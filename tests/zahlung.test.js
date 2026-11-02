// node tests/zahlung.test.js
// Zahlungsart (BT-81), Lastschrift (BT-89 bis BT-91), Leistungszeitraum je Position (BG-26) und das
// ZUGFeRD-Profil: XML erzeugen (js/xrechnung.js) und wieder einlesen (js/xmlinvoice.js).
// Braucht api/node_modules (@xmldom/xmldom) wie validation/generate-samples.js.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { DOMParser } = require(path.join(__dirname, '../api/node_modules/@xmldom/xmldom'));

const NL = String.fromCharCode(10);
const ctx = { console, window: {}, DOMParser, Math, Date, JSON, RegExp, String, Number, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite };
vm.createContext(ctx);
for (const f of ['xrechnung.js', 'xmlinvoice.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'), ctx);
vm.runInContext('this.buildXML = buildXML; this.parseInvoiceXML = parseInvoiceXML;', ctx);

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(JSON.parse(JSON.stringify(ist)), soll, m + ': ' + JSON.stringify(ist)); n++; };   // Arrays aus dem vm-Kontext
const hat = (xml, teil, m) => { assert.ok(xml.includes(teil), m + ': fehlt ' + teil); n++; };
const ohne = (xml, teil, m) => { assert.ok(!xml.includes(teil), m + ': unerwartet ' + teil); n++; };

const basis = {
  verkaeufer: 'Muster GmbH', verkaeufstrasse: 'Weg 1', verkaeufplz: '12345', verkaeufstadt: 'Musterstadt', verkaeufland: 'DE',
  verkaeufervat: 'DE111111125', verkaeufkontakt: 'Erika Muster', verkaeuftel: '+49 1 2', verkaeuferemail: 'a@muster.de',
  iban: 'DE02120300000000202051', bic: 'BYLADEM1001',
  kaeufer: 'Kunde GmbH', kaeuferstrasse: 'Gasse 2', kaeuferplz: '54321', kaeuferstadt: 'Kundenstadt', kaeuferland: 'DE',
  kaeufermail: 'rechnung@kunde.de', rechnungsnummer: '135/26', rechnungsdatum: '2026-11-02', faelligkeitsdatum: '2026-11-16',
  positionen: [{ beschreibung: 'Stiftstein', menge: 300, einheit: 'Stk', einzelpreis: 1.764, mwst: 19 }],
};

// Überweisung wie bisher
let xml = ctx.buildXML(basis, 'xrechnung');
hat(xml, '<ram:TypeCode>58</ram:TypeCode>', 'Standard Überweisung');
hat(xml, '<ram:IBANID>DE02120300000000202051</ram:IBANID>', 'eigenes Konto');
let r = ctx.parseInvoiceXML(xml);
gleich([r.zahlungsart, r.iban], ['58', 'DE02120300000000202051'], 'Überweisung gelesen');

// Verrechnung: kein Konto
xml = ctx.buildXML(Object.assign({}, basis, { zahlungsart: '97' }), 'xrechnung');
hat(xml, '<ram:TypeCode>97</ram:TypeCode>', 'Verrechnung');
ohne(xml, 'DE02120300000000202051', 'Verrechnung ohne eigenes Konto');
r = ctx.parseInvoiceXML(xml);
gleich([r.zahlungsart, r.iban], ['97', ''], 'Verrechnung gelesen');

