// node tests/pdfjs-ersatz.test.js
// pdf.js 6 im Browser ohne Promise.withResolvers (ältere Browser): ohne Ersatz scheitert das Laden,
// mit js/vendor/promise-withresolvers.mjs und dem Worker js/pdfjs-worker.mjs geht es.
// Node hat withResolvers, deshalb wird es hier vorher entfernt. Der Worker läuft in Node im selben Faden.
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { PDFDocument, StandardFonts } = require('../api/node_modules/pdf-lib');

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };
const datei = p => pathToFileURL(path.join(__dirname, '..', p)).href;

(async () => {
  const doc = await PDFDocument.create();
  const seite = doc.addPage([300, 200]);
  seite.drawText('Rechnung 4711', { x: 20, y: 150, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  const bytes = await doc.save();

  const echt = Promise.withResolvers;
  delete Promise.withResolvers;
  gleich(typeof Promise.withResolvers, 'undefined', 'wie im alten Browser');

  // Ohne Ersatz: Laden scheitert wie bei der Anwenderin
  const pdfjs = await import(datei('js/vendor/pdf-6.4.299.min.mjs'));
  pdfjs.GlobalWorkerOptions.workerSrc = datei('js/vendor/pdf-6.4.299.worker.min.mjs');
  await assert.rejects(async () => { await pdfjs.getDocument({ data: bytes.slice() }).promise; }, /withResolvers is not a function/);
  n++;

  // Mit Ersatz und dem Worker über pdfjs-worker.mjs
  await import(datei('js/vendor/promise-withresolvers.mjs'));
  const { promise, resolve } = Promise.withResolvers();
  resolve(5);
  gleich(await promise, 5, 'Ersatz liefert Promise und resolve');
  gleich(Object.keys(Promise).includes('withResolvers'), false, 'nicht aufzählbar wie das Original');
  pdfjs.GlobalWorkerOptions.workerSrc = datei('js/pdfjs-worker.mjs');
  const aufgabe = pdfjs.getDocument({ data: bytes.slice() });
  const pdf = await aufgabe.promise;
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
  gleich([pdf.numPages, text.trim()], [1, 'Rechnung 4711'], 'PDF geladen und Text gelesen');
  await aufgabe.destroy();

  // Neuere Browser: vorhandenes withResolvers bleibt unberührt
  Promise.withResolvers = echt;
  await import(datei('js/vendor/promise-withresolvers.mjs') + '?nochmal');
  gleich(Promise.withResolvers === echt, true, 'Original bleibt');

  console.log(`pdfjs-ersatz: ${n} Prüfungen grün`);
})().catch(e => { console.error(e); process.exit(1); });
