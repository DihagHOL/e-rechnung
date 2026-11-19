/**
 * Rechnungsdaten prüfen und korrigieren (Monitoring)
 * ==================================================
 * Bei einer PDF ohne E-Rechnung liest der Prüfdienst Lieferant, USt-IdNr., Nummer, Datum,
 * Fälligkeit und Beträge aus dem Text oder per Texterkennung. Das ist ein Vorschlag, und
 * manches stimmt nicht (Denis, 19.11.2026: bei DSO stand die Kunden-USt-IdNr. als die des
 * Lieferanten). Hier korrigiert die Kreditorenbuchhaltung die Werte, in jedem Werk, auch wenn
 * „Bearbeiten“ im Monitoring für das Werk aus ist.
 *
 * Geschrieben wird an die Datei der Rechnung in ERAR_<Werk> (dieselben Spalten, die der
 * Eingangs-Flow füllt; SharePoint führt den Versionsverlauf). Im Lieferantenregister stehen
 * danach wer und wann geprüft hat (rechnungen[..].daten), und der Lieferant ist bestätigt.
 * Ab dann zeigt das Monitoring die Werte nicht mehr grau.
 */

/** Spalten in ERAR_<Werk> je Feld des Dialogs. */
const RD_SPALTEN = {
  lieferant: 'Rechnungssteller', vat: 'RechnungsstellerUStID', nummer: 'Title', datum: 'Rechnungsdatum',
  faelligkeit: 'Faelligkeitsdatum', netto: 'Nettobetrag', brutto: 'Bruttobetrag', waehrung: 'Waehrung',
};
const RD_NAMEN = {
  lieferant: 'Lieferant', vat: 'USt-IdNr.', nummer: 'Rechnungsnummer', datum: 'Rechnungsdatum',
  faelligkeit: 'Fällig am', netto: 'Netto', brutto: 'Brutto', waehrung: 'Währung',
};

let _rdAktuell = null;

/* ── Reine Logik (auch in tests/rechnungsdaten.test.js) ──────────────── */

/** Lässt sich die Zeile hier korrigieren? Eingang, Datei in ERAR_<Werk>, ohne E-Rechnungs-XML. */
function rdMoeglich(r) {
  if (!r || r.richtung !== 'Eingang' || r.intake) return false;
  const z = r.bhQuelle || r;
  if (!z.listId || !z.itemId) return false;
  return typeof ugMitXml === 'function' ? !ugMitXml(r) : !/zugferd|xrechnung/i.test(r.format || '');
}

/** Eintrag im Register: wer hat die gelesenen Daten dieser Rechnung geprüft? */
function rdGeprueft(r) {
  if (typeof _ug === 'undefined' || typeof ugRechnungKey !== 'function' || !r) return null;
  const zu = _ug.daten.rechnungen[ugRechnungKey(r)];
  return (zu && zu.daten) || null;
}

/** Betrag aus der Eingabe: „2.507,50“, „2507,5“, „2507.50“, „-12,00“. Leer = null, sonst NaN bei Unsinn. */
function rdBetrag(s) {
  let t = String(s == null ? '' : s).replace(/\s+/g, '').replace(/€|EUR/gi, '');
  if (!t) return null;
  if (/,/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  return /^-?\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) / 100 : NaN;
}

/** USt-IdNr. ohne Leerzeichen, Punkte und Striche, groß. */
function rdVat(s) {
  return String(s || '').replace(/[\s.-]+/g, '').toUpperCase();
}

/** Werte, mit denen der Dialog startet: so, wie das Monitoring sie zeigt. */
function rdWerte(r) {
  const name = typeof _monPartner === 'function' ? _monPartner(r) : '';
  return {
    lieferant: name || r.steller || '',
    vat: r.ustid || '',
    nummer: r.nummer || '',
    datum: r.datumAusRechnung ? String(r.datum || '').slice(0, 10) : '',
    faelligkeit: String(r.faelligkeit || '').slice(0, 10),
    netto: r.netto == null ? null : r.netto,
    brutto: r.brutto == null ? null : r.brutto,
    waehrung: r.waehrungFeld || r.waehrung || 'EUR',
    werk: r.werk || '',
  };
}

