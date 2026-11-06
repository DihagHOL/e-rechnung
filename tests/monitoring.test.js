// node tests/monitoring.test.js
// Rechnungsmonitoring (js/monitoring.js): Rechnungsnummer, Erstelldatum, Dubletten
const assert = require('assert');
const B = require('../js/bearbeitung.js');
const ug = require('../js/umsatzgrenze.js');
// monitoring.js nutzt die Funktionen der anderen Skripte als globale Namen (wie im Browser)
Object.assign(global, { bhZiel: B.bhZiel, bhZusammen: B.bhZusammen, bhAusFeldern: B.bhAusFeldern,
  ugLieferantFuer: ug.ugLieferantFuer, ugMitXml: ug.ugMitXml });
const M = require('../js/monitoring.js');

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };

// 1) Rechnungsnummer aus dem Dateinamen <Nummer>_<USt-IdNr. oder Lieferant>
const aus = M._monNummerAusDatei;
gleich(aus('20261967_DE811979246', 'DE811979246', 'teichmann gmbh'), '20261967', 'USt-IdNr. wie in der Spalte');
gleich(aus('123456_DE12345646', '', 'Test GmbH'), '123456', 'USt-IdNr. ohne Spalte');
gleich(aus('RE24075705-5_DE296887298', '', ''), 'RE24075705-5', 'Nummer mit Bindestrich');
gleich(aus('NR-7_ATU12345678', '', ''), 'NR-7', 'österreichische USt-IdNr.');
gleich(aus('20261987_KENNAMETAL', '', 'KENNAMETAL'), '20261987', 'Lieferant als Kürzel');
gleich(aus('4711_Muster_Werkzeuge_GmbH', '', 'Muster Werkzeuge GmbH'), '4711', 'Kürzel mit Leerzeichen');
gleich(aus('DE140598967', 'DE140598967', ''), '', 'nur die USt-IdNr., keine Nummer');
gleich(aus('F2608-14111_DE297825534_20261029143000', 'DE297825534', ''), 'F2608-14111', 'Zeitstempel einer zweiten Datei');
gleich(aus('Rechnung 700000080043 September 2026', '', 'Stadtwerke Elbtal GmbH'), 'Rechnung 700000080043 September 2026', 'Anhangname bleibt');
gleich(aus('R_2026_AB', '', ''), 'R_2026_AB', 'kurzer Zusatz ist keine USt-IdNr.');

// 2) Title zählt nur, wenn er nicht der Dateiname ist (XML: SharePoint setzt ihn selbst)
gleich(M._monTitelEcht('20261967_DE811979246.xml', '20261967_DE811979246', '20261967_DE811979246'), false, 'Dateiname mit Endung');
gleich(M._monTitelEcht('20261967_DE811979246', '20261967_DE811979246_lesbar', '20261967_DE811979246'), false, 'Dateiname ohne Endung');
gleich(M._monTitelEcht('1324567', '1324567_DE140598967', '1324567_DE140598967'), true, 'echte Nummer');
gleich(M._monTitelEcht('', 'x', 'x'), false, 'leer');
gleich(M._monTitelEcht('4260554', '4260554_20261106', '4260554'), true, 'Ausgang: Title vor dem Datum im Dateinamen ist echt');

// 3) Zeile aus SharePoint-Feldern
const lib = { id: 'L1', werk: 'WGC', richtung: 'Eingang' };
const datei = (name, f, extra) => M._monMap(Object.assign({ id: name, createdDateTime: '2026-10-29T09:39:09Z', webUrl: 'https://x/' + name }, extra),
  Object.assign({ FileLeafRef: name }, f), lib);
const xml = datei('20261967_DE811979246.xml', { Title: '20261967_DE811979246.xml', Rechnungssteller: 'teichmann gmbh',
  RechnungsstellerUStID: 'DE811979246', Format: 'XRechnung', Konformitaet: 'Gruen' });