// Lastschrift: Konto des Kunden, Mandat, Gläubiger-ID; Gläubiger-ID vor PaymentReference
const ls = Object.assign({}, basis, { zahlungsart: '59', kundeIban: 'DE89 3704 0044 0532 0130 00', mandatsreferenz: 'M-100123', glaeubigerId: 'DE98ZZZ09999999999' });
xml = ctx.buildXML(ls, 'xrechnung');
hat(xml, '<ram:PayerPartyDebtorFinancialAccount>', 'Konto des Kunden');
hat(xml, '<ram:IBANID>DE89370400440532013000</ram:IBANID>', 'Kunden-IBAN ohne Leerzeichen');
hat(xml, '<ram:DirectDebitMandateID>M-100123</ram:DirectDebitMandateID>', 'Mandat');
ohne(xml, 'PayeePartyCreditorFinancialAccount', 'Lastschrift ohne eigenes Konto (BR-DE-24)');
assert.ok(xml.indexOf('<ram:CreditorReferenceID>') < xml.indexOf('<ram:PaymentReference>'), 'Reihenfolge CII'); n++;
r = ctx.parseInvoiceXML(xml);
gleich([r.zahlungsart, r.kundeIban, r.mandatsreferenz, r.glaeubigerId], ['59', 'DE89370400440532013000', 'M-100123', 'DE98ZZZ09999999999'], 'Lastschrift gelesen');

// Leistungszeitraum je Position: ein Tag, Zeitraum, keiner
const pos = [
  { beschreibung: 'a', menge: 1, einzelpreis: 1, mwst: 19, leistungVon: '2026-09-04' },
  { beschreibung: 'b', menge: 1, einzelpreis: 1, mwst: 19, leistungVon: '2026-09-04', leistungBis: '2026-09-16' },
  { beschreibung: 'c', menge: 1, einzelpreis: 1, mwst: 19 },
];
xml = ctx.buildXML(Object.assign({}, basis, { positionen: pos }), 'xrechnung');
r = ctx.parseInvoiceXML(xml);
gleich(r.positionen.map(p => [p.leistungVon, p.leistungBis]),
  [['2026-09-04', '2026-09-04'], ['2026-09-04', '2026-09-16'], ['', '']], 'Zeiträume je Position');
assert.ok(xml.indexOf('</ram:ApplicableTradeTax>' + NL + '        <ram:BillingSpecifiedPeriod>') > 0, 'Zeitraum nach der Steuer'); n++;

// ZUGFeRD: Inland im Profil XRECHNUNG mit BT-23, Ausland EN 16931
xml = ctx.buildXML(basis, 'zugferd');
hat(xml, 'urn:xeinkauf.de:kosit:xrechnung_3.0', 'ZUGFeRD Inland XRechnung');
hat(xml, 'BusinessProcessSpecifiedDocumentContextParameter', 'ZUGFeRD Inland mit BT-23');
xml = ctx.buildXML(Object.assign({}, basis, { kaeuferland: 'AT' }), 'zugferd');
hat(xml, '<ram:ID>urn:cen.eu:en16931:2017</ram:ID>', 'ZUGFeRD Ausland EN 16931');
ohne(xml, 'BusinessProcessSpecifiedDocumentContextParameter', 'ZUGFeRD Ausland ohne BT-23');

// Skonto mit Frist in Tagen (MEG: „14 Tage 3% Skonto, 30 Tage Netto“), mit Datum wie bisher
const skonto = notiz => (ctx.buildXML(Object.assign({}, basis, { notiz }), 'xrechnung').match(/#SKONTO#[^#]*#[^#]*#/) || [''])[0];
gleich(skonto('Zahlungsbedingung: 14 Tage 3% Skonto, 30 Tage Netto'), '#SKONTO#TAGE=14#PROZENT=3.00#', 'Skonto in Tagen');
gleich(skonto('Zahlungsbedingung: TPS 75 Tage Netto (bei 15 Tage 2% Abzug)'), '#SKONTO#TAGE=15#PROZENT=2.00#', 'Abzug in Tagen');
gleich(skonto('Zahlungsbedingung: bis 16.11.2026 2 % Skonto'), '#SKONTO#TAGE=14#PROZENT=2.00#', 'Skonto mit Datum');
gleich(skonto('Zahlungsbedingung: 30 Tage netto'), '', 'ohne Skonto');

// Einzelpreis mit drei Nachkommastellen
hat(ctx.buildXML(basis, 'xrechnung'), '<ram:ChargeAmount>1.764</ram:ChargeAmount>', 'Preis 1,764');

console.log(`zahlung: ${n} Prüfungen ok`);
