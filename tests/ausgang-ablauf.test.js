// node tests/ausgang-ablauf.test.js
// Ausgang im Konverter (js/app.js) nach dem Prozess „Rechnungsausgang“ / „Prüfen und erzeugen“:
// - Prüfungen in fester Reihenfolge, für Export und Mail gleich (_vorDemErstellen)
// - erst die Ablage im Monitoring, dann die Mail; ohne Ablage keine Mail
// - die Mail verschickt die abgelegte Datei, mit USt-IdNr.-Bestätigung
// - Meldungen: Fehler bleiben, sonst Dauer nach Länge
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };

const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const stueck = (von, bis) => {
  const a = app.indexOf(von), b = app.indexOf(bis, a + 1);
  assert.ok(a >= 0 && b > a, 'Abschnitt gefunden: ' + von);
  return app.slice(a, b);
};

// 1) Reihenfolge der Prüfungen: harte Fehler und Warnungen, dann Rückfragen, dann Nummernkreis
{
  const aufrufe = [];
  const ctx = vm.createContext({
    calcTotals: () => ({ grossTotal: 119 }),
    _preflightChecks: () => { aufrufe.push('preflight'); return ctx.antwort.preflight; },
    _ausgangRueckfragen: () => { aufrufe.push('rueckfragen'); return ctx.antwort.rueckfragen; },
    vorlagenVorExport: async () => { aufrufe.push('nummernkreis'); return ctx.antwort.nummer; },
    antwort: {},
  });
  vm.runInContext(stueck('async function _vorDemErstellen(', '/** Ohne zugewiesenes Werk') + '\nthis.vor = _vorDemErstellen;', ctx);
  (async () => {
    ctx.antwort = { preflight: true, rueckfragen: true, nummer: true };
    gleich([JSON.stringify(await ctx.vor({ positionen: [] })), aufrufe.splice(0)], ['{"grossTotal":119}', ['preflight', 'rueckfragen', 'nummernkreis']], 'alles bestanden, feste Reihenfolge');
    ctx.antwort = { preflight: false, rueckfragen: true, nummer: true };
    gleich([await ctx.vor({}), aufrufe.splice(0)], [null, ['preflight']], 'harter Fehler: keine Rückfragen mehr');
    ctx.antwort = { preflight: true, rueckfragen: false, nummer: true };
    gleich([await ctx.vor({}), aufrufe.splice(0)], [null, ['preflight', 'rueckfragen']], 'Rückfrage abgebrochen');
  })().then(weiter).catch(e => { console.error(e); process.exit(1); });
}

