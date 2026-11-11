// node tests/meg-ausgang.test.js
// Ausgangsrechnung MEG (Meuselwitz Guss): erfundene Belege im Layout, das pdf.js liefert.
// Deutsch mit Zuschlägen je 100 kg, doppelte Zeilen (Fettdruck), überlagerte Frachtzeile,
// englisch steuerfrei, Schlussrechnung mit Anzahlungsbezug.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console: { log() {}, warn() {}, error() {} }, window: {}, Math, Date, JSON, RegExp, String, Number, Array, Object, Set, Map, parseFloat, parseInt, isNaN };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/parser.js'), 'utf8')
  + '\nthis.ist = _isMegInvoice; this.meg = extractMeg; this.steuer = _detectTaxCategory; this.registry = _COMPANY_REGISTRY;', ctx);

let n = 0;
const flach = x => x === undefined ? x : JSON.parse(JSON.stringify(x));   // Arrays aus dem vm-Kontext
const gleich = (ist, soll, m) => { assert.deepStrictEqual(flach(ist), soll, m + ': ' + JSON.stringify(ist)); n++; };
const NL = String.fromCharCode(10);
const r2 = x => Math.round(x * 100) / 100;
const summe = pos => r2(pos.reduce((s, p) => s + p.menge * p.einzelpreis, 0));
const LINIE = '___________________________________________________________________________________________';

// 1) Deutsch, zwei Positionen, Zuschläge je 100 kg, zweite Position mit überlagertem Text
const de = [
  'Rechnung',
  'Muster Werkzeug Rechnungs-Nr. 202609901',
  'Maschinen GmbH Datum 22.10.2026',
  'UST-ID.Nr. DE150528912',
  'c/o Muster Services GmbH',
  'Musterstraße 21',
  '12345 Musterstadt',
  'Ihre Kunden-Nr. Ihre Zeichen Ihre Bestell-Nr. Ihre Bestellung vom',
  '200001/60000001 Frau Muster 4500012345 22.08.2026',
  'Unsere Auftrags-Nr. Unsere Zeichen Ihren Auftrag bearbeitet Ihre U-ID Nummer',
  '357001 Abc-Def Herr Beispiel DE 123 456 789',
  'Lieferant-Nr.: 7000001',
  'Zahlungsbed.: 14 Tage 3% Skonto, 30 Tage Netto',
  'Preisstellung: FCA, Meuselwitz Guss, Incoterms 2020',
  'Lieferart: per Spedition',
  LINIE,
  'Pos. B e s c h r e i b u n g Preise',
  LINIE,
  'Lieferadresse Muster Montage GmbH',
  'Werkweg 5',
  '54321 Werkstadt',
  '0001 Preis /% kg 1 x 8,8 %kg 205,00 EUR/%kg 1.804,00 EUR',
  '0001 Preis /% kg 1 x 8,8 %kg 205,00 EUR/%kg 1.804,00 EUR',
  'Material TZ 1 x 8,8 %kg 34,75 EUR/%kg 305,80 EUR',
  'Material TZ 1 x 8,8 %kg 34,75 EUR/%kg 305,80 EUR',
  'Energie TZ 1 x 8,8 %kg 16,85 EUR/%kg 148,28 EUR',
  'Transportkosten 350,00 EUR/ST 350,00 EUR',
  'Rohgew.: 880, kg',
  'Artikel-Nr.: 000001-28-MG',
  'Bezeichnung: Deckplatte',
  'Zeichn.-Nr.: 6300001',
  'Werkstoff: EN-GJS-600-3',
  'Lieferschein: L-100001.01für Lieferung vom 23.10.2026',
  'Blatt 2 zu Rechnungs-Nr. 202609901 vom 22.10.2026',
  'Pos. B e s c h r e i b u n g Preise',
  'Kundeninformation',
  'Pos-Nr.: 10',
  'Material-Nr.: 6300001',
  'Positionssumme 2.608,08 EUR',
  '0002 Frachtkosten 1, x 650,00650,00 EUR/xEUR 650,00650,00 EUREUR',
  'Artikel-Nr.: Frachtkosten',
  'Bezeichnung: für Lieferung vom 23.10.2026',
  'Positionssumme 650,00 EUR',
  'Rechnungsbetrag 3.258,08 EUR',
  'MWSt 19 % 619,04 EUR',
  'Gesamtbetrag 3.877,12 EUR',
  '==================',
].join(NL);
gleich(ctx.ist(de), true, 'MEG erkannt an der eigenen USt-IdNr. im Kopf');
let r = ctx.meg(de);
gleich([r.rechnungsnummer, r.rechnungsdatum, r.kundennummer, r.bestellnummer, r.lieferantennummer, r.kaeufervat, r.verkaeufkontakt],
  ['202609901', '2026-10-22', '200001/60000001', '4500012345', '7000001', 'DE123456789', 'Abc-Def'], 'Kopf und Tabellen');
