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

// 5a) Nummer aus dem Anhangnamen: Datum, „v.“, „Kopie“ und das Wort Rechnung zählen nicht
const dn = M._monDublettenNummer;
gleich(dn('Proformarechnung 9900012345 v. 11.11.2026'), dn('Proformarechnung 9900012345'), 'Datum im Anhangnamen');
gleich(dn('Rechnung 4711 Kopie'), dn('4711'), 'Kopie und Rechnung');
gleich(dn('Invoice No. 4711 dated 2026-10-01'), '4711', 'englisch mit ISO-Datum');
gleich(dn('RE 0092658542'), dn('92658542'), 'führende Nullen');
gleich(dn('Proformarechnung 4711') === dn('Rechnung 4711'), false, 'Proforma bleibt eine eigene Art');
gleich(dn('Stornorechnung 4711') === dn('Rechnung 4711'), false, 'Storno bleibt');
gleich(dn('Rechnung_Oktober_2026') === dn('Rechnung_November_2026'), false, 'Monat unterscheidet');
gleich(dn('10.11.12.13'), '10 11 12 13', 'kein Datum mitten in einer Nummer');
gleich(dn('Rechnung'), 'rechnung', 'ohne Ziffern der ganze Text');
recs = [z('Proformarechnung 9900012345 v. 11.11.2026', { ustid: 'DE111111111', steller: 'Muster GmbH', ext: 'pdf', format: 'PDF' }),
  z('Proformarechnung 9900012345', { ustid: 'DE111111111', steller: 'Muster GmbH', ext: 'pdf', format: 'PDF' })];
M._monMarkDupes(recs);
gleich(recs.map(r => r.dublette), [true, true], 'weitergeleitete Kopie mit kürzerem Anhangnamen');
// Ohne Ziffer ist der Name keine Rechnungsnummer: verschiedene Rechnungen sind keine Dublette
recs = [z('Wolff&Müller Quarzsande Rechnung', { ustid: 'DE111111111', steller: 'Muster GmbH', ext: 'pdf', format: 'PDF', brutto: 1835.41 }),
  z('Wolff&Müller Quarzsande Rechnung', { ustid: 'DE111111111', steller: 'Muster GmbH', ext: 'pdf', format: 'PDF', brutto: 1771.84 }),
  z('TEXT', { ustid: 'DE111111111', steller: 'Muster GmbH', ext: 'pdf', format: 'PDF' }), z('TEXT', { ustid: 'DE111111111', steller: 'Muster GmbH', ext: 'pdf', format: 'PDF' })];
M._monMarkDupes(recs);
gleich(recs.map(r => r.dublette), [false, false, false, false], 'Dateiname ohne Ziffer ist keine Nummer');
recs = [z('TEXT 4711', { ustid: 'DE111111111', steller: 'Muster GmbH', ext: 'pdf', format: 'PDF' }), z('TEXT 4711', { ustid: 'DE111111111', steller: 'Muster GmbH', ext: 'pdf', format: 'PDF' })];
M._monMarkDupes(recs);
gleich(recs.map(r => r.dublette), [true, true], 'mit Ziffer weiter eine Dublette');

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
gleich(vg.map(r => [r.nummer, r.anlagen]), [['260158', ['Aufmass.pdf']], ['92008753', undefined]],
  'Rechnung und Gutschrift getrennt, das Aufmaß bleibt Anlage');

// Eingang: Scannernummer am Ende ist kein Datum, zwei Scans aus zwei Mails bleiben zwei Zeilen
vg = M._monGroup([
  mv('SCAN-001_004711.pdf', { Title: '480001', Bruttobetrag: 1000 }, '2026-11-09T11:00:33Z', 'LAUF_A'),
  mv('SCAN-001_004712.pdf', { Title: '4800012', Bruttobetrag: 200 }, '2026-11-09T11:01:32Z', 'LAUF_B'),
]);
gleich(vg.map(r => [r.nummer, r.baseKey]), [['480001', 'SCAN-001_004711'], ['4800012', 'SCAN-001_004712']],
  'Eingang: Ziffern am Ende bleiben im Schlüssel');
vg = M._monGroup([
  mv('SCAN_20261106.pdf', { Title: '111' }, '2026-11-09T11:00:01Z', 'LAUF_C'),
  mv('SCAN_20261107.pdf', { Title: '222' }, '2026-11-09T11:00:02Z', 'LAUF_D'),
]);
gleich(vg.length, 2, 'Eingang: auch acht Ziffern am Ende, zwei Mails bleiben zwei Zeilen');
const libAus = { id: 'L3', werk: 'WGC', richtung: 'Ausgang' };
const ausDatei = (name, t) => M._monMap({ id: name, createdDateTime: t }, { FileLeafRef: name, Title: '4260554' }, libAus);
vg = M._monGroup([ausDatei('4260554_20261106.xml', '2026-11-06T10:00:00Z'), ausDatei('4260554_20261106_lesbar.pdf', '2026-11-06T10:00:01Z')]);
gleich([vg.length, vg[0].baseKey, vg[0].nummer], [1, '4260554', '4260554'], 'Ausgang: Datum im Dateinamen fällt weiter weg');

