// node tests/kopfdaten.test.js
// api/src/kopfdaten.js: PDF mit Text liest pdf.js, Scan der OCR-Dienst. Erfundene Rechnungen, kein echter Dienst.
const assert = require('assert');
const path = require('path');
require(path.join(__dirname, '../api/scripts/sync.js'));
const { PDFDocument, StandardFonts } = require('../api/node_modules/pdf-lib');
const { kopfdatenAusPdf } = require('../api/src/kopfdaten');

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };

const ZEILEN = ['Muster Werkzeuge GmbH', 'Musterstrasse 1, 01234 Musterstadt', 'USt-IdNr.: DE123456789', 'Rechnung Nr. 4711',
  'Rechnungsdatum: 01.10.2026', 'Nettobetrag 1.000,00 EUR', 'MwSt. 19 % 190,00 EUR', 'Gesamtbetrag 1.190,00 EUR', 'Zahlungsbedingung: 30 Tage netto'];

async function mitText() {
  const doc = await PDFDocument.create();
  const s = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  ZEILEN.forEach((z, i) => s.drawText(z, { x: 40, y: 780 - i * 16, size: 10, font }));
  return Buffer.from(await doc.save());
}

async function nurBild() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return Buffer.from(await doc.save());
}

// Antwort des Dienstes: Wörter mit Position, je Zeile eine Grundlinie
const items = ZEILEN.flatMap((z, i) => z.split(' ').map((w, k) => ({ text: w, x: 40 + k * 60, y: 780 - i * 16, page: 1 })));

(async () => {
  const aufrufe = [];
  let antwort = async () => ({ ok: true, status: 200, json: async () => ({ items, seiten: 1 }) });
  global.fetch = async (url, opt) => { aufrufe.push([url, opt]); return antwort(); };

  // Text im PDF: kein OCR
  process.env.OCR_URL = 'https://ocr.test/';
  process.env.OCR_KEY = 'testschluessel';
  let k = await kopfdatenAusPdf(await mitText());
  gleich(aufrufe.length, 0, 'Text im PDF braucht keine Texterkennung');
  gleich([k.quelle, k.steller, k.stellerVat, k.nummer, k.datum, k.faelligkeit, k.netto, k.brutto],
    ['pdf-text', 'Muster Werkzeuge GmbH', 'DE123456789', '4711', '2026-10-01', '2026-10-31', 1000, 1190], 'aus dem PDF-Text');

  // Scan: OCR-Dienst, dieselbe Auswertung
  k = await kopfdatenAusPdf(await nurBild());
  gleich(aufrufe.length, 1, 'Scan geht an den OCR-Dienst');
  gleich(aufrufe[0][0], 'https://ocr.test/?seiten=3', 'Adresse');
  gleich(aufrufe[0][1].headers['X-Dienst-Schluessel'], 'testschluessel', 'Schlüssel im Kopf');
  gleich([k.quelle, k.stellerVat, k.nummer, k.faelligkeit, k.netto, k.brutto],
    ['ocr', 'DE123456789', '4711', '2026-10-31', 1000, 1190], 'aus dem Scan');

  // Dienst fällt aus oder liest nichts: kein Fehler, nur keine Daten
  antwort = async () => ({ ok: false, status: 503, json: async () => ({}) });
  gleich(await kopfdatenAusPdf(await nurBild()), null, 'Dienst nicht erreichbar');
  antwort = async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) });
  gleich(await kopfdatenAusPdf(await nurBild()), null, 'nichts erkannt');

  // Ohne OCR_URL wie vorher
  delete process.env.OCR_URL;
  aufrufe.length = 0;
  gleich(await kopfdatenAusPdf(await nurBild()), null, 'ohne Dienst keine Kopfdaten');
  gleich(aufrufe.length, 0, 'und kein Aufruf');

  console.log(`kopfdaten: ${n} Prüfungen grün`);
})().catch(e => { console.error(e); process.exit(1); });
