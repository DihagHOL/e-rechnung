/**
 * Manuelle Rechnungen aus Vorlagen
 * ================================
 * Reiter „Manuelle Rechnung“ (index.html?modus=manuell). Für Rechnungen, die bisher in Word
 * entstanden, z. B. Managementumlagen der Holding: Vorlage wählen, Leistungsmonat setzen, im
 * Formular des Konverters prüfen und ändern, dann wie gewohnt als ZUGFeRD oder XRechnung
 * erzeugen. Die Rechnung landet wie im Konverter in AR_<Werk>.
 *
 * Gespeichert wird in SharePoint (sites/IT, Dokumente/E-Rechnung/rechnungsvorlagen.json,
 * js/sharepoint.js), nicht im Code: Die Vorlagen enthalten Kunden und Beträge.
 *
 * {
 *   version: 1,
 *   nummernkreise: { HOL: { muster: '{n}/{jjjj}', letzte: { '2026': 120 } } },
 *   vorlagen: [{ id, werk, name, leistung: 'monat'|'vormonat'|'keine', zahlungszielTage,
 *                daten: { kaeufer, …, notiz, positionen: [...] }, am, von, geaendertAm, geaendertVon }]
 * }
 *
 * In Texten steht {monat} für den Leistungsmonat („Oktober 2026“) und {jahr} für sein Jahr.
 * Beim Speichern aus dem Formular wird der Monat wieder zu {monat}.
 */

const VL_MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
  'September', 'Oktober', 'November', 'Dezember'];

/** Fußzeile des PDF einer manuellen Rechnung (statt „Konvertiert aus …“). */
const VL_FUSSZEILE = 'E-Rechnung nach EN 16931 · erstellt mit DIHAG E-Rechnung';

/** Felder der Rechnung, die eine Vorlage mitnimmt (Schlüssel wie collectFormData in js/app.js). */
const VL_VORLAGE_FELDER = [
  'kaeufer', 'kaeuferstrasse', 'kaeuferzusatz', 'kaeuferplz', 'kaeuferstadt', 'kaeuferland',
  'leitwegid', 'kaeufermail', 'kaeufervat', 'kundennummer', 'lieferantennummer', 'bestellnummer',
  'lieferName', 'lieferStrasse', 'lieferPlz', 'lieferStadt', 'lieferLand',
  'rechnungsart', 'notiz', 'waehrung', 'steuerkategorie', 'befreiungsgrund', 'vertragsnummer',
  'verkaeufkontakt', 'verkaeuftel', 'verkaeuferemail',
  'zahlungsart', 'kundeIban', 'mandatsreferenz', 'glaeubigerId',
];
const VL_POS_FELDER = ['posnr', 'beschreibung', 'details', 'positionsnotiz', 'bestellposition',
  'menge', 'einheit', 'einzelpreis', 'rabatt', 'mwst'];

/** Stammdaten des Rechnungsstellers (kommen aus der Registry, nie aus der Vorlage). */
const VL_STAMM_FELDER = ['verkaeufer', 'verkaeufstrasse', 'verkaeufplz', 'verkaeufstadt', 'verkaeufland',
  'verkaeufervat', 'verkaeufersteuernr', 'iban', 'bic', 'handelsregister', 'registernr', 'geschaeftsfuehrung'];

/** Felder, die jede neue Rechnung leer beginnt. */
const VL_LEER_FELDER = ['lieferdatum', 'zahlungsreferenz', 'lieferscheinnummer', 'vorrechnungsnummer',
  'vorrechnungsdatum', 'gezahlt'];

const VL_VORGABEN = { kaeuferland: 'DE', waehrung: 'EUR', rechnungsart: '380', steuerkategorie: 'Z', zahlungsart: '58' };

/* ── Datum und Leistungsmonat ─────────────────────────────────────────── */

const _vl2 = n => String(n).padStart(2, '0');

/** Heute als JJJJ-MM-TT in Ortszeit (toISOString wäre UTC und kurz nach Mitternacht der Vortag). */
function vlHeute(d) {
  const t = d || new Date();
  return `${t.getFullYear()}-${_vl2(t.getMonth() + 1)}-${_vl2(t.getDate())}`;
}

/** Datum plus Tage, beides als JJJJ-MM-TT. */
function vlPlusTage(datum, tage) {
  const [j, m, t] = String(datum).split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1, t + (Number(tage) || 0)));
  return `${d.getUTCFullYear()}-${_vl2(d.getUTCMonth() + 1)}-${_vl2(d.getUTCDate())}`;
}

/** Tage zwischen zwei Daten (bis minus von), null wenn eins fehlt. */
function vlTageZwischen(von, bis) {
  if (!von || !bis) return null;
  const ms = s => { const [j, m, t] = String(s).split('-').map(Number); return Date.UTC(j, m - 1, t); };
  return Math.round((ms(bis) - ms(von)) / 86400000);
}