gleich([xml.nummer, xml.nummerAusDatei, xml.erstellt], ['20261967', true, '2026-10-29T09:39:09Z'], 'XRechnung mit Dateiname im Title');
const lesbar = datei('20261967_DE811979246_lesbar.pdf', {}, { createdDateTime: '2026-10-29T09:39:12Z' });
const bericht = datei('20261967_DE811979246_KoSIT-Bericht.xml', { Title: '20261967_DE811979246_KoSIT-Bericht.xml' }, { createdDateTime: '2026-10-29T09:39:14Z' });
let [zeile] = M._monGroup([xml, lesbar, bericht]);
gleich([zeile.nummer, zeile.nummerAusDatei, zeile.erstellt], ['20261967', true, '2026-10-29T09:39:09Z'], 'Gruppe: Nummer aus dem Dateinamen, erste Datei');
lesbar.titel = lesbar.nummer = '2026-1967'; lesbar.nummerAusDatei = false;   // in „Bearbeiten“ korrigiert
[zeile] = M._monGroup([xml, lesbar, bericht]);
gleich([zeile.nummer, zeile.nummerAusDatei], ['2026-1967', false], 'Korrektur an der Zieldatei gewinnt');

// 4) Erstelldatum: Anzeige, Sortierung, Filter (Kalendertag in Deutschland)
gleich(M._monZeit('2026-10-29T09:39:09Z'), '29.10.2026 10:39', 'Zeit in deutscher Zeit');
gleich(M._monZeit(''), '', 'ohne Zeit');
gleich(M._monSortVal({ erstellt: '2026-10-29T09:39:09Z' }, 'erstellt'), '2026-10-29T09:39:09Z', 'Sortierwert');
const f = { werk: '', richtung: '', klass: '', konform: '', buchung: '', status: '', bstatus: '', genehmigt: '', datumArt: 'erstellt',
  from: '2026-10-29', to: '', q: '', flag: '' };
gleich(M._monMatchBase({ nummer: '', steller: '', empf: '', datum: '2026-09-01', erstellt: '2026-10-28T23:30:00Z' }, f, ''), true, 'kurz nach Mitternacht zählt der deutsche Tag');
gleich(M._monMatchBase({ nummer: '', steller: '', empf: '', datum: '2026-10-29', erstellt: '2026-10-28T12:00:00Z' }, f, ''), false, 'Rechnungsdatum zählt hier nicht');

// 5) Dubletten: gleiche Nummer beim selben Lieferanten, Inhalt über die Prüfsumme
const z = (nummer, extra) => Object.assign({ werk: 'WGC', richtung: 'Eingang', nummer, steller: '', empf: '', ustid: '',
  format: 'XRechnung', ext: 'xml', baseKey: nummer + Math.random(), hash: '' }, extra);
let recs = [z('A-1', { ustid: 'DE111111111', steller: 'Muster GmbH', hash: 'h1' }), z('A-1', { ustid: 'DE111111111', steller: 'Muster GmbH', hash: 'h2' })];
M._monMarkDupes(recs);
gleich(recs.map(r => [r.dublette, r.dubletteArt]), [[true, 'anders'], [true, 'anders']], 'anderer Inhalt');
gleich(/unterscheiden sich/.test(recs[0].dubletteInfo), true, 'Hinweis anderer Inhalt');
recs = [z('A-1', { ustid: 'DE111111111', steller: 'Muster GmbH', hash: 'h1' }), z('A-1', { ustid: 'DE111111111', steller: 'Muster GmbH', hash: 'h1' })];
M._monMarkDupes(recs);
gleich(recs[0].dubletteArt, 'gleich', 'gleiche Datei');
recs = [z('A-1', { ustid: 'DE111111111', steller: 'Muster GmbH' }), z('A-1', { ustid: 'DE222222222', steller: 'Muster GmbH' })];
M._monMarkDupes(recs);
gleich(recs.map(r => r.dublette), [false, false], 'verschiedene USt-IdNr. = verschiedene Lieferanten');
recs = [z('A-1', { steller: 'Muster GmbH' }), z('A-1', { steller: 'Andere AG' })];
M._monMarkDupes(recs);
gleich(recs.map(r => r.dublette), [false, false], 'gleiche Nummer, anderer Lieferant');
recs = [z('A-1', { ustid: 'DE111111111', steller: 'Muster GmbH' }), z('A-1', { steller: 'Muster  GmbH' }), z('A-1', { steller: '' })];
M._monMarkDupes(recs);
gleich(recs.map(r => [r.dublette, r.dubletteArt]), [[true, ''], [true, ''], [false, '']], 'Name reicht, ohne Lieferant nicht bewertbar');
gleich(recs.some(r => [8211, 8212].some(c => r.dubletteInfo.includes(String.fromCharCode(c)))), false, 'keine Gedankenstriche');
recs[0].nummer = 'A-2';
M._monMarkDupes(recs);
gleich(recs.map(r => r.dublette), [false, false, false], 'neu gekennzeichnet nach Korrektur');