// Mehrere Rechnungen in einer Mail ohne E-Rechnung: getrennt, aber nur, wenn es eindeutig Rechnungen sind
const pdfs = liste => M._monGroup(liste.map(([name, felder], i) => mv(name, Object.assign({ Format: 'PDF' }, felder), '2026-11-06T11:14:0' + i + 'Z')));
const zeilen = v => v.map(r => [r.nummer, r.anlagen || []]);
vg = pdfs([['Rechnung 500001_Original_20261106-113925-7901.pdf', { Title: '500001' }], ['Rechnung 500002_Original_20261106-114218-4235.pdf', { Title: '500002' }],
  ['Rechnung 500003_Original_20261106-114234-6940.pdf', { Title: '500003' }]]);
gleich(zeilen(vg), [['500001', []], ['500002', []], ['500003', []]], 'drei Rechnungen in einer Mail, drei Zeilen');
gleich(vg[0].mailRechnungen, ['500002', '500003'], 'jede Zeile nennt die anderen');

vg = pdfs([['RG ABC 261024891.pdf', { Bruttobetrag: 1526.69 }], ['RG ABC 261024892.pdf', { Bruttobetrag: 1526.69 }]]);
gleich(vg.length, 2, 'gleicher Betrag, andere Nummer im Dateinamen: zwei Rechnungen');
vg = pdfs([['RE 2026-310.pdf', { Title: '2026-310' }], ['RE 2026-294.pdf', { Title: '2026-294' }]]);
gleich(vg.length, 2, 'Nummern mit gleichem Jahr sind verschieden');
vg = pdfs([['900111.pdf', { Title: '900111', Bruttobetrag: 2698.49, Rechnungsdatum: '2026-09-23' }], ['900112.pdf', { Title: '900112', Bruttobetrag: 2789.53, Rechnungsdatum: '2026-09-23' }]]);
gleich(vg.length, 2, 'ohne Rechnung im Namen: Nummer, Betrag und Datum vorhanden');
vg = pdfs([['26 - 248 Abschlag KW40.pdf', { Bruttobetrag: 107070.25 }], ['26 - 263 Abschlag KW42.pdf', { Bruttobetrag: 51235.45 }]]);
gleich(vg.length, 2, 'Abschläge ohne lange Nummer, verschiedene Beträge');

// Im Zweifel bleibt es Anlage
const rg = ['Rechnung 100200.pdf', { Title: '100200', Bruttobetrag: 500 }];
gleich(zeilen(pdfs([rg, ['LB 2026-70001.pdf', { Title: '2026-70004', Rechnungsdatum: '2026-10-27' }]])), [['100200', ['LB 2026-70001.pdf']]], 'Beleg mit gelesener Nummer');
gleich(zeilen(pdfs([rg, ['SI CF7501.pdf', { Title: '001/4260433' }]])), [['100200', ['SI CF7501.pdf']]], 'nur eine Nummer reicht nicht');
gleich(zeilen(pdfs([rg, ['PROFORMA - RECHNUNG 96157.pdf', { Title: '96157', Bruttobetrag: 100.38, Rechnungsdatum: '2026-10-01' }]])),
  [['100200', ['PROFORMA - RECHNUNG 96157.pdf']]], 'Proforma ist keine Rechnung');
gleich(zeilen(pdfs([rg, ['Bestellung 20262057.pdf', { Bruttobetrag: 1969.57, Rechnungsdatum: '2026-10-01' }]])), [['100200', ['Bestellung 20262057.pdf']]], 'Bestellung');
gleich(zeilen(pdfs([rg, ['AGB Muster.pdf', {}], ['1_CMR_A553549.pdf', { Bruttobetrag: 20 }]])), [['100200', ['AGB Muster.pdf', '1_CMR_A553549.pdf']]], 'AGB und Frachtbrief');
gleich(zeilen(pdfs([rg, ['re_ anfrage 12345.pdf', {}]])), [['100200', ['re_ anfrage 12345.pdf']]], 'kleines re ist keine Rechnung');
gleich(zeilen(pdfs([['Mahnung 263882.pdf', {}], ['RG 201041797.pdf', { Bruttobetrag: 750 }], ['RG 910369999.pdf', { Bruttobetrag: 9234 }]])),
  [['RG 201041797', ['Mahnung 263882.pdf']], ['RG 910369999', []]], 'Mahnung ist keine Rechnung, die beiden Rechnungen schon');
gleich(zeilen(pdfs([['Schreiben vom 08.10.2026.pdf', { Title: '700000' }], ['Rechnung 700000 September.pdf', { Title: '700000' }]])),
  [['700000', ['Schreiben vom 08.10.2026.pdf']]], 'gleiche Nummer: Rechnung vorn, Schreiben als Anlage');
