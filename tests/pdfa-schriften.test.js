// node tests/pdfa-schriften.test.js
// js/zugferd.js: nicht eingebettete Helvetica (SAP-Adobe-Formulare) wird beim Einbetten der XML
// durch Liberation Sans mit gleichen Laufweiten ersetzt (PDF/A-3 §6.2.11.4.1 und §6.2.11.5).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const PDFLib = require(path.join(ROOT, 'api/node_modules/pdf-lib'));
const fontkit = require(path.join(ROOT, 'api/node_modules/@pdf-lib/fontkit'));
const EMBED_FONTS = require(path.join(ROOT, 'js/vendor/font-embed.js'));
const HELV = require(path.join(ROOT, 'js/vendor/font-helvetica.js'));
const { PDFName, PDFDict } = PDFLib;

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };

// Im Host-Realm laden wie validation/generate-samples.js (pdf-lib prüft mit instanceof)
function laden(ersatz) {
  const src = fs.readFileSync(path.join(ROOT, 'js/zugferd.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  return new Function('PDFLib', 'fontkit', 'HELVETICA_ERSATZ', 'console', 'atob', 'TextEncoder',
    `${src}\n;return { embedXMLIntoPDF, _standardSchriftenEinbetten };`)(
    PDFLib, fontkit, ersatz, { warn() {}, log() {} }, globalThis.atob, globalThis.TextEncoder);
}
const mit = laden(HELV);
const ohne = laden(undefined);
const XML = '<?xml version="1.0" encoding="UTF-8"?><rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"/>';
const TEXT = 'Rechnung Nr. 91000001 Größe Übergabe äöüß ÄÖÜ 1.234,56 € (19 %) -/:';

async function erpPdf(schriften) {
  const doc = await PDFLib.PDFDocument.create();
  const s = doc.addPage([595, 842]);
  let y = 800;
  for (const sf of schriften) {
    s.drawText(TEXT, { x: 40, y, size: 9, font: await doc.embedFont(sf) });
    y -= 20;
  }
  return doc.save();
}

function schriften(doc) {
  const aus = [];
  for (const [, o] of doc.context.enumerateIndirectObjects()) {
    if (o instanceof PDFDict && String(o.get(PDFName.of('Type'))) === '/Font') aus.push(o);
  }
  return aus;
}
const N = (d, k) => { const v = d.lookup(PDFName.of(k)); return v === undefined ? undefined : String(v); };

// PDF-WinAnsiEncoding wie beim Bauen der Vendor-Datei: 0xA0 space, 0xAD hyphen, unbelegt bullet
const winAnsi = c => (c === 0xA0 ? 0x20 : c === 0xAD ? 0x2D : [0x7F, 0x81, 0x8D, 0x8F, 0x90, 0x9D].includes(c) ? 0x2022
  : new TextDecoder('windows-1252').decode(Uint8Array.of(c)).codePointAt(0));

(async () => {
  // 1) Original wie aus SAP: Helvetica und Helvetica-Bold, Type1, WinAnsi, nicht eingebettet
  const roh = await erpPdf([PDFLib.StandardFonts.Helvetica, PDFLib.StandardFonts.HelveticaBold]);
  const vorher = schriften(await PDFLib.PDFDocument.load(roh));
  gleich(vorher.map(f => [N(f, 'Subtype'), N(f, 'BaseFont'), N(f, 'Encoding'), N(f, 'FontDescriptor')]),
    [['/Type1', '/Helvetica', '/WinAnsiEncoding', undefined], ['/Type1', '/Helvetica-Bold', '/WinAnsiEncoding', undefined]],
    'Ausgangslage wie SAP-Adobe-Formular');

  const fertig = await PDFLib.PDFDocument.load(await mit.embedXMLIntoPDF(roh, XML, 'zugferd'));
  const nachher = schriften(fertig);
  gleich(nachher.map(f => [N(f, 'Subtype'), N(f, 'BaseFont'), N(f, 'Encoding'), N(f, 'FirstChar'), N(f, 'LastChar')]),
    [['/TrueType', '/LiberationSans', '/WinAnsiEncoding', '32', '255'], ['/TrueType', '/LiberationSans-Bold', '/WinAnsiEncoding', '32', '255']],
    'Schriften ersetzt');

  for (const f of nachher) {
    const schnitt = N(f, 'BaseFont') === '/LiberationSans' ? 'regular' : 'bold';
    const fd = f.lookup(PDFName.of('FontDescriptor'));
    gleich([N(fd, 'Type'), N(fd, 'FontName'), N(fd, 'Flags')], ['/FontDescriptor', N(f, 'BaseFont'), '32'], `Beschreibung ${schnitt}`);
    const datei = fd.lookup(PDFName.of('FontFile2'));
    gleich(!!datei, true, `Schrift ${schnitt} eingebettet`);

    // 2) Breiten passen zur eingebetteten Schrift (§6.2.11.5), Code für Code
    const prog = fontkit.create(Buffer.from(zlib.inflateSync(Buffer.from(datei.getContents()))));
    gleich(!!prog.characterSet && prog.characterSet.includes(0x20AC), true, `cmap mit Euro (${schnitt})`);
    const breiten = f.lookup(PDFName.of('Widths')).asArray().map(x => x.asNumber());
    gleich(breiten.length, 224, `Breiten für 32 bis 255 (${schnitt})`);
    const falsch = [];
    for (let c = 32; c < 256; c++) {
      const w = Math.round(prog.glyphForCodePoint(winAnsi(c)).advanceWidth * 1000 / prog.unitsPerEm);
      if (Math.abs(w - breiten[c - 32]) > 1) falsch.push(c.toString(16));
    }
    gleich(falsch, [], `Breiten = Schriftprogramm (${schnitt})`);

    // 3) Laufweiten wie Helvetica: Layout des Originals bleibt
    const helv = await (await PDFLib.PDFDocument.create()).embedFont(
      schnitt === 'regular' ? PDFLib.StandardFonts.Helvetica : PDFLib.StandardFonts.HelveticaBold);
    const code = ch => { for (let c = 32; c < 256; c++) if (winAnsi(c) === ch.codePointAt(0)) return c; return -1; };
    const abw = [...new Set(TEXT + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')]
      .filter(ch => helv.widthOfTextAtSize(ch, 1000) !== breiten[code(ch) - 32]);
    gleich(abw, [], `gleiche Laufweiten wie Helvetica (${schnitt})`);
  }
  // ein Schriftprogramm je Schnitt, auch wenn mehrere Schriften darauf zeigen
  const programme = new Set(nachher.map(f => f.lookup(PDFName.of('FontDescriptor')).get(PDFName.of('FontFile2')).toString()));
  gleich(programme.size, 2, 'je Schnitt ein Schriftprogramm');

  // 4) Ohne Vendor-Datei (z. B. Prüfdienst in der Function) bleibt alles, wie es war
  const unveraendert = schriften(await PDFLib.PDFDocument.load(await ohne.embedXMLIntoPDF(roh, XML, 'zugferd')));
  gleich(unveraendert.map(f => N(f, 'Subtype') + N(f, 'BaseFont')), ['/Type1/Helvetica', '/Type1/Helvetica-Bold'], 'ohne Ersatzschrift');

  // 5) Kursiv und andere Standardschriften bleiben (dann greift die veraPDF-Prüfung im Konverter)
  const kursiv = schriften(await PDFLib.PDFDocument.load(await mit.embedXMLIntoPDF(
    await erpPdf([PDFLib.StandardFonts.HelveticaOblique, PDFLib.StandardFonts.TimesRoman]), XML, 'zugferd')));
  gleich(kursiv.map(f => N(f, 'Subtype') + N(f, 'BaseFont')), ['/Type1/Helvetica-Oblique', '/Type1/Times-Roman'], 'kursiv und Times unverändert');

  // 6) Schon eingebettete Schrift (PDF aus Daten, DejaVu) bleibt unangetastet
  const doc = await PDFLib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  const dv = await doc.embedFont(Buffer.from(EMBED_FONTS.regular, 'base64'), { subset: true });
  doc.addPage([595, 842]).drawText(TEXT, { x: 40, y: 800, size: 9, font: dv });
  const ausDaten = await doc.save();
  const zaehlen = async b => schriften(await PDFLib.PDFDocument.load(b)).map(f => N(f, 'Subtype') + N(f, 'BaseFont'));
  gleich(await zaehlen(await mit.embedXMLIntoPDF(ausDaten, XML, 'zugferd')), await zaehlen(ausDaten), 'eingebettete Schrift unverändert');

  // 7) Rückgabe: Zahl der ersetzten Schriften
  const d2 = await PDFLib.PDFDocument.load(roh);
  gleich(mit._standardSchriftenEinbetten(d2), 2, 'zwei ersetzt');
  gleich(mit._standardSchriftenEinbetten(d2), 0, 'zweiter Lauf ändert nichts');

  console.log(`pdfa-schriften: ${n} Prüfungen grün`);
})().catch(e => { console.error(e); process.exit(1); });
