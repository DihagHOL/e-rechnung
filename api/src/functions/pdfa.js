'use strict';
/**
 * HTTP-Trigger: PDF/A-3b-Prüfung eines fertigen ZUGFeRD-PDFs aus dem Konverter
 * ============================================================================
 *   GET  /api/pdfa  -> Info
 *   POST /api/pdfa  -> Body = ZUGFeRD-PDF (roh)
 *                      Antwort { konform: 'ok' | 'fehler' | 'ungeprueft', meldungen[] }
 *
 * Wird der Konverter mit eingebettetem Original-PDF aus dem ERP benutzt, hängt die
 * PDF/A-Konformität vom ERP-PDF ab. Der Konverter prüft das fertige PDF hier mit
 * veraPDF und erzeugt es bei einem Fehler aus den Rechnungsdaten.
 *
 * authLevel "anonymous": wird direkt aus dem Browser aufgerufen, enthält keine Geheimnisse.
 * Damit der Dienst kein offener veraPDF-Dienst ist: nur ZUGFeRD-PDFs bis 15 MB, deren
 * eingebettete XML eine DIHAG-Gesellschaft als Verkäufer nennt (USt-IdNr. aus api/src/eigene.js).
 */
const { app } = require('@azure/functions');
const { validatePdfA } = require('../verapdf');
const { extractInvoiceXml } = require('../pdfxml');
const { EIGENE_UST_IDS } = require('../eigene');

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_MELDUNGEN = 10;

/** USt-IdNr. des Verkäufers aus einer CII-XML (SellerTradeParty, schemeID="VA"), sonst ''. */
function verkaeuferUstId(xml) {
  const block = (String(xml || '').match(/<(?:\w+:)?SellerTradeParty\b[\s\S]*?<\/(?:\w+:)?SellerTradeParty>/) || [''])[0];
  const m = block.match(/schemeID\s*=\s*"VA"\s*>\s*([A-Z]{2}[0-9A-Z]{2,15})\s*</);
  return m ? m[1] : '';
}

app.http('pdfa', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'pdfa',
  handler: async (request, context) => {
    if (request.method === 'GET') {
      return { status: 200, jsonBody: {
        service: 'PDF/A-3b-Prüfung (veraPDF) für ZUGFeRD-Rechnungen der DIHAG-Gesellschaften',
        usage: 'POST Body = ZUGFeRD-PDF -> { konform: ok|fehler|ungeprueft, meldungen[] }',
      } };
    }
    const buf = Buffer.from(await request.arrayBuffer());
    if (!buf.length) return problem(400, 'Leerer Request-Body. Bitte das ZUGFeRD-PDF senden.');
    if (buf.length > MAX_BYTES) return problem(413, 'Das PDF ist größer als 15 MB.');
    if (buf.slice(0, 5).toString('latin1') !== '%PDF-') return problem(400, 'Der Body ist kein PDF.');

    let xml;
    try { xml = await extractInvoiceXml(buf); } catch (e) {
      return problem(400, 'Keine ZUGFeRD-Rechnung: ' + ((e && e.message) || e));
    }
    const ust = verkaeuferUstId(xml);
    if (!EIGENE_UST_IDS.includes(ust)) {
      return problem(403, 'Geprüft werden nur Rechnungen einer DIHAG-Gesellschaft (USt-IdNr. des Verkäufers).');
    }

    let p;
    try { p = await validatePdfA(buf); } catch (e) {
      context.warn('veraPDF nicht erreichbar:', e && e.message);
      return { status: 200, jsonBody: { konform: 'ungeprueft', grund: 'veraPDF nicht erreichbar' } };
    }
    if (!p) return { status: 200, jsonBody: { konform: 'ungeprueft', grund: 'veraPDF nicht eingerichtet' } };
    return { status: 200, jsonBody: {
      konform: p.konform === 'ok' ? 'ok' : p.konform === 'fehler' ? 'fehler' : 'ungeprueft',
      flavour: p.flavour || '',
      meldungen: (p.meldungen || []).slice(0, MAX_MELDUNGEN),
    } };
  },
});

function problem(status, message) {
  return { status, headers: { 'Content-Type': 'application/json; charset=utf-8' }, jsonBody: { error: message } };
}

module.exports = { verkaeuferUstId, MAX_BYTES };
