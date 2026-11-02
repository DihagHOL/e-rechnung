// node tests/shb-ausgang.test.js
// Ausgangsrechnung SHB (Bösdorf): erfundene Belege im Layout, das pdf.js liefert.
// Deutsch mit MwSt, steuerfrei innergemeinschaftlich (ohne „Nettowert“), § 4 Nr. 2 UStG,
// Anzahlungsrechnung mit doppelten Zeilen und englische Rechnung.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console: { log() {}, warn() {}, error() {} }, window: {}, Math, Date, JSON, RegExp, String, Number, Array, Object, Set, Map, parseFloat, parseInt, isNaN };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/parser.js'), 'utf8')
  + '\nthis.ist = _isGermanSHBInvoice; this.meta = extractMetadataGermanSHB; this.kaeufer = extractBuyerGermanSHB;'
  + ' this.pos = extractLineItemsGermanSHB; this.konto = _shbZahlungskonto; this.steuer = _detectTaxCategory; this.lieferschein = _extractLieferschein;', ctx);

let n = 0;
const flach = x => x === undefined ? x : JSON.parse(JSON.stringify(x));   // Arrays aus dem vm-Kontext
const gleich = (ist, soll, m) => { assert.deepStrictEqual(flach(ist), soll, m + ': ' + JSON.stringify(ist)); n++; };
const NL = String.fromCharCode(10);
const r2 = x => Math.round(x * 100) / 100;
const summe = pos => r2(pos.reduce((s, p) => s + p.menge * p.einzelpreis, 0));
const FUSS = [
  'SHB Stahl- und Hartgusswerk Bösdorf GmbH• Werkstraße 7 • 04249 Leipzig |www.shb-guss.de•Tel+49 341 42 79 0 •Fax+49 341 42 79 308',
  'Mailgiesserei@shb-guss.de |HandelsregisterAmtsgericht Leipzig • HRB 13893 • USt-IdNr. DE 812 264 517',
  'Deutsche Bank AG Erfurt• BIC DEUTDE8EXXX • IBAN DE07 8207 0000 0338 6695 00 |GeschäftsführungViktor Babushchak',
];
const KONTO_01 = ['Wir erbitten die Zahlungen auf unser Konto der Deutschen Bank', 'IBAN: DE 77 8207 0000 0338 6695 01', 'BIC: DEUTDE8EXXX'];

// 1) Steuerfrei innergemeinschaftlich: Kopf und Anschrift auf denselben Zeilen, kein „Nettowert“
const eu = [
  'RECHNUNG',
  'Stahl- und Hartgusswerk Bösdorf GmbH - Werkstr. 7 - 04249 Leipzig',
  'Muster Industrie SAS Rechnungs-Nr. : 2600901',
  'CS 12345',
  '12, rue de Muster Re.-Datum : 25.09.2026',
  'Auftrags-Nr. : 2600011',
  'F-67000 STRASBOURG-Cedex',
  'Bestellung : 4711 Pos. 1, 2',
  'Kunden-Nr. : 5001',
  'Leistungs-Dat. : 25.09.2026',
  'I. Ust-Id-Nr : FR 12345678901',
  'Ihr Zeichen : Herr Muster',
  'Bitte geben Sie bei Zahlung und Schriftverkehr unbedingt die Rechnungsnummer',
  'Pos. B E S C H R E I B U N G €/ME € Gesamt',
  '0001 Lieferschein-Nr. : 2600800.01 vom 25.09.2026',
  'Bezeichnung : Gussteil Typ A 2 Stk',
  'Preis mit AOD-Konverter: 1.000,50 €/Stk 2.001,00 €',
  'MTZ : 0,67 €/kg 100,00 €',
  'ETZ : 0,32 €/kg _______________50,00 €',
  'Rechnungsbetrag : 2.151,00 €',
  '===============',
  'Steuerfreie innergem. Lieferung nach §4 Nr.1b USTG in Verbindung mit §6a UStG',
  'Zahlungseingang : Bis zum 25.10.2026 netto',
  'Preisstellung : ab Werk, Spedition Kunde',
  ...FUSS, ...KONTO_01,
].join(NL);
gleich(ctx.ist(eu), true, 'steuerfrei ohne Nettowert erkannt');
let m = ctx.meta(eu);
gleich([m.rechnungsnummer, m.rechnungsdatum, m.lieferdatum, m.faelligkeitsdatum, m.bestellnummer, m.kundennummer],
  ['2600901', '2026-09-25', '2026-09-25', '2026-10-25', '4711 Pos. 1, 2', '5001'], 'Kopf');