// 6) Lieferant aus dem Register: an der Rechnung bestätigt geht vor der XML
ug._ug.daten = { version: 1, lieferanten: { 'muster gmbh': { name: 'Muster GmbH', vat: 'DE111111111' } },
  rechnungen: { 'e|scan_1': { lieferant: 'muster gmbh' } } };
let ps = M._monPartnerSicher({ richtung: 'Eingang', baseKey: 'Scan_1', steller: 'Muster GmbII', format: 'PDF', ext: 'pdf' });
gleich([ps.name, ps.quelle, ps.bestaetigt], ['Muster GmbH', 'rechnung', false], 'an der Rechnung eingetragen, ohne Siegel');
ug._ug.daten.lieferanten['muster gmbh'].bestaetigtAm = '2026-10-29T17:00:00Z';
ps = M._monPartnerSicher({ richtung: 'Eingang', baseKey: 'Scan_1', steller: 'Muster GmbII', format: 'PDF', ext: 'pdf' });
gleich([ps.quelle, ps.bestaetigt], ['rechnung', true], 'von der Kreditorenbuchhaltung bestätigt');
gleich(M._monPartnerSicher({ richtung: 'Eingang', baseKey: 'R_5', steller: 'Muster GmbH', ustid: 'DE111111111', format: 'XRechnung', ext: 'xml' }).bestaetigt, true, 'Siegel auch bei der XML');
gleich(M._monPartnerSicher({ richtung: 'Eingang', baseKey: 'Scan_2', steller: 'Xy', ustid: 'DE111111111', format: 'PDF', ext: 'pdf' }).quelle, 'register', 'über die USt-IdNr.');
gleich(M._monPartnerSicher({ richtung: 'Eingang', baseKey: 'R_3', steller: 'Neu AG', format: 'XRechnung', ext: 'xml' }), { name: 'Neu AG', quelle: 'xml', eintrag: null, bestaetigt: false }, 'aus der XML');
gleich(M._monPartnerSicher({ richtung: 'Eingang', baseKey: 'Scan_4', steller: 'Neu AG', format: 'PDF', ext: 'pdf' }), { name: 'Neu AG', quelle: 'gelesen' }, 'aus dem PDF gelesen: gezeigt, aber nicht bestätigt');