/** Leistungsmonat JJJJ-MM zum Rechnungsdatum: der Monat selbst oder der Vormonat. */
function vlLeistungsmonat(datum, leistung) {
  const [j, m] = String(datum).split('-').map(Number);
  if (leistung !== 'vormonat') return `${j}-${_vl2(m)}`;
  return m === 1 ? `${j - 1}-12` : `${j}-${_vl2(m - 1)}`;
}

/** Erster und letzter Tag eines Monats JJJJ-MM und sein Name („Oktober 2026“). */
function vlMonatsgrenzen(monat) {
  const [j, m] = String(monat).split('-').map(Number);
  const letzter = new Date(Date.UTC(j, m, 0)).getUTCDate();
  return { start: `${j}-${_vl2(m)}-01`, ende: `${j}-${_vl2(m)}-${_vl2(letzter)}`, text: `${VL_MONATE[m - 1]} ${j}`, jahr: String(j) };
}

/* ── Platzhalter ──────────────────────────────────────────────────────── */

/** {monat} und {jahr} durch den Leistungsmonat ersetzen. */
function vlPlatzhalter(s, monat) {
  if (s == null || typeof s !== 'string' || !monat) return s;
  const g = vlMonatsgrenzen(monat);
  return s.split('{monat}').join(g.text).split('{jahr}').join(g.jahr);
}

/** Umkehrung beim Speichern: Der Monatsname wird wieder zu {monat}. */
function vlZurueck(s, monat) {
  if (s == null || typeof s !== 'string' || !monat) return s;
  return s.split(vlMonatsgrenzen(monat).text).join('{monat}');
}

/* ── Nummernkreis ─────────────────────────────────────────────────────── */

/** Nummer nach Muster bilden, z. B. '{n}/{jjjj}' mit 121 und 2026 → '121/2026'. */
function vlNummerBilden(muster, n, jahr) {
  const j = String(jahr);
  return String(muster || '{n}').split('{n}').join(String(n)).split('{jjjj}').join(j).split('{jj}').join(j.slice(2));
}

/** Nummer nach Muster lesen: { n, jahr } oder null, wenn sie nicht zum Muster passt. */
function vlNummerLesen(muster, nummer) {
  const roh = String(nummer || '').trim();
  const zahlen = roh.match(/[0-9]+/g) || [];
  const teile = String(muster || '').match(/[{](n|jjjj|jj)[}]/g) || [];
  if (!teile.includes('{n}') || zahlen.length !== teile.length) return null;
  let n = null;
  let jahr = '';
  teile.forEach((t, i) => {
    if (t === '{n}') n = parseInt(zahlen[i], 10);
    else if (t === '{jjjj}') jahr = zahlen[i];
    else jahr = '20' + zahlen[i];
  });
  if (!jahr || vlNummerBilden(muster, n, jahr) !== roh) return null;
  return { n, jahr };
}

/** Höchste laufende Nummer eines Jahres unter den vergebenen Nummern (0, wenn keine zum Muster passt). */
function vlHoechsteNummer(muster, nummern, jahr) {
  let max = 0;
  for (const nr of nummern || []) {
    const g = vlNummerLesen(muster, nr);
    if (g && g.jahr === String(jahr) && g.n > max) max = g.n;
  }
  return max;
}

/**
 * Vorschlag für die nächste Nummer im Jahr des Rechnungsdatums: nach der höchsten aus Zähler
 * und den schon vergebenen Nummern (Rechnungen in AR_<Werk>).
 */
function vlNaechsteNummer(kreis, jahr, vergeben) {
  if (!kreis || !kreis.muster) return '';
  const letzte = Math.max(Number(((kreis.letzte || {})[String(jahr)]) || 0), vlHoechsteNummer(kreis.muster, vergeben, jahr));
  return vlNummerBilden(kreis.muster, letzte + 1, jahr);
}

/** Vergebene Nummer merken: neuer Kreis, wenn sie höher ist als die letzte, sonst null. */
function vlNummerMerken(kreis, nummer) {
  if (!kreis || !kreis.muster) return null;
  const g = vlNummerLesen(kreis.muster, nummer);
  if (!g) return null;
  const letzte = Object.assign({}, kreis.letzte || {});
  if (Number(letzte[g.jahr] || 0) >= g.n) return null;
  letzte[g.jahr] = g.n;
  return Object.assign({}, kreis, { letzte });
}

/* ── Vorlage anwenden und aus dem Formular bilden ────────────────────── */

/**
 * Werte fürs Formular aus einer Vorlage (oder ohne Vorlage: leere Rechnung mit Stammdaten).
 * opt: { heute, monat (JJJJ-MM), stamm (Registry des Werks), kreis, vergeben (Nummern in AR_<Werk>), kontakt }
 * @returns {{ felder: object, positionen: object[] }}
 */
