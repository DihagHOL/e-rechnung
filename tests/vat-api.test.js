// node tests/vat-api.test.js
// /api/vat (api/src/functions/vat.js): nur eigene anfragende USt-IdNr., Längengrenzen, begrenzter Cache
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..', 'api');
const SRC = path.join(API, 'src');
let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };

// Prüfdienste und Azure-Laufzeit als Attrappen
const handler = {};
const attrappe = (datei, exports) => {
  const f = require.resolve(datei);
  require.cache[f] = { id: f, filename: f, loaded: true, exports };
};
attrappe(require.resolve('@azure/functions', { paths: [path.join(SRC, 'functions')] }),
  { app: { http: (name, o) => { handler[name] = o.handler; } } });
let anfragen = 0;
attrappe(path.join(SRC, 'bzst.js'), { pruefeBzst: async p => { anfragen++; return { quelle: 'BZSt', gueltig: true, qualifiziert: false,
  eigeneUstId: p.vatIdOwn, pruefUstId: p.vatId, ergebnis: {}, ergebnisText: {} }; } });
attrappe(path.join(SRC, 'vies.js'), { pruefeVies: async () => { throw new Error('nicht gebraucht'); } });
const V = require(path.join(SRC, 'functions', 'vat.js'));

// 1) Liste der eigenen USt-IdNr. passt zur Registry in js/parser.js
const registry = [...fs.readFileSync(path.join(__dirname, '..', 'js', 'parser.js'), 'utf8')
  .matchAll(/verkaeufervat:\s*'(DE\d{9})'/g)].map(m => m[1]);
gleich([...V.EIGENE_UST_IDS].sort(), [...new Set(registry)].sort(), 'eigene USt-IdNr. wie in der Registry');

const aufruf = async body => {
  const r = await handler.vat({ method: 'POST', json: async () => body }, { warn() {} });
  return { status: r.status, body: r.jsonBody };
};
const eigene = V.EIGENE_UST_IDS[0];

(async () => {
  // 2) Anfragende USt-IdNr.: nur eigene
  gleich((await aufruf({ vatIdOwn: 'DE123456789', vatId: 'FR12345678901' })).status, 400, 'fremde anfragende USt-IdNr.');
  gleich((await aufruf({ vatIdOwn: eigene, vatId: 'FR12345678901', company: 'Muster SA' })).status, 200, 'eigene anfragende USt-IdNr.');

  // 3) Textfelder höchstens 100 Zeichen
  const lang = await aufruf({ vatIdOwn: eigene, vatId: 'FR12345678901', company: 'x'.repeat(101) });
  gleich([lang.status, /company/.test(lang.body.error)], [400, true], 'Firmenname zu lang');
  gleich((await aufruf({ vatIdOwn: eigene, vatId: 'FR12345678901', street: 'y'.repeat(100) })).status, 200, '100 Zeichen gehen');

  // 4) Cache: Treffer ohne neue Anfrage, höchstens CACHE_MAX Einträge
  const vorher = anfragen;
  const t = await aufruf({ vatIdOwn: eigene, vatId: 'FR12345678901', company: 'Muster SA' });
  gleich([t.body.cached, anfragen], [true, vorher], 'Treffer aus dem Cache');
  for (let i = 0; i < V.CACHE_MAX + 20; i++) await aufruf({ vatIdOwn: eigene, vatId: 'FR12345678901', company: 'Firma ' + i });
  gleich(V._cache.size, V.CACHE_MAX, 'Cache wächst nicht über die Grenze');

  console.log(`vat-api: ${n} Prüfungen grün`);
})().catch(e => { console.error(e); process.exit(1); });