// 7) Neue Spalte in alten Werkseinstellungen
gleich(M._monMitNeuenSpalten({ spalten: ['links', 'werk', 'datum', 'nummer'], spaltenAm: '2026-11-01T08:00:00Z' }), ['links', 'werk', 'datum', 'nummer', 'geprueft'], 'Geprüft hinter dem Vorgänger');
gleich(M._monMitNeuenSpalten({ spalten: ['links', 'werk', 'datum', 'nummer'] }), ['links', 'werk', 'datum', 'erstellt', 'nummer', 'geprueft'], 'hinter Datum');
gleich(M._monMitNeuenSpalten({ spalten: ['links', 'nummer'] }), ['links', 'erstellt', 'nummer', 'geprueft'], 'ohne Datum hinter dem Vorgänger');
gleich(M._monMitNeuenSpalten({ spalten: ['links', 'datum'], spaltenAm: '2026-11-04T08:00:00Z' }), ['links', 'datum'], 'neu gespeichert: Auswahl gilt');
gleich(M._monMitNeuenSpalten({ spalten: ['erstellt', 'links', 'geprueft'] }), ['erstellt', 'links', 'geprueft'], 'schon dabei');
gleich(M._monMitNeuenSpalten({ spalten: ['links', 'datum', 'partner', 'klass'], spaltenAm: '2026-11-01T08:00:00Z' }), ['links', 'datum', 'partner', 'geprueft', 'klass'], 'Geprüft zwischen Empfänger und Klassifizierung');
gleich(M._monMitNeuenSpalten({ spalten: ['partner', 'netto', 'faellig', 'klass'], spaltenAm: '2026-11-01T08:00:00Z' }), ['partner', 'netto', 'faellig', 'geprueft', 'klass'], 'direkt vor der Klassifizierung');

// 8) Eine Eingangsmail = ein Vorgang (Spalte MailVorgang vom Eingangs-Flow)
const mv = (name, f, zeit, lauf) => datei(name, Object.assign({ MailVorgang: lauf || 'LAUF1', OriginalPdfName: name }, f), { createdDateTime: zeit });
let vg = M._monGroup([
  mv('2026-10631_DE195168953.pdf', { Title: '2026-10631', Rechnungssteller: 'Muster Software GmbH', RechnungsstellerUStID: 'DE195168953',
    Format: 'ZUGFeRD', Bruttobetrag: 119 }, '2026-11-02T11:51:30Z'),
  mv('2026-10631_DE195168953_lesbar.pdf', {}, '2026-11-02T11:51:32Z'),
  mv('Leistungsnachweis Hotline.pdf', { Format: 'PDF' }, '2026-11-02T11:51:20Z'),
]);
gleich(vg.length, 1, 'Rechnung mit Leistungsnachweis = eine Zeile');
gleich([vg[0].nummer, vg[0].anlagen, vg[0].brutto, vg[0].erstellt], ['2026-10631', ['Leistungsnachweis Hotline.pdf'], 119, '2026-11-02T11:51:20Z'],
  'Rechnung führt, Nachweis als Anlage, erste Datei der Mail');
gleich(vg[0].dateien.map(d => [d.label, !!d.anlage]), [['Lesbares PDF', false], ['Anlage: Leistungsnachweis Hotline.pdf', true]], 'Anlage verlinkt');
gleich(M._monMatchBase(vg[0], Object.assign({}, f, { from: '', q: 'hotline' }), 'hotline'), true, 'Suche findet den Namen der Anlage');

vg = M._monGroup(['reisekosten.pdf', 'beleg1.pdf', 'beleg2.pdf'].map((x, i) => mv(x, { Format: 'PDF' }, '2026-11-02T11:40:0' + i + 'Z')));
gleich([vg.length, vg[0].file, vg[0].anlagen], [1, 'reisekosten.pdf', ['beleg1.pdf', 'beleg2.pdf']], 'ohne Rechnungsnummer führt der erste Anhang');

vg = M._monGroup([
  mv('4711_DE111111111.xml', { Title: '4711_DE111111111.xml', Format: 'XRechnung', RechnungsstellerUStID: 'DE111111111' }, '2026-11-02T10:00:01Z'),
  mv('4712_DE111111111.xml', { Title: '4712_DE111111111.xml', Format: 'XRechnung', RechnungsstellerUStID: 'DE111111111' }, '2026-11-02T10:00:02Z'),
  mv('LS 99.pdf', { Format: 'PDF' }, '2026-11-02T10:00:03Z'),
]);
gleich(vg.map(r => [r.nummer, r.anlagen || [], r.mailRechnungen]), [['4711', ['LS 99.pdf'], ['4712']], ['4712', [], ['4711']]],
  'zwei XRechnungen in einer Mail bleiben zwei Zeilen, Lieferschein an der ersten');