gleich(r.kontaktZeichen, 'Abc-Def', 'Ansprechpartner ist „Unsere Zeichen“, nicht der Bearbeiter');
gleich([r.kaeufer, r.kaeuferzusatz, r.kaeuferstrasse, r.kaeuferplz, r.kaeuferstadt, r.kaeuferland],
  ['Muster Werkzeug Maschinen GmbH', 'c/o Muster Services GmbH', 'Musterstraße 21', '12345', 'Musterstadt', 'DE'], 'Anschrift');
gleich([r.lieferName, r.lieferStrasse, r.lieferPlz, r.lieferStadt], ['Muster Montage GmbH', 'Werkweg 5', '54321', 'Werkstadt'], 'Lieferadresse');
gleich([r.faelligkeitsdatum, r.lieferscheinnummer, r.lieferdatum], ['2026-11-21', 'L-100001.01', '2026-10-23'], 'Fälligkeit, Lieferschein, Lieferdatum');
gleich(r.notiz, 'Zahlungsbedingung: 14 Tage 3% Skonto, 30 Tage Netto' + NL + 'Preisstellung: FCA, Meuselwitz Guss, Incoterms 2020', 'Hinweise ohne Linien und Lieferart');
gleich(r.positionen.map(p => [p.posnr, p.beschreibung, p.menge, p.einheit, r2(p.einzelpreis), p.mwst]), [
  ['1', 'Deckplatte', 1, 'Stk', 1804, 19],
  ['', 'Materialteuerungszuschlag', 1, 'Pausch.', 305.8, 19],
  ['', 'Energieteuerungszuschlag', 1, 'Pausch.', 148.28, 19],
  ['', 'Transportkosten', 1, 'Pausch.', 350, 19],
  ['2', 'Frachtkosten für Lieferung vom 23.10.2026', 1, 'Pausch.', 650, 19],
], 'Positionen, doppelte Zeilen einmal, Fracht aus der Positionssumme');
gleich(summe(r.positionen), 3258.08, 'Summe = Rechnungsbetrag');
const p1 = r.positionen[0];
gleich([p1.bestellposition, p1.positionsnotiz, p1.leistungVon], ['10', 'Lieferschein L-100001.01 vom 23.10.2026', '2026-10-23'], 'Bestellposition, Lieferschein, Lieferdatum je Position');
gleich(p1.details, '1 x 8,8 %kg à 205,00 EUR/%kg; Artikel-Nr. 000001-28-MG; Zeichn.-Nr. 6300001; Werkstoff EN-GJS-600-3; Material-Nr. 6300001', 'Details');
gleich(r.positionen[1].details, '1 x 8,8 %kg à 34,75 EUR/%kg', 'Zuschlag mit Menge je 100 kg');

