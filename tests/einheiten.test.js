// node tests/einheiten.test.js
// Einheiten aus E-Rechnungen (UN/ECE-Code): Das lesbare PDF zeigt die Einheit der XML, nicht „Stk“
const assert = require('assert');
const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '../api/scripts/sync.js'));
const { convertXmlToPdf, parseInvoiceData } = require('../api/src/converter');
const { pdfText } = require('../api/src/pdftext');

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };

const probe = fs.readFileSync(path.join(__dirname, '../api/test/sample-cii.xml'), 'utf8');
const mit = code => probe.replace(/unitCode="C62"/g, code === null ? '' : `unitCode="${code}"`);
const einheit = code => parseInvoiceData(mit(code)).positionen[0].einheit;

(async () => {
  gleich(['C62', 'H87', 'KWH', 'MWH', 'K1', 'KWT', 'TNE', 'GRM', 'MIN', 'WEE', 'ANN', 'SET', 'PR', 'HUR', 'DAY'].map(einheit),
    ['Stk', 'Stk', 'kWh', 'MWh', 'kW', 'kW', 't', 'g', 'min', 'Woche', 'Jahr', 'Satz', 'Paar', 'h', 'Tag'], 'bekannte Codes');
  gleich(einheit('kwh'), 'kWh', 'Schreibweise des Codes egal');
  gleich(einheit('XYZ'), 'XYZ', 'unbekannter Code bleibt sichtbar statt Stk');
  gleich(einheit(null), 'Stk', 'ohne Code Stück');

  // Im lesbaren PDF steht die Einheit der XML
  const text = (await pdfText(Buffer.from((await convertXmlToPdf(mit('KWH'))).pdf), { maxSeiten: 5 })).text;
  gleich([/kWh/.test(text), /Stk/.test(text)], [true, false], 'PDF zeigt kWh, nicht Stk');

  // Lieferanten-Nr. beim Kunden: nicht, wenn die Kennung nur die USt-IdNr. oder Steuernummer des Verkäufers ist
  const mitKennung = (id, vat, steuernr) => probe.replace('<ram:SellerTradeParty>', `<ram:SellerTradeParty><ram:ID>${id}</ram:ID>`)
    .replace('</ram:SellerTradeParty>', `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${vat}</ram:ID></ram:SpecifiedTaxRegistration>`
      + `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${steuernr}</ram:ID></ram:SpecifiedTaxRegistration></ram:SellerTradeParty>`);
  const pdfVon = async xml => (await pdfText(Buffer.from((await convertXmlToPdf(xml)).pdf), { maxSeiten: 5 })).text.replace(/\s+/g, ' ');
  gleich(/Lieferanten-Nr/.test(await pdfVon(mitKennung('DE259329230', 'DE259329230', '2711872862'))), false, 'Kennung = USt-IdNr.: keine Lieferantennummer');
  gleich(/Lieferanten-Nr/.test(await pdfVon(mitKennung('19/656/52594', 'DE352878871', '19/656/52594'))), false, 'Kennung = Steuernummer');
  gleich(/Lieferanten-Nr\. beim Kunden: 1001946/.test(await pdfVon(mitKennung('1001946', 'DE352878871', '19/656/52594'))), true, 'echte Lieferantennummer bleibt');

  console.log(`einheiten: ${n} Prüfungen grün`);
})().catch(e => { console.error(e); process.exit(1); });
