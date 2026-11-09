// node tests/postfach.test.js
// api/src/postfach.js: Rechnungspostfach über Graph lesen, nur lesend, ohne echte Zugangsdaten (fetch ist ersetzt).
const assert = require('assert');
const P = require('../api/src/postfach');

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };

const ENV = { POSTFACH_TST_TENANT: 'tenant-1', POSTFACH_TST_CLIENT: 'app-1', POSTFACH_TST_SECRET: 'geheim', POSTFACH_TST_ADRESSE: 'rechnung@beispiel.example' };
Object.assign(process.env, ENV);

const aufrufe = [];
let anmeldungen = 0;
global.fetch = async (url, opt = {}) => {
  aufrufe.push({ url: String(url), opt });
  const ok = body => ({ ok: true, status: 200, json: async () => body });
  if (/login\.microsoftonline\.com/.test(url)) { anmeldungen++; return ok({ access_token: 'T' + anmeldungen, expires_in: 3600 }); }
  if (/\/mailFolders\/inbox\/messages\?/.test(url)) {
    return ok({ value: [{ id: 'M1', receivedDateTime: '2026-11-09T07:00:00Z', subject: 'Rechnung 1', from: { emailAddress: { address: 'buha@lieferant.example' } }, replyTo: [] }],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/seite2' });
  }
  if (/seite2$/.test(url)) {
    return ok({ value: [{ id: 'M2', receivedDateTime: '2026-11-09T08:00:00Z', subject: 'Rechnung 2', from: { emailAddress: { address: 'a@x.example' } }, replyTo: [{ emailAddress: { address: 'b@x.example' } }] }] });
  }
  if (/\/messages\/M%2F1\/attachments\?/.test(url)) {
    return ok({ value: [
      { '@odata.type': '#microsoft.graph.fileAttachment', id: 'A1', name: 'Rechnung.pdf', contentType: 'application/pdf', size: 10, isInline: false },
      { '@odata.type': '#microsoft.graph.fileAttachment', id: 'A2', name: 'logo.png', contentType: 'image/png', size: 5, isInline: true },
      { '@odata.type': '#microsoft.graph.fileAttachment', id: 'A3', name: 'xrechnung', contentType: 'application/xml', size: 7, isInline: false },
      { '@odata.type': '#microsoft.graph.itemAttachment', id: 'A4', name: 'Weitergeleitet.pdf', size: 9, isInline: false },
    ] });
  }
  if (/\/attachments\/A1$/.test(url)) return ok({ contentBytes: 'UERG' });
  if (/\/attachments\/A3$/.test(url)) return ok({ contentBytes: 'WE1M' });
  if (/\/messages\/M%2F1\?/.test(url)) return ok({ id: 'M/1', receivedDateTime: '2026-11-09T07:00:00Z', subject: 'Rechnung 1', from: { emailAddress: { address: 'buha@lieferant.example' } } });
  if (/\/messages\/FEHLT\?/.test(url)) return { ok: false, status: 404, json: async () => ({ error: { code: 'ErrorItemNotFound' } }) };
  throw new Error('unerwartet: ' + url);
};

(async () => {
  // Zugang nur mit allen Einstellungen
  gleich(P.zugang('tst') && P.zugang('tst').ordner, 'inbox', 'vollständig, Ordner inbox');
  gleich(P.zugang('XYZ'), null, 'ohne Einstellungen');
  gleich(P.zugang('../x'), null, 'kein gültiges Kürzel');
  const z = P.zugang('TST');

  // Liste: Filter, Sortierung, Seiten, nur Kopf
  const mails = await P.mailsSeit(z, '2026-11-07T00:00:00Z');
  gleich(mails, [
    { id: 'M1', empfangen: '2026-11-09T07:00:00Z', betreff: 'Rechnung 1', von: 'buha@lieferant.example', antwortAn: '' },
    { id: 'M2', empfangen: '2026-11-09T08:00:00Z', betreff: 'Rechnung 2', von: 'a@x.example', antwortAn: 'b@x.example' },
  ], 'zwei Seiten, älteste zuerst');
  const liste = decodeURIComponent(aufrufe.find(a => /messages\?/.test(a.url)).url);
  gleich([/receivedDateTime ge 2026-11-07T00:00:00Z and hasAttachments eq true/.test(liste), /\$orderby=receivedDateTime asc/.test(liste), /users\/rechnung@beispiel\.example\/mailFolders\/inbox/.test(liste)], [true, true, true], 'Abfrage');
  const graphAufruf = aufrufe.find(a => /graph\.microsoft\.com/.test(a.url));
  gleich([graphAufruf.opt.headers.Authorization, graphAufruf.opt.headers.Prefer], ['Bearer T1', 'IdType="ImmutableId"'], 'Token und unveränderliche IDs');
  gleich(aufrufe.filter(a => a.opt.method && a.opt.method !== 'GET').every(a => /login/.test(a.url)), true, 'nur lesend: außer der Anmeldung nur GET');
  gleich(anmeldungen, 1, 'Token wird wiederverwendet');
  const anm = aufrufe.find(a => /login/.test(a.url));
  gleich([/tenant-1/.test(anm.url), anm.opt.body.get('client_id'), anm.opt.body.get('grant_type')], [true, 'app-1', 'client_credentials'], 'Anmeldung mit App-Zugang');

  // Eine Mail: nur PDF und XML als Datei, Inhalt Base64
  const m = await P.mailMitAnhaengen(z, 'M/1');
  gleich(m.anhaenge.map(a => [a.name, a.contentBytes]), [['Rechnung.pdf', 'UERG'], ['xrechnung.xml', 'WE1M']], 'Logo und angehängte Mail fallen weg, Endung ergänzt');
  gleich([m.id, m.von], ['M/1', 'buha@lieferant.example'], 'Kopf der Mail');

  // Fehler ohne Zugangsdaten im Text
  await assert.rejects(P.mailMitAnhaengen(z, 'FEHLT'), e => e.status === 404 && /ErrorItemNotFound/.test(e.message) && !/geheim/.test(e.message));
  n++;
  P._token.clear();
  const echt = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid_client', error_description: 'geheim falsch' }) });
  await assert.rejects(P.mailsSeit(z, '2026-11-07T00:00:00Z'), e => /invalid_client/.test(e.message) && !/geheim/.test(e.message));
  n++;
  global.fetch = echt;

  console.log(`postfach: ${n} Prüfungen grün`);
})().catch(e => { console.error(e); process.exit(1); });
