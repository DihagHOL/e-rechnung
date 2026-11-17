'use strict';
/**
 * Sichtbild ↔ eingebettete XML abgleichen (ZUGFeRD/Factur-X)
 * =========================================================
 * Umsatzsteuerlich ist die XML der Beleg, der PDF-Bildteil nur Visualisierung
 * (UStAE 14.4 Abs. 3; GoBD-Leitfaden Kap. 9). Es wird daher NICHT abgelehnt und
 * IMMER aus der XML gebucht. Eine automatische Rueckfrage an den Lieferanten
 * erfolgt NUR bei MATERIELLEN Abweichungen — solchen, die den Steuerbetrag oder
 * die Belegidentitaet veraendern — nicht bei Rundungs-/Darstellungsdifferenzen
 * (vgl. UStAE 14c.1 Abs. 4a).
 *
 * Wir extrahieren den PDF-Text (src/pdftext.js: pdf.js 6),
 * lesen die dort gedruckten Betraege
 * und vergleichen sie mit den XML-Werten (Steuerbetrag, Bruttobetrag) mit einer
 * Rundungstoleranz. Konservativ: ohne verlaesslich lesbaren Text/Betrag -> Status
 * "nicht-pruefbar" statt Fehlalarm.
 *
 * Seit 17.11.2026 zusaetzlich (jeweils nur, wenn der Wert in der XML steht):
 *   - Empfaengername und -ort: die tragenden Woerter muessen im Bild stehen
 *     (Rechtsform, Umlaute, Zeilenumbrueche zaehlen nicht).
 *   - Rechnungsdatum: im Bild in einer der ueblichen Schreibweisen, einen Tag Abstand
 *     toleriert (manche Programme verschieben das Datum beim Umrechnen der Zeitzone).
 *   - IBAN: Zeigt das Bild gueltige IBANs (Pruefziffer) und die IBAN der XML ist nicht
 *     darunter, waere das Geld an ein Konto gegangen, das auf der Rechnung nicht steht.
 *     Ohne IBAN im Bild keine Aussage.
 * Nicht geprueft, weil es am Bestand nur Fehlalarme gab: Nettobetrag (oft nicht oder als
 * „1.031,-“ gedruckt), PLZ (Postfach gegen Strasse), USt-IdNr. des Lieferanten (oft Grafik).
 * Gegenprobe 17.11.2026 an 367 echten ZUGFeRD-Eingaengen: Name, Ort, Datum ohne Treffer,
 * IBAN 11 Rechnungen mit anderem Konto im Bild.
 */
const { pdfText } = require('./pdftext');

const TOLERANZ = 0.02;   // Cent-Rundung tolerieren (keine materielle Abweichung)
const MAX_SEITEN = 100;  // Die Summe steht am Ende, also alle Seiten lesen

// Woerter, die in Firmennamen nichts unterscheiden (Rechtsformen, Artikel)
const FUELLWOERTER = new Set(['gmbh', 'mbh', 'co', 'kg', 'ag', 'se', 'ug', 'ohg', 'gbr', 'ev', 'und', 'der', 'die', 'das', 'fuer',
  'the', 'of', 'and', 'sp', 'oo', 'srl', 'sro', 'as', 'sa', 'sas', 'ltd', 'limited', 'inc', 'bv', 'nv', 'kft', 'spa', 'werk',
  'firma', 'haftungsbeschraenkt']);
// IBAN-Laenge je Land (Auswahl Europa). Andere Laendercodes zaehlen nicht als IBAN.
const IBAN_LAENGE = { DE: 22, AT: 20, CH: 21, LI: 21, NL: 18, BE: 16, LU: 20, FR: 27, MC: 27, IT: 27, SM: 27, ES: 24, PT: 25,
  PL: 28, CZ: 24, SK: 24, HU: 28, SI: 19, HR: 21, DK: 18, SE: 24, FI: 18, NO: 15, GB: 22, IE: 22, GR: 27, RO: 24, BG: 22,
  EE: 20, LV: 21, LT: 20, MT: 31, CY: 28, TR: 26 };
