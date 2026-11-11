// node tests/smime.test.js
// api/src/smime.js: S/MIME-signierte Mails auspacken (smime.p7m), nur mit erfundenen Daten.
const assert = require('assert');
const S = require('../api/src/smime');

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };
const b64 = s => Buffer.from(s, 'latin1').toString('base64');
const zeilen = (...z) => z.join('\r\n');
const PDF1 = '%PDF-1.4 Rechnung eins';
const PDF2 = '%PDF-1.7 Rechnung zwei mit Umlaut';
const XML = '<?xml version="1.0"?><rsm:CrossIndustryInvoice/>';

// Signierte Mail wie in Outlook: multipart/signed > mixed > alternative/related + Anhänge, Signatur am Ende
const innen = zeilen(
  'Content-Type: multipart/mixed; boundary="----=_Teil_1"',
  'MIME-Version: 1.0',
  '',
  'Vorspann wird ignoriert',
  '------=_Teil_1',
  'Content-Type: multipart/alternative; boundary="----=_Teil_2"',
  '',
  '------=_Teil_2',
  'Content-Type: text/plain; charset="UTF-8"',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Sehr geehrte Damen und Herren, anbei die Rechnung. Gr=C3=BC=C3=9Fe',
  '------=_Teil_2',
  'Content-Type: text/html; charset="us-ascii"',
  '',
  '<p>Rechnung</p>',
  '------=_Teil_2--',
  '------=_Teil_1',
  'Content-Type: application/octet-stream; name="RE 4711.pdf"',
  'Content-Transfer-Encoding: base64',
  'Content-Disposition: attachment; filename="RE 4711.pdf"',
  '',
  b64(PDF1).replace(/(.{20})/g, '$1\r\n'),
  '------=_Teil_1',
  'Content-Type: application/pdf;',
  ' name="=?UTF-8?B?' + Buffer.from('Rechnung Müller.pdf').toString('base64') + '?="',
  'Content-Transfer-Encoding: base64',
  "Content-Disposition: attachment; filename*=UTF-8''Rechnung%20M%C3%BCller.pdf",
  '',
  b64(PDF2),
  '------=_Teil_1',
  'Content-Type: text/xml; charset=utf-8',
  'Content-Disposition: attachment;',
  " filename*0*=UTF-8''factur-;",
  ' filename*1="x.xml"',
  '',
  XML,
  '------=_Teil_1',
  'Content-Type: image/png; name="logo.png"',
  'Content-Transfer-Encoding: base64',
  'Content-Disposition: inline; filename="logo.png"',
  '',
  'iVBORw0KGgo=',
  '------=_Teil_1',
  'Content-Type: message/rfc822',
  '',
  'Subject: Weitergeleitet',
  'Content-Type: application/pdf; name="alt.pdf"',
  '',
  '%PDF-alt',
  '------=_Teil_1--',
  '');
const signiert = zeilen(
  'Content-Type: multipart/signed; protocol="application/pkcs7-signature"; micalg="sha-256"; boundary="----SIG"',
  '',
  '------SIG',
  innen,
  '------SIG',
  'Content-Type: application/pkcs7-signature; name="smime.p7s"',
  'Content-Transfer-Encoding: base64',
  'Content-Disposition: attachment; filename="smime.p7s"',
  '',
  'MIAGCSqGSIb3DQEHAqCAMIACAQExDzANBglghkgBZQMEAgEFADCABgkqhkiG9w0BBwEAAA==',
  '------SIG--',
  '');

const inhalt = r => r.anhaenge.map(a => [a.name, a.contentType, Buffer.from(a.contentBytes || '', 'base64').toString(a.contentBytes ? 'utf8' : 'latin1')]);

