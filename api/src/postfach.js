'use strict';
/**
 * Postfach eines Werks über Microsoft Graph lesen
 * ===============================================
 * Für Rechnungspostfächer, die Power Automate nicht abhören kann, etwa weil sie in einem
 * anderen Tenant liegen. Dort gibt eine App-Registrierung mit Mail.Read (Anwendung) den
 * Zugriff. Die Zugangsdaten je Werk stehen nur in den App-Einstellungen der Function:
 *   POSTFACH_<WERK>_TENANT, POSTFACH_<WERK>_CLIENT, POSTFACH_<WERK>_SECRET, POSTFACH_<WERK>_ADRESSE
 *   POSTFACH_<WERK>_ORDNER (optional, Standard inbox)
 * Exchange im eigenen Haus (EWS) statt Graph: POSTFACH_<WERK>_EWS, _BENUTZER, _KENNWORT (src/ews.js).
 *
 * Gelesen wird ohne Spuren: nichts als gelesen markiert. Welche Mail schon abgelegt ist, sieht
 * der Flow an der Spalte MailVorgang (unveränderliche Graph-ID der Mail, bleibt beim Verschieben).
 * Verschieben (verschieben) ist der einzige schreibende Aufruf und braucht Mail.ReadWrite.
 * Ordner gibt der Flow mit Namen an („IRIS“ oder „Posteingang/IRIS“), die Function sucht die ID.
 */
const { ewsMailsSeit, ewsMailMitAnhaengen } = require('./ews');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const ZEIT_MS = 30000;
const MAX_MAILS = 200;
const _token = new Map();   // Werk -> { wert, bis }
const _baum = new Map();    // Werk -> { liste, bis }, Ordnerbaum für 10 Minuten
const BEKANNT = ['inbox', 'archive', 'sentitems', 'deleteditems', 'junkemail', 'drafts'];

/** Zugangsdaten eines Werks aus den App-Einstellungen, null wenn unvollständig. */
function zugang(werk) {
  const w = String(werk || '').toUpperCase();
  if (!/^[A-Z]{2,8}$/.test(w)) return null;
  const e = k => String(process.env[`POSTFACH_${w}_${k}`] || '').trim();
  const ordner = e('ORDNER') || 'inbox';
  if (e('EWS')) {
    const z = { werk: w, art: 'ews', ews: e('EWS'), benutzer: e('BENUTZER'), kennwort: e('KENNWORT'), adresse: e('ADRESSE') || e('BENUTZER'), ordner };
    return /^https:\/\//.test(z.ews) && z.benutzer && z.kennwort ? z : null;
  }
  const z = { werk: w, art: 'graph', tenant: e('TENANT'), client: e('CLIENT'), secret: e('SECRET'), adresse: e('ADRESSE'), ordner };
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

async function _graph(z, pfad, body) {
  const kopf = { Authorization: 'Bearer ' + await _anmelden(z), Prefer: 'IdType="ImmutableId"' };
  if (body) kopf['Content-Type'] = 'application/json';
  const r = await fetch(/^https:\/\//.test(pfad) ? pfad : GRAPH + pfad, Object.assign({
    headers: kopf, signal: AbortSignal.timeout(ZEIT_MS),
  }, body ? { method: 'POST', body: JSON.stringify(body) } : {}));
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw Object.assign(new Error(`Graph HTTP ${r.status}${j.error && j.error.code ? ', ' + j.error.code : ''}`), { status: r.status });
  }
  return r.json();
}

const _adresse = a => (a && a.emailAddress && a.emailAddress.address) || '';
const _kopf = m => ({ id: m.id, empfangen: m.receivedDateTime || '', betreff: m.subject || '', von: _adresse(m.from), antwortAn: _adresse((m.replyTo || [])[0]) });
const _postfach = z => `/users/${encodeURIComponent(z.adresse)}`;

/**
 * Alle Ordner des Postfachs mit Pfad („Posteingang/IRIS“), ID und Zahl der Mails, höchstens
 * vier Ebenen tief. Bleibt zehn Minuten im Speicher, ein Lauf des Flows fragt ihn oft.
 */
async function ordnerBaum(z, frisch) {
  const c = _baum.get(z.werk);
  if (!frisch && c && c.bis > Date.now()) return c.liste;
  const felder = '$select=id,displayName,childFolderCount,totalItemCount&$top=250';
  const liste = [];
  const ebene = async (pfad, vorne, tiefe) => {
    for (let url = pfad; url;) {
      const d = await _graph(z, url);
      for (const f of d.value || []) {
        const eintrag = { id: f.id, name: f.displayName || '', pfad: vorne + (f.displayName || ''), anzahl: f.totalItemCount || 0 };
        liste.push(eintrag);
        if (f.childFolderCount > 0 && tiefe < 4) await ebene(`${_postfach(z)}/mailFolders/${encodeURIComponent(f.id)}/childFolders?${felder}`, eintrag.pfad + '/', tiefe + 1);
      }
      url = d['@odata.nextLink'] || '';
    }
  };
  await ebene(`${_postfach(z)}/mailFolders?${felder}`, '', 1);
  _baum.set(z.werk, { liste, bis: Date.now() + 600000 });
  return liste;
}