gleich(pdfs([['Rechnung 700000.pdf', { Title: '700000' }], ['Rechnung 0700000 Zweitdruck.pdf', { Title: '0700000' }]]).length, 1, 'führende Nullen: dieselbe Nummer');
gleich(pdfs([['Rechnung A.pdf', { Bruttobetrag: 100 }], ['Rechnung B.pdf', { Bruttobetrag: 100 }]]).length, 1, 'ohne Nummer und gleicher Betrag: nicht eindeutig');

// PDF-Ansicht einer E-Rechnung ist keine zweite Rechnung
const xmlRe = ['479964_DE111111111.xml', { Title: '479964_DE111111111.xml', Format: 'XRechnung', RechnungsstellerUStID: 'DE111111111', Bruttobetrag: 602.63 }];
gleich(zeilen(pdfs([xmlRe, ['2026_Muster_RE_479964__.pdf', {}]])), [['479964', ['2026_Muster_RE_479964__.pdf']]], 'Nummer steht im Dateinamen');
gleich(zeilen(pdfs([xmlRe, ['31628226 - Muster - INVOICE.pdf', { Bruttobetrag: 602.63 }]])), [['479964', ['31628226 - Muster - INVOICE.pdf']]], 'gleicher Betrag, keine gelesene Nummer');
gleich(zeilen(pdfs([xmlRe, ['Rechnung 900500.pdf', { Title: '900500', Bruttobetrag: 75 }]])), [['479964', []], ['900500', []]], 'zweite Rechnung als PDF neben der E-Rechnung');

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

// Status von Hand: Mahnung oder Information, in allen Werken außer SCH, SHB und WGC
{
  const vorher = { an: global.bhBearbeitenAn, mark: global.bhMarkierenAn, wert: global.bhMarkierung, oeffnen: global.bhMarkierenOeffnen };
  Object.assign(global, { bhBearbeitenAn: w => ['WGC', 'MEG'].includes(w), bhMarkierenAn: B.bhMarkierenAn, bhMarkierung: B.bhMarkierung,
    bhMarkierenOeffnen: () => {} });
  const im = werk => (name, f) => M._monMap({ id: werk + name, createdDateTime: '2026-11-20T09:00:00Z', webUrl: 'https://x/' + name },
    Object.assign({ FileLeafRef: name }, f), { id: 'L-' + werk, werk, richtung: 'Eingang' });
  const dso = im('DSO');
  const [info] = M._monGroup([dso('Avis_77.pdf', { Format: 'PDF', Formatmangel: true, Title: '77', Bearbeitungsstatus: 'Information' })]);
  gleich([info.bh, info.markierung, info.info, info.mahnung, !!info.markQuelle], [null, 'Information', true, false, true], 'DSO ohne Bearbeiten: Information');
  gleich([M._monKeineRechnung(info), M._monMatchFlag(info, 'info'), M._monMatchFlag(info, 'fehler'), ug.ugSonstige(info)], [true, true, false, false],
    'Information: keine Rechnung, kein Fehler, keine 800k-Einschätzung');
  gleich([M._monPasstRichtung(info, 'Eingang nicht geprüft'), M._monPasstRichtung(info, 'Eingang geprüft')], [false, true], 'markiert zählt als erledigt');
  gleich(/data-mark="3"[^>]*>Information ✎</.test(M._monMarkKnopf(info, 3)), true, 'Knopf zeigt den Status');
  gleich(M._monZelle('geprueft', info, 3).includes('Keine Rechnung'), true, 'statt „Als geprüft markieren“');

  const [mahnHand] = M._monGroup([dso('Schreiben_12.pdf', { Format: 'PDF', Title: '12', Bearbeitungsstatus: 'Mahnung' })]);
  gleich([mahnHand.markierung, mahnHand.mahnung, mahnHand.info], ['Mahnung', true, false], 'Mahnung von Hand');
  const [mahnName] = M._monGroup([dso('Mahnung_13.pdf', { Format: 'PDF', Title: '13' })]);
  gleich([mahnName.markierung, mahnName.mahnung, M._monPasstRichtung(mahnName, 'Eingang nicht geprüft'), /Status</.test(M._monMarkKnopf(mahnName, 1))],
    ['', true, true, true], 'am Namen erkannt: Mahnung, aber noch nicht erledigt');
  const [umgestellt] = M._monGroup([dso('Erinnerung_14.pdf', { Format: 'PDF', Title: '14', Bearbeitungsstatus: 'Information' })]);
  gleich([umgestellt.mahnung, umgestellt.info], [false, true], 'Information geht vor dem Namen');
  const [normal] = M._monGroup([dso('4711_DE811979246.pdf', { Format: 'PDF', Title: '4711', Bearbeitungsstatus: 'Keine RG' })]);
  gleich([normal.markierung, M._monKeineRechnung(normal), /Status</.test(M._monMarkKnopf(normal, 1))], ['', false, true], 'andere Werte zählen nicht');

  // Gleiche Nummer wie die Rechnung: keine Dublette
  const paarInfo = [Object.assign({}, rech, { ustid: 'DE811979246' }), Object.assign({}, info, { nummer: '4711', ustid: 'DE811979246', steller: 'Muster GmbH' })];
  M._monMarkDupes(paarInfo);
  gleich(paarInfo.map(x => x.dublette), [false, false], 'Rechnung und Information sind keine Dubletten');

  // WGC (alte Statusliste) bleibt, wie es war. MEG hat Bearbeiten: Status im Dialog, kein eigener Knopf
  const [wgc] = M._monGroup([im('WGC')('Schreiben_15.pdf', { Format: 'PDF', Title: '15', Bearbeitungsstatus: 'Mahnung' })]);
  gleich([wgc.markierung, wgc.mahnung, !!wgc.bh, M._monMarkKnopf(wgc, 1)], ['', false, true, ''], 'WGC unverändert');
  const [meg] = M._monGroup([im('MEG')('Avis_16.pdf', { Format: 'PDF', Title: '16', Bearbeitungsstatus: 'Information' })]);
  gleich([meg.markierung, meg.info, !!meg.bh, M._monMarkKnopf(meg, 1)], ['Information', true, true, ''], 'MEG: Information aus dem Bearbeiten-Dialog');

  // Von Hand markiert bleibt eine eigene Zeile, auch neben einer Rechnung in derselben Mail
  const vg2 = M._monGroup([
    dso('RE-900_DE811979246.pdf', { Format: 'PDF', Title: 'RE-900', OriginalPdfName: 'Rechnung RE-900.pdf', Bruttobetrag: 50, MailVorgang: 'L9' }),
    dso('Mahnung_900.pdf', { Format: 'PDF', Title: 'RE-900', Bearbeitungsstatus: 'Mahnung', MailVorgang: 'L9' })]);
  gleich(vg2.length, 2, 'markierte Mahnung nicht als Anlage versteckt');

  Object.assign(global, { bhBearbeitenAn: vorher.an, bhMarkierenAn: vorher.mark, bhMarkierung: vorher.wert, bhMarkierenOeffnen: vorher.oeffnen });
}

