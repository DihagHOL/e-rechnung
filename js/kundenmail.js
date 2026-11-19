/**
 * Rechnungsadresse je Kunde (BT-49)
 * =================================
 * Die XRechnung braucht eine elektronische Adresse des Rechnungsempfängers. Das ist das
 * Rechnungspostfach des Kunden (z. B. rechnung@kunde.de), nicht die Adresse dessen, der
 * die Rechnung erstellt. Die App merkt sich die Adresse je Werk und Kunde und schlägt sie
 * beim nächsten Mal vor. Gespeichert wird in SharePoint (E-Rechnung/kunden-rechnungsmail.json,
 * js/sharepoint.js), nicht im Code, weil die Seite öffentlich ist.
 *
 * Eintrag: { werk, kundennummer, vat, name, mail, betreff, am, von }
 * Gesucht wird nach Kunden-Nr., dann USt-IdNr., dann Name, jeweils im selben Werk.
 * betreff (optional) ist die Betreffvorgabe des Kunden für die Rechnungsmail, siehe kundenBetreff.
 * Ein Eintrag darf auch nur den Betreff tragen, ohne Mail (die Adresse steht dann im Beleg).
 */

function _kmNorm(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Eintrag zu einer Rechnung, der das Feld `feld` trägt (mail, betreff), sonst null. Ohne feld jeder Eintrag. */
function _kmSuchen(eintraege, d, feld) {
  const werk = _kmNorm(d.gesellschaft || d.werk);
  const imWerk = e => !e.werk || !werk || _kmNorm(e.werk) === werk;
  const liste = (eintraege || []).filter(e => e && (!feld || String(e[feld] || '').trim()) && imWerk(e));
  const gleich = (a, b) => a && b && _kmNorm(a) === _kmNorm(b);
  return liste.find(e => gleich(e.kundennummer, d.kundennummer))
    || liste.find(e => gleich(String(e.vat || '').replace(/\s+/g, ''), String(d.kaeufervat || '').replace(/\s+/g, '')))
    || liste.find(e => gleich(e.name, d.kaeufer))
    || null;
}

/** Passenden Eintrag mit Rechnungsadresse zu einer Rechnung finden, sonst null. */
function kundenMailFinden(eintraege, d) {
  return _kmSuchen(eintraege, d, 'mail');
}

/**
 * Betreff der Rechnungsmail nach der Vorgabe des Kunden, sonst ''.
 * Ein Wort wie „Invoice“ oder „Faktura“ ersetzt „Rechnung“ im üblichen Betreff
 * („Invoice 92001234 – Eisenwerk Arnstadt GmbH“). Eine Vorgabe mit Platzhaltern wird ganz
 * übernommen: eine Ziffernfolge mit xxx (z. B. 92xxxxxx) wird die Rechnungsnummer, „Datum“
 * das Rechnungsdatum (TT.MM.JJJJ), etwa AR_92xxxxxx_1099002_Datum.
 */
function kundenBetreff(eintraege, d) {
  const e = _kmSuchen(eintraege, d, 'betreff');
  const vorgabe = e ? String(e.betreff).trim() : '';
  if (!vorgabe) return '';
  const nr = String(d.rechnungsnummer || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d.rechnungsdatum || ''));
  const datum = m ? `${m[3]}.${m[2]}.${m[1]}` : '';
  if (/\d*x{3,}/i.test(vorgabe) || /Datum/.test(vorgabe)) {
    return vorgabe.replace(/\d*x{3,}/i, () => nr).replace(/Datum/, () => datum);
  }
  return [vorgabe, nr].filter(Boolean).join(' ') + (d.verkaeufer ? ' – ' + d.verkaeufer : '');
}

/** Gehört die Adresse zur eigenen Firma (gleiche Domain wie die Verkäufer-Mail)? */
function kundenMailIstEigen(mail, verkaeuferemail) {
  const domain = String(verkaeuferemail || '').split('@')[1];
  const m = String(mail || '').trim().toLowerCase();
  return !!(domain && m.endsWith('@' + domain.trim().toLowerCase()));
}

/** Adressen aus dem Feld: „a@kunde.de; b@kunde.de“ ergibt beide, sonst eine. */
function kundenMailListe(mail) {
  return String(mail || '').split(/[;,\s]+/).filter(Boolean);
}

/** Sieht jede Adresse im Feld wie eine Mailadresse aus? */
function kundenMailGueltig(mail) {
  const l = kundenMailListe(mail);
  return l.length > 0 && l.every(m => /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(m));
}

/** Konzernadresse bei einem Kunden außerhalb des Konzerns: Die Rechnung käme nie beim Kunden an. */
function kundenMailImKonzern(mail, kaeufer) {
  return /dihag/i.test(String(mail || '').split('@')[1] || '') && !/dihag/i.test(String(kaeufer || ''));
}

