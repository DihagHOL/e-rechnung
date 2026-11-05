// node tests/pdfa-api.test.js
// /api/pdfa (api/src/functions/pdfa.js): PDF/A-Prüfung nur für ZUGFeRD-Rechnungen der eigenen Gesellschaften
const assert = require('assert');
const path = require('path');

const API = path.join(__dirname, '..', 'api');
const SRC = path.join(API, 'src');
let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };

// Azure-Laufzeit und veraPDF als Attrappen
const handler = {};
const attrappe = (datei, exports) => {
  const f = require.resolve(datei);
  require.cache[f] = { id: f, filename: f, loaded: true, exports };
};
attrappe(require.resolve('@azure/functions', { paths: [path.join(SRC, 'functions')] }),
  { app: { http: (name, o) => { handler[name] = o.handler; } } });
let urteil = { konform: 'ok', flavour: 'PDF/A-3b', meldungen: [] };
let geprueft = 0;
attrappe(path.join(SRC, 'verapdf.js'), { validatePdfA: async () => { geprueft++; if (urteil instanceof Error) throw urteil; return urteil; } });
const P = require(path.join(SRC, 'functions', 'pdfa.js'));
const { EIGENE_UST_IDS } = require(path.join(SRC, 'eigene.js'));
const { PDFDocument } = require(require.resolve('pdf-lib', { paths: [SRC] }));

const xml = ust => `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">
<rsm:SupplyChainTradeTransaction><ram:ApplicableHeaderTradeAgreement>
<ram:SellerTradeParty><ram:Name>Beispiel GmbH</ram:Name><ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${ust}</ram:ID></ram:SpecifiedTaxRegistration></ram:SellerTradeParty>
<ram:BuyerTradeParty><ram:Name>Kunde</ram:Name><ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">DE999999999</ram:ID></ram:SpecifiedTaxRegistration></ram:BuyerTradeParty>
</ram:ApplicableHeaderTradeAgreement></rsm:SupplyChainTradeTransaction></rsm:CrossIndustryInvoice>`;
const pdfMit = async text => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  if (text) await doc.attach(Buffer.from(text, 'utf8'), 'factur-x.xml', { mimeType: 'text/xml' });
  return Buffer.from(await doc.save());
};
const aufruf = async buf => {
  const r = await handler.pdfa({ method: 'POST', arrayBuffer: async () => buf }, { warn() {} });
  return { status: r.status, body: r.jsonBody };
};

(async () => {
  // 1) Verkäufer aus der XML lesen, Käufer zählt nicht
  gleich(P.verkaeuferUstId(xml('DE140598967')), 'DE140598967', 'USt-IdNr. des Verkäufers');
  gleich(P.verkaeuferUstId('<x/>'), '', 'ohne Verkäufer leer');

  // 2) Eigene Rechnung: Urteil von veraPDF
  const eigen = await pdfMit(xml(EIGENE_UST_IDS[0]));
  gleich((await aufruf(eigen)).body.konform, 'ok', 'konform');
  urteil = { konform: 'fehler', flavour: 'PDF/A-3b', meldungen: Array.from({ length: 14 }, (_, i) => ({ regel: '6.2.11.4.' + i })) };
  const f = await aufruf(eigen);
  gleich([f.status, f.body.konform, f.body.meldungen.length], [200, 'fehler', 10], 'nicht konform, höchstens 10 Meldungen');
  urteil = new Error('Zeitüberschreitung');
  gleich((await aufruf(eigen)).body.konform, 'ungeprueft', 'veraPDF nicht erreichbar');
  urteil = null;
  gleich((await aufruf(eigen)).body.konform, 'ungeprueft', 'veraPDF nicht eingerichtet');

  // 3) Kein offener Prüfdienst: fremde Rechnung, PDF ohne XML, kein PDF, zu groß
  const vorher = geprueft;
  gleich((await aufruf(await pdfMit(xml('DE123456789')))).status, 403, 'fremder Verkäufer');
  gleich((await aufruf(await pdfMit(''))).status, 400, 'PDF ohne XML');
  gleich((await aufruf(Buffer.from('hallo'))).status, 400, 'kein PDF');
  gleich((await aufruf(Buffer.alloc(0))).status, 400, 'leer');
  gleich((await aufruf(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(P.MAX_BYTES)]))).status, 413, 'zu groß');
  gleich(geprueft, vorher, 'in diesen Fällen geht nichts an veraPDF');

  console.log(`pdfa-api: ${n} Prüfungen grün`);
})().catch(e => { console.error(e); process.exit(1); });
