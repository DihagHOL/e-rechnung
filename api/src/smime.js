'use strict';
/**
 * S/MIME-signierte Mails auspacken
 * ================================
 * Bei einer S/MIME-signierten Mail liefern Graph und der Outlook-Auslöser von Power Automate nur einen
 * Anhang „smime.p7m“. Darin steckt die ganze Mail, die PDFs und XMLs liegen eine Ebene tiefer. Ohne
 * Auspacken legt der Flow nichts ab und meldet auch keinen Fehler.
 *
 *  - multipart/signed (Signatur getrennt, der Normalfall): Der erste Teil ist die signierte Mail.
 *  - application/pkcs7-mime mit signed-data (Signatur umschließt den Inhalt): Inhalt aus der
 *    CMS-Struktur (DER oder BER mit offener Länge).
 *  - enveloped-data (verschlüsselt): ohne Schlüssel nicht lesbar, Fehler 422.
 *
 * Die Signatur wird nicht geprüft, sie ändert am Inhalt nichts. Angehängte Mails (message/rfc822)
 * fallen weg, wie bei Graph. Zurück kommen nur PDF und XML, mit denselben Feldern wie im Auslöser
 * (name, contentType, contentBytes in Base64, size).
 */

const MAX_TIEFE = 12;

const _fehler = (text, status = 422) => Object.assign(new Error(text), { status });

/* ── MIME ─────────────────────────────────────────────────────────────── */

/** Kopf und Rumpf trennen; der Rumpf bleibt als latin1-Zeichenkette (Byte für Byte). */
function _teilen(roh) {
  const m = /\r?\n\r?\n/.exec(roh);
  if (!m) return { kopf: roh, rumpf: '' };
  return { kopf: roh.slice(0, m.index), rumpf: roh.slice(m.index + m[0].length) };
}

/** Kopfzeilen entfalten, Name klein, erster Wert gilt. */
function _kopfzeilen(kopf) {
  const felder = {};
  for (const zeile of kopf.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = zeile.indexOf(':');
    if (i <= 0) continue;
    const name = zeile.slice(0, i).trim().toLowerCase();
    if (!(name in felder)) felder[name] = zeile.slice(i + 1).trim();
  }
  return felder;
}

function _dekodieren(bytes, zeichensatz) {
  try { return new TextDecoder(String(zeichensatz || 'utf-8').trim().toLowerCase() || 'utf-8').decode(bytes); }
  catch { return Buffer.from(bytes).toString('latin1'); }
}

/** Rohe 8-Bit-Kopfwerte: als UTF-8 lesen, wenn das sauber geht, sonst latin1 lassen. */
function _achtBit(s) {
  if (!/[\x80-\xff]/.test(s)) return s;
  const u = Buffer.from(s, 'latin1').toString('utf8');
  return u.includes(String.fromCharCode(0xfffd)) ? s : u;   // Ersatzzeichen: kein gültiges UTF-8
}

/** RFC 2047: =?zeichensatz?B|Q?text?= */
function _wort(s) {
  return String(s).replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, '$1').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, zs, art, text) => {
    const bytes = /b/i.test(art)
      ? Buffer.from(text, 'base64')
      : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (__, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
    return _dekodieren(bytes, zs.split('*')[0]);
  });
}

/**
 * Wert und Parameter einer Kopfzeile wie Content-Type oder Content-Disposition, mit RFC 2231
 * (name*=UTF-8''..., name*0*=..., name*1=...) und RFC 2047 in Anführungszeichen.
 */