const MONATE = [['januar', 'january', 'jan'], ['februar', 'february', 'feb'], ['maerz', 'march', 'mar'], ['april', 'apr'],
  ['mai', 'may'], ['juni', 'june', 'jun'], ['juli', 'july', 'jul'], ['august', 'aug'], ['september', 'sep'],
  ['oktober', 'october', 'okt', 'oct'], ['november', 'nov'], ['dezember', 'december', 'dez', 'dec']];

/**
 * @param {Buffer} pdfBuf  Das ZUGFeRD/Factur-X-PDF (Sichtbild + eingebettete XML).
 * @param {object} daten   Geparste XML-Kopfdaten (mapDaten): nummer, mwst, brutto, …
 * @returns {Promise<{status:'ok'|'abweichung'|'nicht-pruefbar', pruefbar:boolean,
 *                     materiell:boolean, hinweis:string, fehler?:string}>}
 */
async function pdfXmlAbgleich(pdfBuf, daten) {
  daten = daten || {};

  let text = '';
  try {
    text = (await pdfText(pdfBuf, { maxSeiten: MAX_SEITEN })).text;
  } catch (e) {
    return { status: 'nicht-pruefbar', pruefbar: false, materiell: false, hinweis: '',
             fehler: e && e.message ? e.message : String(e) };
  }

  const flat = text.replace(/\s+/g, ' ');
  const alnum = (flat.match(/[A-Za-z0-9]/g) || []).length;
  if (alnum < 120) {
    return {
      status: 'nicht-pruefbar', pruefbar: false, materiell: false,
      hinweis: 'Sichtprüfung PDF↔XML nicht möglich (PDF ohne extrahierbaren Text — evtl. Scan). '
             + 'Übereinstimmung von Steuerbetrag/Belegnummer bitte manuell prüfen.',
    };
  }

  const amounts = _amounts(flat);
  // Keine lesbaren Betraege -> Betragsvergleich nicht moeglich.
  if (!amounts.size) {
    return {
      status: 'nicht-pruefbar', pruefbar: false, materiell: false,
      hinweis: 'Sichtprüfung PDF↔XML nicht möglich (keine lesbaren Beträge im Bild). '
             + 'Steuerbetrag bitte manuell abgleichen.',
    };
  }
  // Ohne Vorzeichen: Die XML einer Gutschrift hat positive Beträge, das Sichtbild oft negative
  const near = target => {
    for (const a of amounts) if (Math.abs(Math.abs(a) - target) <= TOLERANZ) return true;
    return false;
  };
  const eur = v => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

  const abw = [];

  // Belegidentitaet: Rechnungsnummer (unterschiedliche Nummer = anderer Beleg, materiell).
  const nr = String(daten.nummer || daten.rechnungsnummer || '').trim();
  const nummerOk = !nr || nr.length < 5
    || flat.includes(nr) || flat.replace(/[\s.]/g, '').toLowerCase().includes(nr.replace(/[\s.]/g, '').toLowerCase())
    || _gleicheZiffern(flat, nr);
  if (!nummerOk) abw.push(`Rechnungsnummer „${nr}" steht nicht im Sichtbild`);

  // Steuerbetrag (MATERIELL): muss im Bild stehen (Rundung toleriert).
  const vat = Number(daten.mwst != null ? daten.mwst : daten.vatTotal);
  if (Number.isFinite(vat) && vat > 0 && !near(vat)) {
    abw.push(`Steuerbetrag ${eur(vat)} steht nicht im Sichtbild`);
  }

  // Bruttobetrag (MATERIELL, sofern nicht nur Rundung): muss im Bild stehen.
  const gross = Number(daten.brutto != null ? daten.brutto : daten.grossTotal);
  if (Number.isFinite(gross) && gross > 0 && !near(gross)) {
    abw.push(`Bruttobetrag ${eur(gross)} steht nicht im Sichtbild`);
  }

  // Empfaenger: Name und Ort aus der XML muessen im Bild stehen
  const textNorm = _norm(text), textOhne = textNorm.replace(/ /g, '');
  const fehlend = s => _woerter(s).filter(w => !textNorm.includes(w) && !textOhne.includes(w));
  if (daten.empfaenger && fehlend(daten.empfaenger).length) {
    abw.push(`Empfänger „${daten.empfaenger}“ steht nicht im Sichtbild`);
  }
  if (daten.empfaengerOrt && fehlend(daten.empfaengerOrt).length) {
    abw.push(`Ort des Empfängers „${daten.empfaengerOrt}“ steht nicht im Sichtbild`);
  }

  // Rechnungsdatum, einen Tag Abstand toleriert
  if (daten.datum && _datumImText(text, daten.datum) === false) {
    abw.push(`Rechnungsdatum ${_datumDe(daten.datum)} steht nicht im Sichtbild`);
  }

  // Bankverbindung: andere gueltige IBAN im Bild als in der XML
  const xmlIban = String(daten.iban || '').replace(/\s+/g, '').toUpperCase();
  if (_ibanGueltig(xmlIban) && !_ibanImText(text, xmlIban)) {
    const bild = _ibansImText(text);
    if (bild.length && !bild.includes(xmlIban)) {
      abw.push(`IBAN ${_ibanLesbar(xmlIban)} aus der XML steht nicht im Sichtbild, dort steht ${bild.map(_ibanLesbar).join(' bzw. ')}`);
    }
  }

  if (abw.length) {
    return {
      status: 'abweichung', pruefbar: true, materiell: true,
      // Kurz halten: Die Spalte ValidierungsMeldung nimmt 255 Zeichen, /api/intake stellt diesen
      // Grund bei einer Rueckfrage nach vorn (feldlaenge.js kuerzt hinten).
      hinweis: 'Materielle Abweichung Sichtbild ↔ XML: ' + abw.join('; ') + '. Gebucht wird aus der XML.',
    };
  }
  return { status: 'ok', pruefbar: true, materiell: false, hinweis: '' };
}