// Rückfrage: Der Grund steht auch bei grünem Ergebnis in den Details
gleich(M._monHinweis({ konform: 'Gelb - Warnungen', meldung: 'Materielle Abweichung Sichtbild ↔ XML: Bruttobetrag 119,00 € steht nicht im Sichtbild. Gebucht wird aus der XML. | Warnungen: [BR-DE-21] x', rueckfrage: true }),
  'Materielle Abweichung Sichtbild ↔ XML: Bruttobetrag 119,00 € steht nicht im Sichtbild. Gebucht wird aus der XML.', 'Rückfrage: Grund aus dem Abgleich vor den Regelcodes');

// Andere IBAN im PDF: vor der Zahlung klären, nie „aus der XML buchen“ (alter und neuer Text)
const ibanAlt = { konform: 'Gruen - KoSIT ok', rueckfrage: true,
  meldung: 'Materielle Abweichung Sichtbild ↔ XML: IBAN DE89 3704 0044 0532 0130 00 aus der XML steht nicht im Sichtbild, dort steht DE02 1203 0000 0000 2020 51. Gebucht wird aus der XML.' };
gleich([M._monBankKlaeren(ibanAlt), /Gebucht wird aus der XML/.test(M._monHinweis(ibanAlt)), /bekannte Telefonnummer/.test(M._monHinweis(ibanAlt))],
  [true, false, true], 'alter IBAN-Text: vor der Zahlung klären');
const ibanNeu = { konform: 'Gelb - Warnungen', rueckfrage: true,
  meldung: 'Bankverbindung vor der Zahlung klären: IBAN in der XML DE89 3704 0044 0532 0130 00, im PDF DE02 1203 0000 0000 2020 51. Beim Lieferanten über eine bekannte Telefonnummer bestätigen. | Warnungen: [BR-DE-21] x' };
gleich([M._monBankKlaeren(ibanNeu), M._monHinweis(ibanNeu).startsWith('Bankverbindung vor der Zahlung klären')], [true, true], 'neuer IBAN-Text');
gleich(M._monBankKlaeren({ rueckfrage: true, meldung: 'Materielle Abweichung Sichtbild ↔ XML: Bruttobetrag 1,00 € steht nicht im Sichtbild.' }), false, 'andere Abweichung ist kein IBAN-Fall');
gleich(M._monBankKlaeren(Object.assign({}, ibanAlt, { rueckfrage: false })), false, 'ohne Rückfrage-Flag kein IBAN-Fall');

// Buchungsweg einheitlich, ältere Hinweistexte in heutiger Fassung
gleich(['automatik', 'unter_vorbehalt', 'Manuell', 'Zurueckgewiesen', 'zurückgewiesen', '', null].map(M._monBuchungText),
  ['Automatik', 'Unter Vorbehalt', 'Manuell', 'Zurückgewiesen', 'Zurückgewiesen', '', ''], 'Buchungsweg');
gleich(M._monAlterText('Keine E-Rechnungs-XML eingebettet. Als sonstige Rechnung unter Vorbehalt gebucht, Berichtigung angefordert (UStAE 14.1 Abs. 2, 15.2a Abs. 1a).'),
  'Keine E-Rechnungs-XML eingebettet. Buchungsweg unter Vorbehalt, Einschätzung im Monitoring offen (UStAE 14.1 Abs. 2, 15.2a Abs. 1a).', 'sonstige Rechnung: nichts gebucht');
