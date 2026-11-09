'use strict';
/**
 * Postfach auf einem Exchange-Server im eigenen Haus lesen (EWS, Exchange Web Services)
 * ====================================================================================
 * Für Werke ohne Exchange Online, zuerst EIS (Gienanth). Angemeldet wird mit dem Konto des
 * Postfachs (Basic über HTTPS). Zugangsdaten nur in den App-Einstellungen der Function:
 *   POSTFACH_<WERK>_EWS       https://<server>/EWS/Exchange.asmx
 *   POSTFACH_<WERK>_BENUTZER  DOMÄNE\konto
 *   POSTFACH_<WERK>_KENNWORT  Kennwort des Kontos
 *
 * Es wird nur gelesen: FindItem, GetItem und GetAttachment ändern nichts am Postfach,
 * auch nicht den Status „gelesen“. Die Antworten haben dieselbe Form wie bei Graph
 * (src/postfach.js), der Flow merkt keinen Unterschied.
 */
const { DOMParser } = require('@xmldom/xmldom');

const ZEIT_MS = 30000;
const SEITE = 50;
const MAX_MAILS = 200;
const NS_T = 'http://schemas.microsoft.com/exchange/services/2006/types';
const NS_M = 'http://schemas.microsoft.com/exchange/services/2006/messages';

const _xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function _umschlag(inhalt) {
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" '
    + `xmlns:t="${NS_T}" xmlns:m="${NS_M}">`
    + '<soap:Header><t:RequestServerVersion Version="Exchange2013"/></soap:Header>'
    + `<soap:Body>${inhalt}</soap:Body></soap:Envelope>`;
}

async function _anfrage(z, inhalt) {
  // Windows-Kennwörter: IIS liest Basic im ANSI-Zeichensatz
  const anmeldung = Buffer.from(`${z.benutzer}:${z.kennwort}`, 'latin1').toString('base64');
  const r = await fetch(z.ews, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', Authorization: 'Basic ' + anmeldung },
    body: _umschlag(inhalt),
    signal: AbortSignal.timeout(ZEIT_MS),
  });
  const text = await r.text();
  if (r.status === 401) throw Object.assign(new Error('Anmeldung am Exchange-Server fehlgeschlagen (HTTP 401, Benutzer oder Kennwort)'), { status: 502 });
  const doc = new DOMParser({ errorHandler: { warning() {}, error() {}, fatalError() {} } }).parseFromString(text, 'text/xml');
  const msg = Array.from(doc.getElementsByTagNameNS(NS_M, '*')).find(e => e.localName.endsWith('ResponseMessage'));
  if (!r.ok || !msg) throw Object.assign(new Error(`Exchange HTTP ${r.status}`), { status: 502 });
  if (msg.getAttribute('ResponseClass') === 'Error') {
    const code = _text(msg, NS_M, 'ResponseCode');
    throw Object.assign(new Error(`Exchange ${code || 'Fehler'}`), { status: /NotFound|InvalidId|Malformed/i.test(code) ? 404 : 502 });
  }
  return doc;
}

function _kind(el, ns, name) {
  return el ? Array.from(el.getElementsByTagNameNS(ns, name))[0] || null : null;
}
function _text(el, ns, name) {
  const k = _kind(el, ns, name);
  return k ? String(k.textContent || '').trim() : '';
}
const _absender = (el, feld) => _text(_kind(el, NS_T, feld), NS_T, 'EmailAddress');

function _kopf(el) {
  return {
    id: (_kind(el, NS_T, 'ItemId') || { getAttribute: () => '' }).getAttribute('Id'),
    empfangen: _text(el, NS_T, 'DateTimeReceived'),
    betreff: _text(el, NS_T, 'Subject'),
    von: _absender(el, 'From'),
    antwortAn: _absender(el, 'ReplyTo'),
  };
}

const _eigenschaften = felder => '<t:AdditionalProperties>'
  + felder.map(f => `<t:FieldURI FieldURI="${f}"/>`).join('') + '</t:AdditionalProperties>';