/**
 * Dieselbe Nummer mit anderer Schreibweise: „DRA/10085621“ in der XML und 10085621 im Bild,
 * „0092658542“ und 92658542. Verglichen werden die Ziffern ohne führende Nullen, mindestens fünf.
 */
function _gleicheZiffern(text, nr) {
  const ziffern = s => String(s).replace(/\D/g, '').replace(/^0+/, '');
  const soll = ziffern(nr);
  if (soll.length < 5) return false;
  return (text.match(/[A-Za-z0-9/.-]*\d[A-Za-z0-9/.-]*/g) || []).some(w => ziffern(w) === soll);
}

/**
 * Alle gedruckten Geldbetraege aus dem Text als Zahlenmenge (auf 2 NK gerundet).
 * Zwei Durchgaenge: einmal mit Leerzeichen als Tausendertrenner („1 035,18"),
 * einmal ohne. Sonst verschmilzt eine Menge vor dem Betrag („1 869,90") zu einer
 * falschen Zahl und der echte Betrag fehlt in der Menge.
 */
function _amounts(text) {
  const set = new Set();
  const muster = [
    /-?\d{1,3}(?:[.\s]\d{3})+[.,]\d{2}|-?\d+[.,]\d{2}/g,
    /-?\d{1,3}(?:\.\d{3})+,\d{2}|-?\d{1,3}(?:,\d{3})+\.\d{2}|-?\d+[.,]\d{2}/g,
  ];
  for (const re of muster) {
    let m;
    while ((m = re.exec(text))) {
      const v = _num(m[0]);
      if (v != null) set.add(Math.round(v * 100) / 100);
    }
  }
  return set;
}

