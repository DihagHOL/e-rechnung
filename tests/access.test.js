// node tests/access.test.js
// Werkzuweisung und Rollen (js/access.js): FIBU sieht Ein- und Ausgang, Vertrieb nur den Ausgang
const assert = require('assert');
const A = require('../js/access.js');
const M = require('../js/monitoring.js');

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };

const cfg = {
  wgc: ['erika.muster@beispiel.de', 'max.probe@beispiel.de'],
  shb: ['max.probe@beispiel.de'],
  _rollen: { wgc: { 'max.probe@beispiel.de': 'vertrieb' } },
  _app: { admins: ['admin@beispiel.de'], apiHost: 'https://beispiel-fn.azurewebsites.net' },
};

// 1) Rolle je Werk, ohne Eintrag FIBU
gleich(A.rolleIn(cfg, 'wgc', 'Max.Probe@beispiel.de '), 'vertrieb', 'Vertrieb im Werk, Groß-/Kleinschreibung egal');
gleich(A.rolleIn(cfg, 'WGC', 'erika.muster@beispiel.de'), 'fibu', 'ohne Eintrag FIBU');
gleich(A.rolleIn(cfg, 'shb', 'max.probe@beispiel.de'), 'fibu', 'Rolle gilt je Werk');
gleich(A.rolleIn({ _rollen: { wgc: { 'x@beispiel.de': 'chef' } } }, 'wgc', 'x@beispiel.de'), 'fibu', 'unbekannte Rolle = FIBU');
gleich(A.rolleIn({}, 'wgc', 'x@beispiel.de'), 'fibu', 'alte Config ohne _rollen');

// 2) Was der angemeldete Benutzer sieht
A._zugriffSetzen(cfg);
global.getAuthUser = () => ({ username: 'max.probe@beispiel.de' });
gleich(A.erlaubteRichtungen(), { wgc: ['Ausgang'], shb: ['Eingang', 'Ausgang'] }, 'WGC nur Ausgang, SHB beides');
global.getAuthUser = () => ({ username: 'admin@beispiel.de' });
gleich(A.erlaubteRichtungen(), null, 'Admin sieht alles');
global.getAuthUser = () => ({ username: 'fremd@beispiel.de' });
gleich(A.erlaubteRichtungen(), {}, 'ohne Zuweisung nichts');
gleich(A.getAccessFor('max.probe@beispiel.de'), ['wgc', 'shb'], '_rollen und _app sind keine Werke');

// 3) Bibliotheken im Monitoring
const vertrieb = { wgc: ['Ausgang'] };
const erlaubt = (lib, r) => M._monLibErlaubt(lib, r);
gleich(erlaubt({ werk: 'WGC', richtung: 'Ausgang' }, vertrieb), true, 'Vertrieb: AR_WGC');
gleich(erlaubt({ werk: 'WGC', richtung: 'Eingang' }, vertrieb), false, 'Vertrieb: kein ERAR_WGC');
gleich(erlaubt({ werk: '', richtung: 'Eingang', intake: true }, vertrieb), false, 'Vertrieb: keine Eingangsstufe');
gleich(erlaubt({ werk: '', richtung: 'Eingang', intake: true }, { wgc: ['Ausgang'], shb: ['Eingang', 'Ausgang'] }), true, 'FIBU irgendwo: Eingangsstufe');
gleich(erlaubt({ werk: 'SHB', richtung: 'Ausgang' }, vertrieb), false, 'anderes Werk nicht');
gleich(erlaubt({ werk: 'SHB', richtung: 'Eingang' }, null), true, 'Admin: alles');

// 4) Einstellungen: Kopie behält _app und _rollen, Bereinigen vor dem Speichern
const kopie = A.zugriffKopie(cfg);
gleich(kopie._app, cfg._app, '_app bleibt beim Bearbeiten erhalten');
kopie.wgc.push('neu@beispiel.de');
gleich(cfg.wgc.length, 2, 'Kopie ist unabhängig');
A.rolleSetzen(kopie, 'wgc', 'neu@beispiel.de', 'vertrieb');
A.rolleSetzen(kopie, 'wgc', 'max.probe@beispiel.de', 'fibu');
gleich(kopie._rollen, { wgc: { 'neu@beispiel.de': 'vertrieb' } }, 'FIBU wird nicht gespeichert');
A.rolleSetzen(kopie, 'wgc', 'neu@beispiel.de', 'fibu');
gleich('_rollen' in kopie, false, 'leere Rollen fallen weg');
A.rolleSetzen(kopie, 'shb', 'max.probe@beispiel.de', 'vertrieb');
kopie.shb = [];
const gespeichert = A.zugriffBereinigen(kopie);
gleich('_rollen' in gespeichert, false, 'Rolle einer entfernten Person fällt weg');
gleich(gespeichert._app, cfg._app, '_app wird mitgespeichert');
gleich(A.zugriffBereinigen({ wgc: ['a@beispiel.de'], _rollen: { wgc: { 'a@beispiel.de': 'vertrieb', 'b@beispiel.de': 'vertrieb' } } })._rollen,
  { wgc: { 'a@beispiel.de': 'vertrieb' } }, 'nur Personen im Werk');

console.log(`access: ${n} Prüfungen grün`);
