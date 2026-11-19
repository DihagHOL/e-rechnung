// node tests/rechnungsdaten.test.js
// Gelesene Rechnungsdaten prüfen und korrigieren (js/rechnungsdaten.js) und eigene USt-IdNr.,
// die nie als die des Lieferanten zählen (Register, Monitoring). Anlass 19.11.2026: Bei DSO stand
// die Kunden-USt-IdNr. („KD-UST-Id-Nr.“) an 49 Rechnungen, das Register ordnete sie alle einem
// Lieferanten zu.
const assert = require('assert');
const L = require('../js/lieferant.js');
// Die Skripte rufen sich im Browser über globale Namen auf
global.istEigeneVat = L.istEigeneVat;
const ug = require('../js/umsatzgrenze.js');
const B = require('../js/bearbeitung.js');
Object.assign(global, { ugMitXml: ug.ugMitXml, ugLieferantFuer: ug.ugLieferantFuer, ugRechnungKey: ug.ugRechnungKey, _ug: ug._ug,
  bhZiel: B.bhZiel, bhZusammen: B.bhZusammen, bhAusFeldern: B.bhAusFeldern });
const RD = require('../js/rechnungsdaten.js');
Object.assign(global, { rdGeprueft: RD.rdGeprueft, rdMoeglich: RD.rdMoeglich });
const M = require('../js/monitoring.js');

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };

// 1) Beträge aus der Eingabe
gleich(RD.rdBetrag('1.190,00'), 1190, 'deutsch mit Tausenderpunkt');
gleich(RD.rdBetrag('1190,5'), 1190.5, 'ohne Tausenderpunkt');
gleich(RD.rdBetrag('1190.50'), 1190.5, 'Punkt als Dezimalzeichen');
gleich(RD.rdBetrag('11900'), 11900, 'ganze Zahl');
gleich(RD.rdBetrag('1.234'), 1234, 'nur Tausenderpunkt');
gleich(RD.rdBetrag('-12,00 €'), -12, 'Gutschrift mit Eurozeichen');
gleich(RD.rdBetrag(''), null, 'leer');
gleich(Number.isNaN(RD.rdBetrag('zwölf')), true, 'Unsinn');

// 2) Welche Zeilen sich korrigieren lassen
const pdf = { richtung: 'Eingang', format: 'PDF ohne E-Rechnung', listId: 'L', itemId: '7', werk: 'DSO', baseKey: 'ab_7654321', file: 'ab_7654321.pdf' };
gleich(RD.rdMoeglich(pdf), true, 'PDF ohne E-Rechnung im Eingang');
gleich(RD.rdMoeglich(Object.assign({}, pdf, { format: 'ZUGFeRD (PDF+XML)' })), false, 'E-Rechnung nicht');
gleich(RD.rdMoeglich(Object.assign({}, pdf, { richtung: 'Ausgang' })), false, 'Ausgang nicht');
gleich(RD.rdMoeglich(Object.assign({}, pdf, { intake: true })), false, 'Eingangsstufe nicht');
gleich(RD.rdMoeglich(Object.assign({}, pdf, { listId: '' })), false, 'ohne Datei nicht');

// 3) Änderungen als Spalten
const alt = { lieferant: 'Muster Arbeitsschutz GmbH', vat: '', nummer: 'Ab_7654321_1112223', datum: '', faelligkeit: '',
  netto: 1000, brutto: 1190, waehrung: 'EUR' };
const eingabe = Object.assign({}, alt, { netto: '1.000,00', brutto: '1.190,00' });
gleich(RD.rdAenderungen(alt, eingabe), { felder: {}, geaendert: [], fehler: [] }, 'nichts geändert');
let a = RD.rdAenderungen(alt, Object.assign({}, eingabe, { vat: 'de 123 456 788', nummer: '7654321', datum: '2026-11-11' }));
gleich(a.felder, { RechnungsstellerUStID: 'DE123456788', Title: '7654321', Rechnungsdatum: '2026-11-11T12:00:00Z' }, 'USt-IdNr., Nummer, Datum');
gleich(a.geaendert, ['vat', 'nummer', 'datum'], 'geänderte Felder');
a = RD.rdAenderungen(alt, Object.assign({}, eingabe, { vat: 'DE453718391' }));
gleich(a.fehler.length === 1 && /eigenen Gesellschaft/.test(a.fehler[0]), true, 'eigene USt-IdNr. abgelehnt');
a = RD.rdAenderungen(alt, Object.assign({}, eingabe, { vat: 'DE12' }));
gleich(/Format/.test(a.fehler[0]), true, 'kein gültiges Format');
a = RD.rdAenderungen(alt, Object.assign({}, eingabe, { brutto: '100,00' }));
gleich(/kleiner als Netto/.test(a.fehler.join(' ')), true, 'Brutto kleiner als Netto');
a = RD.rdAenderungen(alt, Object.assign({}, eingabe, { netto: '', brutto: '' }));
gleich(a.felder, { Nettobetrag: null, Bruttobetrag: null }, 'Beträge leeren');
a = RD.rdAenderungen(alt, Object.assign({}, eingabe, { lieferant: '', waehrung: 'Euro' }));
gleich(a.fehler.length, 2, 'Lieferant leer und Währung falsch');
a = RD.rdAenderungen(Object.assign({}, alt, { vat: 'DE453718391' }), Object.assign({}, eingabe, { vat: '' }));
gleich(a.felder, { RechnungsstellerUStID: '' }, 'falsche USt-IdNr. entfernen');