gleich(m.befreiungsgrund, 'Steuerfreie innergem. Lieferung nach §4 Nr.1b USTG in Verbindung mit §6a UStG', 'Befreiungsgrund aus dem Text');
gleich(m.notiz, 'Zahlungsbedingung: Bis zum 25.10.2026 netto' + NL + 'Preisstellung: ab Werk, Spedition Kunde', 'Hinweise');
let k = ctx.kaeufer('', eu);
gleich([k.kaeufer, k.kaeuferzusatz, k.kaeuferstrasse, k.kaeuferplz, k.kaeuferstadt, k.kaeuferland, k.kaeufervat],
  ['Muster Industrie SAS', 'CS 12345', '12, rue de Muster', '67000', 'STRASBOURG-Cedex', 'FR', 'FR12345678901'], 'Anschrift aus dem Fließtext');
let p = ctx.pos(eu);
gleich(p.map(x => [x.beschreibung, x.menge, x.mwst]), [['Gussteil Typ A', 2, 0], ['MTZ – Materialteuerungszuschlag', 1, 0], ['ETZ – Energieteuerungszuschlag', 1, 0]], 'Positionen steuerfrei');
gleich(summe(p), 2151, 'Summe = Rechnungsbetrag');
gleich(ctx.steuer(eu, { positionen: p }).steuerkategorie, 'K', 'innergem. → K');
gleich(ctx.konto(eu), { iban: 'DE77820700000338669501', bic: 'DEUTDE8EXXX' }, 'Konto aus der Zahlungsaufforderung, nicht aus dem Fuß');
gleich(ctx.lieferschein(eu).lieferscheinnummer, '2600800.01', 'Lieferschein');

// 2) Inland mit MwSt, Uns. Zeichen, zweite Preiszeile (Transport), „Zahlungseingang“ ohne Doppelpunkt
const de = [
  'RECHNUNG',
  'Stahl- und Hartgusswerk Bösdorf GmbH - Werkstr. 7 - 04249 Leipzig',
  'Muster Seilbau GmbH Rechnungs-Nr. : 2600902',
  'Abteilung Einkauf',
  'Musterweg 1 Re.-Datum : 20.10.2026',
  'D-12345 Musterstadt Auftrags-Nr. : 2600012',
  'Uns. Zeichen : Abc',
  'Telefon : 0341 4279-999',
  'E-Mail : vertrieb.muster@shb-guss.de',
  'Bestellung : OP 1 Pos. 2',
  'Pos. B E S C H R E I B U N G €/ME € Gesamt',
  '0001 Bezeichnung : Seilbirne 23 Stk',
  'Preis : 301,60 €/Stk 6.936,80 €',
  'MTZ : 0,76 €/kg 157,32 €',
  'Transport / Verpackg. (Rahmen): 184,00 €/Pos. 184,00 €',
  'Nettowert : 7.278,12 €',
  'MwSt : 19,00 % 1.382,84 €',
  'Rechnungsbetrag : 8.660,96 €',
  'Zahlungseingang Bis zum 19.11.2026 netto',
  ...FUSS, ...KONTO_01,
].join(NL);
const kopfDe = 'Stahl- und Hartgusswerk Bösdorf GmbH - Werkstr. 7 - 04249 Leipzig' + NL + 'Muster Seilbau GmbH' + NL + 'Abteilung Einkauf' + NL + 'Musterweg 1' + NL + 'D-12345 Musterstadt';
m = ctx.meta(de);
gleich([m.verkaeufkontakt, m.verkaeuftel, m.verkaeuferemail, m.faelligkeitsdatum], ['Abc', '0341 4279-999', 'vertrieb.muster@shb-guss.de', '2026-11-19'], 'Ansprechpartner aus dem Kopf, Fälligkeit ohne Doppelpunkt');
gleich(m.befreiungsgrund, undefined, 'mit MwSt kein Befreiungsgrund');
k = ctx.kaeufer(kopfDe, de);
gleich([k.kaeufer, k.kaeuferzusatz, k.kaeuferstrasse, k.kaeuferland], ['Muster Seilbau GmbH', 'Abteilung Einkauf', 'Musterweg 1', 'DE'], 'Anschrift aus dem Adressfenster');
p = ctx.pos(de);
gleich(p.map(x => [x.beschreibung, x.menge, r2(x.einzelpreis), x.mwst]),
  [['Seilbirne', 23, 301.6, 19], ['MTZ – Materialteuerungszuschlag', 1, 157.32, 19], ['Transport / Verpackg. (Rahmen)', 1, 184, 19]], 'Transport als eigene Position');