(async () => {
  // 1) multipart/signed wie aus Graph und dem Outlook-Auslöser
  let r = S.smimeAnhaenge([
    { name: 'smime.p7m', contentType: 'multipart/signed', contentBytes: b64(signiert) },
    { name: 'Lieferschein.pdf', contentType: 'application/pdf', contentBytes: b64('%PDF-LS') },
  ]);
  gleich(r.ausgepackt, 1, 'ein S/MIME-Anhang');
  gleich(inhalt(r), [
    ['RE 4711.pdf', 'application/pdf', PDF1],
    ['Rechnung Müller.pdf', 'application/pdf', PDF2],
    ['factur-x.xml', 'text/xml', XML],
    ['Lieferschein.pdf', 'application/pdf', '%PDF-LS'],
  ], 'PDFs und XML aus der Mail, Name nach RFC 2231 und 2047, Logo, Mailtext, angehängte Mail und Signatur fallen weg');
  gleich(r.anhaenge.slice(0, 3).map(a => [a.size, a.isInline]), [[PDF1.length, false], [Buffer.byteLength(PDF2), false], [XML.length, false]], 'Größe und Felder wie im Auslöser');

  // 2) Name nur am Content-Type, Endung fehlt nicht; Anhänge ohne S/MIME bleiben unverändert
  const ohne = { name: 'RE 1.pdf', contentType: 'application/pdf', contentBytes: b64('%PDF') };
  r = S.smimeAnhaenge([ohne]);
  gleich([r.ausgepackt, r.anhaenge[0] === ohne], [0, true], 'normale Mail unverändert');

  // 3) CMS signed-data mit eingebettetem Inhalt (DER), so wie application/pkcs7-mime
  const tlv = (tag, ...inhalte) => {
    const b = Buffer.concat(inhalte.map(x => Buffer.isBuffer(x) ? x : Buffer.from(x)));
    const l = b.length < 128 ? Buffer.from([b.length]) : b.length < 256 ? Buffer.from([0x81, b.length]) : Buffer.from([0x82, b.length >> 8, b.length & 255]);
    return Buffer.concat([Buffer.from([tag]), l, b]);
  };
  const oid = hex => tlv(0x06, Buffer.from(hex, 'hex'));
  const mimeKlein = zeilen('Content-Type: multipart/mixed; boundary="B"', '', '--B', 'Content-Type: text/plain', '', 'Hallo',
    '--B', 'Content-Type: application/pdf; name="CMS.pdf"', 'Content-Transfer-Encoding: base64', '', b64('%PDF-cms'), '--B--', '');
  const cms = eContent => tlv(0x30, oid('2a864886f70d010702'), tlv(0xa0,
    tlv(0x30, tlv(0x02, [1]), tlv(0x31, tlv(0x30, oid('608648016503040201'))), tlv(0x30, oid('2a864886f70d010701'), tlv(0xa0, eContent)), tlv(0x31))));
  const der = cms(tlv(0x04, Buffer.from(mimeKlein, 'latin1')));
  r = S.smimeAnhaenge([{ name: 'smime.p7m', contentType: 'application/pkcs7-mime', contentBytes: der.toString('base64') }]);
  gleich(inhalt(r), [['CMS.pdf', 'application/pdf', '%PDF-cms']], 'CMS signed-data (DER)');

  // 4) dasselbe mit offener Länge und gestückeltem OCTET STRING (BER)
  const offen = (tag, ...inh) => Buffer.concat([Buffer.from([tag, 0x80]), ...inh, Buffer.from([0, 0])]);
  const mb = Buffer.from(mimeKlein, 'latin1');
  const ber = offen(0x30, oid('2a864886f70d010702'), offen(0xa0, offen(0x30, tlv(0x02, [1]), tlv(0x31), offen(0x30, oid('2a864886f70d010701'),
    offen(0xa0, offen(0x24, tlv(0x04, mb.subarray(0, 40)), tlv(0x04, mb.subarray(40))))), tlv(0x31))));
  r = S.smimeAnhaenge([{ name: 'smime.p7m', contentType: 'application/pkcs7-mime', contentBytes: ber.toString('base64') }]);
  gleich(inhalt(r), [['CMS.pdf', 'application/pdf', '%PDF-cms']], 'CMS mit offener Länge (BER)');

  // 5) p7m als Base64-Text (manche Programme) und S/MIME in der Mail (application/pkcs7-mime als MIME-Teil)
  r = S.smimeAnhaenge([{ name: 'smime.p7m', contentType: 'application/octet-stream', contentBytes: b64(der.toString('base64').replace(/(.{64})/g, '$1\r\n')) }]);
  gleich(inhalt(r).map(x => x[0]), ['CMS.pdf'], 'Base64-Text eines CMS');
  const alsTeil = zeilen('Content-Type: application/pkcs7-mime; smime-type=signed-data; name="smime.p7m"', 'Content-Transfer-Encoding: base64', '', der.toString('base64'), '');
  r = S.smimeAnhaenge([{ name: 'smime.p7m', contentType: 'application/pkcs7-mime', contentBytes: b64(alsTeil) }]);
  gleich(inhalt(r).map(x => x[0]), ['CMS.pdf'], 'pkcs7-mime als MIME-Teil');

  // 6) verschlüsselt: Fehler mit verständlichem Text
  const verschl = tlv(0x30, oid('2a864886f70d010703'), tlv(0xa0, tlv(0x30, tlv(0x02, [0]))));
  assert.throws(() => S.smimeAnhaenge([{ name: 'smime.p7m', contentType: 'application/pkcs7-mime', contentBytes: verschl.toString('base64') }]),
    e => e.status === 422 && /verschlüsselt/.test(e.message));
  n++;
  assert.throws(() => S.smimeAnhaenge('kein Array'), e => e.status === 400);
  n++;
  assert.throws(() => S.smimeAnhaenge([{ name: 'smime.p7m', contentBytes: b64('\u0000\u0001 Unsinn') }]), e => e.status === 422);
  n++;

  // 7) Hilfen
  gleich(S._wort('=?ISO-8859-1?Q?Gr=FC=DFe_aus?= =?UTF-8?B?' + Buffer.from(' Köln').toString('base64') + '?='), 'Grüße aus Köln', 'RFC 2047 über zwei Wörter');
  gleich([S._istSmime('smime.p7m', ''), S._istSmime('x', 'multipart/signed'), S._istSmime('RE.pdf', 'application/pdf')], [true, true, false], 'S/MIME erkennen');

  console.log(`smime: ${n} Prüfungen grün`);
})().catch(e => { console.error(e); process.exit(1); });