// 2) Englisch, steuerfrei, Kunde in Österreich, Menge „5, ST“, „,22 %kg“
const en = [
  'INVOICE',
  'Muster Motoren GmbH & Co. OG invoice-no. 202609902',
  'ABT 6200 date 30.09.2026',
  'UST-ID.Nr. DE150528912',
  'Musterstr. 1-3',
  'A-6200 Musterdorf',
  'customer-no. your sign purchase order order from',
  '300001/61000001 Frau Muster 2600001 01.06.2026',
  'our order-no. our sign our contact your u-id number',
  '356001 Abc-Def Herr Beispiel ATU 12345678',
  'country of origin: Germany',
  'supplier-no: 100001',
  'terms: 75 Tage Netto (bei 15 Tage 2% Abzug)',
  'price condition: FCA, Meuselwitz Guss, Incoterms 2020',
  'tranport route: per Spedition',
  'i t e m price',
  'delivery address Muster Motoren GmbH & Co OG',
  'Musterstr. 1-3',
  'A-6200 Musterdorf',
  '0001 basic price 5, ST 100,00 EUR/ST 500,00 EUR',
  'Material TZ 5 x ,22 %kg 34,75 EUR/%kg 38,23 EUR',
  'name: Konsole',
  'delivery note: L-100002.01for delivery from 30.09.2026',
  'item-no.: 1',
  'item price __________________538,23 EUR',
  'total price 538,23 EUR',
].join(NL);
gleich(ctx.ist(en), true, 'englisch erkannt');
r = ctx.meg(en);
gleich([r.rechnungsnummer, r.rechnungsdatum, r.kundennummer, r.bestellnummer, r.kaeufervat, r.verkaeufkontakt, r.lieferantennummer],
  ['202609902', '2026-09-30', '300001/61000001', '2600001', 'ATU12345678', 'Abc-Def', '100001'], 'Kopf englisch');
gleich([r.kaeufer, r.kaeuferzusatz, r.kaeuferstrasse, r.kaeuferland, r.lieferLand], ['Muster Motoren GmbH & Co. OG', 'ABT 6200', 'Musterstr. 1-3', 'AT', 'AT'], 'Anschrift Österreich');
gleich(r.positionen.map(p => [p.beschreibung, p.menge, r2(p.einzelpreis), p.mwst]), [['Konsole', 5, 100, 0], ['Materialteuerungszuschlag', 1, 38.23, 0]], 'Positionen steuerfrei');
gleich(summe(r.positionen), 538.23, 'Summe = total price');
gleich(ctx.steuer(en, r).steuerkategorie, 'K', 'Österreich → K');
gleich(r.notiz.includes('tranport'), false, 'vertippte Lieferart nicht in den Hinweisen');

// 3) Steuerfrei innergemeinschaftlich ohne Straße, USt-IdNr. in der Lieferadresse, Schlussrechnung
const schluss = [
  'Rechnung',
  'Muster SE Rechnungs-Nr. 202609903',
  'Dept. ABC Datum 26.10.2026',
  'UST-ID.Nr. DE150528912',
  '86000 Musterstadt',
  'Ihre Kunden-Nr. Ihre Zeichen Ihre Bestell-Nr. Ihre Bestellung vom',
  '300002/60100001 Herr Muster 4500000001 27.02.2026',
  'Unsere Auftrags-Nr. Unsere Zeichen Ihren Auftrag bearbeitet Ihre U-ID Nummer',
  '356002 Abc-Def Herr Beispiel FR 12345678901',
  '--- S C H L U S S - R E C H N U N G ---',
  'Steuerbefreite innergemeinschaftliche Lieferung',
  'Zahlungsbed.: Vorkasse nach Vereinbarung',
  'Pos. B e s c h r e i b u n g Preise',
  'Lieferadresse Muster SE',
  'FR12345678901',
  'Rue de Muster 7',
  '44000 Ville',
  '0001 50% Rest 1, ST 1.000,00 EUR/ST 1.000,00 EUR',
  'Bezeichnung: Kurbelgehäuse',
  'Positionssumme 1.000,00 EUR',
  'Gesamtbetrag 1.000,00 EUR',
  '==================',
  '50% Anzahlung #202609800 vom 21.07.2026',
].join(NL);
r = ctx.meg(schluss);
gleich([r.kaeufer, r.kaeuferstrasse, r.kaeuferzusatz, r.kaeufervat], ['Muster SE', 'Dept. ABC', null, 'FR12345678901'], 'ohne Straße: Zusatzzeile als Adresszeile');
gleich([r.lieferName, r.lieferStrasse, r.lieferLand], ['Muster SE', 'Rue de Muster 7', 'FR'], 'USt-IdNr. in der Lieferadresse gibt das Land');
gleich([r.befreiungsgrund, r.vorrechnungsnummer, r.vorrechnungsdatum], ['Steuerbefreite innergemeinschaftliche Lieferung', '202609800', '2026-07-21'], 'Befreiung und Anzahlungsbezug');
gleich(r.positionen.map(p => [p.beschreibung, p.menge, p.einzelpreis, p.mwst]), [['Kurbelgehäuse, 50% Rest', 1, 1000, 0]], 'Rest als Hauptposition');
gleich(r.notiz.split(NL).slice(0, 3), ['Zahlungsbedingung: Vorkasse nach Vereinbarung', 'Schlussrechnung', 'Steuerbefreite innergemeinschaftliche Lieferung'], 'Hinweise');

