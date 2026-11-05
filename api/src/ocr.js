'use strict';
/**
 * Client zum OCR-Dienst (ocr-service/, gescannte PDFs ohne Textebene).
 * URL und Schlüssel kommen aus den App-Einstellungen OCR_URL und OCR_KEY. Ohne OCR_URL
 * liefert ocrItems null, Scans bleiben dann ohne Kopfdaten.
 */
const ZEIT_MS = 60000;   // Kaltstart des Containers + drei Seiten, Power Automate wartet 120 Sekunden
const SEITEN = 3;

/**
 * @param {Buffer} pdfBuf
 * @returns {Promise<null|Array<{text, x, y, page}>>} Items für textAusItems (js/lieferant.js)
 */
async function ocrItems(pdfBuf) {
  const basis = process.env.OCR_URL || '';
  if (!basis) return null;
  const schluessel = process.env.OCR_KEY || '';
  const resp = await fetch(`${basis.replace(/\/*$/, '/')}?seiten=${SEITEN}`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/pdf' }, schluessel ? { 'X-Dienst-Schluessel': schluessel } : {}),
    body: pdfBuf,
    signal: AbortSignal.timeout(ZEIT_MS),
  });
  if (!resp.ok) throw new Error(`OCR-Dienst HTTP ${resp.status}`);
  const d = await resp.json();
  return Array.isArray(d.items) ? d.items : null;
}

module.exports = { ocrItems };
