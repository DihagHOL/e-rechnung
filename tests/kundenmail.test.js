// node tests/kundenmail.test.js
const assert = require('assert');
const { kundenMailFinden, kundenMailIstEigen, kundenMailListe, kundenMailGueltig, kundenMailImKonzern,
  kundenMailAbweichung, kundenMailUebernehmen, kundenMailZeilen } = require('../js/kundenmail.js');

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };
const NL = String.fromCharCode(10);

const liste = [
  { werk: 'ZAI', kundennummer: '900001', vat: 'DE999999999', name: 'Beispielguss Muster GmbH', mail: 'rechnung@beispielguss.de' },
  { werk: 'ZAI', kundennummer: '900002', vat: '', name: 'Muster Motoren AG', mail: 'invoice@muster-motoren.de' },
  { werk: 'WGC', kundennummer: '900001', vat: '', name: 'Anderer Kunde GmbH', mail: 'buchhaltung@anderer.de' },
];

// Finden: Kunden-Nr. vor USt-IdNr. vor Name, immer im selben Werk
gleich(kundenMailFinden(liste, { gesellschaft: 'ZAI', kundennummer: '900001' }).mail, 'rechnung@beispielguss.de', 'Kunden-Nr. im Werk');
gleich(kundenMailFinden(liste, { gesellschaft: 'WGC', kundennummer: '900001' }).mail, 'buchhaltung@anderer.de', 'gleiche Nr. anderes Werk');
gleich(kundenMailFinden(liste, { gesellschaft: 'zai', kaeufervat: 'DE 999 999 999' }).mail, 'rechnung@beispielguss.de', 'USt-IdNr. mit Leerzeichen');
gleich(kundenMailFinden(liste, { gesellschaft: 'ZAI', kaeufer: 'muster  motoren ag' }).mail, 'invoice@muster-motoren.de', 'Name ohne Groß/klein');
gleich(kundenMailFinden(liste, { gesellschaft: 'SHB', kundennummer: '900001' }), null, 'anderes Werk ohne Eintrag');
gleich(kundenMailFinden(liste, { gesellschaft: 'ZAI', kundennummer: '123' }), null, 'unbekannter Kunde');
gleich(kundenMailFinden([], { gesellschaft: 'ZAI', kundennummer: '900001' }), null, 'leere Liste');

// Eigene Adresse: gleiche Domain wie der Verkäufer
gleich(kundenMailIstEigen('erika.muster@dihag-zaigler.com', 'vertrieb@dihag-zaigler.com'), true, 'eigene Domain');
gleich(kundenMailIstEigen('Erika.Muster@DIHAG-Zaigler.com ', 'vertrieb@dihag-zaigler.com'), true, 'eigene Domain, Groß/klein');
gleich(kundenMailIstEigen('rechnung@dihag-gienanth.com', 'vertrieb@dihag-zaigler.com'), false, 'Schwesterfirma ist Kunde');
gleich(kundenMailIstEigen('x@kunde.de', ''), false, 'ohne Verkäufer-Mail keine Aussage');
gleich(kundenMailIstEigen('x@sub.dihag-zaigler.com', 'vertrieb@dihag-zaigler.com'), false, 'nur exakt gleiche Domain');

// Übernehmen
const jetzt = '2026-10-26T10:00:00.000Z';
let neu = kundenMailUebernehmen(liste, { gesellschaft: 'ZAI', kundennummer: '900003', kaeufer: 'Neukunde GmbH',
  kaeufermail: 'eingang@neukunde.de', verkaeuferemail: 'vertrieb@dihag-zaigler.com' }, 'erika@dihag-zaigler.com', jetzt);
gleich(neu.length, 4, 'neuer Kunde angehängt');
gleich(neu[3], { werk: 'ZAI', kundennummer: '900003', vat: '', name: 'Neukunde GmbH', mail: 'eingang@neukunde.de', am: jetzt, von: 'erika@dihag-zaigler.com' }, 'Eintrag vollständig');
gleich(liste.length, 3, 'Ausgangsliste unverändert');

neu = kundenMailUebernehmen(liste, { gesellschaft: 'ZAI', kundennummer: '900001', kaeufermail: 'neu@beispielguss.de' }, '', jetzt);
gleich(neu.length, 3, 'geänderte Adresse ersetzt');
gleich([neu[0].mail, neu[0].name, neu[0].vat], ['neu@beispielguss.de', 'Beispielguss Muster GmbH', 'DE999999999'], 'Name und USt-IdNr. bleiben');

gleich(kundenMailUebernehmen(liste, { gesellschaft: 'ZAI', kundennummer: '900001', kaeufermail: 'RECHNUNG@beispielguss.de' }), null, 'Adresse schon bekannt');
gleich(kundenMailUebernehmen(liste, { gesellschaft: 'ZAI', kundennummer: '900009', kaeufermail: 'erika@dihag-zaigler.com',
  verkaeuferemail: 'vertrieb@dihag-zaigler.com' }), null, 'eigene Adresse wird nicht gemerkt');