vg = M._monGroup([
  mv('A1_DE111111111.pdf', { Title: 'A1', Format: 'ZUGFeRD', RechnungsstellerUStID: 'DE111111111' }, '2026-11-02T10:00:01Z'),
  mv('A2_DE111111111.pdf', { Title: 'A2', Format: 'ZUGFeRD', RechnungsstellerUStID: 'DE111111111' }, '2026-11-02T10:00:02Z'),
]);
gleich(vg.map(r => r.nummer), ['A1', 'A2'], 'zwei ZUGFeRD-Rechnungen bleiben getrennt');

vg = M._monGroup([
  mv('Aufmass.pdf', { Format: 'PDF' }, '2026-11-02T06:56:01Z'),
  mv('Rechnung 260158.pdf', { Title: '260158', Format: 'PDF' }, '2026-11-02T06:56:02Z'),
  mv('Gutschrift 92008753.pdf', { Title: '92008753', Format: 'PDF' }, '2026-11-02T06:56:03Z'),
]);
gleich(vg.map(r => [r.nummer, r.anlagen]), [['260158', ['Aufmass.pdf', 'Gutschrift 92008753.pdf']]],
  'normale PDFs bleiben zusammen, auch mit Nummer; vorne das erste mit Nummer');

vg = M._monGroup([
  mv('RE1_DE296887298.pdf', { Title: 'RE1', Format: 'ZUGFeRD', RechnungsstellerUStID: 'DE296887298' }, '2026-10-30T12:27:00Z'),
  mv('RE1_DE296887298_20261030122710.xml', { Title: 'RE1_DE296887298_20261030122710.xml', Format: 'XRechnung', RechnungsstellerUStID: 'DE296887298' }, '2026-10-30T12:27:10Z'),
]);
gleich([vg.length, vg[0].nummer, vg[0].dateien.map(d => d.label)], [1, 'RE1', ['XML']], 'PDF und XML derselben Rechnung = eine Zeile ohne Dublette');

vg = M._monGroup([mv('a.pdf', { Format: 'PDF' }, '2026-11-02T09:00:00Z'), mv('b.pdf', { Format: 'PDF' }, '2026-11-02T09:00:05Z', 'LAUF2'),
  datei('c.pdf', { Format: 'PDF' }), datei('d.pdf', { Format: 'PDF' })]);
gleich(vg.length, 4, 'andere Mail oder ohne Kennung: eigene Zeilen');

// Status (Bearbeitungsstatus): leer zählt als „Offen“ beim Sortieren
gleich(M._monSortVal({ bh: B.bhAusFeldern({}) }, 'bstatus'), 'Offen', 'leer sortiert als Offen');
gleich(M._monSortVal({ bh: B.bhAusFeldern({ Bearbeitungsstatus: 'Mahnung' }) }, 'bstatus'), 'Mahnung', 'gesetzter Status');
gleich(M._monSortVal({ bh: null }, 'bstatus'), '', 'ohne Bearbeitung leer');
gleich(M._monMatchBase({ bh: B.bhAusFeldern({}), datum: '2026-11-05' }, { bstatus: 'Offen' }, ''), true, 'Filter Offen findet leeren Status');
gleich(M._monMatchBase({ bh: B.bhAusFeldern({ Bearbeitungsstatus: 'Mahnung' }), datum: '2026-11-05' }, { bstatus: 'Offen' }, ''), false, 'Filter Offen nicht bei Mahnung');
gleich(M._monMatchBase({ bh: null, datum: '2026-11-05' }, { bstatus: 'Offen' }, ''), false, 'ohne Bearbeitung kein Offen');

