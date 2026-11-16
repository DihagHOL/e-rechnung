// node tests/api-haertung.test.js
// Prüfdienst (api/src): Entpack-Grenze für eingebettete Dateien, Schlüssel und Zeitlimit für die
// Prüf-Container, frühe Größenprüfung in /api/pdfa, JSON-Objekt in /api/vat
const assert = require('assert');
const path = require('path');

const API = path.join(__dirname, '..', 'api');
const SRC = path.join(API, 'src');
const { PDFDocument } = require(path.join(API, 'node_modules', 'pdf-lib'));
let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };

const handler = {};
const attrappe = (datei, exports) => {
  const f = require.resolve(datei);
  require.cache[f] = { id: f, filename: f, loaded: true, exports };
};
attrappe(require.resolve('@azure/functions', { paths: [path.join(SRC, 'functions')] }),
  { app: { http: (name, o) => { handler[name] = o.handler; } } });

const CII = '<?xml version="1.0"?><rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"/>';
async function pdfMitAnhang(inhalt, name) {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  await doc.attach(inhalt, name, { mimeType: 'text/xml' });
  return Buffer.from(await doc.save());
}

(async () => {
  // 1) Entpacken: normale XML geht, eine aufgeblähte Datei bricht mit klarem Fehler ab
  const X = require(path.join(SRC, 'pdfxml.js'));
  gleich(await X.extractInvoiceXml(await pdfMitAnhang(Buffer.from(CII), 'factur-x.xml')), CII, 'eingebettete XML gelesen');
  const bombe = await pdfMitAnhang(Buffer.alloc(X.MAX_XML_BYTES + 1024 * 1024, 0x20), 'factur-x.xml');
  gleich(bombe.length < 1024 * 1024, true, 'gepackt unter 1 MB');
  let fehler = null;
  try { await X.extractInvoiceXml(bombe); } catch (e) { fehler = e; }
  gleich([fehler && fehler.code, /größer als 32 MB/.test((fehler && fehler.message) || '')], ['EMBEDDED_TOO_LARGE', true], 'entpackt über der Grenze: Abbruch');

  // 2) Prüf-Container: Schlüssel nur, wenn DIENST_KEY gesetzt ist, und immer ein Zeitlimit
  const D = require(path.join(SRC, 'dienst.js'));
  delete process.env.DIENST_KEY;
  gleich(D.dienstKopf({ 'Content-Type': 'application/xml' }), { 'Content-Type': 'application/xml' }, 'ohne DIENST_KEY kein Kopf');
  process.env.DIENST_KEY = 'nur-ein-testwert';
  gleich(D.dienstKopf({ a: '1' }), { a: '1', 'X-Dienst-Schluessel': 'nur-ein-testwert' }, 'mit DIENST_KEY Schlüssel im Kopf');
  const echt = global.fetch;
  let gesehen = null;
  global.fetch = async (url, o) => { gesehen = { url, o }; return { status: 200, ok: true, text: async () => '{"konform":"ok"}' }; };
  process.env.VERAPDF_URL = 'https://verapdf.example/';
  const V = require(path.join(SRC, 'verapdf.js'));
  gleich(await V.validatePdfA(Buffer.from('%PDF-1.7')), { konform: 'ok' }, 'veraPDF-Antwort');
  gleich([gesehen.o.method, gesehen.o.headers['X-Dienst-Schluessel'], gesehen.o.signal instanceof AbortSignal],
    ['POST', 'nur-ein-testwert', true], 'Aufruf mit Schlüssel und Zeitlimit');
  global.fetch = echt;
  delete process.env.DIENST_KEY;

  // 3) /api/pdfa: zu großer Body wird am Kopf abgewiesen, ohne ihn zu lesen
  require(path.join(SRC, 'functions', 'pdfa.js'));
  let gelesen = false;
  const r = await handler.pdfa({ method: 'POST', headers: new Map([['content-length', String(16 * 1024 * 1024)]]),
    arrayBuffer: async () => { gelesen = true; return new ArrayBuffer(0); } }, { warn() {} });
  gleich([r.status, gelesen], [413, false], 'pdfa: 413 vor dem Lesen');
  const klein = await handler.pdfa({ method: 'POST', headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) }, { warn() {} });
  gleich(klein.status, 400, 'pdfa: ohne Längenangabe weiter wie bisher');

  // 4) /api/vat: Body muss ein Objekt sein (vorher Absturz bei null)
  attrappe(path.join(SRC, 'bzst.js'), { pruefeBzst: async () => { throw new Error('nicht gebraucht'); } });
  attrappe(path.join(SRC, 'vies.js'), { pruefeVies: async () => { throw new Error('nicht gebraucht'); } });
  require(path.join(SRC, 'functions', 'vat.js'));
  for (const body of [null, 'text', 7, []]) {
    const v = await handler.vat({ method: 'POST', json: async () => body }, { warn() {} });
    gleich(v.status, 400, 'vat: kein Objekt (' + JSON.stringify(body) + ')');
  }

  console.log(`api-haertung: ${n} Prüfungen grün`);
})().catch(e => { console.error(e); process.exit(1); });