/**
 * Eingaben prüfen und als PATCH-Inhalt für die Datei liefern (nur was sich ändert).
 * @param alt  rdWerte(r)
 * @param neu  Eingaben aus dem Dialog (Texte)
 * @returns {{ felder: object, geaendert: string[], fehler: string[] }}
 */
function rdAenderungen(alt, neu) {
  const felder = {}, geaendert = [], fehler = [];
  const setze = (k, wert) => { felder[RD_SPALTEN[k]] = wert; geaendert.push(k); };
  const text = k => String(neu[k] == null ? '' : neu[k]).replace(/\s+/g, ' ').trim();

  const lieferant = text('lieferant');
  if (lieferant !== String(alt.lieferant || '').trim()) {
    if (!lieferant) fehler.push('Bitte den Lieferanten angeben.');
    else setze('lieferant', lieferant.slice(0, 255));
  }
  const vat = rdVat(neu.vat);
  if (vat !== rdVat(alt.vat)) {
    if (vat && !/^[A-Z]{2}[0-9A-Z]{8,12}$/.test(vat)) fehler.push('Die USt-IdNr. hat nicht das übliche Format (etwa DE123456789).');
    else if (vat && typeof vatDesWerks === 'function' && vat === vatDesWerks(alt.werk)) {
      fehler.push(`Das ist die USt-IdNr. von ${alt.werk}, also des Empfängers. Gesucht ist die des Lieferanten.`);
    } else if (vat && typeof istEigeneVat === 'function' && istEigeneVat(vat)
        && !(typeof istEigen === 'function' && istEigen(lieferant || alt.lieferant))) {
      fehler.push('Das ist die USt-IdNr. einer Konzerngesellschaft. Sie passt nur, wenn diese Gesellschaft der Lieferant ist.');
    } else setze('vat', vat);
  }
  const nummer = text('nummer');
  if (nummer !== String(alt.nummer || '').trim()) {
    if (!nummer) fehler.push('Bitte die Rechnungsnummer angeben.');
    else setze('nummer', nummer.slice(0, 255));
  }
  for (const k of ['datum', 'faelligkeit']) {
    const d = text(k);
    if (d === String(alt[k] || '')) continue;
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) { fehler.push(`${RD_NAMEN[k]}: kein gültiges Datum.`); continue; }
    // Mittag UTC: Der Kalendertag bleibt in Deutschland derselbe
    setze(k, d ? d + 'T12:00:00Z' : null);
  }
  for (const k of ['netto', 'brutto']) {
    const b = rdBetrag(neu[k]);
    if (Number.isNaN(b)) { fehler.push(`${RD_NAMEN[k]}: bitte einen Betrag wie 1.234,56 eingeben.`); continue; }
    if (b === (alt[k] == null ? null : alt[k])) continue;
    setze(k, b);
  }
  const w = text('waehrung').toUpperCase();
  if (w !== String(alt.waehrung || '').toUpperCase()) {
    if (!/^[A-Z]{3}$/.test(w)) fehler.push('Währung: drei Buchstaben, etwa EUR.');
    else setze('waehrung', w);
  }
  const n = 'netto' in felder || !Number.isNaN(rdBetrag(neu.netto)) ? rdBetrag(neu.netto) : null;
  const b = rdBetrag(neu.brutto);
  if (n != null && b != null && !Number.isNaN(n) && !Number.isNaN(b) && Math.abs(b) < Math.abs(n)) {
    fehler.push('Brutto ist kleiner als Netto. Bitte die Beträge prüfen.');
  }
  return { felder, geaendert, fehler };
}

