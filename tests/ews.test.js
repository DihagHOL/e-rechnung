// node tests/ews.test.js
// api/src/ews.js über api/src/postfach.js: Postfach auf einem Exchange im eigenen Haus lesen (EWS), fetch ist ersetzt.
const assert = require('assert');
const P = require('../api/src/postfach');

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };

Object.assign(process.env, {
  POSTFACH_EWT_EWS: 'https://mail.beispiel.example/EWS/Exchange.asmx',
  POSTFACH_EWT_BENUTZER: 'beispiel\\rechnung',
  POSTFACH_EWT_KENNWORT: 'geheim',
});

const umschlag = body => `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${body}</s:Body></s:Envelope>`;
const T = 'xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"';
const M = 'xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"';
const mail = (id, zeit, betreff, von) => `<t:Message><t:ItemId Id="${id}" ChangeKey="CK"/><t:Subject>${betreff}</t:Subject><t:DateTimeReceived>${zeit}</t:DateTimeReceived>`
  + `<t:HasAttachments>true</t:HasAttachments><t:From><t:Mailbox><t:Name>X</t:Name><t:EmailAddress>${von}</t:EmailAddress></t:Mailbox></t:From></t:Message>`;
const find = (items, letzte, offset) => umschlag(`<m:FindItemResponse ${M} ${T}><m:ResponseMessages><m:FindItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode>`
  + `<m:RootFolder IndexedPagingOffset="${offset}" TotalItemsInView="51" IncludesLastItemInRange="${letzte}"><t:Items>${items}</t:Items></m:RootFolder></m:FindItemResponseMessage></m:ResponseMessages></m:FindItemResponse>`);

const anfragen = [];
global.fetch = async (url, opt) => {
  const body = String(opt.body);
  anfragen.push({ url, opt, body });
  const ok = text => ({ ok: true, status: 200, text: async () => text });
  if (opt.headers.Authorization !== 'Basic ' + Buffer.from('beispiel\\rechnung:geheim').toString('base64')) return { ok: false, status: 401, text: async () => '' };
  if (/<m:FindItem /.test(body)) {
    return /Offset="0"/.test(body)
      ? ok(find(mail('AAA+1/=', '2026-11-08T07:00:00Z', 'Rechnung 1', 'buha@lieferant.example'), 'false', 50))
      : ok(find(mail('AAA+2/=', '2026-11-09T07:00:00Z', 'Rechnung 2 &amp; Lieferschein', 'b@x.example'), 'true', 51));
  }
  if (/<m:GetItem>/.test(body)) {
    if (/Id="FEHLT"/.test(body)) {
      return ok(umschlag(`<m:GetItemResponse ${M} ${T}><m:ResponseMessages><m:GetItemResponseMessage ResponseClass="Error"><m:MessageText>x</m:MessageText><m:ResponseCode>ErrorItemNotFound</m:ResponseCode></m:GetItemResponseMessage></m:ResponseMessages></m:GetItemResponse>`));
    }
    return ok(umschlag(`<m:GetItemResponse ${M} ${T}><m:ResponseMessages><m:GetItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode><m:Items>`
      + `<t:Message><t:ItemId Id="AAA+1/=" ChangeKey="CK"/><t:Subject>Rechnung 1</t:Subject><t:DateTimeReceived>2026-11-08T07:00:00Z</t:DateTimeReceived>`
      + '<t:From><t:Mailbox><t:EmailAddress>buha@lieferant.example</t:EmailAddress></t:Mailbox></t:From>'
      + '<t:ReplyTo><t:Mailbox><t:EmailAddress>rechnung@lieferant.example</t:EmailAddress></t:Mailbox></t:ReplyTo><t:Attachments>'
      + '<t:FileAttachment><t:AttachmentId Id="AT1"/><t:Name>RE 4711.pdf</t:Name><t:ContentType>application/pdf</t:ContentType><t:Size>10</t:Size><t:IsInline>false</t:IsInline></t:FileAttachment>'
      + '<t:FileAttachment><t:AttachmentId Id="AT2"/><t:Name>image001.png</t:Name><t:ContentType>image/png</t:ContentType><t:Size>5</t:Size><t:IsInline>true</t:IsInline></t:FileAttachment>'
      + '<t:ItemAttachment><t:AttachmentId Id="AT3"/><t:Name>Weitergeleitet</t:Name></t:ItemAttachment>'
      + '<t:FileAttachment><t:AttachmentId Id="AT4"/><t:Name>factur-x</t:Name><t:ContentType>text/xml</t:ContentType><t:Size>7</t:Size><t:IsInline>false</t:IsInline></t:FileAttachment>'
      + '</t:Attachments></t:Message></m:Items></m:GetItemResponseMessage></m:ResponseMessages></m:GetItemResponse>'));
  }
  if (/<m:GetAttachment>/.test(body)) {
    const id = /AttachmentId Id="([^"]+)"/.exec(body)[1];
    return ok(umschlag(`<m:GetAttachmentResponse ${M} ${T}><m:ResponseMessages><m:GetAttachmentResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode>`
      + `<m:Attachments><t:FileAttachment><t:AttachmentId Id="${id}"/><t:Content>${id === 'AT1' ? 'UERG' : 'WE1M'}</t:Content></t:FileAttachment></m:Attachments></m:GetAttachmentResponseMessage></m:ResponseMessages></m:GetAttachmentResponse>`));
  }
  throw new Error('unerwartet: ' + body.slice(0, 200));
};

