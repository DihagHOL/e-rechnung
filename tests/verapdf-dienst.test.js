// node tests/verapdf-dienst.test.js
// veraPDF-Wrapper (verapdf-service/server.js) mit nachgestellter CLI: Schlüssel, Größe, Zeitlimit, Parallelität
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const cp = require('child_process');
let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };

let gleichzeitig = 0, maxGleichzeitig = 0, dateien = [];
cp.execFile = (bin, args, opts, cb) => {
  const tmp = args[args.length - 1];
  dateien.push(tmp);
  const inhalt = fs.readFileSync(tmp, 'latin1');
  gleichzeitig++; maxGleichzeitig = Math.max(maxGleichzeitig, gleichzeitig);
  setTimeout(() => {
    gleichzeitig--;
    if (inhalt.includes('haengt')) return cb(Object.assign(new Error('killed'), { killed: true }), '', '');
    if (inhalt.includes('leer')) return cb(Object.assign(new Error('exit 2'), { code: 2 }), '', 'kaputt');
    if (inhalt.includes('mangel')) return cb(Object.assign(new Error('exit 1'), { code: 1 }),
      '<report isCompliant="false"><rule clause="6.1.2" testNumber="1" status="failed"></rule></report>', '');
    cb(null, '<report isCompliant="true"></report>', '');
  }, 60);
};
process.env.DIENST_KEY = 'testwert-3';
process.env.VERAPDF_PARALLEL = '2';
const S = require(require('path').join(__dirname, '..', 'verapdf-service', 'server.js'));

const ruf = (port, methode, body, kopf, nurKopf) => new Promise((ok, fehler) => {
  const req = http.request({ host: '127.0.0.1', port, method: methode, path: '/', headers: kopf || {} }, res => {
    const teile = [];
    res.on('data', c => teile.push(c));
    res.on('end', () => ok({ status: res.statusCode, body: JSON.parse(Buffer.concat(teile).toString('utf8') || '{}') }));
  });
  req.on('error', fehler);
  if (nurKopf) req.flushHeaders(); else req.end(body);
});

S.server.listen(0, '127.0.0.1', async () => {
  const port = S.server.address().port;
  const k = { 'X-Dienst-Schluessel': 'testwert-3' };
  try {
    const h = await ruf(port, 'GET');
    gleich([h.status, h.body.schluessel, 'bin' in h.body], [200, true, false], 'Health ohne Pfad der CLI');
    gleich((await ruf(port, 'POST', Buffer.from('%PDF-1.7'))).status, 401, 'ohne Schlüssel');
    gleich((await ruf(port, 'POST', Buffer.from('%PDF-1.7'), { 'X-Dienst-Schluessel': 'falsch' })).status, 401, 'falscher Schlüssel');
    gleich(dateien.length, 0, 'ohne Schlüssel keine Prüfung gestartet');
    const ok = await ruf(port, 'POST', Buffer.from('%PDF-1.7 gut'), k);
    gleich([ok.status, ok.body.konform, ok.body.flavour], [200, 'ok', 'PDF/A-3b'], 'konformes PDF');
    const mangel = await ruf(port, 'POST', Buffer.from('%PDF-1.7 mangel'), k);
    gleich([mangel.status, mangel.body.konform, mangel.body.meldungen], [200, 'fehler', ['Clause 6.1.2 Test 1']], 'Mangel trotz Exit-Code 1 gelesen');
    gleich((await ruf(port, 'POST', Buffer.from('%PDF-1.7 haengt'), k)).status, 504, 'Zeitlimit');
    gleich((await ruf(port, 'POST', Buffer.from('%PDF-1.7 leer'), k)).status, 502, 'ohne Ausgabe');
    gleich((await ruf(port, 'POST', Buffer.from('kein pdf'), k)).status, 400, 'kein PDF');
    gleich((await ruf(port, 'POST', null, Object.assign({ 'Content-Length': String(65 * 1024 * 1024) }, k), true).catch(() => ({ status: 413 }))).status, 413, 'zu groß am Kopf abgewiesen');
    gleich(dateien.every(d => !fs.existsSync(d) && !fs.existsSync(require('path').dirname(d))), true, 'Arbeitsordner danach weg');
    maxGleichzeitig = 0;
    const viele = await Promise.all([1, 2, 3, 4, 5].map(i => ruf(port, 'POST', Buffer.from('%PDF-1.7 gut ' + i), k)));
    gleich([viele.every(v => v.status === 200), maxGleichzeitig], [true, 2], 'höchstens zwei Prüfungen gleichzeitig');
    gleich([S.schluesselPasst('testwert-3'), S.schluesselPasst(''), S.schluesselPasst(undefined)], [true, false, false], 'Schlüsselvergleich');
    console.log(`verapdf-dienst: ${n} Prüfungen grün`);
  } catch (e) { console.error(e); process.exitCode = 1; }
  S.server.close();
});
