'use strict';
/**
 * Kopfdaten einer sonstigen Rechnung aus dem PDF
 * ==============================================
 * Eine PDF ohne E-Rechnungs-XML bringt keine strukturierten Daten mit. Lieferant,
 * USt-IdNr., Rechnungsnummer, Datum, Fälligkeit und Beträge liest js/lieferant.js
 * trotzdem meist sicher aus dem Text (dieselbe Logik wie im Monitoring). Das Ergebnis
 * ist ein Vorschlag: es steuert keine Buchung, es füllt nur die Spalten, die sonst leer
 * blieben, damit niemand die Rechnung dafür öffnen muss.
 *
 * Den Text liefert src/pdftext.js. Bei Scans ohne Textebene läuft der OCR-Dienst
 * (src/ocr.js). Das erledigt der Eingang einmal, statt der Browser bei jedem Öffnen.
 */
const path = require('path');
const { pdfText } = require('./pdftext');
const { ocrItems } = require('./ocr');

let lieferant = null;
try { lieferant = require(path.join(__dirname, '..', 'vendor', 'lieferant.js')); }
catch (e) { /* vendor nicht synchronisiert: dann ohne Kopfdaten */ }

const nichtsGelesen = l => !l.name && !l.vat && !l.nummer;

/**
 * @param {Buffer} pdfBuf
 * @returns {Promise<null|{nummer, datum, faelligkeit, steller, stellerVat, netto, brutto, waehrung,
 *                         kleinunternehmer, quelle: 'pdf-text'|'ocr'}>}
 */
async function kopfdatenAusPdf(pdfBuf) {
  if (!lieferant) return null;
  let text = '';
  try { text = (await pdfText(pdfBuf)).text; }
  catch (e) { /* kaputte Textebene: vielleicht liest die Texterkennung mehr */ }
  let l = lieferant.lieferantAusText(text);
  let quelle = 'pdf-text';
  if (!l.lesbar || nichtsGelesen(l)) {
    try {
      const items = await ocrItems(pdfBuf);
      const o = items && items.length ? lieferant.lieferantAusText(lieferant.textAusItems(items)) : null;
      if (o && o.lesbar && !nichtsGelesen(o)) { l = o; quelle = 'ocr'; }
    } catch (e) { /* OCR nicht erreichbar: weiter wie ohne */ }
  }
  if (!l.lesbar || nichtsGelesen(l)) return null;
  return {
    nummer: l.nummer || null,
    datum: l.datum || null,
    faelligkeit: l.faelligkeit || null,
    steller: l.name || null,
    stellerVat: l.vat || null,
    netto: l.netto == null ? null : l.netto,
    brutto: l.brutto == null ? null : l.brutto,
    waehrung: l.waehrung || null,
    kleinunternehmer: !!l.kleinunternehmer,
    quelle,
  };
}

module.exports = { kopfdatenAusPdf };