/**
 * Ordner-ID zu einer Angabe: bekannter Name (inbox), voller Pfad oder ein eindeutiger
 * Ordnername, Groß- und Kleinschreibung egal. Sonst Fehler 404 oder 409 (mehrdeutig).
 */
async function ordnerId(z, angabe) {
  const a = String(angabe || '').trim().replace(/^\/+|\/+$/g, '');
  if (!a || BEKANNT.includes(a.toLowerCase())) return a.toLowerCase() || 'inbox';
  const klein = a.toLowerCase();
  for (const frisch of [false, true]) {
    const baum = await ordnerBaum(z, frisch);
    const pfad = baum.filter(o => o.pfad.toLowerCase() === klein);
    const name = baum.filter(o => o.name.toLowerCase() === klein);
    const treffer = pfad.length ? pfad : name;
    if (treffer.length === 1) return treffer[0].id;
    if (treffer.length > 1) throw Object.assign(new Error(`Ordner „${a}“ gibt es mehrfach, bitte mit Pfad angeben (${treffer.map(o => o.pfad).join(', ')})`), { status: 409 });
  }
  throw Object.assign(new Error(`Ordner „${a}“ nicht gefunden`), { status: 404 });
}

/** Ein Ordner und alle Ordner darunter (IDs), für Quellen wie „Vorkassen“ mit Unterordnern. */
async function ordnerMitUnterordnern(z, angabe) {
  const id = await ordnerId(z, angabe);
  const baum = await ordnerBaum(z);
  const basis = baum.find(o => o.id === id);
  if (!basis) return [id];
  return [id, ...baum.filter(o => o.pfad.toLowerCase().startsWith(basis.pfad.toLowerCase() + '/')).map(o => o.id)];
}

/** Mail in einen Ordner verschieben. Die unveränderliche ID bleibt dabei gleich. */
async function verschieben(z, id, ziel) {
  if (z.art !== 'graph') throw Object.assign(new Error('Verschieben geht nur über Graph'), { status: 400 });
  const m = await _graph(z, `${_postfach(z)}/messages/${encodeURIComponent(id)}/move`, { destinationId: await ordnerId(z, ziel) });
  return { id: m.id || id, ordner: ziel };
}

/** Rechte der App laut Token (roles), ohne den Token selbst. */
function _rollen(token) {
  try {
    const teil = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(teil, 'base64').toString('utf8')).roles || [];
  } catch { return []; }
}

/** Fehlersuche: Rechte der App und Ordner mit Anzahl, keine Mailinhalte. */
async function graphDiagnose(z) {
  const rollen = _rollen(await _anmelden(z)).sort();
  const ordner = (await ordnerBaum(z, true)).map(o => ({ pfad: o.pfad, anzahl: o.anzahl }));
  return { art: 'graph', postfach: z.adresse, rollen, ordner };
}

/**
 * Mails mit Anhängen seit `seit` (ISO, UTC), älteste zuerst, ohne Inhalt.
 * ordner: eine ID oder mehrere (Liste), sonst z.ordner.
 * geaendert: nach letzter Änderung statt Eingang filtern. Wer eine Mail später in einen Ordner
 *   zieht, ändert sie dabei, so fällt sie trotzdem ins Zeitfenster.
 * ab: Stichtag (ISO, UTC), nur Mails, die ab dann eingegangen sind. So zählt eine alte Mail nicht als
 *   neu, nur weil jemand sie zwischen Ordnern verschiebt.
 */
async function mailsSeit(z, seit, ordner, geaendert, ab) {
  if (z.art === 'ews') return ewsMailsSeit(z, seit);
  const feld = geaendert ? 'lastModifiedDateTime' : 'receivedDateTime';
  const filter = [`${feld} ge ${seit}`, ab && feld !== 'receivedDateTime' ? `receivedDateTime ge ${ab}` : '', 'hasAttachments eq true'].filter(Boolean);
  if (ab && feld === 'receivedDateTime' && ab > seit) filter[0] = `${feld} ge ${ab}`;
  const q = [
    '$filter=' + encodeURIComponent(filter.join(' and ')),
    '$orderby=' + encodeURIComponent(`${feld} asc`),
    `$select=id,receivedDateTime,lastModifiedDateTime,subject,from,replyTo`,
    '$top=50',
  ].join('&');
  const ids = [].concat(ordner || z.ordner);
  const mails = [];
  for (const id of ids) {
    let pfad = `${_postfach(z)}/mailFolders/${encodeURIComponent(id)}/messages?${q}`;
    while (pfad && mails.length < MAX_MAILS) {
      const d = await _graph(z, pfad);
      mails.push(...(d.value || []).map(m => Object.assign(_kopf(m), { _zeit: m[feld] || '' })));
      pfad = d['@odata.nextLink'] || '';
    }
  }
  mails.sort((x, y) => (x._zeit < y._zeit ? -1 : x._zeit > y._zeit ? 1 : 0));
  return mails.slice(0, MAX_MAILS).map(({ _zeit, ...m }) => m);
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
  if (z.art === 'ews') return ewsMailMitAnhaengen(z, id, istRechnungsanhang, _dateiname);
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

module.exports = { zugang, mailsSeit, mailMitAnhaengen, istRechnungsanhang, ordnerBaum, ordnerId, ordnerMitUnterordnern, verschieben, graphDiagnose, _token, _baum };
