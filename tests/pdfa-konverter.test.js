// node tests/pdfa-konverter.test.js
// Konverter (js/app.js): Original-PDF eingebettet -> veraPDF prüfen, sonst aus den Rechnungsdaten erzeugen
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };
const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8').split(String.fromCharCode(13)).join('');
const stueck = name => app.slice(app.indexOf(name), app.indexOf('\n}\n', app.indexOf(name)) + 3);
const quelle = stueck('async function _buildZugferdPdf(') + stueck('async function _pdfaPruefen(') + stueck('function _pdfDaten(');

const ctx = { console, setTimeout, clearTimeout, AbortController, JSON, Promise, Error, parseFloat, String, Object };
vm.createContext(ctx);
vm.runInContext(quelle + '\nthis.bauen = _buildZugferdPdf;', ctx);
const zustand = { haken: false, urteil: 'ok', status: 200, wirft: false, meldungen: [], aufrufe: 0 };
Object.assign(ctx, {
  document: { getElementById: id => (id === 'opt-render-pdf' ? { checked: zustand.haken } : null) },
  uploadedPdfBytes: 'ORIGINAL',
  buildInvoicePdf: async () => 'AUS-DATEN',
  embedXMLIntoPDF: async (basis, xml) => basis + '+' + xml,
  getAppConfig: () => ({ apiHost: 'https://beispiel.azurewebsites.net' }),
  showToast: t => zustand.meldungen.push(t),
  fetch: async (url, opt) => {
    zustand.aufrufe++;
    if (zustand.wirft) throw new Error('offline');
    gleich([url, opt.method], ['https://beispiel.azurewebsites.net/api/pdfa', 'POST'], 'Aufruf des Prüfdienstes');
    return { ok: zustand.status === 200, status: zustand.status, json: async () => ({ konform: zustand.urteil }) };
  },
});
const daten = { positionen: [{ menge: 1, einzelpreis: 10 }] };
const summen = { netTotal: 10, vatTotal: 1.9, grossTotal: 11.9 };

(async () => {
  // Haken „aus Daten“: keine Prüfung nötig
  zustand.haken = true;
  gleich(await ctx.bauen(daten, summen, 'XML'), 'AUS-DATEN+XML', 'aus Daten');
  gleich(zustand.aufrufe, 0, 'ohne Prüfung');

  // Original konform: bleibt
  zustand.haken = false;
  gleich(await ctx.bauen(daten, summen, 'XML'), 'ORIGINAL+XML', 'Original konform');
  gleich(zustand.meldungen.length, 0, 'ohne Hinweis');

  // Original nicht konform: aus Daten, mit Hinweis
  zustand.urteil = 'fehler';
  gleich(await ctx.bauen(daten, summen, 'XML'), 'AUS-DATEN+XML', 'Original nicht konform');
  gleich(/kein gültiges PDF\/A-3/.test(zustand.meldungen.pop()), true, 'Hinweis PDF/A');

  // Prüfdienst nicht erreichbar oder noch nicht deployt: ebenfalls aus Daten
  zustand.wirft = true;
  gleich(await ctx.bauen(daten, summen, 'XML'), 'AUS-DATEN+XML', 'offline');
  gleich(/nicht erreichbar/.test(zustand.meldungen.pop()), true, 'Hinweis offline');
  zustand.wirft = false; zustand.status = 404;
  gleich(await ctx.bauen(daten, summen, 'XML'), 'AUS-DATEN+XML', 'Endpunkt fehlt');
  zustand.status = 200; zustand.urteil = 'ungeprueft';
  gleich(await ctx.bauen(daten, summen, 'XML'), 'AUS-DATEN+XML', 'ungeprüft');

  console.log(`pdfa-konverter: ${n} Prüfungen grün`);
})().catch(e => { console.error(e); process.exit(1); });
