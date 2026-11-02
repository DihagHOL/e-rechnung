'use strict';
/**
 * Text eines PDFs lesen (Prüfdienst)
 * ==================================
 * pdf.js 6.4.299, dieselbe Version wie im Browser (js/vendor/pdf-6.4.299.min.mjs).
 * Die Zeilen baut textAusPdf aus js/lieferant.js, damit Prüfdienst und Monitoring
 * denselben Text sehen. pdf.js ist ein ES-Modul und wird beim ersten Aufruf geladen.
 * Legacy-Build, weil Node die neuen Map-Funktionen des modernen Builds nicht kennt.
 *
 * pdf-parse ist entfernt: Es brachte intern pdf.js 1.10 mit (alte Lücken) und scheiterte
 * an PDFs mit komprimierter Querverweistabelle.
 */
const path = require('path');

let lieferant = null;
try { lieferant = require(path.join(__dirname, '..', 'vendor', 'lieferant.js')); }
catch (e) { /* vendor nicht synchronisiert */ }

let _pdfjs = null;
function _laden() {
  if (!_pdfjs) _pdfjs = import('pdfjs-dist/legacy/build/pdf.mjs');
  return _pdfjs;
}

const OPTIONEN = { verbosity: 0, disableFontFace: true, useSystemFonts: false };

/**
 * @param {Buffer} pdfBuf   bleibt unverändert (pdf.js bekommt eine Kopie)
 * @returns {Promise<{text: string, quelle: 'pdfjs'}>}  wirft, wenn das PDF nicht lesbar ist
 */
async function pdfText(pdfBuf) {
  if (!lieferant || !lieferant.textAusPdf) throw new Error('js/lieferant.js nicht synchronisiert (npm run sync)');
  globalThis.pdfjsLib = await _laden();
  return { text: await lieferant.textAusPdf(pdfBuf, OPTIONEN), quelle: 'pdfjs' };
}

module.exports = { pdfText };