(async () => {
  const z = P.zugang('EWT');
  gleich([z.art, z.ordner, z.adresse], ['ews', 'inbox', 'beispiel\\rechnung'], 'EWS erkannt');
  process.env.POSTFACH_EWU_EWS = 'http://unsicher.example/EWS/Exchange.asmx';
  process.env.POSTFACH_EWU_BENUTZER = 'x'; process.env.POSTFACH_EWU_KENNWORT = 'y';
  gleich(P.zugang('EWU'), null, 'nur über HTTPS');

  const mails = await P.mailsSeit(z, '2026-11-07T00:00:00Z');
  gleich(mails, [
    { id: 'AAA+1/=', empfangen: '2026-11-08T07:00:00Z', betreff: 'Rechnung 1', von: 'buha@lieferant.example', antwortAn: '' },
    { id: 'AAA+2/=', empfangen: '2026-11-09T07:00:00Z', betreff: 'Rechnung 2 & Lieferschein', von: 'b@x.example', antwortAn: '' },
  ], 'zwei Seiten, älteste zuerst');
  const f = anfragen[0].body;
  gleich([/Constant Value="2026-11-07T00:00:00Z"/.test(f), /item:HasAttachments/.test(f), /Order="Ascending"/.test(f), /DistinguishedFolderId Id="inbox"/.test(f), anfragen[0].url],
    [true, true, true, true, 'https://mail.beispiel.example/EWS/Exchange.asmx'], 'Abfrage');

  const m = await P.mailMitAnhaengen(z, 'AAA+1/=');
  gleich(m.anhaenge.map(a => [a.name, a.contentBytes]), [['RE 4711.pdf', 'UERG'], ['factur-x.xml', 'WE1M']], 'nur PDF und XML, Endung ergänzt');
  gleich([m.id, m.von, m.antwortAn], ['AAA+1/=', 'buha@lieferant.example', 'rechnung@lieferant.example'], 'Kopf mit Antwortadresse');

  // Nur lesende Operationen
  const ops = [...new Set(anfragen.map(a => (/<m:(\w+)[ >]/.exec(a.body) || [])[1]))];
  gleich(ops, ['FindItem', 'GetItem', 'GetAttachment'], 'nur FindItem, GetItem, GetAttachment');

  await assert.rejects(P.mailMitAnhaengen(z, 'FEHLT'), e => e.status === 404 && /ErrorItemNotFound/.test(e.message));
  n++;
  process.env.POSTFACH_EWT_KENNWORT = 'falsch';
  await assert.rejects(P.mailsSeit(P.zugang('EWT'), '2026-11-07T00:00:00Z'), e => /401/.test(e.message) && !/falsch|geheim/.test(e.message));
  n++;

  // Diagnose: ausgehende IP, je Server-IP eine Anfrage ohne Anmeldung (dns und https ersetzt)
  const dns = require('dns'), https = require('https'), { EventEmitter } = require('events');
  const ohne = [];
  dns.promises.resolve4 = async host => (host === 'mail.beispiel.example' ? ['192.0.2.1', '192.0.2.2'] : []);
  https.request = (opt, cb) => {
    ohne.push(opt);
    const req = new EventEmitter();
    req.end = () => {
      const r = new EventEmitter();
      Object.assign(r, { statusCode: opt.host === '192.0.2.1' ? 401 : 403, headers: { server: opt.host === '192.0.2.1' ? 'Microsoft-IIS/8.5' : 'nginx' }, resume() {} });
      cb(r); r.emit('end');
    };
    return req;
  };
  global.fetch = async url => ({ text: async () => (/cdn-cgi\/trace$/.test(url) ? 'fl=1\nip=198.51.100.7\nloc=DE\n' : '') });
  const d = await require('../api/src/ews').ewsDiagnose(P.zugang('EWT'));
  gleich(d, { ausgehendeIp: '198.51.100.7', land: 'DE', server: [
    { ip: '192.0.2.1', status: 401, server: 'Microsoft-IIS/8.5' }, { ip: '192.0.2.2', status: 403, server: 'nginx' }] }, 'Diagnose');
  gleich(ohne.map(o => [o.servername, o.headers.Host, o.path, o.headers.Authorization]),
    [['mail.beispiel.example', 'mail.beispiel.example', '/EWS/Exchange.asmx', undefined], ['mail.beispiel.example', 'mail.beispiel.example', '/EWS/Exchange.asmx', undefined]], 'Diagnose ohne Anmeldung, SNI und Host');

  console.log(`ews: ${n} Prüfungen grün`);
})().catch(e => { console.error(e); process.exit(1); });
