// node tests/intake-lesbar.test.js
// /api/intake (api/src/functions/intake.js): Wann entsteht ein lesbares PDF aus der XML?
// Reine XML und Formatmangel: Ersatz-PDF (konvertiertesPdf). ZUGFeRD gelb: Ansicht ohne Ersatz-Kennzeichen.
const assert = require('assert');
const path = require('path');

const API = path.join(__dirname, '..', 'api');
const SRC = path.join(API, 'src');
let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };

// Azure-Laufzeit, Prüfwerkzeuge und Renderer als Attrappen
const handler = {};
const attrappe = (datei, exports) => {
  const f = require.resolve(datei);
  require.cache[f] = { id: f, filename: f, loaded: true, exports };
};
attrappe(require.resolve('@azure/functions', { paths: [path.join(SRC, 'functions')] }),
  { app: { http: (name, o) => { handler[name] = o.handler; } } });

let pruefung = { konform: 'gruen', konformLabel: 'Gruen - KoSIT ok' };
let renderFehler = null;
let gerendert = 0;
const XML = '<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"/>';
attrappe(path.join(SRC, 'kosit.js'), { validateXml: async () => pruefung, istMinimalprofil: () => false });
attrappe(path.join(SRC, 'mustang.js'), { validateMustang: async () => pruefung });
attrappe(path.join(SRC, 'pdfxml.js'), { extractInvoiceXml: async () => XML });
attrappe(path.join(SRC, 'verapdf.js'), { validatePdfA: async () => ({ konform: 'ok' }) });
attrappe(path.join(SRC, 'converter.js'), {
  convertXmlToPdf: async () => { gerendert++; if (renderFehler) throw renderFehler; return { pdf: Buffer.from('%PDF-1.7 gerendert') }; },
  parseInvoiceData: () => ({ nummer: 'R-100', datum: '2026-11-12', steller: 'Muster Lieferant GmbH', stellerVat: 'DE123456789',
    empfaenger: 'Beispiel Werk GmbH', netto: 100, mwst: 19, brutto: 119, waehrung: 'EUR', steuerkategorie: 'S' }),
});
attrappe(path.join(SRC, 'pdfabgleich.js'), { pdfXmlAbgleich: async () => ({ status: 'ok', pruefbar: true, materiell: false, hinweis: '' }) });
attrappe(path.join(SRC, 'kopfdaten.js'), { kopfdatenAusPdf: async () => null });
require(path.join(SRC, 'functions', 'intake.js'));

const PDF = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF');
const anfrage = body => ({
  method: 'POST',
  arrayBuffer: async () => body,
  query: new URLSearchParams('werk=MEG'),
});
const ctx = { error: () => {}, log: () => {}, warn: () => {} };
async function lauf(body, urteil) {
  pruefung = urteil; gerendert = 0;
  const r = await handler.intake(anfrage(body), ctx);
  assert.strictEqual(r.status, 200, JSON.stringify(r.jsonBody));
  return r.jsonBody;
}

(async () => {
  // ZUGFeRD gelb, PDF/A in Ordnung: Ansicht der XML, kein Ersatz-PDF
  let r = await lauf(PDF, { konform: 'gelb', konformLabel: 'Gelb - Warnungen' });
  gleich(r.klassifizierung, 'zugferd', 'gelb: Klassifizierung');
  gleich(r.buchung, 'unter_vorbehalt', 'gelb: unter Vorbehalt');
  gleich(typeof r.lesbarPdfBase64 === 'string' && r.lesbarPdfBase64.length > 0, true, 'gelb: lesbares PDF da');
  gleich(Buffer.from(r.lesbarPdfBase64, 'base64').toString(), '%PDF-1.7 gerendert', 'gelb: PDF aus dem Renderer');
  gleich(r.konvertiertesPdf, false, 'gelb: nicht als Ersatz-PDF gekennzeichnet');
  gleich(r.formatMangel, false, 'gelb: kein Formatmangel');

  // ZUGFeRD grün: Original reicht, nichts rendern
  r = await lauf(PDF, { konform: 'gruen', konformLabel: 'Gruen - KoSIT ok' });
  gleich([r.lesbarPdfBase64, r.konvertiertesPdf, gerendert], [null, false, 0], 'grün: kein lesbares PDF');

  // ZUGFeRD grün mit PDF/A-Mangel: Ersatz-PDF wie bisher
  r = await lauf(PDF, { konform: 'gruen', konformLabel: 'Gruen - KoSIT ok', pdfaMangel: true });
  gleich([!!r.lesbarPdfBase64, r.konvertiertesPdf, r.formatMangel], [true, true, true], 'Formatmangel: Ersatz-PDF');

  // ZUGFeRD gelb mit PDF/A-Mangel: Ersatz-PDF, Kennzeichen bleibt
  r = await lauf(PDF, { konform: 'gelb', konformLabel: 'Gelb - Warnungen', pdfaMangel: true });
  gleich([!!r.lesbarPdfBase64, r.konvertiertesPdf, gerendert], [true, true, 1], 'gelb + Formatmangel: einmal gerendert, Ersatz');

  // ZUGFeRD rot: zurückgewiesen, kein lesbares PDF
  r = await lauf(PDF, { konform: 'rot', konformLabel: 'Rot - Fehler' });
  gleich([r.buchung, r.lesbarPdfBase64, gerendert], ['zurueckgewiesen', null, 0], 'rot: nichts gerendert');

  // Reine XRechnung-XML: immer gerendert, als Ersatz gekennzeichnet
  r = await lauf(Buffer.from(XML), { konform: 'gruen', konformLabel: 'Gruen - KoSIT ok' });
  gleich([r.klassifizierung, !!r.lesbarPdfBase64, r.konvertiertesPdf], ['xrechnung-xml', true, true], 'XML: Ersatz-PDF');

  // Renderer scheitert bei gelb: Eingang läuft weiter, Fehler steht im Ergebnis
  renderFehler = new Error('Renderer kaputt');
  r = await lauf(PDF, { konform: 'gelb', konformLabel: 'Gelb - Warnungen' });
  gleich([r.lesbarPdfBase64, r.konvertiertesPdf, r.renderFehler], [null, false, 'Renderer kaputt'], 'gelb, Renderfehler');
  renderFehler = null;

  console.log(`intake-lesbar: ${n} Prüfungen grün`);
})().catch(e => { console.error(e); process.exit(1); });