// Mahnungen: erkannt am Namen, zählen nicht als Rechnung, keine Dublette mit der Rechnung
gleich(['Mahnung_4711.pdf', '2. Mahnstufe.pdf', 'Zahlungserinnerung 12.pdf', 'Dunning Notice 1.pdf', 'Erinnerung_88.pdf'].every(x => M._monIstMahnung(x)), true, 'Schreibweisen erkannt');
gleich(['Rechnung_4711.pdf', 'Terminerinnerung.pdf', '4711_DE123456789.pdf'].some(x => M._monIstMahnung(x)), false, 'Rechnungen nicht');
const mahn = datei('Mahnung_4711.pdf', { Format: 'PDF', Formatmangel: true, Verarbeitungsstatus: 'Validiert', Rechnungssteller: 'Muster GmbH', Title: '4711' });
gleich(mahn.mahnung, true, 'Mahnung im Eingang');
gleich(M._monMap({ id: 'a', createdDateTime: '2026-11-05T09:00:00Z' }, { FileLeafRef: 'Mahnung_1.pdf' }, { id: 'L2', werk: 'WGC', richtung: 'Ausgang' }).mahnung, false, 'Ausgang nie');
gleich([M._monMatchFlag(mahn, 'fehler'), M._monMatchFlag(mahn, 'mahnung')], [false, true], 'kein Fehler, aber unter Mahnungen');
const rech = datei('4711_DE811979246.pdf', { Format: 'PDF', Rechnungssteller: 'Muster GmbH', Title: '4711', RechnungsstellerUStID: 'DE811979246' });
const paar = [Object.assign({}, rech, { ustid: 'DE811979246' }), Object.assign({}, mahn, { ustid: 'DE811979246' })];
M._monMarkDupes(paar);
gleich([paar[0].dublette, paar[1].dublette], [false, false], 'Rechnung und Mahnung mit gleicher Nummer sind keine Dubletten');

// Rückfrage: Der Grund steht auch bei grünem Ergebnis in den Details
gleich(M._monHinweis({ konform: 'Gruen - KoSIT ok', meldung: 'Materielle Abweichung', rueckfrage: true }), 'Materielle Abweichung', 'Grund der Rückfrage');
gleich(M._monHinweis({ konform: 'Gruen - KoSIT ok', meldung: 'Sonstiges' }), '', 'grün ohne Rückfrage ohne Hinweis');

// Formatmangel: bei Kleinbeträgen kein Mangel
gleich(M._monFormatmangel({ formatmangel: true, brutto: 900 }), true, 'Formatmangel über 250 €');
gleich(M._monFormatmangel({ formatmangel: true, brutto: 180.5 }), false, 'kein Formatmangel beim Kleinbetrag');
gleich(M._monFormatmangel({ formatmangel: true, brutto: null }), true, 'ohne Betrag bleibt der Hinweis');
gleich(M._monFormatmangel({ formatmangel: false, brutto: 900 }), false, 'kein Mangel');

// Geprüft: nur im Eingang, in einer reinen Ausgangsansicht ohne Spalte
global.ugGeprueft = () => ({ am: '2026-11-03T08:00:00Z' });
gleich(M._monGeprueftMoeglich({ richtung: 'Eingang' }), true, 'Eingang');
gleich(M._monGeprueftMoeglich({ richtung: 'Ausgang' }), false, 'Ausgang');
gleich(M._monSortVal({ richtung: 'Ausgang' }, 'geprueft'), '', 'Ausgang ohne Sortierwert');
gleich(M._monSortVal({ richtung: 'Eingang' }, 'geprueft'), '2026-11-03T08:00:00Z', 'Eingang mit Sortierwert');
const _hatGeprueft = () => M._monSichtbareSpalten().some(s => s.id === 'geprueft');
gleich(_hatGeprueft(), true, 'Standard: Spalte da');
M._monFilter.richtung = 'Ausgang';
gleich(_hatGeprueft(), false, 'Filter Ausgang: Spalte weg');
M._monFilter.richtung = '';
delete global.ugGeprueft;