gleich(M._monAlterText('Reverse-Charge (§13b UStG) — manuelle Pruefung (Vier-Augen) erforderlich.'), 'Reverse-Charge (§13b UStG): Vier-Augen-Prüfung erforderlich.', 'Vier-Augen-Text');
gleich(M._monAlterText('PDF/A-3 fehlt — als sonstige Rechnung unter Vorbehalt gebucht, Berichtigung angefordert.'),
  'PDF/A-3 fehlerhaft, zählt als sonstige Rechnung. Buchungsweg unter Vorbehalt, Einschätzung im Monitoring offen.', 'PDF/A-Text');

// Prüfdienst nicht erreichbar: Fehler, unter Vorbehalt, Hinweis
const offen = datei('R-9_DE123456789.pdf', { Format: 'ZUGFeRD', Konformitaet: 'Ungeprueft', Buchung: 'Automatik', Verarbeitungsstatus: 'Validiert', Title: 'R-9' });
const [offenZ] = M._monGroup([offen]);
gleich([M._monPruefungOffen(offenZ), M._monMatchFlag(offenZ, 'fehler'), offenZ.buchung, offenZ.buchungAlt, /^Prüfung nicht gelaufen/.test(M._monHinweis(offenZ))],
  [true, true, 'Unter Vorbehalt', 'Automatik', true], 'ungeprüfte E-Rechnung');
gleich(M._monPruefungOffen(datei('scan.pdf', { Format: 'PDF', Konformitaet: 'Ungeprueft' })), false, 'PDF ohne E-Rechnung ist kein Fall');
gleich(M._monPruefungOffen(datei('R-10.pdf', { Format: 'ZUGFeRD', Konformitaet: 'Ungeprueft', ValidierungsMeldung: 'Prüfung nicht gelaufen (Prüfdienst nicht erreichbar).' })), true, 'neuer Text');
gleich(M._monHinweis({ konform: 'Gelb - Warnungen', meldung: 'Warnungen: [BR-DE-21] x', rueckfrage: false }), 'Verstoß gegen EN16931-Geschäftsregeln.', 'ohne Rückfrage wie bisher');
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

// Vier-Augen und Erledigt: Warteschlangen zählen nur Offenes (Register als Attrappe)
const reg = {};
Object.assign(global, {
  ugGeprueft: r => (reg[r.nummer] || {}).geprueft || null,
  ugZweitpruefung: r => (reg[r.nummer] || {}).geprueft2 || null,
  ugErledigt: (r, art) => (reg[r.nummer] || {})[{ rueckfrage: 'rueckfrageGestellt', zurueckweisung: 'zurueckweisungGesendet' }[art]] || null,
  ugMailsFuer: r => (reg[r.nummer] || {}).mails || [],
  ugRechnungSetzen: async () => {},
  getAuthUser: () => ({ username: 'erste@firma.example', name: 'Erika Erste' }),
});
const rc = { nummer: 'RC-1', richtung: 'Eingang', manuellePruefung: true, manuellePruefungGrund: 'Reverse-Charge (§13b UStG)', buchung: 'Manuell' };
gleich([M._monVierAugen(rc), M._monMatchFlag(rc, 'manuell')], [true, true], 'Reverse-Charge: Vier-Augen offen');
reg['RC-1'] = { geprueft: { am: '2026-11-17T08:00:00Z', von: 'erste@firma.example', vonName: 'Erika Erste' } };
gleich([M._monPruefStand(rc).fertig, M._monMatchFlag(rc, 'manuell')], [false, true], 'eine Prüfung reicht nicht');
let zelle = M._monZelle('geprueft', rc, 0);
gleich([/1 von 2/.test(zelle), /data-geprueft2="0" disabled/.test(zelle)], [true, true], 'Zweitprüfung nicht durch dieselbe Person');
reg['RC-1'].geprueft2 = { am: '2026-11-17T09:00:00Z', von: 'zweite@firma.example', vonName: 'Zora Zweite' };
gleich([M._monPruefStand(rc).fertig, M._monMatchFlag(rc, 'manuell'), /2 von 2/.test(M._monZelle('geprueft', rc, 0))], [true, false, true], 'zwei Personen: erledigt');
const normal = { nummer: 'N-1', richtung: 'Eingang', buchung: 'Automatik' };
reg['N-1'] = { geprueft: { am: '2026-11-17T08:00:00Z', von: 'erste@firma.example' } };
gleich([M._monVierAugen(normal), M._monPruefStand(normal).fertig, /✓ Geprüft</.test(M._monZelle('geprueft', normal, 1))], [false, true, true], 'ohne Vier-Augen eine Prüfung');