/** Geänderte Spalten in den geladenen Daten nachziehen (Datei-Datensatz). */
function rdUebernehmen(z, felder) {
  if (!z) return;
  if ('Rechnungssteller' in felder) z.steller = felder.Rechnungssteller;
  if ('RechnungsstellerUStID' in felder) z.ustid = felder.RechnungsstellerUStID;
  if ('Title' in felder) { z.titel = z.nummer = felder.Title; z.nummerAusDatei = false; }
  if ('Rechnungsdatum' in felder) {
    z.datum = felder.Rechnungsdatum ? felder.Rechnungsdatum.slice(0, 10) : (z.erstellt || '').slice(0, 10);
    z.datumAusRechnung = !!felder.Rechnungsdatum;
  }
  if ('Faelligkeitsdatum' in felder) z.faelligkeit = felder.Faelligkeitsdatum ? felder.Faelligkeitsdatum.slice(0, 10) : '';
  if ('Nettobetrag' in felder) z.netto = felder.Nettobetrag;
  if ('Bruttobetrag' in felder) z.brutto = felder.Bruttobetrag;
  if ('Waehrung' in felder) z.waehrung = z.waehrungFeld = felder.Waehrung;
}

/* ── Dialog ──────────────────────────────────────────────────────────── */

function _rdEsc(s) {
  return typeof _esc === 'function' ? _esc(s)
    : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _rdBetragText(v) {
  return v == null ? '' : v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Öffnet den Dialog für eine Zeile. onGespeichert: Rückruf nach dem Speichern. */
function rdDialogOeffnen(r, onGespeichert) {
  const dlg = document.getElementById('rd-dialog');
  if (!dlg || !rdMoeglich(r)) return;
  const alt = rdWerte(r);
  _rdAktuell = { r, alt, onGespeichert };
  const g = rdGeprueft(r);
  const wer = g ? `Geprüft von ${g.vonName || g.von || ''} am ${typeof _monDate === 'function' ? _monDate(g.am) : String(g.am).slice(0, 10)}`
    + (g.felder && g.felder.length ? `, geändert: ${g.felder.map(k => RD_NAMEN[k] || k).join(', ')}.` : ', nichts geändert.') : '';
  const bekannte = typeof _ug !== 'undefined' ? Object.values(_ug.daten.lieferanten).map(l => l.name).filter(Boolean).sort() : [];
  const feld = (id, label, wert, extra) => `<label class="ug-lbl">${label}<input id="rd-${id}" value="${_rdEsc(wert)}" autocomplete="off"${extra || ''}></label>`;
  dlg.innerHTML = `
    <form method="dialog" class="ug-form">
      <div class="ug-kopf">
        <h3>Rechnungsdaten ${_rdEsc(r.nummer)}</h3>
        <button type="button" class="ug-x" data-rd-zu aria-label="Schließen">✕</button>
      </div>
      <p class="ug-regel">Die Rechnung ist eine PDF ohne E-Rechnung. Die Werte sind aus dem Text oder per Texterkennung gelesen.
        Bitte mit der Rechnung vergleichen und falsche Werte korrigieren. Mit dem Speichern gelten sie als geprüft.</p>
      ${r.url ? `<p class="ug-hinweis"><a href="${_rdEsc(r.url)}" target="_blank" rel="noopener">Rechnung öffnen ↗</a></p>` : ''}
      <div class="bh-raster">
        ${feld('lieferant', 'Lieferant', alt.lieferant, ' list="rd-lieferanten"')}
        ${feld('vat', 'USt-IdNr. des Lieferanten', alt.vat, ' placeholder="DE123456789"')}
      </div>
      <datalist id="rd-lieferanten">${bekannte.map(n => `<option value="${_rdEsc(n)}">`).join('')}</datalist>
      <div class="bh-raster">
        ${feld('nummer', 'Rechnungsnummer', alt.nummer)}
        ${feld('datum', 'Rechnungsdatum', alt.datum, ' type="date"')}
        ${feld('faelligkeit', 'Fällig am', alt.faelligkeit, ' type="date"')}
      </div>
      <div class="bh-raster">
        ${feld('netto', 'Netto', _rdBetragText(alt.netto), ' inputmode="decimal"')}
        ${feld('brutto', 'Brutto', _rdBetragText(alt.brutto), ' inputmode="decimal"')}
        ${feld('waehrung', 'Währung', alt.waehrung, ' maxlength="3"')}
      </div>
      ${wer ? `<p class="ug-hinweis">${_rdEsc(wer)}</p>` : ''}
      <p class="ug-meldung" id="rd-meldung" role="status"></p>
      <div class="ug-aktionen">
        <button type="button" class="ug-sek" data-rd-zu>Abbrechen</button>
        <button type="button" class="ug-prim" data-rd-speichern>Speichern</button>
      </div>
    </form>`;
  dlg.querySelectorAll('[data-rd-zu]').forEach(x => x.addEventListener('click', () => dlg.close()));
  dlg.querySelector('[data-rd-speichern]').addEventListener('click', _rdSpeichern);
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
}

function _rdMeldung(text, art) {
  const el = document.getElementById('rd-meldung');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'ug-meldung' + (art ? ' ' + art : '');
}

async function _rdSchreiben(r, felder) {
  const z = r.bhQuelle || r;
  const site = (typeof _bh !== 'undefined' && _bh.siteId) || (typeof _ug !== 'undefined' && _ug.siteId);
  const token = await acquireToken(SP.scopes);
  if (!token) throw new Error('Nicht angemeldet.');
  const resp = await fetch(`${SP.graphBase}/sites/${site}/lists/${z.listId}/items/${z.itemId}/fields`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(felder),
  });
  if (resp.ok) return resp.json();
  const text = await resp.text();
  if (resp.status === 401 || resp.status === 403) throw new Error(`Keine Schreibrechte auf ERAR_${r.werk}. Die Buchhaltung braucht dort „Mitwirken“.`);
  if (/record|retention|Datensatz|Aufbewahrung|locked|gesperrt/i.test(text)) throw new Error('Die Aufbewahrungsbezeichnung der Datei erlaubt keine Änderung der Eigenschaften.');
  throw new Error(`Speichern fehlgeschlagen (${resp.status}): ${text.slice(0, 160)}`);
}

async function _rdSpeichern() {
  const a = _rdAktuell;
  const dlg = document.getElementById('rd-dialog');
  const wert = id => dlg.querySelector('#rd-' + id).value;
  const neu = {};
  for (const k of Object.keys(RD_SPALTEN)) neu[k] = wert(k);
  const { felder, geaendert, fehler } = rdAenderungen(a.alt, neu);
  if (fehler.length) { _rdMeldung(fehler.join(' '), 'nicht'); return; }
  const knopf = dlg.querySelectorAll('.ug-aktionen button');
  knopf.forEach(k => { k.disabled = true; });
  _rdMeldung('Wird gespeichert…');
  const vorher = Object.assign({}, a.r);
  try {
    if (Object.keys(felder).length) {
      await _rdSchreiben(a.r, felder);
      rdUebernehmen(a.r, felder);
      const z = a.r.bhQuelle;
      if (z) rdUebernehmen(z, felder);
      // Datei-Datensatz im Monitoring, damit das neue Zusammenfassen die Werte behält
      if (typeof _monDateien !== 'undefined') {
        const ziel = a.r.bhQuelle || a.r;
        const d = _monDateien.find(x => x.listId === ziel.listId && x.itemId === ziel.itemId);
        if (d) rdUebernehmen(d, felder);
      }
    }
    // Lieferant bestätigen und merken, mit der geprüften USt-IdNr.; geprüft an der Rechnung festhalten
    const name = String(neu.lieferant || '').trim();
    if (typeof ugBestaetigen === 'function' && name) {
      await ugBestaetigen(vorher, name, { vat: rdVat(neu.vat), vatSetzen: geaendert.includes('vat') });
    }
    if (typeof ugRechnungSetzen === 'function') await ugRechnungSetzen(vorher, 'daten', { felder: geaendert });
    dlg.close();
    if (typeof a.onGespeichert === 'function') a.onGespeichert();
  } catch (e) {
    const teil = Object.keys(felder).length && !/Schreibrechte auf ERAR|Speichern fehlgeschlagen|Aufbewahrung|Nicht angemeldet/.test(e.message || '')
      ? 'Die Werte sind an der Rechnung gespeichert, aber nicht im Lieferantenregister: ' : '';
    _rdMeldung(teil + (e.message || String(e)), 'nicht');
    knopf.forEach(k => { k.disabled = false; });
    if (teil && typeof a.onGespeichert === 'function') a.onGespeichert();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RD_SPALTEN, rdMoeglich, rdGeprueft, rdBetrag, rdVat, rdWerte, rdAenderungen, rdUebernehmen };
}