function vlAnwenden(vorlage, opt) {
  const o = opt || {};
  const heute = o.heute || vlHeute();
  const leistung = vorlage ? (vorlage.leistung || 'monat') : 'keine';
  const monat = leistung === 'keine' ? '' : (o.monat || vlLeistungsmonat(heute, leistung));
  const daten = (vorlage && vorlage.daten) || {};
  const felder = {};
  for (const k of VL_VORLAGE_FELDER) felder[k] = vlPlatzhalter(daten[k] != null ? daten[k] : (VL_VORGABEN[k] || ''), monat);
  const stamm = o.stamm || {};
  for (const k of VL_STAMM_FELDER) felder[k] = stamm[k] || (k === 'verkaeufland' ? 'DE' : '');
  // Kontakt: aus der Vorlage, sonst die angemeldete Person; Telefon und Mail sonst aus den Stammdaten
  felder.verkaeufkontakt = felder.verkaeufkontakt || o.kontakt || '';
  felder.verkaeuftel = felder.verkaeuftel || stamm.verkaeuftel || '';
  felder.verkaeuferemail = felder.verkaeuferemail || stamm.verkaeuferemail || '';
  for (const k of VL_LEER_FELDER) felder[k] = '';
  felder.rechnungsdatum = heute;
  felder.rechnungsnummer = vlNaechsteNummer(o.kreis, heute.slice(0, 4), o.vergeben);
  const ziel = vorlage && vorlage.zahlungszielTage != null && vorlage.zahlungszielTage !== '' ? Number(vorlage.zahlungszielTage) : null;
  felder.faelligkeitsdatum = ziel != null && ziel >= 0 ? vlPlusTage(heute, ziel) : '';
  const g = monat ? vlMonatsgrenzen(monat) : null;
  felder.abrZeitraumStart = g ? g.start : '';
  felder.abrZeitraumEnde = g ? g.ende : '';
  const positionen = ((vorlage && daten.positionen) || []).map(p => {
    const q = {};
    for (const k of VL_POS_FELDER) if (p[k] != null) q[k] = typeof p[k] === 'string' ? vlPlatzhalter(p[k], monat) : p[k];
    return q;
  });
  return { felder, positionen: positionen.length ? positionen : [{}] };
}

/**
 * Vorlagendaten aus den Formulardaten (collectFormData): nur VL_VORLAGE_FELDER und Positionen,
 * der Leistungsmonat als {monat}. Leere Felder fallen weg.
 */
function vlAusFormular(data, monat) {
  const daten = {};
  for (const k of VL_VORLAGE_FELDER) {
    const w = data[k];
    if (w != null && w !== '' && w !== VL_VORGABEN[k]) daten[k] = vlZurueck(String(w), monat);
  }
  daten.positionen = (data.positionen || []).map(p => {
    const q = {};
    for (const k of VL_POS_FELDER) {
      const w = p[k];
      if (w == null || w === '' || (k === 'rabatt' && !w)) continue;
      q[k] = typeof w === 'string' ? vlZurueck(w, monat) : w;
    }
    return q;
  });
  return daten;
}

/** Leistungsart beim Speichern: kein Zeitraum, Monat des Rechnungsdatums oder Vormonat. */
function vlLeistungAus(data) {
  if (!data.abrZeitraumStart) return 'keine';
  const start = data.abrZeitraumStart.slice(0, 7);
  return data.rechnungsdatum && start === vlLeistungsmonat(data.rechnungsdatum, 'vormonat') ? 'vormonat' : 'monat';
}

/* ── Vorlagenliste ────────────────────────────────────────────────────── */

function vlLeer() {
  return { version: 1, nummernkreise: {}, vorlagen: [] };
}