// Richtungsfilter oben: Eingang geprüft und nicht geprüft (Vier-Augen erst mit der zweiten Prüfung geprüft)
const imFilter = (r, richtung) => M._monMatchBase(Object.assign({ steller: '', empf: '', datum: '2026-11-17' }, r), { richtung }, '');
const ungeprueft = { nummer: 'N-2', richtung: 'Eingang', buchung: 'Automatik' };
const halb = { nummer: 'RC-2', richtung: 'Eingang', manuellePruefung: true, buchung: 'Manuell' };
reg['RC-2'] = { geprueft: { am: '2026-11-17T08:00:00Z', von: 'erste@firma.example' } };
const aus1 = { nummer: 'A-1', richtung: 'Ausgang' };
gleich([imFilter(normal, 'Eingang geprüft'), imFilter(normal, 'Eingang nicht geprüft'), imFilter(normal, 'Eingang')], [true, false, true], 'geprüft');
gleich([imFilter(ungeprueft, 'Eingang geprüft'), imFilter(ungeprueft, 'Eingang nicht geprüft')], [false, true], 'nicht geprüft');
gleich([imFilter(halb, 'Eingang geprüft'), imFilter(halb, 'Eingang nicht geprüft'), imFilter(rc, 'Eingang geprüft')], [false, true, true], 'Vier-Augen: 1 von 2 ist nicht geprüft');
gleich([imFilter(aus1, 'Eingang nicht geprüft'), imFilter(aus1, 'Ausgang'), imFilter(aus1, '')], [false, true, true], 'Ausgang nur bei Ausgang oder allen');
const libsWgc = [{ werk: 'WGC', richtung: 'Eingang', id: 'e' }, { werk: 'WGC', richtung: 'Ausgang', id: 'a' }, { intake: true, id: 'i' }];
gleich(M._monLibsZumAktualisieren(libsWgc, { werk: 'WGC', richtung: 'Eingang nicht geprüft' }).map(l => l.id), ['e', 'i'], 'Aktualisieren lädt den Eingang');

const rf = Object.assign({ nummer: 'RF-1', richtung: 'Eingang', buchung: 'Automatik', konform: 'Gruen - KoSIT ok' }, ibanAlt);
gleich([M._monMatchFlag(rf, 'rueckfrage'), /IBAN bestätigt/.test(M._monErledigtZelle(rf, 2))], [true, true], 'IBAN offen, Knopf „IBAN bestätigt“');
reg['RF-1'] = { rueckfrageGestellt: { am: '2026-11-17T10:00:00Z', von: 'erste@firma.example', vonName: 'Erika Erste' } };
gleich([M._monMatchFlag(rf, 'rueckfrage'), /✓ IBAN bestätigt · EE/.test(M._monErledigtZelle(rf, 2))], [false, true], 'IBAN bestätigt: nicht mehr offen');

const zw = { nummer: 'ZW-1', richtung: 'Eingang', buchung: 'Zurueckgewiesen' };
gleich([M._monMatchFlag(zw, 'zurueck'), /Zurückweisung gesendet/.test(M._monErledigtZelle(zw, 3))], [true, true], 'Zurückweisung offen');
reg['ZW-1'] = { mails: [{ art: 'Zurueckweisung', status: 'Gesendet', gesendetAm: '2026-11-17T11:00:00Z' }] };
gleich([M._monMatchFlag(zw, 'zurueck'), !!M._monErledigt(zw, 'zurueckweisung').perMail, /data-erledigt/.test(M._monErledigtZelle(zw, 3))],
  [false, true, false], 'vom Flow gesendet zählt, ohne Knopf');
gleich(M._monErledigtZelle({ nummer: 'A', richtung: 'Ausgang', rueckfrage: true }, 4), '', 'Ausgang ohne Knöpfe');
// Bearbeiten-Dialog: offene Punkte vor Genehmigung und Buchung (js/bearbeitung.js)
const monFn = ['_monPruefungOffen', '_monErledigt', '_monBankKlaeren', '_monHinweis', '_monGeprueftMoeglich', '_monPruefStand', '_monVierAugen'];
for (const k of monFn) global[k] = M[k];
gleich(B.bhWarnungen(Object.assign({}, rc)), [], 'Vier-Augen fertig: nichts offen');
delete reg['RC-1'].geprueft2;
gleich(B.bhWarnungen(rc), [{ text: 'Vier-Augen-Prüfung (Reverse-Charge (§13b UStG)) nicht abgeschlossen, 1 von 2 Prüfungen.', vorher: true }], 'Vier-Augen halb: vor dem Buchen');
const allesOffen = Object.assign({ nummer: 'X-1', richtung: 'Eingang', buchung: 'Automatik', dublette: true, dubletteInfo: 'gleiche Nummer wie X-1 vom 03.11.2026' }, ibanAlt);
const w = B.bhWarnungen(allesOffen);
gleich([w.length, /^Dublette: gleiche Nummer/.test(w[0].text), w[0].vorher, /^Bankverbindung vor der Zahlung klären/.test(w[1].text), w[1].vorher, w[2]],
  [3, true, true, true, true, { text: 'Noch nicht als geprüft markiert.', vorher: false }], 'Dublette und IBAN vorher klären, nicht geprüft nur Hinweis');