/**
 * Passt die Adresse im Formular zum Register? Gemeldet wird eine andere gemerkte Adresse für
 * diesen Kunden ({ art: 'gemerkt', eintrag }) oder eine Adresse, die bei einem anderen Kunden
 * im selben Werk gemerkt ist ({ art: 'fremd', eintrag }). Sonst null.
 */
function kundenMailAbweichung(eintraege, d) {
  const mail = kundenMailListe(d.kaeufermail).join(';').toLowerCase();
  if (!mail || d.leitwegid) return null;
  const gleicheMail = e => kundenMailListe(e.mail).join(';').toLowerCase() === mail;
  const eigener = kundenMailFinden(eintraege, d);
  if (eigener) return gleicheMail(eigener) ? null : { art: 'gemerkt', eintrag: eigener };
  // Ein Kunde mit mehreren Kundennummern teilt sich oft ein Postfach: gleicher Name vorn, kein Treffer
  const vorn = s => _kmNorm(s).split(' ')[0];
  const werk = _kmNorm(d.gesellschaft || d.werk);
  const fremd = (eintraege || []).find(e => e && e.mail && gleicheMail(e) && _kmNorm(e.werk) === werk && vorn(e.name) !== vorn(d.kaeufer));
  return fremd ? { art: 'fremd', eintrag: fremd } : null;
}

/**
 * Eintrag für eine exportierte Rechnung übernehmen. Gibt die neue Liste zurück, oder
 * null, wenn sich nichts ändert (Adresse schon bekannt, eigene Adresse, Leitweg-ID).
 */
function kundenMailUebernehmen(eintraege, d, von, jetzt) {
  const mail = String(d.kaeufermail || '').trim();
  if (!mail || d.leitwegid || kundenMailIstEigen(mail, d.verkaeuferemail) || kundenMailImKonzern(mail, d.kaeufer)) return null;
  if (!d.kundennummer && !d.kaeufervat && !d.kaeufer) return null;
  const liste = (eintraege || []).slice();
  // Auch ein Eintrag nur mit Betreff zählt, sonst stünde der Kunde danach zweimal in der Liste
  const alt = kundenMailFinden(liste, d) || _kmSuchen(liste, d, 'betreff');
  if (alt && _kmNorm(alt.mail) === _kmNorm(mail)) return null;
  const neu = {
    werk: String(d.gesellschaft || '').toUpperCase(),
    kundennummer: d.kundennummer || (alt && alt.kundennummer) || '',
    vat: String(d.kaeufervat || (alt && alt.vat) || '').replace(/\s+/g, ''),
    name: d.kaeufer || (alt && alt.name) || '',
    mail,
    am: jetzt || new Date().toISOString(),
    von: von || '',
  };
  if (alt && alt.betreff) neu.betreff = alt.betreff;
  if (alt) liste[liste.indexOf(alt)] = neu; else liste.push(neu);
  return liste;
}

/**
 * Zeilen „Werk;Kunden-Nr.;Kunde;Mail;Betreff“ einlesen (Betreff optional). Mit Tabulator
 * getrennte Zeilen aus Excel gehen auch, dann darf das Mailfeld mehrere Adressen mit
 * Semikolon tragen. Ohne Mail braucht die Zeile einen Betreff. Ungültige Zeilen werden
 * gezählt, nicht übernommen.
 */
function kundenMailZeilen(text) {
  const eintraege = [];
  let fehler = 0;
  for (const roh of String(text || '').split(/\r?\n/)) {
    const z = roh.trim();
    if (!z || /^werk\s*[;\t,]/i.test(z)) continue;
    const t = z.includes('\t') ? z.split(/\s*\t\s*/)
      : z.split(/\s*;\s*/).length >= 4 ? z.split(/\s*;\s*/) : z.split(/\s*,\s*/);
    const [werk, kundennummer, name, mailRoh, betreffRoh] = t;
    const mail = kundenMailListe(mailRoh).join('; ');
    const betreff = String(betreffRoh || '').trim();
    if (mail ? !kundenMailGueltig(mail) : !betreff) { fehler++; continue; }
    const e = { werk: String(werk || '').trim().toUpperCase(), kundennummer: String(kundennummer || '').trim(),
      vat: '', name: String(name || '').trim(), mail };
    if (betreff) e.betreff = betreff;
    eintraege.push(e);
  }
  return { eintraege, fehler };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { kundenMailFinden, kundenBetreff, kundenMailIstEigen, kundenMailListe, kundenMailGueltig, kundenMailImKonzern,
    kundenMailAbweichung, kundenMailUebernehmen, kundenMailZeilen };
}
