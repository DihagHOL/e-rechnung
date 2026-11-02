'use strict';
/**
 * HTTP-Trigger: qualifizierte USt-IdNr-Prüfung für den Ausgangsrechnungsprozess
 * ============================================================================
 *   GET  /api/vat  -> Info
 *   POST /api/vat  -> Body JSON { vatIdOwn, vatId, company, city, zip, street }
 *                     Antwort = normalisiertes Ergebnis inkl. `bericht` (Nachweis).
 *
 * Primär BZSt (deutsche qualifizierte Bestätigung, A/B/C/D + Anfrage-ID);
 * Fallback EU-VIES, falls BZSt nicht erreichbar ist (Wartungsfenster).
 *
 * authLevel "anonymous": wird direkt aus dem Browser-Tool (index.html) aufgerufen.
 * Enthält KEINE Geheimnisse; BZSt/VIES sind selbst ohne Auth erreichbar. Ergebnis
 * wird kurz gecacht (Rate-Limits der BZSt schonen).
 *
 * Damit der Dienst kein offener BZSt-Proxy ist: anfragende USt-IdNr. nur eine der
 * eigenen Gesellschaften, Textfelder höchstens 100 Zeichen, Cache höchstens 1.000 Einträge.
 */
const { app } = require('@azure/functions');
const { pruefeBzst } = require('../bzst');
const { pruefeVies } = require('../vies');

const _cache = new Map();          // key -> { t, res }, Reihenfolge = zuletzt benutzt hinten
const TTL_MS = 12 * 3600 * 1000;   // 12 h
const CACHE_MAX = 1000;
const FELD_MAX = 100;

// USt-IdNr. der eigenen Gesellschaften (Registry in js/parser.js, verkaeufervat).
// tests/vat-api.test.js prüft, dass die Liste zur Registry passt.
const EIGENE_UST_IDS = ['DE140598967', 'DE812264517', 'DE368990137', 'DE368676368',
  'DE811154479', 'DE812737567', 'DE281233945', 'DE150528912'];

app.http('vat', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'vat',
  handler: async (request, context) => {
    if (request.method === 'GET') {
      return {
        status: 200,
        jsonBody: {
          service: 'USt-IdNr-Prüfung (BZSt qualifiziert, VIES-Fallback)',
          usage: 'POST { vatIdOwn (DE…), vatId (EU, nicht-DE), company, city, zip, street } '
               + '-> { gueltig, qualifiziert, ergebnis{firmenname,ort,plz,strasse}, anfrageId, bericht }',
        },
      };
    }

    let p;
    try { p = await request.json(); } catch { return problem(400, 'Request-Body muss JSON sein.'); }

    const vatId    = norm(p.vatId);
    const vatIdOwn = norm(p.vatIdOwn);

    if (!/^[A-Z]{2}[0-9A-Z]{2,15}$/.test(vatId)) {
      return problem(400, 'Ungültige zu prüfende USt-IdNr (Feld "vatId").');
    }
    if (vatId.startsWith('DE')) {
      return { status: 200, jsonBody: {
        moeglich: false,
        grund: 'BZSt/VIES bestätigen nur ausländische EU-USt-IdNr (nicht DE). '
             + 'Inlandsrechnungen brauchen keine qualifizierte Bestätigung.',
      } };
    }
    if (!EIGENE_UST_IDS.includes(vatIdOwn)) {
      return problem(400, 'Anfragende USt-IdNr ("vatIdOwn") muss die einer DIHAG-Gesellschaft sein.');
    }

    const params = {
      vatIdOwn, vatId,
      company: str(p.company), city: str(p.city), zip: str(p.zip), street: str(p.street),
    };
    for (const k of ['company', 'city', 'zip', 'street']) {
      if (params[k].length > FELD_MAX) return problem(400, `Feld "${k}" ist länger als ${FELD_MAX} Zeichen.`);
    }

    const key = JSON.stringify(params);
    const hit = _cache.get(key);
    if (hit && Date.now() - hit.t < TTL_MS) {
      _cache.delete(key); _cache.set(key, hit);   // zuletzt benutzt nach hinten
      return { status: 200, jsonBody: { ...hit.res, cached: true } };
    }

    let res;
    try {
      res = await pruefeBzst(params);
    } catch (e) {
      context.warn('BZSt nicht erreichbar -> VIES-Fallback:', e && e.message);
      try {
        res = await pruefeVies(params);
        res.fallback = 'BZSt nicht erreichbar – EU-VIES verwendet';
      } catch (e2) {
        return problem(502, 'Weder BZSt noch VIES erreichbar: ' + (e2 && e2.message ? e2.message : String(e2)));
      }
    }

    res.bericht = baueBericht(res);
    _cache.delete(key);
    _cache.set(key, { t: Date.now(), res });
    while (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value);   // ältesten raus
    return { status: 200, jsonBody: res };
  },
});

/** Menschlich lesbarer Nachweis (für Anzeige/Druck/Ablage an der Rechnung). */
function baueBericht(res) {
  const L = { firmenname: 'Firmenname', ort: 'Ort', plz: 'PLZ', strasse: 'Straße' };
  const zeilen = [
    ['Quelle', res.quelle + (res.fallback ? ' (Fallback)' : '')],
    ['Art', res.qualifiziert ? 'Qualifizierte Bestätigung' : 'Einfache Bestätigung (Gültigkeit)'],
    ['Anfragende USt-IdNr.', res.eigeneUstId],
    ['Geprüfte USt-IdNr.', res.pruefUstId],
    ['Ergebnis', res.gueltig ? 'GÜLTIG' : 'NICHT gültig'],
    ['Status', [res.status, res.statusText].filter(Boolean).join(' – ')],
  ];
  if (res.qualifiziert) {
    for (const f of ['firmenname', 'ort', 'plz', 'strasse']) {
      if (res.ergebnis[f]) zeilen.push([L[f], `${res.ergebnis[f]} – ${res.ergebnisText[f]}`]);
    }
  }
  if (res.registriert && res.registriert.name) {
    zeilen.push(['Registriert (VIES)', [res.registriert.name, res.registriert.adresse].filter(Boolean).join(', ')]);
  }
  if (res.gueltigAb || res.gueltigBis) zeilen.push(['Gültigkeit', [res.gueltigAb, res.gueltigBis].filter(Boolean).join(' – ')]);
  zeilen.push(['Anfrage-ID (Nachweis)', res.anfrageId || '—']);
  zeilen.push(['Zeitpunkt', res.zeitpunkt || '—']);
  return { titel: 'USt-IdNr-Bestätigung', zeilen };
}

function norm(v) { return String(v || '').replace(/\s+/g, '').toUpperCase(); }
function str(v) { return v == null ? '' : String(v).trim(); }
function problem(status, message) {
  return { status, headers: { 'Content-Type': 'application/json; charset=utf-8' }, jsonBody: { error: message } };
}

module.exports = { EIGENE_UST_IDS, CACHE_MAX, _cache };