// Fehlermeldung nur mit Zeilenumbruch (WGC-Flow) ist keine Meldung, zählt nicht unter „Fehler / rot“
gleich(datei('x.pdf', { Fehlermeldung: '\n', Konformitaet: 'Gruen' }).fehler, '', 'Zeilenumbruch als Fehlermeldung');
gleich(M._monMatchFlag(datei('x.pdf', { Fehlermeldung: '\n', Konformitaet: 'Gruen', Verarbeitungsstatus: 'Validiert' }), 'fehler'), false, 'kein Fehler-Treffer');
gleich(M._monMatchFlag(datei('x.pdf', { Fehlermeldung: 'Timeout', Konformitaet: 'Gruen' }), 'fehler'), true, 'echte Meldung zählt');

// Laden: neueste zuerst bis zum Stichtag, Älteres auf Klick, kein festes Limit
gleich(M._monVorMonaten('2026-11-05T12:00:00Z', 6), '2026-05-05', 'sechs Monate zurück');
(async () => {
  global.SP = { graphBase: 'https://g' };
  const eintrag = (id, tag) => ({ id, createdDateTime: tag + 'T10:00:00Z', webUrl: 'https://x/' + id, fields: { FileLeafRef: id + '.pdf' } });
  const seiten = {
    start: { value: [eintrag('a', '2026-10-01'), eintrag('b', '2026-06-01')], '@odata.nextLink': 'https://g/n1' },
    'https://g/n1': { value: [eintrag('c', '2026-05-20'), eintrag('d', '2026-05-01')], '@odata.nextLink': 'https://g/n2' },
    'https://g/n2': { value: [eintrag('e', '2026-01-01')] },
  };
  let abrufe = [], kaputt = '';
  global.fetch = async url => {
    abrufe.push(url);
    if (url === kaputt) return { ok: false, status: 500, text: async () => 'Fehler', headers: { get: () => null } };
    if (kaputt === 'sortierung' && url.includes('orderby')) return { ok: false, status: 400, text: async () => 'nicht indiziert', headers: { get: () => null } };
    return { ok: true, json: async () => seiten[url.includes('sites/') ? 'start' : url] };
  };
  const lib2 = { id: 'L2', werk: 'WGC', richtung: 'Eingang' };
  const geladen = [];
  const merken = s => { geladen.push(...s.map(r => r.file)); return true; };
  await M._monFetchLib('s', lib2, 't', merken, '2026-05-05');
  gleich(geladen, ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf'], 'hört auf, sobald eine Seite vor den Stichtag reicht');
  gleich(M._monWeiter.get('L2'), 'https://g/n2', 'nächste Seite bleibt für „Ältere laden“');
  await M._monFetchLib('s', lib2, 't', merken, '2025-11-05');
  gleich(geladen.slice(4), ['e.pdf'], 'macht dort weiter');
  gleich(M._monWeiter.has('L2'), false, 'nichts mehr offen');

  // Fehler beim Weiterladen: Beim nächsten Klick geht es an derselben Stelle weiter
  M._monWeiter.set('L2', 'https://g/n2');
  kaputt = 'https://g/n2';
  let fehler = '';
  await M._monFetchLib('s', lib2, 't', merken, '2025-11-05').catch(e => { fehler = e.message; });
  gleich([/500/.test(fehler), M._monWeiter.get('L2')], [true, 'https://g/n2'], 'Adresse bleibt nach einem Fehler');
  M._monWeiter.clear();

  // Sortierung abgelehnt: ungeordnet alles laden, ohne Stichtag
  kaputt = 'sortierung';
  geladen.length = 0;
  await M._monFetchLib('s', lib2, 't', merken, '2026-05-05');
  gleich(geladen, ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf', 'e.pdf'], 'ohne Sortierung alles');
  gleich(M._monWeiter.size, 0, 'dann kein „Ältere laden“');

  console.log(`monitoring: ${n} Prüfungen grün`);
})().catch(e => { console.error(e); process.exit(1); });