// 4) Mehrere Lieferscheine (je Teil einer, die Rechnung über mehrere Teile): alle in BT-16
const zwei = [
  'Rechnung',
  'Muster Anlagen GmbH Rechnungs-Nr. 202609904',
  'Datum 10.11.2026',
  'UST-ID.Nr. DE150528912',
  'Musterweg 1',
  '12345 Musterstadt',
  'Ihre Kunden-Nr. Ihre Zeichen Ihre Bestell-Nr. Ihre Bestellung vom',
  '200002/60000002 4500000002 31.08.2026',
  'Unsere Auftrags-Nr. Unsere Zeichen Ihren Auftrag bearbeitet Ihre U-ID Nummer',
  '357002 Muster-Kontakt DE 123 456 789',
  'Pos. B e s c h r e i b u n g Preise',
  '0001 Grundpreis 1, ST 1.000,00 EUR/ST 1.000,00 EUR',
  'Bezeichnung: Halter A',
  'Lieferschein: L-100003.01für Lieferung vom 09.11.2026',
  'Positionssumme 1.000,00 EUR',
  '0002 Grundpreis 1, ST 2.000,00 EUR/ST 2.000,00 EUR',
  'Bezeichnung: Halter B',
  'Lieferschein: L-100004.01für Lieferung vom 10.11.2026',
  'Positionssumme 2.000,00 EUR',
  '0003 Grundpreis 1, ST 500,00 EUR/ST 500,00 EUR',
  'Bezeichnung: Halter C',
  'Lieferschein: L-100003.01für Lieferung vom 09.11.2026',
  'Positionssumme 500,00 EUR',
  'Rechnungsbetrag 3.500,00 EUR',
  'MWSt 19 % 665,00 EUR',
  'Gesamtbetrag 4.165,00 EUR',
].join(NL);
r = ctx.meg(zwei);
gleich([r.lieferscheinnummer, r.lieferdatum], ['L-100003.01, L-100004.01', '2026-11-09'], 'alle Lieferscheine, jeder einmal, Lieferdatum der ersten Position');
gleich(r.positionen.map(p => [p.beschreibung, p.positionsnotiz, p.leistungVon]), [
  ['Halter A', 'Lieferschein L-100003.01 vom 09.11.2026', '2026-11-09'],
  ['Halter B', 'Lieferschein L-100004.01 vom 10.11.2026', '2026-11-10'],
  ['Halter C', 'Lieferschein L-100003.01 vom 09.11.2026', '2026-11-09']], 'Lieferschein und Datum je Position');
gleich([r.verkaeufkontakt, r.kontaktZeichen], ['Muster-Kontakt', 'Muster-Kontakt'], 'Zeichen ohne Bearbeiter');
r = ctx.meg(zwei.replace('357002 Muster-Kontakt', '357002 Herr Beispiel'));
gleich([r.verkaeufkontakt, r.kontaktZeichen], ['Herr Beispiel', null], 'ohne Zeichen gilt der Bearbeiter');

// 5) Stammdaten
const reg = ctx.registry.MEG;
gleich([reg.verkaeufer, reg.verkaeufervat, reg.iban, reg.registernr, reg._aktiv], ['Meuselwitz Guss Eisengießerei GmbH', 'DE150528912', 'DE11860700000208986000', 'HRB 203104', true], 'Registry MEG');
gleich(reg._detect.test('UST-ID.Nr. DE150528912'), true, 'Erkennung über die eigene USt-IdNr.');

console.log(`meg-ausgang: ${n} Prüfungen ok`);