// 4) Gespeicherte Werte im geladenen Datensatz
const z = Object.assign({}, pdf, { erstellt: '2026-11-11T09:00:00Z', datum: '2026-11-11', datumAusRechnung: false });
RD.rdUebernehmen(z, { Title: '7654321', Rechnungsdatum: '2026-11-10T12:00:00Z', Bruttobetrag: 10, RechnungsstellerUStID: 'DE123456788' });
gleich([z.nummer, z.nummerAusDatei, z.datum, z.datumAusRechnung, z.brutto, z.ustid], ['7654321', false, '2026-11-10', true, 10, 'DE123456788'], 'Übernahme');

// 5) Eigene USt-IdNr. im Register und an der Rechnung zählen nicht
gleich([ug.ugVat('DE 453 718 391'), ug.ugVat('de123456788')], ['', 'DE123456788'], 'ugVat');
ug._ug.daten = { version: 1, rechnungen: {}, lieferanten: {
  'muster arbeitsschutz gmbh': { name: 'Muster Arbeitsschutz GmbH', vat: 'DE453718391' },
} };
const fremd = { richtung: 'Eingang', ustid: 'DE453718391', steller: 'Ganz Andere GmbH', baseKey: 'x1' };
gleich(ug.ugLieferantFuer(fremd), null, 'eigene USt-IdNr. ordnet keinem Lieferanten zu');
const echt = { richtung: 'Eingang', ustid: 'DE123456788', steller: 'Muster Arbeitsschutz GmbH', baseKey: 'x2' };
gleich((ug.ugLieferantFuer(echt) || {}).treffer, 'name', 'gemerkte eigene USt-IdNr. blockiert den Namen nicht');
const user = { username: 'kb@example.org', name: 'KB' };
gleich(ug.ugLieferantMerken({ name: 'X', vat: 'DE453718391' }, 'X', echt, user, '2026-11-19').vat, 'DE123456788', 'eigene im Register wird ersetzt');
gleich(ug.ugLieferantMerken({ name: 'X', vat: 'DE111111111' }, 'X', echt, user, '2026-11-19', { vat: 'DE222222222' }).vat, 'DE111111111', 'ohne vatSetzen bleibt die gemerkte');
gleich(ug.ugLieferantMerken({ name: 'X', vat: 'DE111111111' }, 'X', echt, user, '2026-11-19', { vat: 'DE222222222', vatSetzen: true }).vat, 'DE222222222', 'von Hand korrigiert ersetzt sie');

// 6) Monitoring: eigene USt-IdNr. im Eingang leer, im Ausgang bleibt sie (Verkäufer = eigene Gesellschaft)
const datei = (richtung, ustid) => M._monMap({ id: '1', createdDateTime: '2026-11-11T10:00:00Z', webUrl: 'u' },
  { FileLeafRef: `7654321_${ustid}.pdf`, RechnungsstellerUStID: ustid, Rechnungssteller: 'Muster Arbeitsschutz GmbH' },
  { id: 'L', werk: 'DSO', richtung });
gleich(datei('Eingang', 'DE453718391').ustid, '', 'Eingang: eigene USt-IdNr. ausgeblendet');
gleich(datei('Eingang', 'DE453718391').nummer, '7654321', 'Nummer aus dem Dateinamen trotzdem ohne USt-IdNr.');
gleich(datei('Ausgang', 'DE453718391').ustid, 'DE453718391', 'Ausgang unverändert');

// 7) Geprüfte Daten sind nicht mehr grau
const zeile = Object.assign({}, pdf, { ustid: '' });
gleich(M._monGelesen(zeile), true, 'gelesen, nicht geprüft');
gleich(/Daten prüfen/.test(M._monDatenKnopf(zeile, 3)), true, 'Knopf „Daten prüfen“');
ug._ug.daten.rechnungen[ug.ugRechnungKey(zeile)] = { daten: { felder: ['vat'], am: '2026-11-19T10:00:00Z', vonName: 'KB' } };
gleich(M._monGelesen(zeile), false, 'nach der Prüfung nicht mehr grau');
gleich(/Daten ✓/.test(M._monDatenKnopf(zeile, 3)), true, 'Knopf zeigt die Prüfung');
gleich(M._monDatenKnopf(Object.assign({}, zeile, { format: 'ZUGFeRD (PDF+XML)' }), 3), '', 'E-Rechnung ohne Knopf');

console.log(`rechnungsdaten: ${n} Pruefungen gruen`);