gleich(summe(p), 7278.12, 'Summe = Nettowert');

// 3) § 4 Nr. 2 UStG → E
const see = de.replace('MwSt : 19,00 % 1.382,84 €', '').replace('Nettowert : 7.278,12 €', '').replace('Rechnungsbetrag : 8.660,96 €', 'Rechnungsbetrag : 7.278,12 €' + NL + 'Steuerfrei gem. §4 Nr. 2 UstG');
p = ctx.pos(see);
gleich([p.every(x => x.mwst === 0), summe(p)], [true, 7278.12], '§ 4 Nr. 2 ohne MwSt');
gleich(ctx.steuer(see, { positionen: p }).steuerkategorie, 'E', '§ 4 Nr. 2 → E');
gleich(ctx.meta(see).befreiungsgrund, 'Steuerfrei gem. §4 Nr. 2 UstG', 'Befreiungsgrund E');

// 4) Anzahlungsrechnung: V-Nummer, Bezeichnung in der Positionszeile, jede Zeile doppelt
const anz = [
  'ANZAHLUNGSRECHNUNG',
  'Stahl- und Hartgusswerk Bösdorf GmbH – Werkstr. 7 – 04249 Leipzig',
  'Muster Bahn GmbH Rechnungs-Nr.: V2600099',
  'Bahnweg 2-5 Re.-Datum: 08.10.2026',
  'D-04179 Leipzig',
  'Leistungs-Dat. 08.10.2026',
  'Pos. B E S C H R E I B U N G €/ME € Gesamt',
  '0001 Bezeichnung: Konsole 023 5,00 Stk',
  'Preis: 826,28 € / Stk 4.131,40 €', 'Preis: 826,28 € / Stk 4.131,40 €',
  'ETZ: 0,51 € / kg 44,37 €', 'ETZ: 0,51 € / kg 44,37 €',
  'Nettowert: 4.175,77 €', 'Nettowert: 4.175,77 €',
  'MwSt: 19,00% 793,40 €',
  'Rechnungsbetrag 4.969,17 €',
  'Diese Rechnung berechtigt nicht zum Vorsteuerabzug!',
  'Zahlungsbedingung: 100 % Vorkasse',
  'Wir erbitten die Zahlung auf unser Konto der Deutschen Bank AG Erfurt', 'IBAN: DE 07 8207 0000 0338 6695 00', 'BIC: DEUTDE8E',
  ...FUSS,
].join(NL);
gleich(ctx.ist(anz), true, 'Anzahlung erkannt');
m = ctx.meta(anz);
gleich([m.rechnungsart, m.rechnungsnummer, m.lieferdatum], ['386', 'V2600099', '2026-10-08'], 'Anzahlung, V-Nummer, Leistungsdatum ohne Doppelpunkt');
gleich(m.notiz, 'Zahlungsbedingung: 100 % Vorkasse' + NL + 'Diese Rechnung berechtigt nicht zum Vorsteuerabzug!', 'Vorkasse als Zahlungsbedingung');
p = ctx.pos(anz);
gleich(p.map(x => [x.beschreibung, x.menge, x.mwst]), [['Konsole 023', 5, 19], ['ETZ – Energieteuerungszuschlag', 1, 19]], 'doppelte Zeilen einmal');
gleich(ctx.konto(anz), { iban: 'DE07820700000338669500', bic: 'DEUTDE8EXXX' }, 'Anzahlung: Konto laut Aufforderung, BIC der Bank aus den Stammdaten');

