// node tests/stammdaten.test.js
// Stammdaten des Rechnungsstellers im Konverter gesperrt (js/parser.js): nur aus der Registry,
// bei einem Beleg desselben Werks IBAN und BIC laut Beleg. Beleg-Werte sind erfunden.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console: { log() {}, warn() {}, error() {} }, window: {}, Math, Date, JSON, RegExp, String, Number, Array, Object, Set, Map, parseFloat, parseInt, isNaN };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/parser.js'), 'utf8')
  + '\nthis.reg = _COMPANY_REGISTRY; this.felder = STAMMDATEN_FELDER; this.stamm = werkStammdaten;'
  + ' this.abw = stammdatenAbweichungen; this.fuer = stammdatenFuerWerk; this.aktiv = activeWerke;', ctx);

let n = 0;
const kopie = o => (o === undefined ? o : JSON.parse(JSON.stringify(o)));   // Werte aus dem vm-Kontext vergleichbar machen
const gleich = (ist, soll, m) => { assert.deepStrictEqual(kopie(ist), kopie(soll), m + ': ' + JSON.stringify(ist)); n++; };
const FREMD_IBAN = 'DE02120300000000202051';
const FREMD_BIC = 'BYLADEM1001';

// Für jedes aktive Werk: die eigenen Stammdaten passen, jede Änderung fällt auf
for (const w of ctx.aktiv()) {
  const s = ctx.stamm(w, false);
  gleich(Object.keys(s), Object.keys(ctx.felder), `${w}: alle Stammdatenfelder`);
  gleich(s.verkaeufer, ctx.reg[w].verkaeufer, `${w}: Firma aus der Registry`);
  gleich(ctx.abw(w, s, null, false), [], `${w}: unverändert passt`);
  gleich(ctx.abw(w, Object.assign({}, s, { iban: FREMD_IBAN }), null, false), ['IBAN'], `${w}: andere IBAN ohne Beleg`);
  gleich(ctx.abw(w, Object.assign({}, s, { verkaeufer: s.verkaeufer + ' X' }), null, false), ['Firma'], `${w}: andere Firma`);
  if (s.verkaeufstrasse) {
    gleich(ctx.abw(w, Object.assign({}, s, { verkaeufstrasse: 'Musterweg 1' }), null, false), ['Straße'], `${w}: andere Straße`);
  }
}

const [a, b] = ctx.aktiv();
const sa = ctx.stamm(a, false);

// Leerzeichen und Groß-/Kleinschreibung in IBAN und BIC zählen nicht, in Texten nur doppelte Leerzeichen
const iban4 = sa.iban.replace(/(.{4})/g, '$1 ').trim().toLowerCase();
gleich(ctx.abw(a, Object.assign({}, sa, { iban: iban4, verkaeufer: ' ' + sa.verkaeufer + ' ' }), null, false), [], 'Schreibweise IBAN, Ränder');

// Stammdaten eines anderen Werks passen nicht
gleich(ctx.abw(b, sa, null, false).includes('Firma'), true, 'anderes Werk: Firma weicht ab');

// Unbekanntes oder leeres Werk
gleich(ctx.abw('XYZ', sa, null, false), ['Werk XYZ ohne Stammdaten'], 'unbekanntes Werk');
gleich(ctx.abw('', sa, null, false), ['Werk ? ohne Stammdaten'], 'kein Werk');
gleich(ctx.stamm('XYZ', false), null, 'kein Eintrag für unbekanntes Werk');

// Beleg desselben Werks: IBAN und BIC laut Beleg (Factoring, Zahlungskonto) sind erlaubt
const beleg = Object.assign(kopie(sa), { gesellschaft: a, iban: FREMD_IBAN, bic: FREMD_BIC });
gleich(ctx.abw(a, Object.assign({}, sa, { iban: FREMD_IBAN, bic: FREMD_BIC }), beleg, false), [], 'IBAN/BIC laut Beleg');
gleich(ctx.abw(a, sa, beleg, false), [], 'IBAN/BIC der Registry bleiben erlaubt');
gleich(ctx.abw(a, Object.assign({}, sa, { iban: 'DE89370400440532013000' }), beleg, false), ['IBAN'], 'dritte IBAN nicht');
gleich(ctx.abw(a, Object.assign({}, sa, { verkaeufer: 'Andere GmbH' }), Object.assign({}, beleg, { verkaeufer: 'Andere GmbH' }), false),
  ['Firma'], 'Beleg hebt die Firma der Registry nicht auf');
gleich(ctx.fuer(a, beleg, false).iban, FREMD_IBAN, 'Formular: IBAN vom Beleg');
gleich(ctx.fuer(a, beleg, false).verkaeufer, sa.verkaeufer, 'Formular: Firma aus der Registry');

// Beleg eines anderen Werks: dessen Bank gilt nicht, das Formular nimmt die Registry
gleich(ctx.abw(b, Object.assign(ctx.stamm(b, false), { iban: FREMD_IBAN }), beleg, false), ['IBAN'], 'Bank eines fremden Belegs');
gleich(ctx.fuer(b, beleg, false), ctx.stamm(b, false), 'Formular: anderes Werk aus der Registry');

// Felder ohne Registry-Eintrag: leer ohne Beleg, sonst der Wert vom Beleg
const leer = ctx.aktiv().map(w => [w, Object.keys(ctx.felder).find(k => !ctx.stamm(w, false)[k])]).find(x => x[1]);
if (leer) {
  const [w, k] = leer;
  const s = ctx.stamm(w, false);
  const name = ctx.felder[k];
  gleich(ctx.abw(w, Object.assign({}, s, { [k]: '123/456' }), null, false), [name], `${w}: ${name} ohne Registry-Eintrag nur leer`);
  const b2 = Object.assign(kopie(s), { gesellschaft: w, [k]: '123/456' });
  gleich(ctx.abw(w, Object.assign({}, s, { [k]: '123/456' }), b2, false), [], `${w}: ${name} vom Beleg`);
  gleich(ctx.abw(w, Object.assign({}, s, { [k]: '999/999' }), b2, false), [name], `${w}: ${name} anders als im Beleg`);
}

// Reiter „Manuelle Rechnung“: abweichende Bank aus _manuell, nur dort
const mw = Object.keys(ctx.reg).find(w => ctx.reg[w]._manuell && ctx.stamm(w, false));
if (mw) {
  const m = ctx.stamm(mw, true);
  gleich(m.iban, ctx.reg[mw]._manuell.iban, `${mw}: Bank im Reiter Manuelle Rechnung`);
  gleich(ctx.abw(mw, m, null, true), [], `${mw}: manuell passt`);
  gleich(ctx.abw(mw, m, null, false), ['IBAN', 'BIC'], `${mw}: Bank des Reiters gilt im Konverter nicht`);
}

console.log(`stammdaten: ${n} Prüfungen grün`);
