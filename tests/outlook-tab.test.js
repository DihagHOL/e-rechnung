// node tests/outlook-tab.test.js
// „Mail erstellen“ (js/app.js): Outlook-Tab gleich beim Klick öffnen, nach dem Anlegen des Entwurfs
// auf den Entwurf lenken, bei Fehler schließen. Blockt der Browser, kommt ein Knopf in der Meldung.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };

const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const von = app.indexOf('/**\n * Leeren Tab für Outlook öffnen') >= 0
  ? app.indexOf('/**\n * Leeren Tab für Outlook öffnen') : app.indexOf('function _outlookTabVorbereiten(');
const bis = app.indexOf('/** Empfänger der Rechnungsmail');
assert.ok(von > 0 && bis > von, 'Funktionen in app.js gefunden');

function browser(blockt) {
  const offen = [];
  const neuerTab = () => ({
    opener: 'eltern', closed: false, ziel: '',
    document: { title: '', body: { style: {}, textContent: '' } },
    location: { replace(u) { this.tab.ziel = u; } },
    close() { this.closed = true; },
  });
  const window = {
    open(url, ziel, merkmale) {
      if (blockt) return null;
      const t = neuerTab(); t.location.tab = t; t.url = url; t.merkmale = merkmale;
      offen.push(t); return t;
    },
  };
  const ctx = vm.createContext({ window });
  vm.runInContext(app.slice(von, bis) + '\nthis.vor = _outlookTabVorbereiten; this.zeigen = _outlookTabZeigen; this.zu = _outlookTabSchliessen;', ctx);
  return { ctx, offen };
}

// 1) Normalfall: leerer Tab beim Klick, ohne Rückgriff auf die App, später auf den Entwurf gelenkt
let b = browser(false);
const tab = b.ctx.vor();
gleich([b.offen.length, tab.opener, tab.url, /Outlook öffnet sich/.test(tab.document.body.textContent)], [1, null, '', true], 'Tab vorbereitet');
gleich(b.ctx.zeigen(tab, 'https://outlook.office365.com/owa/?ItemID=abc'), true, 'Entwurf gezeigt');
gleich([tab.ziel, b.offen.length], ['https://outlook.office365.com/owa/?ItemID=abc', 1], 'im selben Tab, kein zweites Fenster');

// 2) Fehler beim Erstellen: der vorbereitete Tab geht wieder zu
b = browser(false);
const tab2 = b.ctx.vor();
b.ctx.zu(tab2);
gleich(tab2.closed, true, 'Tab bei Fehler geschlossen');
b.ctx.zu(null);
gleich(true, true, 'ohne Tab kein Fehler');

// 3) Tab vom Nutzer geschlossen: neues Fenster mit noopener
b = browser(false);
const tab3 = b.ctx.vor();
tab3.closed = true;
gleich(b.ctx.zeigen(tab3, 'https://outlook.office365.com/x'), true, 'neues Fenster');
gleich([b.offen.length, b.offen[1].merkmale], [2, 'noopener'], 'zweites Fenster ohne Rückgriff');

// 4) Browser blockt: kein Tab, zeigen meldet false (App zeigt dann den Knopf „In Outlook öffnen“)
b = browser(true);
gleich(b.ctx.vor(), null, 'geblockt: kein Tab');
gleich(b.ctx.zeigen(null, 'https://outlook.office365.com/x'), false, 'geblockt: Knopf nötig');

// 5) Ablauf in createInvoiceMail: Tab erst nach den Rückfragen, vor dem Bauen des PDFs
const ablauf = app.slice(app.indexOf('async function createInvoiceMail('), app.indexOf('/**\n * Leeren Tab für Outlook öffnen'));
const stelle = s => ablauf.indexOf(s);
gleich(stelle('_preflightChecks(data, totals)') < stelle('_outlookTabVorbereiten()') && stelle('_outlookTabVorbereiten()') < stelle('_buildZugferdPdf('), true,
  'Tab nach den Rückfragen und vor der Arbeit');
gleich((ablauf.match(/_outlookTabSchliessen\(outlook\)/g) || []).length >= 3, true, 'Tab bei Selbstprüfung, Fehler und .eml-Weg geschlossen');
gleich(/text: 'In Outlook öffnen', klick: \(\) => window\.open\(draft\.webLink/.test(ablauf), true, 'Knopf bei geblocktem Fenster');

console.log(`outlook-tab: ${n} Prüfungen grün`);