function _parameter(wert) {
  const s = String(wert || '');
  const i = s.indexOf(';');
  const haupt = (i < 0 ? s : s.slice(0, i)).trim().toLowerCase();
  const stuecke = {};
  const re = /;\s*([^=\s;]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^;]*)/g;
  let m;
  while ((m = re.exec(s))) {
    let v = m[2].trim();
    if (v.startsWith('"')) v = v.slice(1, -1).replace(/\\(.)/g, '$1');
    const k = /^([^*]+)(?:\*(\d+))?(\*)?$/.exec(m[1].toLowerCase());
    if (!k) continue;
    (stuecke[k[1]] = stuecke[k[1]] || []).push({ nr: k[2] ? Number(k[2]) : 0, erweitert: !!k[3], wert: v });
  }
  const params = {};
  for (const [name, liste] of Object.entries(stuecke)) {
    liste.sort((a, b) => a.nr - b.nr);
    let zs = '';
    const bytes = [];
    liste.forEach((st, n) => {
      let v = st.wert;
      if (st.erweitert && n === 0) {
        const z = /^([^']*)'[^']*'(.*)$/.exec(v);
        if (z) { zs = z[1]; v = z[2]; }
      }
      if (st.erweitert) {
        const roh = v.replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
        bytes.push(...Buffer.from(roh, 'latin1'));
      } else {
        bytes.push(...Buffer.from(_achtBit(_wort(v)), 'utf8'));
      }
    });
    params[name] = liste.some(st => st.erweitert) ? _dekodieren(Uint8Array.from(bytes), zs || 'utf-8') : Buffer.from(bytes).toString('utf8');
  }
  return { wert: haupt, params };
}

function _rumpfBytes(rumpf, kodierung) {
  const k = String(kodierung || '').trim().toLowerCase();
  if (k === 'base64') return Buffer.from(rumpf.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (k === 'quoted-printable') {
    return Buffer.from(rumpf.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
  }
  return Buffer.from(rumpf, 'latin1');
}

/** Teile eines multipart-Rumpfs zwischen den Grenzen, ohne Vor- und Nachspann. */
function _teile(rumpf, grenze) {
  const esc = grenze.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\r?\\n)--${esc}(--)?[ \\t]*(?=\\r?\\n|$)`, 'g');
  const stellen = [];
  let m;
  while ((m = re.exec(rumpf))) stellen.push({ start: m.index, ende: m.index + m[0].length, schluss: !!m[1] });
  const teile = [];
  for (let i = 0; i < stellen.length - 1; i++) {
    if (stellen[i].schluss) break;
    teile.push(rumpf.slice(stellen[i].ende, stellen[i + 1].start).replace(/^\r?\n/, ''));
  }
  return teile;
}

/* ── CMS (PKCS #7) ────────────────────────────────────────────────────── */

const OID = {
  signedData: '2a864886f70d010702',
  envelopedData: '2a864886f70d010703',
  authEnvelopedData: '2a864886f70d0109100117',
};

/** Ein BER/DER-Element ab pos: Tag, konstruiert, Inhalt [start, ende), nächstes Element bei weiter. */
function _element(buf, pos) {
  if (pos + 2 > buf.length) throw _fehler('S/MIME: CMS-Struktur endet zu früh');
  const tag = buf[pos];
  let p = pos + 1;
  if ((tag & 0x1f) === 0x1f) { while (buf[p] & 0x80) p++; p++; }   // lange Tagnummer
  const l = buf[p++];
  const konstruiert = !!(tag & 0x20);
  if (l === 0x80) {   // offene Länge (BER): Kinder bis 00 00
    if (!konstruiert) throw _fehler('S/MIME: offene Länge bei einfachem Element');
    let q = p;
    while (!(buf[q] === 0 && buf[q + 1] === 0)) q = _element(buf, q).weiter;
    return { tag, konstruiert, start: p, ende: q, weiter: q + 2 };
  }
  let laenge = l;
  if (l & 0x80) {
    laenge = 0;
    for (let n = l & 0x7f; n > 0; n--) laenge = laenge * 256 + buf[p++];
  }
  if (p + laenge > buf.length) throw _fehler('S/MIME: CMS-Länge passt nicht');
  return { tag, konstruiert, start: p, ende: p + laenge, weiter: p + laenge };
}

function _kinder(buf, el) {
  const liste = [];
  for (let p = el.start; p < el.ende;) { const k = _element(buf, p); liste.push(k); p = k.weiter; }
  return liste;
}

/** OCTET STRING, auch in Stücken (BER, konstruiert). */
function _oktette(buf, el) {
  if (!el.konstruiert) return buf.subarray(el.start, el.ende);
  return Buffer.concat(_kinder(buf, el).map(k => _oktette(buf, k)));
}

/** Eingebetteter Inhalt einer CMS-SignedData; verschlüsselt oder unbekannt: Fehler. */
function _cmsInhalt(buf) {
  const info = _element(buf, 0);
  const [oid, huelle] = _kinder(buf, info);
  const art = oid && oid.tag === 0x06 ? buf.subarray(oid.start, oid.ende).toString('hex') : '';
  if (art === OID.envelopedData || art === OID.authEnvelopedData) {
    throw _fehler('S/MIME: Die Mail ist verschlüsselt und lässt sich ohne Schlüssel nicht öffnen. Bitte den Absender um eine unverschlüsselte Rechnung.');
  }
  if (art !== OID.signedData || !huelle) throw _fehler('S/MIME: unbekannter CMS-Inhalt');
  const signed = _kinder(buf, huelle)[0];
  const encap = _kinder(buf, signed).find(k => k.tag === 0x30);   // version, digestAlgorithms (SET), encapContentInfo
  const [, inhaltHuelle] = _kinder(buf, encap);
  if (!inhaltHuelle) throw _fehler('S/MIME: signiert ohne eingebetteten Inhalt (Signatur getrennt, Inhalt fehlt)');
  return _oktette(buf, _kinder(buf, inhaltHuelle)[0]);
}

/* ── Auspacken ────────────────────────────────────────────────────────── */

const _istSmime = (name, typ) => /\.p7m$/i.test(name || '') || /^(multipart\/signed|application\/(x-)?pkcs7-mime)\b/i.test(typ || '');
const _istRechnung = (name, typ) => /\.(pdf|xml)$/i.test(name || '') || /\/(pdf|xml)\b/i.test(typ || '');

function _typNachName(name, typ) {
  const t = String(typ || '').toLowerCase();
  if (t && t !== 'application/octet-stream') return t;
  if (/\.pdf$/i.test(name)) return 'application/pdf';
  if (/\.xml$/i.test(name)) return 'application/xml';
  return t || 'application/octet-stream';
}

/** Eine MIME-Einheit (latin1-Zeichenkette) rekursiv durchgehen und Dateien sammeln. */
function _einheit(roh, dateien, tiefe) {
  if (tiefe > MAX_TIEFE) throw _fehler('S/MIME: zu tief verschachtelt');
  const { kopf, rumpf } = _teilen(roh);
  const k = _kopfzeilen(kopf);
  const ct = _parameter(k['content-type'] || 'text/plain');
  const cd = _parameter(k['content-disposition'] || '');
  if (ct.wert.startsWith('multipart/')) {
    if (!ct.params.boundary) return;
    const teile = _teile(rumpf, ct.params.boundary);
    // multipart/signed: nur der signierte Inhalt, nicht die Signatur
    for (const t of ct.wert === 'multipart/signed' ? teile.slice(0, 1) : teile) _einheit(t, dateien, tiefe + 1);
    return;
  }
  if (ct.wert === 'message/rfc822') return;
  const bytes = _rumpfBytes(rumpf, k['content-transfer-encoding']);
  const name = (cd.params.filename || ct.params.name || '').trim();
  if (_istSmime(name, ct.wert) && !ct.wert.startsWith('multipart/')) { _binaer(bytes, dateien, tiefe + 1); return; }
  if (!name && !/\/(pdf|xml)\b/i.test(ct.wert)) return;   // Mailtext ohne Dateiname
  dateien.push({ name: name || (ct.wert.endsWith('pdf') ? 'Anhang.pdf' : 'Anhang.xml'), contentType: _typNachName(name, ct.wert), inhalt: bytes });
}

/** Inhalt eines smime.p7m: MIME (mit Kopf), CMS (DER/BER) oder Base64 davon. */
function _binaer(buf, dateien, tiefe) {
  if (tiefe > MAX_TIEFE) throw _fehler('S/MIME: zu tief verschachtelt');
  if (buf[0] === 0x30) { _einheit(_cmsInhalt(buf).toString('latin1'), dateien, tiefe + 1); return; }
  const anfang = buf.subarray(0, 4096).toString('latin1');
  if (/^\s*[A-Za-z][A-Za-z0-9-]*:/m.test(anfang.split(/\r?\n\r?\n/)[0])) { _einheit(buf.toString('latin1'), dateien, tiefe + 1); return; }
  if (/^[A-Za-z0-9+/=\s]+$/.test(anfang)) { _binaer(Buffer.from(buf.toString('latin1').replace(/\s+/g, ''), 'base64'), dateien, tiefe + 1); return; }
  throw _fehler('S/MIME: Inhalt nicht erkannt');
}

/** Ein smime.p7m (Bytes) auspacken: Liste der enthaltenen PDF- und XML-Dateien. */
function smimeDateien(buf) {
  const dateien = [];
  _binaer(Buffer.from(buf), dateien, 0);
  return dateien.filter(d => _istRechnung(d.name, d.contentType));
}

/**
 * Anhänge wie im Auslöser durchgehen: S/MIME-Anhänge durch die PDFs und XMLs darin ersetzen,
 * alle anderen unverändert lassen. Gibt { anhaenge, ausgepackt } zurück.
 */
function smimeAnhaenge(anhaenge) {
  if (!Array.isArray(anhaenge)) throw _fehler('anhaenge fehlt', 400);
  const raus = [];
  let ausgepackt = 0;
  for (const a of anhaenge) {
    const name = a && (a.name || a.Name);
    const typ = a && (a.contentType || a.ContentType);
    if (!a || !_istSmime(name, typ)) { raus.push(a); continue; }
    const inhalt = Buffer.from(String(a.contentBytes || a.ContentBytes || ''), 'base64');
    for (const d of smimeDateien(inhalt)) {
      raus.push({ name: d.name, contentType: d.contentType, size: d.inhalt.length, isInline: false, contentBytes: d.inhalt.toString('base64') });
    }
    ausgepackt++;
  }
  return { anhaenge: raus, ausgepackt };
}

module.exports = { smimeAnhaenge, smimeDateien, _parameter, _wort, _istSmime };