/** Mails mit Anhängen seit `seit` (ISO, UTC), älteste zuerst, ohne Inhalt. */
async function ewsMailsSeit(z, seit) {
  const mails = [];
  for (let offset = 0; mails.length < MAX_MAILS; offset += SEITE) {
    const doc = await _anfrage(z, '<m:FindItem Traversal="Shallow">'
      + '<m:ItemShape><t:BaseShape>IdOnly</t:BaseShape>'
      + _eigenschaften(['item:DateTimeReceived', 'item:Subject', 'message:From', 'item:HasAttachments']) + '</m:ItemShape>'
      + `<m:IndexedPageItemView MaxEntriesReturned="${SEITE}" Offset="${offset}" BasePoint="Beginning"/>`
      + '<m:Restriction><t:And>'
      + `<t:IsGreaterThanOrEqualTo><t:FieldURI FieldURI="item:DateTimeReceived"/><t:FieldURIOrConstant><t:Constant Value="${_xml(seit)}"/></t:FieldURIOrConstant></t:IsGreaterThanOrEqualTo>`
      + '<t:IsEqualTo><t:FieldURI FieldURI="item:HasAttachments"/><t:FieldURIOrConstant><t:Constant Value="true"/></t:FieldURIOrConstant></t:IsEqualTo>'
      + '</t:And></m:Restriction>'
      + '<m:SortOrder><t:FieldOrder Order="Ascending"><t:FieldURI FieldURI="item:DateTimeReceived"/></t:FieldOrder></m:SortOrder>'
      + `<m:ParentFolderIds><t:DistinguishedFolderId Id="${_xml(z.ordner)}"/></m:ParentFolderIds>`
      + '</m:FindItem>');
    const wurzel = _kind(doc.documentElement, NS_M, 'RootFolder');
    const items = _kind(wurzel, NS_T, 'Items');
    const seite = items ? Array.from(items.childNodes).filter(n => n.nodeType === 1) : [];
    mails.push(...seite.map(_kopf));
    if (!wurzel || wurzel.getAttribute('IncludesLastItemInRange') !== 'false' || !seite.length) break;
  }
  return mails.slice(0, MAX_MAILS);
}

/** Eine Mail mit ihren PDF- und XML-Anhängen, Felder wie bei Graph. */
async function ewsMailMitAnhaengen(z, id, istRechnungsanhang, dateiname) {
  const doc = await _anfrage(z, '<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape>'
    + _eigenschaften(['item:DateTimeReceived', 'item:Subject', 'message:From', 'message:ReplyTo', 'item:Attachments'])
    + `</m:ItemShape><m:ItemIds><t:ItemId Id="${_xml(id)}"/></m:ItemIds></m:GetItem>`);
  const items = _kind(doc.documentElement, NS_M, 'Items');
  const el = items ? Array.from(items.childNodes).find(n => n.nodeType === 1) : null;
  if (!el) throw Object.assign(new Error('Exchange: Mail nicht gefunden'), { status: 404 });
  const dateien = Array.from(el.getElementsByTagNameNS(NS_T, 'FileAttachment')).map(a => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    id: (_kind(a, NS_T, 'AttachmentId') || { getAttribute: () => '' }).getAttribute('Id'),
    name: _text(a, NS_T, 'Name'),
    contentType: _text(a, NS_T, 'ContentType'),
    size: Number(_text(a, NS_T, 'Size')) || 0,
    isInline: _text(a, NS_T, 'IsInline') === 'true',
  }));
  const anhaenge = [];
  for (const a of dateien.filter(istRechnungsanhang)) {
    const d = await _anfrage(z, `<m:GetAttachment><m:AttachmentIds><t:AttachmentId Id="${_xml(a.id)}"/></m:AttachmentIds></m:GetAttachment>`);
    anhaenge.push({ name: dateiname(a), contentType: a.contentType, size: a.size, contentBytes: _text(d.documentElement, NS_T, 'Content') });
  }
  return Object.assign(_kopf(el), { id, anhaenge });
}

module.exports = { ewsMailsSeit, ewsMailMitAnhaengen };
