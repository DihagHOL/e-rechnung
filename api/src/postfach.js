'use strict';
/**
 * Postfach eines Werks über Microsoft Graph lesen
 * ===============================================
 * Für Rechnungspostfächer, die Power Automate nicht abhören kann, etwa weil sie in einem
 * anderen Tenant liegen. Dort gibt eine App-Registrierung mit Mail.Read (Anwendung) den
 * Zugriff. Die Zugangsdaten je Werk stehen nur in den App-Einstellungen der Function:
 *   POSTFACH_<WERK>_TENANT, POSTFACH_<WERK>_CLIENT, POSTFACH_<WERK>_SECRET, POSTFACH_<WERK>_ADRESSE
 *   POSTFACH_<WERK>_ORDNER (optional, Standard inbox)
 *
 * Es wird nur gelesen: nichts verschoben, nichts als gelesen markiert. Welche Mail schon
 * abgelegt ist, sieht der Flow an der Spalte MailVorgang (unveränderliche Graph-ID der Mail).
 */
const GRAPH = 'https://graph.microsoft.com/v1.0';
const ZEIT_MS = 30000;
const MAX_MAILS = 200;
const _token = new Map();   // Werk -> { wert, bis }

/** Zugangsdaten eines Werks aus den App-Einstellungen, null wenn unvollständig. */
function zugang(werk) {
  const w = String(werk || '').toUpperCase();
  if (!/^[A-Z]{2,8}$/.test(w)) return null;
  const e = k => String(process.env[`POSTFACH_${w}_${k}`] || '').trim();
  const z = { werk: w, tenant: e('TENANT'), client: e('CLIENT'), secret: e('SECRET'), adresse: e('ADRESSE'), ordner: e('ORDNER') || 'inbox' };
  return z.tenant && z.client && z.secret && z.adresse ? z : null;
}

async function _anmelden(z) {
  const t = _token.get(z.werk);
  if (t && t.bis > Date.now() + 60000) return t.wert;
  const body = new URLSearchParams({ client_id: z.client, client_secret: z.secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(z.tenant)}/oauth2/v2.0/token`,
    { method: 'POST', body, signal: AbortSignal.timeout(ZEIT_MS) });
  const j = await r.json().catch(() => ({}));
  // Fehlertext ohne Zugangsdaten: nur Status und Fehlercode der Anmeldung
  if (!r.ok || !j.access_token) throw Object.assign(new Error(`Anmeldung am Tenant des Postfachs fehlgeschlagen (HTTP ${r.status}${j.error ? ', ' + j.error : ''})`), { status: 502 });
  _token.set(z.werk, { wert: j.access_token, bis: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
  return j.access_token;
}

async function _graph(z, pfad) {
  const r = await fetch(/^https:\/\//.test(pfad) ? pfad : GRAPH + pfad, {
    headers: { Authorization: 'Bearer ' + await _anmelden(z), Prefer: 'IdType="ImmutableId"' },
    signal: AbortSignal.timeout(ZEIT_MS),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw Object.assign(new Error(`Graph HTTP ${r.status}${j.error && j.error.code ? ', ' + j.error.code : ''}`), { status: r.status });
  }
  return r.json();
}

const _adresse = a => (a && a.emailAddress && a.emailAddress.address) || '';
const _kopf = m => ({ id: m.id, empfangen: m.receivedDateTime || '', betreff: m.subject || '', von: _adresse(m.from), antwortAn: _adresse((m.replyTo || [])[0]) });
const _postfach = z => `/users/${encodeURIComponent(z.adresse)}`;

/** Mails mit Anhängen seit `seit` (ISO, UTC), älteste zuerst, ohne Inhalt. */
async function mailsSeit(z, seit) {
  const q = [
    '$filter=' + encodeURIComponent(`receivedDateTime ge ${seit} and hasAttachments eq true`),
    '$orderby=' + encodeURIComponent('receivedDateTime asc'),
    '$select=id,receivedDateTime,subject,from,replyTo',
    '$top=50',
  ].join('&');
  let pfad = `${_postfach(z)}/mailFolders/${encodeURIComponent(z.ordner)}/messages?${q}`;
  const mails = [];
  while (pfad && mails.length < MAX_MAILS) {
    const d = await _graph(z, pfad);
    mails.push(...(d.value || []).map(_kopf));
    pfad = d['@odata.nextLink'] || '';
  }
  return mails.slice(0, MAX_MAILS);
}

/** PDF oder XML als Datei, keine eingebetteten Bilder und keine angehängten Mails. */
function istRechnungsanhang(a) {
  return a['@odata.type'] === '#microsoft.graph.fileAttachment' && !a.isInline
    && (/\.(pdf|xml)$/i.test(a.name || '') || /\/(pdf|xml)$/i.test(a.contentType || ''));
}

/** Name mit Endung: Der Flow erkennt PDF und XML an „.pdf“ und „.xml“. */
function _dateiname(a) {
  const name = String(a.name || 'Anhang').trim();
  if (/\.(pdf|xml)$/i.test(name)) return name;
  return name + (/pdf$/i.test(a.contentType || '') ? '.pdf' : '.xml');
}

/** Eine Mail mit ihren PDF- und XML-Anhängen. Die Felder heißen wie im Outlook-Auslöser (name, contentBytes). */
async function mailMitAnhaengen(z, id) {
  const basis = `${_postfach(z)}/messages/${encodeURIComponent(id)}`;
  const m = await _graph(z, `${basis}?$select=id,receivedDateTime,subject,from,replyTo`);
  const liste = await _graph(z, `${basis}/attachments?$select=id,name,contentType,size,isInline`);
  const anhaenge = [];
  for (const a of (liste.value || []).filter(istRechnungsanhang)) {
    const voll = await _graph(z, `${basis}/attachments/${encodeURIComponent(a.id)}`);
    anhaenge.push({ name: _dateiname(a), contentType: a.contentType || '', size: a.size || 0, contentBytes: voll.contentBytes || '' });
  }
  return Object.assign(_kopf(m), { anhaenge });
}

module.exports = { zugang, mailsSeit, mailMitAnhaengen, istRechnungsanhang, _token };
