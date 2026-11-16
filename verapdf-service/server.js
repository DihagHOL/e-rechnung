'use strict';
/**
 * Schlanker HTTP-Wrapper um die veraPDF-CLI.
 *   GET  /   -> JSON-Info (Health)
 *   POST /   -> Body = PDF, Antwort = JSON { konform, flavour, compliant, meldungen[] }
 * Ruft `verapdf --flavour <F> --format mrr <tmp>` auf und wertet den
 * Machine-Readable-Report (MRR) aus (isCompliant + fehlgeschlagene Regeln).
 *
 * Ist DIENST_KEY gesetzt, muss der Aufrufer ihn im Kopf X-Dienst-Schluessel mitschicken
 * (wie OCR_KEY beim OCR-Dienst). Der Container ist aus dem Internet erreichbar, ohne
 * Schlüssel kann ihn jeder benutzen. Dazu: Größengrenze, Zeitlimit je Prüfung und höchstens
 * VERAPDF_PARALLEL Prüfungen gleichzeitig, weitere warten.
 */
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const VERAPDF = process.env.VERAPDF_BIN || '/opt/verapdf/verapdf';
const FLAVOUR = process.env.VERAPDF_FLAVOUR || '3b';
const PORT = parseInt(process.env.PORT || '8080', 10);
const DIENST_KEY = process.env.DIENST_KEY || '';
const MAX_BYTES = 64 * 1024 * 1024;
const ZEIT_MS = parseInt(process.env.VERAPDF_ZEIT_MS || '120000', 10);
const PARALLEL = Math.max(1, parseInt(process.env.VERAPDF_PARALLEL || '2', 10));

/** Schlüssel vergleichen, ohne über die Laufzeit etwas zu verraten. */
function schluesselPasst(gesendet) {
  if (!DIENST_KEY) return true;
  const h = s => crypto.createHash('sha256').update(String(s || '')).digest();
  return crypto.timingSafeEqual(h(gesendet), h(DIENST_KEY));
}

// Höchstens PARALLEL Prüfungen gleichzeitig: Jede startet eine eigene JVM
let laufend = 0;
const wartend = [];
function platz() {
  if (laufend < PARALLEL) { laufend++; return Promise.resolve(); }
  return new Promise(frei => wartend.push(frei));
}
function platzFrei() {
  const naechster = wartend.shift();
  if (naechster) naechster(); else laufend--;
}

function pruefen(buf) {
  return new Promise((fertig, fehler) => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-'));
    const tmp = path.join(ordner, 'ein.pdf');
    // unlink und rmdir statt rmSync: Das Image bringt je nach Basis ein älteres Node mit
    const weg = () => {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      try { fs.rmdirSync(ordner); } catch (_) { /* ignore */ }
    };
    try { fs.writeFileSync(tmp, buf); } catch (e) { weg(); return fehler(e); }
    execFile(VERAPDF, ['--flavour', FLAVOUR, '--format', 'mrr', tmp],
      { maxBuffer: 128 * 1024 * 1024, encoding: 'utf8', timeout: ZEIT_MS, killSignal: 'SIGKILL' },
      (err, stdout, stderr) => {
        weg();
        if (err && err.killed) return fertig({ status: 504, body: { konform: 'ungeprueft', error: 'Zeitlimit der PDF/A-Prüfung überschritten' } });
        const mrr = stdout || '';
        // veraPDF endet bei nicht konformen PDFs mit Exit-Code 1, der Bericht steht trotzdem in stdout
        if (!mrr.trim()) {
          return fertig({ status: 502, body: { konform: 'ungeprueft', error: 'veraPDF ohne Ausgabe: ' + String(stderr || (err && err.message) || '').slice(0, 300) } });
        }
        fertig({ status: 200, body: parseMrr(mrr, FLAVOUR) });
      });
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    return json(res, 200, { service: 'veraPDF', flavour: 'PDF/A-' + FLAVOUR, schluessel: !!DIENST_KEY });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Nur GET/POST.' });
  if (!schluesselPasst(req.headers['x-dienst-schluessel'])) {
    req.resume();
    return json(res, 401, { error: 'Schlüssel fehlt oder falsch' });
  }
  if (Number(req.headers['content-length']) > MAX_BYTES) {
    req.resume();
    return json(res, 413, { error: 'PDF ist größer als 64 MB' });
  }

  const chunks = [];
  let size = 0, zuGross = false;
  req.on('data', c => {
    size += c.length;
    if (size > MAX_BYTES) { zuGross = true; chunks.length = 0; } else if (!zuGross) chunks.push(c);
  });
  req.on('error', () => { /* Verbindung abgebrochen */ });
  req.on('end', async () => {
    if (zuGross) return json(res, 413, { error: 'PDF ist größer als 64 MB' });
    const buf = Buffer.concat(chunks);
    if (!buf.length || buf.subarray(0, 8).toString('latin1').indexOf('%PDF-') === -1) {
      return json(res, 400, { error: 'Bitte ein PDF als Body senden.' });
    }
    await platz();
    try {
      const r = await pruefen(buf);
      json(res, r.status, r.body);
    } catch (e) {
      json(res, 500, { error: String((e && e.message) || e) });
    } finally {
      platzFrei();
    }
  });
});

function parseMrr(mrr, flavour) {
  const compliant = /isCompliant="true"/i.test(mrr) && !/isCompliant="false"/i.test(mrr);
  const failures = [];
  const re = /<rule\b([^>]*?)>/gi;
  let m;
  while ((m = re.exec(mrr)) && failures.length < 60) {
    const a = m[1];
    if (!/status="failed"/i.test(a)) continue;
    const clause = (a.match(/clause="([^"]*)"/i) || ['', ''])[1];
    const test = (a.match(/testNumber="([^"]*)"/i) || ['', ''])[1];
    const label = (clause ? 'Clause ' + clause : '') + (test ? ' Test ' + test : '');
    if (label.trim()) failures.push(label.trim());
  }
  return {
    konform: compliant ? 'ok' : 'fehler',
    flavour: 'PDF/A-' + flavour,
    compliant,
    meldungen: Array.from(new Set(failures)).slice(0, 40),
  };
}

function json(res, status, obj) {
  if (res.headersSent) return;
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log('veraPDF-Wrapper auf :' + PORT + ' (Flavour ' + FLAVOUR
    + (DIENST_KEY ? ', mit Schlüssel' : ', OHNE Schlüssel: DIENST_KEY setzen') + ')'));
}

module.exports = { server, parseMrr, schluesselPasst };