function vlNeueId(werk, name) {
  const slug = String(name || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${String(werk || '').toLowerCase()}-${slug || 'vorlage'}-${Date.now().toString(36)}`;
}

/** Vorlagen eines Werks, nach Name sortiert. */
function vlVorlagenFuer(daten, werk) {
  const w = String(werk || '').toUpperCase();
  return ((daten && daten.vorlagen) || []).filter(v => String(v.werk || '').toUpperCase() === w)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
}

/** Vorlage einfügen oder (gleiche id) ersetzen. Gibt neue Daten zurück, die alten bleiben. */
function vlVorlageSpeichern(daten, vorlage) {
  const d = Object.assign(vlLeer(), daten || {});
  const liste = (d.vorlagen || []).slice();
  const i = liste.findIndex(v => v.id === vorlage.id);
  if (i >= 0) liste[i] = Object.assign({}, liste[i], vorlage, { am: liste[i].am, von: liste[i].von });
  else liste.push(vorlage);
  return Object.assign({}, d, { vorlagen: liste });
}

function vlVorlageLoeschen(daten, id) {
  const d = Object.assign(vlLeer(), daten || {});
  return Object.assign({}, d, { vorlagen: (d.vorlagen || []).filter(v => v.id !== id) });
}

/* ══════════════════════════════════════════════════════════════════════
   Oberfläche (nur im Browser, nur im Modus „manuell“)
══════════════════════════════════════════════════════════════════════ */

/** Element-IDs der Formularfelder (Gegenstück zu collectFormData in js/app.js). */
const VL_FORM_IDS = {
  verkaeufer: 'verkaeufer', verkaeufstrasse: 'verkaeufer-strasse', verkaeufplz: 'verkaeufer-plz',
  verkaeufstadt: 'verkaeufer-stadt', verkaeufland: 'verkaeufer-land', verkaeufervat: 'verkaeufer-vat',
  verkaeufersteuernr: 'verkaeufer-steuernr', verkaeufkontakt: 'verkaeufer-kontakt', verkaeuftel: 'verkaeufer-tel',
  verkaeuferemail: 'verkaeufer-email', iban: 'iban', bic: 'bic', handelsregister: 'verkaeufer-handelsregister',
  registernr: 'verkaeufer-registernr', geschaeftsfuehrung: 'verkaeufer-gf',
  kaeufer: 'kaeufer', kaeuferstrasse: 'kaeufer-strasse', kaeuferzusatz: 'kaeufer-zusatz', kaeuferplz: 'kaeufer-plz',
  kaeuferstadt: 'kaeufer-stadt', kaeuferland: 'kaeufer-land', leitwegid: 'leitwegid', kaeufermail: 'kaeufer-email',
  kaeufervat: 'kaeufer-vat', lieferName: 'liefer-name', lieferStrasse: 'liefer-strasse', lieferPlz: 'liefer-plz',
  lieferStadt: 'liefer-stadt', lieferLand: 'liefer-land', rechnungsart: 'rechnungsart', rechnungsnummer: 'rechnungsnummer',
  rechnungsdatum: 'rechnungsdatum', lieferdatum: 'lieferdatum', faelligkeitsdatum: 'faelligkeitsdatum',
  zahlungsreferenz: 'zahlungsreferenz', notiz: 'notiz', bestellnummer: 'bestellnummer',
  zahlungsart: 'zahlungsart', kundeIban: 'kunde-iban', mandatsreferenz: 'mandatsreferenz', glaeubigerId: 'glaeubiger-id',
  lieferscheinnummer: 'lieferscheinnummer', kundennummer: 'kundennummer', lieferantennummer: 'lieferantennummer',
  vorrechnungsnummer: 'vorrechnungsnummer', vorrechnungsdatum: 'vorrechnungsdatum', waehrung: 'waehrung',
  steuerkategorie: 'steuerkategorie', befreiungsgrund: 'befreiungsgrund', abrZeitraumStart: 'abr-start',
  abrZeitraumEnde: 'abr-ende', vertragsnummer: 'vertragsnummer', gezahlt: 'gezahlt',
};

// sichtbar: Vorlagendatei gelesen. Sie hat eigene Rechte, wer nicht freigegeben ist, bekommt 404.
// vergeben: Rechnungsnummern je Werk aus AR_<Werk>, damit der Vorschlag auch fremd vergebene Nummern kennt
const _vl = { daten: null, etag: '', geladen: false, sichtbar: false, fehler: '', zuletztNummer: '', vergeben: {} };
const VL_NICHT_FREIGEGEBEN = 'Die Vorlagen sind für dieses Konto nicht freigegeben. Die Freigabe erteilt die IT.';
let _vlVorschauTimer = null;

const _vlEl = id => document.getElementById(id);

function vlIstManuell() {
  try { return new URLSearchParams(window.location.search).get('modus') === 'manuell'; } catch (e) { return false; }
}

/** Für js/app.js: Fußzeile des gerenderten PDF. */
function vorlagenFusszeile() {
  return vlIstManuell() ? VL_FUSSZEILE : '';
}

function _vlStatus(text, art) {
  const el = _vlEl('vl-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'vl-status' + (art ? ' vl-' + art : '');
}

function _vlStamm(werk) {
  const e = (typeof _COMPANY_REGISTRY !== 'undefined' && _COMPANY_REGISTRY[werk]) || {};
  const s = {};
  for (const [k, w] of Object.entries(e)) if (!k.startsWith('_')) s[k] = w;
  return Object.assign(s, e._manuell || {});   // abweichende Stammdaten nur für diesen Reiter
}

function _vlKreis(werk) {
  return ((_vl.daten && _vl.daten.nummernkreise) || {})[String(werk || '').toUpperCase()] || null;
}

function _vlWerk() {
  return (_vlEl('vl-werk') || {}).value || v('gesellschaft') || '';
}

function _vlAktuelleVorlage() {
  const id = (_vlEl('vl-vorlage') || {}).value || '';
  return id ? vlVorlagenFuer(_vl.daten, _vlWerk()).find(x => x.id === id) || null : null;
}

async function _vlLaden() {
  try {
    const r = await spLoadVorlagen();
    _vl.daten = r.daten || vlLeer();
    _vl.etag = r.etag;
    _vl.sichtbar = !!r.daten;
    _vl.fehler = '';
  } catch (e) {
    _vl.daten = _vl.daten || vlLeer();
    _vl.fehler = e.message || String(e);
  }
  _vl.geladen = true;
}

/** Vorlagendatei ändern: laden, ändern, mit If-Match speichern, bei Konflikt neu versuchen. */
async function _vlAendern(aendern) {
  for (let versuch = 0; versuch < 3; versuch++) {
    if (versuch > 0 || !_vl.geladen) await _vlLaden();
    if (_vl.fehler) throw new Error(_vl.fehler);
    const neu = aendern(JSON.parse(JSON.stringify(_vl.daten || vlLeer())));
    if (!neu) return false;
    try {
      _vl.etag = await spSaveVorlagen(neu, _vl.etag);
      _vl.daten = neu;
      return true;
    } catch (e) {
      if (e.code !== 'KONFLIKT') throw e;
      // Neu geladen und wieder nicht zu sehen, aber anlegen geht nicht: Die Datei gibt es, nur nicht für uns
      if (versuch > 0 && !_vl.sichtbar) throw new Error(VL_NICHT_FREIGEGEBEN);
    }
  }
  throw new Error('Die Vorlagen wurden gerade von jemand anderem geändert. Bitte die Seite neu laden.');
}

function _vlWerkeFuellen() {
  const sel = _vlEl('vl-werk');
  const alle = typeof activeWerke === 'function' ? activeWerke() : [];
  // ohne zugewiesenes Werk keine Auswahl (Admins sehen alle)
  const werke = typeof erlaubteWerke === 'function' ? erlaubteWerke(alle) : alle;
  const mitVorlagen = werke.filter(w => vlVorlagenFuer(_vl.daten, w).length);
  const vorher = sel.value;
  sel.innerHTML = werke.map(w => `<option value="${w}">${w} · ${escHTML(_vlStamm(w).verkaeufer || w)}</option>`).join('');
  sel.value = werke.includes(vorher) ? vorher : (mitVorlagen[0] || werke[0] || '');
}

function _vlListeFuellen(auswahl) {
  const sel = _vlEl('vl-vorlage');
  const liste = vlVorlagenFuer(_vl.daten, _vlWerk());
  sel.innerHTML = '<option value="">Leere Rechnung (nur Stammdaten)</option>'
    + liste.map(x => `<option value="${escHTML(x.id)}">${escHTML(x.name)}</option>`).join('');
  sel.value = auswahl && liste.some(x => x.id === auswahl) ? auswahl : (liste[0] ? liste[0].id : '');
  _vlAuswahlGeaendert();
  _vlVergebeneLaden(_vlWerk()).then(_vlStatusZeigen);
}

/** Vergebene Rechnungsnummern des Werks aus AR_<Werk> laden (nur mit Nummernkreis). */
async function _vlVergebeneLaden(werk) {
  if (!werk || !_vlKreis(werk) || typeof spRechnungsnummernAR !== 'function') return null;
  try {
    const liste = await spRechnungsnummernAR(werk);
    if (liste) _vl.vergeben[werk] = liste;
  } catch (e) {
    console.warn('[Vorlagen] Nummern aus AR_' + werk + ' nicht lesbar:', e.message);
  }
  return _vl.vergeben[werk] || null;
}

function _vlAuswahlGeaendert() {
  const vorlage = _vlAktuelleVorlage();
  const monat = _vlEl('vl-monat');
  const leistung = vorlage ? (vorlage.leistung || 'monat') : 'keine';
  monat.disabled = leistung === 'keine';
  monat.value = leistung === 'keine' ? '' : vlLeistungsmonat(vlHeute(), leistung);
  _vlEl('vl-loeschen').disabled = !vorlage;
  _vlStatusZeigen();
}

function _vlStatusZeigen() {
  const vorlage = _vlAktuelleVorlage();
  const werk = _vlWerk();
  const kreis = _vlKreis(werk);
  const vergeben = _vl.vergeben[werk];
  const nr = kreis ? vlNaechsteNummer(kreis, vlHeute().slice(0, 4), vergeben) : '';
  const teile = [];
  if (vorlage) teile.push(`Zuletzt geändert ${vorlage.geaendertAm ? _vlDatum(vorlage.geaendertAm) : _vlDatum(vorlage.am)}`
    + ((vorlage.geaendertVon || vorlage.von) ? ` von ${vorlage.geaendertVon || vorlage.von}` : '') + '.');
  if (_vl.geladen && !_vl.sichtbar) teile.push(VL_NICHT_FREIGEGEBEN + ' Die leere Rechnung mit den Stammdaten geht trotzdem, die Rechnungsnummer bitte selbst eintragen.');
  else if (nr) teile.push(vergeben
    ? `Nächste Rechnungsnummer nach Nummernkreis und AR_${werk}: ${nr}. Rechnungen, die außerhalb der App entstehen und nicht im Monitoring liegen, kennt sie nicht.`
    : `Nächste Rechnungsnummer laut Nummernkreis: ${nr}. Rechnungen, die außerhalb der App entstehen, kennt der Nummernkreis nicht.`);
  else teile.push('Für dieses Werk ist kein Nummernkreis hinterlegt, die Rechnungsnummer bitte selbst eintragen.');
  _vlStatus(_vl.fehler ? `Vorlagen nicht geladen: ${_vl.fehler}` : teile.join(' '), _vl.fehler ? 'fehler' : '');
}

function _vlDatum(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('de-DE');
}

function _vlFormularBelegt() {
  return !!(v('kaeufer') || (typeof collectPositionen === 'function' && collectPositionen().some(p => p.beschreibung)));
}

/** Vorlage (oder leere Rechnung) ins Formular übernehmen. */
async function vlUebernehmen(ohneRueckfrage) {
  const werk = _vlWerk();
  if (!werk) return;
  if (!ohneRueckfrage && _vlFormularBelegt()
    && !window.confirm('Die Angaben im Formular werden durch die Vorlage ersetzt. Weiter?')) return;
  const vorlage = _vlAktuelleVorlage();
  const user = (typeof getAuthUser === 'function' && getAuthUser()) || {};
  const vergeben = await _vlVergebeneLaden(werk);   // frisch, falls inzwischen jemand abgelegt hat
  const { felder, positionen } = vlAnwenden(vorlage, {
    heute: vlHeute(), monat: (_vlEl('vl-monat') || {}).value || '', stamm: _vlStamm(werk),
    kreis: _vlKreis(werk), vergeben, kontakt: user.name || '',
  });

  const ges = _vlEl('gesellschaft');
  if (ges) {
    if (![...ges.options].some(o => o.value === werk)) ges.add(new Option(werk, werk));
    ges.value = werk;
  }
  for (const [k, id] of Object.entries(VL_FORM_IDS)) {
    const el = _vlEl(id);
    if (el && k in felder) { el.value = felder[k] == null ? '' : felder[k]; el.classList.remove('autofilled', 'field-error'); }
  }
  const steuer = _vlEl('steuerbetrag-original');
  if (steuer) steuer.value = '';
  if (typeof _anlagen !== 'undefined') { _anlagen = []; if (typeof _anlagenZeigen === 'function') _anlagenZeigen(); }

  const tbody = _vlEl('positions-body');
  tbody.innerHTML = '';
  positionen.forEach(p => addPositionRow(p));
  // Ohne Menge in der Vorlage bleibt das Feld leer (addPositionRow setzt sonst 1), die Prüfung verlangt es
  tbody.querySelectorAll('tr.pos-row .pos-menge').forEach((el, i) => {
    if (positionen[i] && !parseFloat(positionen[i].menge)) el.value = '';
  });
  if (typeof renumberRows === 'function') renumberRows();
  updateTotals();
  if (typeof lockSellerMaster === 'function') lockSellerMaster();
  if (typeof zahlungsartAnzeigen === 'function') zahlungsartAnzeigen();
  if (typeof _kundenMailVorschlagen === 'function') {
    _kundenMailVorschlagen(Object.assign({ gesellschaft: werk }, felder)).catch(() => {});
  }
  _vlStatus(vorlage
    ? `Vorlage „${vorlage.name}“ übernommen. Bitte Rechnungsnummer, Mengen, Beträge und Texte prüfen.`
    : 'Leere Rechnung mit den Stammdaten angelegt.', 'ok');
  vlVorschau();
}

/** Aktuelles Formular als Vorlage speichern (neu oder die gewählte überschreiben). */
async function vlSpeichern() {
  const werk = _vlWerk();
  const data = collectFormData();
  if (!data.kaeufer) { _vlStatus('Bitte zuerst den Rechnungsempfänger eintragen.', 'fehler'); return; }
  const gewaehlt = _vlAktuelleVorlage();
  const name = (window.prompt('Name der Vorlage:', gewaehlt ? gewaehlt.name : data.kaeufer) || '').trim();
  if (!name) return;
  const gleich = vlVorlagenFuer(_vl.daten, werk).find(x => x.name.toLowerCase() === name.toLowerCase());
  if (gleich && !window.confirm(`Die Vorlage „${gleich.name}“ gibt es schon. Überschreiben?`)) return;
  const user = (typeof getAuthUser === 'function' && getAuthUser()) || {};
  const jetzt = new Date().toISOString();
  const monat = data.abrZeitraumStart ? data.abrZeitraumStart.slice(0, 7) : '';
  const vorlage = {
    id: gleich ? gleich.id : vlNeueId(werk, name),
    werk, name,
    leistung: vlLeistungAus(data),
    zahlungszielTage: vlTageZwischen(data.rechnungsdatum, data.faelligkeitsdatum),
    daten: vlAusFormular(data, monat),
    am: jetzt, von: user.username || '',
    geaendertAm: jetzt, geaendertVon: user.username || '',
  };
  try {
    _vlStatus('Vorlage wird gespeichert …');
    await _vlAendern(d => vlVorlageSpeichern(d, vorlage));
    _vlListeFuellen(vorlage.id);
    _vlStatus(`Vorlage „${name}“ gespeichert.`, 'ok');
  } catch (e) {
    _vlStatus(`Vorlage nicht gespeichert: ${e.message}`, 'fehler');
  }
}

async function vlLoeschen() {
  const vorlage = _vlAktuelleVorlage();
  if (!vorlage || !window.confirm(`Vorlage „${vorlage.name}“ löschen?`)) return;
  try {
    await _vlAendern(d => vlVorlageLoeschen(d, vorlage.id));
    _vlListeFuellen('');
    _vlStatus(`Vorlage „${vorlage.name}“ gelöscht.`, 'ok');
  } catch (e) {
    _vlStatus(`Vorlage nicht gelöscht: ${e.message}`, 'fehler');
  }
}

/**
 * Vorschau: PDF aus den Formulardaten rendern, Seite und Zoom bleiben stehen. Es zeichnet immer
 * nur ein Vorgang auf die Leinwand (pdf.js verträgt keine zwei); kommt währenddessen eine
 * Änderung, wird danach noch einmal gezeichnet.
 */
let _vlVorschauLaeuft = null;
let _vlVorschauNochmal = false;

async function vlVorschau() {
  if (_vlVorschauLaeuft) { _vlVorschauNochmal = true; return _vlVorschauLaeuft; }
  _vlVorschauLaeuft = (async () => {
    do { _vlVorschauNochmal = false; await _vlVorschauZeichnen(); } while (_vlVorschauNochmal);
  })();
  try { await _vlVorschauLaeuft; } finally { _vlVorschauLaeuft = null; }
}

async function _vlVorschauZeichnen() {
  if (typeof buildInvoicePdf !== 'function' || typeof pdfjsLib === 'undefined') return;
  const data = collectFormData();
  if (!data.verkaeufer) return;
  try {
    const totals = calcTotals(data.positionen, data.steuerbetrag);
    const bytes = await buildInvoicePdf(_pdfDaten(data, totals));
    const seite = currentPage;
    const zoom = zoomFactor;
    pdfDocument = await pdfjsLib.getDocument({ data: bytes }).promise;
    totalPages = pdfDocument.numPages;
    currentPage = Math.min(seite || 1, totalPages);
    zoomFactor = zoom || 1;
    updatePageNav();
    await renderPage(currentPage);
  } catch (e) {
    console.warn('[Vorlagen] Vorschau nicht erzeugt:', e);
  }
}

function _vlVorschauPlanen() {
  clearTimeout(_vlVorschauTimer);
  _vlVorschauTimer = setTimeout(vlVorschau, 900);
}

/** Vor dem Export (js/app.js): Nummer schon in AR_<Werk>? false = abbrechen. */
async function vorlagenVorExport(data) {
  if (!vlIstManuell() || !data.rechnungsnummer || data.rechnungsnummer === _vl.zuletztNummer) return true;
  let treffer = null;
  try { treffer = await spRechnungsnummerVergeben(data.gesellschaft, data.rechnungsnummer); } catch (e) { treffer = null; }
  if (!treffer || !treffer.length) return true;
  return window.confirm(`Die Rechnungsnummer ${data.rechnungsnummer} gibt es in AR_${data.gesellschaft} schon `
    + `(${treffer.map(t => t.name).filter(Boolean).join(', ') || 'Eintrag ohne Dateiname'}). `
    + 'Rechnungsnummern müssen eindeutig sein. Trotzdem erzeugen?');
}

/** Nach dem Erzeugen (js/app.js): Nummernkreis des Werks fortschreiben. */
async function vorlagenNummerVerbraucht(data) {
  if (!vlIstManuell()) return;
  _vl.zuletztNummer = data.rechnungsnummer;
  const werk = String(data.gesellschaft || '').toUpperCase();
  if (_vl.vergeben[werk]) _vl.vergeben[werk].push(data.rechnungsnummer);
  if (!vlNummerMerken(_vlKreis(werk), data.rechnungsnummer)) { _vlStatusZeigen(); return; }
  await _vlAendern(d => {
    const neu = vlNummerMerken((d.nummernkreise || {})[werk], data.rechnungsnummer);
    if (!neu) return null;
    d.nummernkreise = Object.assign({}, d.nummernkreise, { [werk]: neu });
    return d;
  });
  _vlStatusZeigen();
}

function _vlSeiteUmstellen() {
  document.body.classList.add('modus-manuell');
  document.title = 'Manuelle Rechnung | DIHAG';
  document.querySelectorAll('.site-nav a').forEach(a => a.classList.toggle('active', a.id === 'nav-manuell'));
  const h1 = document.querySelector('.hero h1');
  const p = document.querySelector('.hero p');
  if (h1) h1.textContent = 'Manuelle Rechnung aus Vorlage';
  if (p) p.textContent = 'Vorlage wählen, Leistungsmonat setzen und übernehmen. Danach lassen sich alle Angaben im '
    + 'Formular ändern, nur die Stammdaten des Rechnungsstellers sind gesperrt. Erzeugt wird wie im Konverter eine E-Rechnung (ZUGFeRD oder XRechnung), die im Monitoring abgelegt wird.';
  const titel = document.querySelector('.pdf-viewer-panel .panel-header h3');
  if (titel) titel.textContent = '📄 Vorschau';
  const ph = document.querySelector('#pdf-placeholder p');
  if (ph) ph.textContent = 'Die Vorschau erscheint, sobald eine Vorlage übernommen ist.';
  // Kein Original-PDF: das PDF entsteht immer aus den Rechnungsdaten
  const opt = _vlEl('opt-render-pdf');
  if (opt) opt.checked = true;
  _vlEl('vorlagen-panel').hidden = false;
  _vlEl('btn-vorschau').hidden = false;
}

async function vlInit() {
  if (!vlIstManuell() || !_vlEl('vorlagen-panel')) return;
  _vlSeiteUmstellen();
  _vlEl('vl-werk').addEventListener('change', () => {
    const ges = _vlEl('gesellschaft');
    if (ges) ges.value = _vlWerk();
    _vlListeFuellen('');
  });
  _vlEl('vl-vorlage').addEventListener('change', _vlAuswahlGeaendert);
  _vlEl('vl-uebernehmen').addEventListener('click', () => vlUebernehmen(false));
  _vlEl('vl-speichern').addEventListener('click', vlSpeichern);
  _vlEl('vl-loeschen').addEventListener('click', vlLoeschen);
  _vlEl('btn-vorschau').addEventListener('click', vlVorschau);
  const ges = _vlEl('gesellschaft');
  if (ges) ges.addEventListener('change', () => {
    const w = _vlEl('vl-werk');
    if (w && [...w.options].some(o => o.value === ges.value)) { w.value = ges.value; _vlListeFuellen(''); }
  });
  // Vorschau folgt den Eingaben
  const formular = document.querySelector('.form-panel');
  if (formular) {
    formular.addEventListener('input', _vlVorschauPlanen);
    formular.addEventListener('change', _vlVorschauPlanen);
    formular.addEventListener('click', e => { if (e.target.closest('.btn-remove-row, #btn-add-row')) _vlVorschauPlanen(); });
  }
  _vlStatus('Vorlagen werden geladen …');

  onAuthReady(async () => {
    if (typeof loadRuntimeAccessConfig === 'function') await loadRuntimeAccessConfig();
    await _vlLaden();
    _vlWerkeFuellen();
    _vlListeFuellen('');
    // Ohne Rückfrage mit den Stammdaten des Werks beginnen; die Vorlage übernimmt man selbst
    const auswahl = _vlEl('vl-vorlage').value;
    _vlEl('vl-vorlage').value = '';
    await vlUebernehmen(true);
    _vlEl('vl-vorlage').value = auswahl;
    _vlAuswahlGeaendert();
  });
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', vlInit);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    vlHeute, vlPlusTage, vlTageZwischen, vlLeistungsmonat, vlMonatsgrenzen, vlPlatzhalter, vlZurueck,
    vlNummerBilden, vlNummerLesen, vlHoechsteNummer, vlNaechsteNummer, vlNummerMerken, vlAnwenden, vlAusFormular,
    vlLeistungAus, vlLeer, vlNeueId, vlVorlagenFuer, vlVorlageSpeichern, vlVorlageLoeschen,
    VL_VORLAGE_FELDER, VL_STAMM_FELDER,
    _vl, _vlAendern, VL_NICHT_FREIGEGEBEN,   // für die Tests
  };
}
