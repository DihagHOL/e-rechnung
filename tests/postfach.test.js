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
  // S/MIME-signierte Mail: Graph zeigt nur smime.p7m
  if (/\/messages\/S1\/attachments\?/.test(url)) {
    return ok({ value: [{ '@odata.type': '#microsoft.graph.fileAttachment', id: 'P7', name: 'smime.p7m', contentType: 'multipart/signed', size: 300, isInline: false }] });
  }
  if (/\/attachments\/P7$/.test(url)) {
    const mime = ['Content-Type: multipart/signed; protocol="application/pkcs7-signature"; boundary="S"', '', '--S',
      'Content-Type: multipart/mixed; boundary="M"', '', '--M', 'Content-Type: text/plain', '', 'Hallo', '--M',
      'Content-Type: application/octet-stream; name="RE 9.pdf"', 'Content-Transfer-Encoding: base64', '', Buffer.from('%PDF-9').toString('base64'),
      '--M--', '--S', 'Content-Type: application/pkcs7-signature; name="smime.p7s"', '', 'xx', '--S--', ''].join(String.fromCharCode(13, 10));
    return ok({ contentBytes: Buffer.from(mime).toString('base64') });
  }
  if (/\/messages\/S1\?/.test(url)) return ok({ id: 'S1', receivedDateTime: '2026-11-11T07:00:00Z', subject: 'Signiert', from: { emailAddress: { address: 'buha@lieferant.example' } } });
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
  const sm = await P.mailMitAnhaengen(z, 'S1');
  gleich(sm.anhaenge.map(a => [a.name, a.contentType, Buffer.from(a.contentBytes, 'base64').toString()]), [['RE 9.pdf', 'application/pdf', '%PDF-9']], 'S/MIME-Mail ausgepackt');

  // Fehler ohne Zugangsdaten im Text
  await assert.rejects(P.mailMitAnhaengen(z, 'FEHLT'), e => e.status === 404 && /ErrorItemNotFound/.test(e.message) && !/geheim/.test(e.message));
  n++;
  P._token.clear();
  const echt = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid_client', error_description: 'geheim falsch' }) });
  await assert.rejects(P.mailsSeit(z, '2026-11-07T00:00:00Z'), e => /invalid_client/.test(e.message) && !/geheim/.test(e.message));
  n++;
  global.fetch = echt;

  // Ordner: Baum, Suche nach Name oder Pfad, Liste aus einem Ordner, Verschieben, Diagnose
  P._token.clear(); P._baum.clear();
  const nutzlast = Buffer.from(JSON.stringify({ roles: ['Mail.ReadWrite', 'Mail.Read'] })).toString('base64url');
  const ordnerAufrufe = [];
  global.fetch = async (url, opt = {}) => {
    url = String(url);
    ordnerAufrufe.push({ url, opt });
    const ok = body => ({ ok: true, status: 200, json: async () => body });
    if (/login\.microsoftonline\.com/.test(url)) return ok({ access_token: 'kopf.' + nutzlast + '.sig', expires_in: 3600 });
    if (/\/mailFolders\?/.test(url)) {
      return ok({ value: [
        { id: 'F-IN', displayName: 'Posteingang', childFolderCount: 2, totalItemCount: 12 },
        { id: 'F-AR', displayName: 'Archiv', childFolderCount: 1, totalItemCount: 0 },
      ] });
    }
    if (/\/mailFolders\/F-IN\/childFolders\?/.test(url)) {
      return ok({ value: [
        { id: 'F-IRIS', displayName: 'IRIS', childFolderCount: 0, totalItemCount: 5 },
        { id: 'F-VK', displayName: 'Vorkasse', childFolderCount: 0, totalItemCount: 2 },
      ] });
    }
    if (/\/mailFolders\/F-AR\/childFolders\?/.test(url)) return ok({ value: [{ id: 'F-AR-IRIS', displayName: 'IRIS', childFolderCount: 0, totalItemCount: 0 }] });
    if (/\/mailFolders\/F-VK\/messages\?/.test(url)) return ok({ value: [{ id: 'V1', receivedDateTime: '2026-11-10T07:00:00Z', lastModifiedDateTime: '2026-11-10T09:00:00Z', subject: 'Vorkasse 1', from: { emailAddress: { address: 'a@x.example' } } }] });
    if (/\/mailFolders\/F-IN\/messages\?/.test(url)) return ok({ value: [{ id: 'I1', receivedDateTime: '2026-11-10T08:00:00Z', lastModifiedDateTime: '2026-11-10T08:30:00Z', subject: 'Eingang 1', from: { emailAddress: { address: 'b@x.example' } } }] });
    if (/\/mailFolders\/F-IRIS\/messages\?/.test(url)) return ok({ value: [] });
    if (/\/messages\/V1\/move$/.test(url)) return ok({ id: 'V1' });
    throw new Error('unerwartet: ' + url);
  };
  const baum = await P.ordnerBaum(z);
  gleich(baum.map(o => [o.pfad, o.anzahl]), [['Posteingang', 12], ['Posteingang/IRIS', 5], ['Posteingang/Vorkasse', 2], ['Archiv', 0], ['Archiv/IRIS', 0]], 'Ordnerbaum mit Pfad');
  gleich([await P.ordnerId(z, 'vorkasse'), await P.ordnerId(z, 'Posteingang/IRIS'), await P.ordnerId(z, 'inbox')], ['F-VK', 'F-IRIS', 'inbox'], 'Name, Pfad, bekannter Ordner');
  await assert.rejects(P.ordnerId(z, 'IRIS'), e => e.status === 409 && /Posteingang\/IRIS, Archiv\/IRIS/.test(e.message));
  n++;
  await assert.rejects(P.ordnerId(z, 'Gibtsnicht'), e => e.status === 404);
  n++;
  gleich((await P.mailsSeit(z, '2026-11-08T00:00:00Z', await P.ordnerId(z, 'Vorkasse'))).map(m => m.id), ['V1'], 'Liste aus einem Ordner');
  const vk = decodeURIComponent(ordnerAufrufe.filter(a => /F-VK\/messages/.test(a.url)).pop().url);
  gleich(/receivedDateTime ge 2026-11-08T00:00:00Z/.test(vk), true, 'Ordner nach Eingang');
  await P.mailsSeit(z, '2026-11-08T00:00:00Z', 'F-VK', true);
  const vk2 = decodeURIComponent(ordnerAufrufe.filter(a => /F-VK\/messages/.test(a.url)).pop().url);
  gleich([/lastModifiedDateTime ge 2026-11-08T00:00:00Z and hasAttachments eq true/.test(vk2), /\$orderby=lastModifiedDateTime asc/.test(vk2)], [true, true], 'Ordner nach Änderung');
  // Ordner samt Unterordnern, nach Änderung sortiert, mit Stichtag
  gleich(await P.ordnerMitUnterordnern(z, 'Posteingang'), ['F-IN', 'F-IRIS', 'F-VK'], 'Posteingang mit Unterordnern');
  gleich(await P.ordnerMitUnterordnern(z, 'Vorkasse'), ['F-VK'], 'ohne Unterordner nur er selbst');
  const zusammen = await P.mailsSeit(z, '2026-11-08T00:00:00Z', ['F-IN', 'F-IRIS', 'F-VK'], true, '2026-11-09T00:00:00Z');
  gleich(zusammen.map(m => m.id), ['I1', 'V1'], 'mehrere Ordner, nach letzter Änderung sortiert');
  gleich(Object.keys(zusammen[0]).sort(), ['antwortAn', 'betreff', 'empfangen', 'id', 'von'], 'keine Hilfsfelder in der Antwort');
  const mitAb = decodeURIComponent(ordnerAufrufe.filter(a => /F-IN\/messages/.test(a.url)).pop().url);
  gleich(/lastModifiedDateTime ge 2026-11-08T00:00:00Z and receivedDateTime ge 2026-11-09T00:00:00Z and hasAttachments eq true/.test(mitAb), true, 'Stichtag im Filter');
  await P.mailsSeit(z, '2026-11-08T00:00:00Z', 'F-VK', false, '2026-11-09T00:00:00Z');
  const nachEingang = decodeURIComponent(ordnerAufrufe.filter(a => /F-VK\/messages/.test(a.url)).pop().url);
  gleich(/receivedDateTime ge 2026-11-09T00:00:00Z and hasAttachments eq true/.test(nachEingang), true, 'Stichtag nach dem Fenster ersetzt den Beginn');
  gleich(await P.verschieben(z, 'V1', 'Posteingang/IRIS'), { id: 'V1', ordner: 'Posteingang/IRIS' }, 'verschoben');
  const zug = ordnerAufrufe.find(a => /\/move$/.test(a.url));
  gleich([zug.opt.method, JSON.parse(zug.opt.body), zug.opt.headers['Content-Type']], ['POST', { destinationId: 'F-IRIS' }, 'application/json'], 'Verschieben per POST mit Ziel-ID');
  gleich(ordnerAufrufe.filter(a => a.opt.method === 'POST' && !/login/.test(a.url)).length, 1, 'sonst nur lesend');
  const diag = await P.graphDiagnose(z);
  gleich([diag.rollen, diag.ordner.length, JSON.stringify(diag).includes(nutzlast)], [['Mail.Read', 'Mail.ReadWrite'], 5, false], 'Diagnose: Rechte, Ordner, kein Token');
  await assert.rejects(P.verschieben(P.zugang('EWT') || { art: 'ews' }, 'X', 'IRIS'), e => e.status === 400);
  n++;
  global.fetch = echt;

  console.log(`postfach: ${n} Prüfungen grün`);
})().catch(e => { console.error(e); process.exit(1); });