/** Betragsstring -> Zahl. Letztes ,/. = Dezimaltrenner; Rest = Tausendertrenner. */
function _num(t) {
  t = String(t).replace(/\s/g, '');
  const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
  const dec = lc > ld ? ',' : '.';
  const s = dec === ',' ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

/** Text fuer Wortvergleiche: klein, Umlaute ausgeschrieben, nur Buchstaben und Ziffern. */
function _norm(s) {
  return String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').replace(/ +/g, ' ').trim();
}

/** Tragende Woerter eines Namens: ab drei Zeichen, ohne Rechtsform und Artikel. */
function _woerter(s) {
  return [...new Set(_norm(s).split(' ').filter(w => w.length >= 3 && !FUELLWOERTER.has(w)))];
}

/**
 * Steht das Datum (JJJJ-MM-TT) im Text? Geprueft werden der Tag selbst und je ein Tag davor
 * und danach in den ueblichen Schreibweisen. null = Datum nicht lesbar, dann keine Aussage.
 */
function _datumImText(text, iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  const flach = String(text).replace(/\s+/g, '');
  const woerter = _norm(text);
  const basis = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  for (const versatz of [0, -1, 1]) {
    const d = new Date(basis + versatz * 86400000);
    const j = String(d.getUTCFullYear()), mo = String(d.getUTCMonth() + 1).padStart(2, '0'), t = String(d.getUTCDate()).padStart(2, '0');
    const ti = String(+t), mi = String(+mo), jj = j.slice(2);
    const formen = [`${t}.${mo}.${j}`, `${ti}.${mi}.${j}`, `${t}.${mo}.${jj}`, `${ti}.${mi}.${jj}`, `${j}-${mo}-${t}`, `${j}.${mo}.${t}`,
      `${t}/${mo}/${j}`, `${mo}/${t}/${j}`, `${t}/${mo}/${jj}`, `${t}-${mo}-${j}`, `${j}${mo}${t}`];
    if (formen.some(f => flach.includes(f))) return true;
    if (MONATE[+mo - 1].some(n => woerter.includes(`${ti} ${n} ${j}`) || woerter.includes(`${n} ${ti} ${j}`)
      || woerter.includes(`${ti} ${n} ${jj}`))) return true;
  }
  return false;
}

function _datumDe(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || '');
}

/** IBAN mit gueltiger Laenge fuer das Land und stimmender Pruefziffer (Mod 97). */
function _ibanGueltig(iban) {
  const s = String(iban || '');
  if (IBAN_LAENGE[s.slice(0, 2)] !== s.length || !/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(s)) return false;
  let rest = 0;
  for (const c of s.slice(4) + s.slice(0, 4)) {
    const v = /[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c;
    for (const z of v) rest = (rest * 10 + Number(z)) % 97;
  }
  return rest === 1;
}

/**
 * Alle gueltigen IBANs im Text, mit oder ohne einzelne Leerzeichen zwischen den Zeichen.
 * Gesucht wird nur der Anfang (Land und Pruefziffer), der Rest wird Zeichen fuer Zeichen
 * gelesen. So verschluckt ein Fragment wie „FF 683“ (Teil eines BIC) nicht die IBAN dahinter.
 */
function _ibansImText(text) {
  const gefunden = new Set();
  const gross = String(text || '').toUpperCase();
  for (const m of gross.matchAll(/(?<![A-Z0-9])([A-Z]{2}) ?([0-9]{2})(?= ?[A-Z0-9])/g)) {
    const laenge = IBAN_LAENGE[m[1]];
    if (!laenge) continue;
    let rest = '';
    for (let i = m.index + m[0].length; i < gross.length && rest.length < laenge - 4; i++) {
      const c = gross[i];
      if (/[A-Z0-9]/.test(c)) rest += c;
      else if (c !== ' ' || gross[i + 1] === ' ') break;
    }
    const kandidat = m[1] + m[2] + rest;
    if (_ibanGueltig(kandidat)) gefunden.add(kandidat);
  }
  return [...gefunden];
}

/** Steht die IBAN im Text, auch umbrochen oder mit Satzzeichen zwischen den Gruppen? */
function _ibanImText(text, iban) {
  return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').includes(iban);
}

function _ibanLesbar(iban) {
  return String(iban).replace(/(.{4})(?=.)/g, '$1 ');
}

module.exports = { pdfXmlAbgleich, _ibanGueltig, _ibansImText, _datumImText, _woerter };