// 5) Englische Rechnung (Export in die EU)
const en = [
  'INVOICE',
  'Stahl- und Hartgusswerk Bösdorf GmbH - Werkstr. 7 - 04249 Leipzig',
  'Muster Vehicles a.s. Invoice No. : 2600903',
  'Musterova 7/1',
  'CZ-186 00 Praha 8 - Karlin Invoice Date : 09.10.2026',
  'Order N° : 2600209',
  'Your Order No. : N123 Pos. 2,6',
  'Cust. ID-No. : 6275',
  'Date of delivery : 09.10.2026',
  'Your VAT-No. : CZ12345678',
  'By payment and correspondence please let us know our invoice no. and the customer no.',
  'Item D E S C R I P T I O N €/QU € Total',
  '0001 Delivery No. : 2600564.01 of 09.10.2026',
  'Name : Flansch (rechts) 3 pcs.',
  'Price (per unit) : 1.715,10 €/pcs. 5.145,30 €',
  'Material price escalation surcharge [€/ kg finished] 10,00 €/pcs. 30,00 €',
  'Amount total : 5.175,30 €',
  'Internal communal and tax free deliveries acc. to § 6a UStG',
  'Receipt of payment : Up to 08.11.2026 net',
  'Delivery Terms : EXW',
  ...FUSS,
].join(NL);
gleich(ctx.ist(en), true, 'englisch erkannt');
m = ctx.meta(en);
gleich([m.rechnungsnummer, m.rechnungsdatum, m.lieferdatum, m.faelligkeitsdatum, m.bestellnummer, m.kundennummer],
  ['2600903', '2026-10-09', '2026-10-09', '2026-11-08', 'N123 Pos. 2,6', '6275'], 'Kopf englisch, Order N° ist der eigene Auftrag');
k = ctx.kaeufer('', en);
gleich([k.kaeufer, k.kaeuferstrasse, k.kaeuferplz, k.kaeuferstadt, k.kaeuferland, k.kaeufervat],
  ['Muster Vehicles a.s.', 'Musterova 7/1', '186 00', 'Praha 8 - Karlin', 'CZ', 'CZ12345678'], 'Anschrift CZ mit Leerzeichen in der PLZ');
p = ctx.pos(en);
gleich(p.map(x => [x.beschreibung, x.menge, x.einheit, x.mwst]), [['Flansch (rechts)', 3, 'Stk', 0], ['MTZ – Materialteuerungszuschlag', 1, 'Pausch.', 0]], 'Positionen englisch');
gleich(summe(p), 5175.3, 'Summe = Amount total');
gleich(ctx.steuer(en, { positionen: p }).steuerkategorie, 'K', 'Internal communal → K');
gleich(ctx.lieferschein(en).lieferscheinnummer, '2600564.01', 'Delivery No.');

// 6) Gescannt (OCR): Satzzeichen und Leerzeichen verrutscht, IBAN mit falscher Prüfziffer
const ocr = en
  .replace('Invoice No. : 2600903', 'Invoice No, ; 2600903')
  .replace('Cust. ID-No. : 6275', 'Cust, ID-No. : 6275')
  .replace('Date of delivery : 09.10.2026', 'Date ofdelivery : 09.10.2026')
  .replace('Your VAT-No. : CZ12345678', 'YourVAT-No. : CZ12345678')
  .replace('Your Order No. : N123', 'Your Order No. ; N123')
  .replace('Up to 08.11.2026', 'Upto 08.11.2026')
  .replace('3 pcs.', '3 pes.');
m = ctx.meta(ocr);
gleich([m.rechnungsnummer, m.kundennummer, m.lieferdatum, m.faelligkeitsdatum, m.bestellnummer],
  ['2600903', '6275', '2026-10-09', '2026-11-08', 'N123 Pos. 2,6'], 'OCR: Kopf trotz Semikolon und fehlender Leerzeichen');
gleich(ctx.kaeufer('', ocr).kaeufervat, 'CZ12345678', 'OCR: USt-IdNr.');
gleich(ctx.pos(ocr)[0].menge, 3, 'OCR: „pes.“ als Stück');
const ocrPos = ctx.pos(ocr.replace('3 pes.', '3 pces.').replace('10,00 €/pcs. 30,00 €', '10,00 E€/pcs. 30,00 E'));
gleich([ocrPos[0].menge, ocrPos.length, summe(ocrPos)], [3, 2, 5175.3], 'OCR: „pces.“ und „E€“');
gleich(ctx.konto(KONTO_01.join(NL).replace('BIC: DEUTDE8EXXX', 'BIC: DEUTDE8SEXXX')), { iban: 'DE77820700000338669501', bic: 'DEUTDE8EXXX' }, 'OCR: verlesener BIC → BIC aus den Stammdaten');
gleich(ctx.konto(KONTO_01.join(NL).replace('6695 01', '6595 01')), {}, 'OCR: IBAN mit falscher Prüfziffer wird nicht übernommen');

console.log(`shb-ausgang: ${n} Prüfungen ok`);