// Gewöhnliche Rückfrage: laut Prozess nach der Buchung, deshalb nur Hinweis
const rfNormal = { nummer: 'RN-1', richtung: 'Eingang', buchung: 'Automatik', konform: 'Gruen - KoSIT ok', rueckfrage: true,
  meldung: 'Materielle Abweichung Sichtbild ↔ XML: Rechnungsdatum 28.10.2026 steht nicht im Sichtbild. Gebucht wird aus der XML.' };
reg['RN-1'] = { geprueft: { am: '2026-11-17T08:00:00Z', von: 'erste@firma.example' } };
const wn = B.bhWarnungen(rfNormal);
gleich([wn.length, /^Rückfrage an den Lieferanten nach der Buchung stellen: Materielle Abweichung/.test(wn[0].text), wn[0].vorher], [1, true, false], 'Rückfrage nur Hinweis');

// Verarbeitung bei nicht gelaufener Prüfung: „Nicht geprüft“ statt „Validiert“
gleich(M._monGroup([datei('R-11_DE1.pdf', { Format: 'ZUGFeRD', Konformitaet: 'Ungeprueft', Verarbeitungsstatus: 'Validiert', Title: 'R-11' })])[0].status, 'Nicht geprüft', 'Status ehrlich');
gleich(M._monGroup([datei('R-12_DE1.pdf', { Format: 'ZUGFeRD', Konformitaet: 'Gruen - KoSIT ok', Verarbeitungsstatus: 'Validiert', Title: 'R-12' })])[0].status, 'Validiert', 'geprüft bleibt Validiert');
gleich(B.bhWarnungen({ nummer: 'A-1', richtung: 'Ausgang', dublette: true }), [], 'Ausgang: keine Warnungen');
for (const k of monFn) delete global[k];
for (const k of ['ugGeprueft', 'ugZweitpruefung', 'ugErledigt', 'ugMailsFuer', 'ugRechnungSetzen', 'getAuthUser']) delete global[k];

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

  // Aktualisieren: mit gewähltem Werk nur dessen Bibliotheken und die Eingangsstufe
  const libsAlle = [{ id: 'E1', werk: 'WGC', richtung: 'Eingang' }, { id: 'A1', werk: 'WGC', richtung: 'Ausgang' },
    { id: 'E2', werk: 'SHB', richtung: 'Eingang' }, { id: 'A2', werk: 'SHB', richtung: 'Ausgang' },
    { id: 'I', werk: '', richtung: 'Eingang', intake: true }];
  const zumNeuladen = (werk, richtung) => {
    const r = M._monLibsZumAktualisieren(libsAlle, Object.assign({}, M._monFilter, { werk, richtung }));
    return r && r.map(l => l.id);
  };
  gleich(zumNeuladen('', ''), null, 'Alle Werke: alles neu');
  gleich(zumNeuladen('SHB', ''), ['E2', 'A2', 'I'], 'SHB mit Eingangsstufe');
  gleich(zumNeuladen('SHB', 'Ausgang'), ['A2'], 'SHB Ausgang ohne Eingangsstufe');
  gleich(zumNeuladen('WGC', 'Eingang'), ['E1', 'I'], 'WGC Eingang');
  gleich(zumNeuladen('XYZ', ''), null, 'Werk ohne Bibliothek: alles neu');

  const d = (listId, file) => ({ listId, file });
  const alt = [d('E1', 'w1'), d('E2', 's1'), d('E2', 's2'), d('A2', 'sa1'), d('I', 'i1')];
  const neuGeladen = [d('E2', 's3'), d('E2', 's1'), d('A2', 'sa1'), d('I', 'i2')];
  gleich(M._monDateienTauschen(alt, neuGeladen, new Set(['E2', 'A2', 'I']), new Set(), libsAlle).map(x => x.file),
    ['w1', 's3', 's1', 'sa1', 'i2'], 'SHB getauscht, WGC unverändert, Reihenfolge nach Bibliothek');
  gleich(M._monDateienTauschen(alt, [d('E2', 's3'), d('I', 'i2')], new Set(['E2', 'A2', 'I']), new Set(['A2']), libsAlle).map(x => x.file),
    ['w1', 's3', 'sa1', 'i2'], 'Bibliothek mit Fehler behält die alten Dateien');

  // Große Bibliothek: Rest des Zeitraums in Zeitfenstern gleichzeitig, jede Datei genau einmal,
  // höchstens MON.gleichzeitig Abrufe auf einmal, danach „Ältere laden“ ab dem Stichtag
  {
    const vorher = { seite: M.MON.seite, gleichzeitig: M.MON.gleichzeitig };
    M.MON.seite = 2; M.MON.gleichzeitig = 2;
    const alle = [['f1', '2026-11-01'], ['f2', '2026-10-01'], ['f3', '2026-09-01'], ['f4', '2026-08-01'],
      ['f5', '2026-07-01'], ['f6', '2026-06-01'], ['f7', '2026-04-01'], ['f8', '2026-03-01']].map(([id, tag]) => eintrag(id, tag));
    const zwischen = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return null; const j = s.indexOf(b, i + a.length); return s.slice(i + a.length, j); };
    let aktiv = 0, hoechstens = 0;
    const urls = [];
    global.fetch = async url => {
      urls.push(url);
      aktiv++; hoechstens = Math.max(hoechstens, aktiv);
      await new Promise(r => setTimeout(r, 5));
      aktiv--;
      const ab = zwischen(url, "Created ge '", "'");
      const bis = zwischen(url, "Created lt '", "'");
      let treffer = alle.filter(e => (!ab || e.createdDateTime >= ab) && (!bis || e.createdDateTime < bis));
      if (url.includes('orderby')) treffer = treffer.slice().sort((a, b) => (a.createdDateTime < b.createdDateTime ? 1 : -1));
      const ab0 = Number(zwischen(url + '&', '&skip=', '&') || 0);
      const top = url.includes('$select=id&') ? 1 : M.MON.seite;
      const teil = treffer.slice(ab0, ab0 + top);
      const weiter = ab0 + top < treffer.length && top > 1 ? { '@odata.nextLink': url.split('&skip=')[0] + '&skip=' + (ab0 + top) } : {};
      return { ok: true, json: async () => Object.assign({ value: teil }, weiter) };
    };
    const libF = { id: 'F', werk: 'EWA', richtung: 'Eingang' };
    const geladen = [];
    const merken = s => { geladen.push(...s.map(r => r.file)); return true; };
    await M._monFetchLib('s', libF, 't', merken, '2026-05-05');
    gleich(geladen.slice().sort(), ['f1.pdf', 'f2.pdf', 'f3.pdf', 'f4.pdf', 'f5.pdf', 'f6.pdf'], 'Zeitfenster: alles bis zum Stichtag, jede Datei einmal');
    gleich(urls.filter(u => u.includes('Created ge')).length > 1, true, 'mehrere Fenster');
    gleich(hoechstens <= 2, true, 'nie mehr Abrufe gleichzeitig als erlaubt');
    const weiterUrl = M._monWeiter.get('F') || '';
    gleich([weiterUrl.includes('orderby'), weiterUrl.includes("Created lt '2026-05-05T00:00:00Z'")], [true, true], '„Ältere laden“ beginnt am Stichtag');
    await M._monFetchLib('s', libF, 't', merken, '2025-11-05');
    gleich(geladen.slice(6), ['f7.pdf', 'f8.pdf'], 'Ältere: der Rest');
    gleich(M._monWeiter.has('F'), false, 'dann nichts mehr offen');

    // Feldauswahl abgelehnt: dieselbe Abfrage ohne Auswahl, die Bibliothek merkt sich das
    const libS = { id: 'S', werk: 'EWA', richtung: 'Eingang' };
    gleich(M._monFelderAuswahl(libS).startsWith('fields($select=FileLeafRef,'), true, 'Feldauswahl');
    const echt = global.fetch;
    global.fetch = async url => (url.includes('fields($select=FileLeafRef')
      ? { ok: false, status: 400, text: async () => 'Spalte unbekannt', headers: { get: () => null } } : echt(url));
    geladen.length = 0; M._monWeiter.clear();
    await M._monFetchLib('s', libS, 't', merken, '2026-05-05');
    gleich([geladen.length, M._monOhneAuswahl.has('S'), M._monFelderAuswahl(libS)], [6, true, 'fields'], 'ohne Auswahl weiter');
    Object.assign(M.MON, vorher);
    M._monWeiter.clear();
  }

  // Reihenfolge nach dem gleichzeitigen Laden: die neuesten zuerst, bei gleicher Zeit die höhere Id
  gleich(M._monSortiert([{ itemId: '1', erstellt: '2026-10-01T10:00:00Z' }, { itemId: '3', erstellt: '2026-11-01T10:00:00Z' },
    { itemId: '2', erstellt: '2026-11-01T10:00:00Z' }]).map(x => x.itemId), ['3', '2', '1'], 'Reihenfolge wie früher');

  // Kalendertag in Deutschland (Winter- und Sommerzeit), auch beim zweiten Mal aus dem Gemerkten
  gleich(['2026-11-19T23:30:00Z', '2026-07-01T22:30:00Z', '2026-07-01T21:30:00Z', '2026-07-01', '', '2026-11-19T23:30:00Z'].map(M._monTag),
    ['2026-11-20', '2026-07-02', '2026-07-01', '2026-07-01', '', '2026-11-20'], 'Kalendertag');

  // Rechnungsart: Code aus dem Eingang mit Bezeichnung, Ausgang und Unbekanntes unverändert
gleich(['380', '381', ' 325 ', '380 - Rechnung', '999', '', null].map(M._monRechnungsart),
  ['380 - Rechnung', '381 - Gutschrift', '325 - Proformarechnung', '380 - Rechnung', '999', '', ''], 'Rechnungsart mit Bezeichnung');

console.log(`monitoring: ${n} Prüfungen grün`);
})().catch(e => { console.error(e); process.exit(1); });
