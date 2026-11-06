// node tests/pdfabgleich.test.js
// api/src/pdfabgleich.js: Sichtbild gegen XML, keine Rückfrage bei Gutschrift, langer Rechnung oder anderer Schreibweise der Nummer.
const assert = require('assert');
const path = require('path');
require(path.join(__dirname, '../api/scripts/sync.js'));
const { PDFDocument, StandardFonts } = require('../api/node_modules/pdf-lib');
const { pdfXmlAbgleich } = require('../api/src/pdfabgleich');

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };

const FUELLER = 'Lieferung laut Auftrag vom Oktober, Abnahme durch den Kunden erfolgt, alle Angaben ohne Gewähr, Erfüllungsort ist der Sitz des Lieferanten.';

async function pdf(seiten) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const zeilen of seiten) {
    const s = doc.addPage([595, 842]);
    [FUELLER].concat(zeilen).forEach((z, i) => s.drawText(z, { x: 40, y: 800 - i * 16, size: 8, font }));
  }
  return Buffer.from(await doc.save());
}

(async () => {
  const daten = { nummer: '4711081', mwst: 2.84, brutto: 17.79 };

  let a = await pdfXmlAbgleich(await pdf([['Rechnung 4711081', 'Mehrwertsteuer 19 % 2,84 EUR', 'Gesamtbetrag 17,79 EUR']]), daten);
  gleich([a.status, a.materiell], ['ok', false], 'alles gleich');

  a = await pdfXmlAbgleich(await pdf([['Gutschrift 4711081', 'Mehrwertsteuer 19 % -2,84 EUR', 'Gesamtbruttobetrag -17,79 EUR']]), daten);
  gleich(a.status, 'ok', 'Gutschrift: negativ im Bild, positiv in der XML');

  const lang = [['Rechnung 4711081'], ['Seite 2'], ['Seite 3'], ['Seite 4'], ['Mehrwertsteuer 19 % 2,84 EUR', 'Gesamtbetrag 17,79 EUR']];
  a = await pdfXmlAbgleich(await pdf(lang), daten);
  gleich(a.status, 'ok', 'Summe auf Seite 5');

  a = await pdfXmlAbgleich(await pdf([['Beleg 10085621', 'MwSt. 2,84 EUR', 'Summe 17,79 EUR']]), { nummer: 'DRA/10085621', mwst: 2.84, brutto: 17.79 });
  gleich(a.status, 'ok', 'Nummer ohne Präfix im Bild');
  a = await pdfXmlAbgleich(await pdf([['Beleg 92658542', 'MwSt. 2,84 EUR', 'Summe 17,79 EUR']]), { nummer: '0092658542', mwst: 2.84, brutto: 17.79 });
  gleich(a.status, 'ok', 'führende Nullen');

  // Echte Abweichungen bleiben
  a = await pdfXmlAbgleich(await pdf([['Rechnung 4711081', 'MwSt. 3,84 EUR', 'Summe 18,79 EUR']]), daten);
  gleich([a.status, a.materiell, /Steuerbetrag/.test(a.hinweis), /Bruttobetrag/.test(a.hinweis)], ['abweichung', true, true, true], 'andere Beträge');
  a = await pdfXmlAbgleich(await pdf([['Rechnung 4711082', 'MwSt. 2,84 EUR', 'Summe 17,79 EUR']]), daten);
  gleich([a.status, /Rechnungsnummer/.test(a.hinweis)], ['abweichung', true], 'andere Nummer');

  console.log(`pdfabgleich: ${n} Prüfungen grün`);
})().catch(e => { console.error(e); process.exit(1); });