gleich(kundenMailUebernehmen(liste, { gesellschaft: 'ZAI', kundennummer: '900009', kaeufermail: 'x@amt.de', leitwegid: '991-12345-67' }), null, 'Leitweg-ID statt Mail');
gleich(kundenMailUebernehmen(liste, { gesellschaft: 'ZAI', kaeufermail: 'x@kunde.de' }), null, 'ohne Kundenmerkmal');
gleich(kundenMailUebernehmen(null, { gesellschaft: 'shb', kaeufer: 'Kunde', kaeufermail: 'x@kunde.de' }, '', jetzt)[0].werk, 'SHB', 'Werk groß, leere Liste');

// Zeilen einlesen
const z = kundenMailZeilen([
  'Werk;Kunden-Nr.;Kunde;Mail',
  'ZAI;900001;Beispielguss Muster GmbH;rechnung@beispielguss.de',
  'zai\t900002\tMuster Motoren AG\tinvoice@muster-motoren.de',
  'ZAI, 900004, Komma GmbH, a@komma.de',
  '',
  'ZAI;900005;Ohne Mail GmbH;',
  'ZAI;900006;Kaputt;keine-mail',
].join(NL));
gleich(z.eintraege.length, 3, 'drei gültige Zeilen');
gleich(z.fehler, 2, 'zwei ohne gültige Mail');
gleich(z.eintraege[1], { werk: 'ZAI', kundennummer: '900002', vat: '', name: 'Muster Motoren AG', mail: 'invoice@muster-motoren.de' }, 'Tabulator aus Excel');
gleich(z.eintraege[2].name, 'Komma GmbH', 'Komma getrennt');

// Mehrere Adressen im Feld, Format
gleich(kundenMailListe('a@kunde.de; b@kunde.de'), ['a@kunde.de', 'b@kunde.de'], 'zwei Adressen');
gleich(kundenMailListe('a@kunde.de, b@kunde.de'), ['a@kunde.de', 'b@kunde.de'], 'mit Komma');
gleich(kundenMailListe(''), [], 'leer');
gleich(kundenMailGueltig('a@kunde.de; b@kunde.de'), true, 'zwei gültige');
gleich(kundenMailGueltig('DSFDSF'), false, 'keine Adresse');
gleich(kundenMailGueltig('a@kunde.de; DSFDSF'), false, 'eine ungültig');
gleich(kundenMailGueltig('a@kunde'), false, 'ohne Endung');

// Konzernadresse beim fremden Kunden
gleich(kundenMailImKonzern('jemand@dihag.com', 'Kunde AG'), true, 'Konzern, fremder Kunde');
gleich(kundenMailImKonzern('rechnung@dihag-beispiel.com', 'DIHAG Beispiel GmbH'), false, 'Konzern an Konzern');
gleich(kundenMailImKonzern('rechnung@kunde.de', 'Kunde AG'), false, 'Kundenadresse');
gleich(kundenMailUebernehmen(liste, { gesellschaft: 'ZAI', kundennummer: '900009', kaeufer: 'Kunde AG', kaeufermail: 'jemand@dihag.com', verkaeuferemail: 'x@werk.de' }), null, 'Konzernadresse wird nicht gemerkt');

// Abgleich mit dem Register
const ab = (d) => kundenMailAbweichung(liste, Object.assign({ gesellschaft: 'ZAI' }, d));
gleich(ab({ kundennummer: '900001', kaeufermail: 'rechnung@beispielguss.de' }), null, 'gemerkte Adresse');
gleich(ab({ kundennummer: '900001', kaeufermail: 'RECHNUNG@beispielguss.de' }), null, 'ohne Groß/klein');
gleich(ab({ kundennummer: '900002', kaeufer: 'Muster Motoren AG', kaeufermail: 'rechnung@beispielguss.de' }).art, 'gemerkt', 'Adresse eines anderen Kunden');
gleich(ab({ kundennummer: '900002', kaeufermail: 'rechnung@beispielguss.de' }).eintrag.mail, 'invoice@muster-motoren.de', 'nennt die gemerkte');
gleich(ab({ kundennummer: '900003', kaeufer: 'Neukunde AG', kaeufermail: 'rechnung@beispielguss.de' }).art, 'fremd', 'neuer Kunde mit fremder Adresse');
gleich(ab({ kundennummer: '900003', kaeufer: 'Beispielguss Werk 2 GmbH', kaeufermail: 'rechnung@beispielguss.de' }), null, 'gleiche Firma mit neuer Nummer');
gleich(ab({ kundennummer: '900003', kaeufer: 'Neukunde AG', kaeufermail: 'neu@neukunde.de' }), null, 'neuer Kunde, neue Adresse');
gleich(ab({ kundennummer: '900001', kaeufermail: 'x@y.de', leitwegid: '991-1' }), null, 'Leitweg-ID statt Mail');
gleich(ab({ kundennummer: '900001', kaeufermail: '' }), null, 'leer');
gleich(kundenMailAbweichung(liste, { gesellschaft: 'WGC', kundennummer: '900008', kaeufer: 'Neukunde AG', kaeufermail: 'rechnung@beispielguss.de' }), null, 'anderes Werk zählt nicht');

console.log(`kundenmail: ${n} Prüfungen grün`);