function weiter() {
  // Beide Wege nutzen dieselben Prüfungen
  const exp = stueck('async function exportInvoice(', '/**\n * Prüfungen vor Export und Mail');
  const mail = stueck('async function createInvoiceMail(', '/**\n * Leeren Tab für Outlook öffnen');
  gleich([/_vorDemErstellen\(data\)/.test(exp), /_vorDemErstellen\(data\)/.test(mail), /_preflightChecks\(/.test(exp + mail)], [true, true, false], 'Export und Mail gleich');
  gleich(mail.indexOf('_vorDemErstellen(data)') < mail.indexOf('_outlookTabVorbereiten()'), true, 'Outlook-Tab erst nach den Prüfungen');

  // 2) Mail: Ablage zuerst, gleiche Datei, keine Mail ohne Ablage
  const protokoll = [];
  const meldungen = [];
  let ablageFehler = null;
  const tab = { closed: false, opener: 'x', document: { title: '', body: { style: {}, textContent: '' } }, location: { replace: u => { tab.ziel = u; } }, close() { this.closed = true; } };
  const ctx = vm.createContext({
    window: { open: () => tab, matchingVatCheck: () => ({ quelle: 'BZSt' }) },
    TextEncoder, console: { warn() {}, error() {} },
    _werkZugewiesen: () => true,
    collectFormData: () => ({ rechnungsnummer: 'RE-1', kaeufervat: 'ATU12345678', kaeufermail: 'rechnung@kunde.example' }),
    _stammdatenGeprueft: () => true, validateForm: () => [], highlightErrors() {},
    acquireTokenPopupSafe: async () => 'token',
    _vorDemErstellen: async () => ({ grossTotal: 119, netTotal: 100, vatTotal: 19 }),
    buildXML: () => '<xml>RE-1</xml>', _verifyEmbeddedXml: () => [],
    sanitizeFilename: s => s,
    _buildZugferdPdf: async (data, totals, xml, ust) => { protokoll.push('pdf:' + (ust ? ust.quelle : 'ohne')); return new Uint8Array([1, 2, 3]); },
    bytesToBase64: b => Buffer.from(b).toString('base64'),
    vorlagenNummerVerbraucht: async () => {}, _renderReadablePdf: async () => null, _buildAudit: async () => ({}),
    saveToHistory() {}, showLoading() {}, uploadedFileName: 'RE-1.pdf', _kundenMailMerken() {},
    spSaveToMonitoring: async a => { protokoll.push('ablage:' + Buffer.from(a.pdfBytes || []).toString('base64')); if (ablageFehler) throw ablageFehler; },
    _mailSubjectBody: () => ({ subject: 'Rechnung', body: 'Text' }),
    _createOutlookDraft: async (token, data, subject, body, anh) => { protokoll.push('mail:' + anh[0].base64); return { webLink: 'https://outlook.office365.com/x' }; },
    _buildInvoiceEml: () => '', downloadBlob() { protokoll.push('eml'); },
    showToast: (text, typ, aktion) => meldungen.push({ text, typ, knopf: aktion && aktion.text }),
  });
  vm.runInContext(stueck('// Zuletzt abgelegte Rechnung', '/** Empfänger der Rechnungsmail')
    + '\nthis.mail = createInvoiceMail; this.ablegen = _imMonitoringAblegen; this.stand = () => _zuletztAbgelegt;', ctx);

  (async () => {
    // Ablage scheitert: keine Mail, Tab zu, Fehler bleibt mit „Erneut versuchen“
    ablageFehler = new Error('403 Keine Schreibrechte');
    await ctx.mail();
    gleich(protokoll.splice(0), ['pdf:BZSt', 'ablage:AQID'], 'ohne Ablage keine Mail');
    gleich([tab.closed, meldungen.length, meldungen[0].typ, meldungen[0].knopf, /Keine Schreibrechte/.test(meldungen[0].text)],
      [true, 1, 'error', 'Erneut versuchen', true], 'Fehler bleibt stehen, mit Knopf');
    meldungen.length = 0; tab.closed = false;

    // Ablage klappt: Mail mit derselben Datei, USt-IdNr.-Bestätigung im PDF
    ablageFehler = null;
    await ctx.mail();
    gleich(protokoll.splice(0), ['pdf:BZSt', 'ablage:AQID', 'mail:AQID'], 'erst ablegen, dann Mail mit derselben Datei');
    gleich(tab.ziel, 'https://outlook.office365.com/x', 'Outlook im vorbereiteten Tab');

    // Export vorher (andere Bytes): Mail verschickt die abgelegte Datei und legt nicht neu ab
    vm.runInContext('_zuletztAbgelegt = { fassung: "", pdfBytes: null };', ctx);
    gleich(await ctx.ablegen({ rechnungsnummer: 'RE-1' }, { grossTotal: 119 }, '<xml>RE-1</xml>', new Uint8Array([9, 9]), 'zugferd', null), null, 'Export legt ab');
    protokoll.length = 0;
    await ctx.mail();
    gleich(protokoll.splice(0), ['mail:CQk='], 'Mail nach Export: abgelegte Datei, keine zweite Ablage');
    gleich(await ctx.ablegen({ rechnungsnummer: 'RE-1' }, { grossTotal: 119 }, '<xml>RE-1</xml>', null, 'zugferd', null), null, 'gleiche Fassung gilt als abgelegt');

    // 3) Meldungen: Dauer
    const dctx = vm.createContext({});
    vm.runInContext(stueck('/** Anzeigedauer in ms', 'function formatDE(') + '\nthis.dauer = toastDauer;', dctx);
    gleich([dctx.dauer('x'.repeat(20), 'error', false), dctx.dauer('kurz', 'success', false), dctx.dauer('x'.repeat(300), 'info', false),
      dctx.dauer('kurz', 'warn', true)], [0, 5000, 9000, 15000], 'Fehler bleiben, sonst nach Länge, mit Knopf 15 s');

    console.log(`ausgang-ablauf: ${n} Prüfungen grün`);
  })().catch(e => { console.error(e); process.exit(1); });
}
