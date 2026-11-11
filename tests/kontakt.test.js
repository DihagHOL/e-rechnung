// node tests/kontakt.test.js
// Ansprechpartner aus dem Firmenverzeichnis (js/kontakt.js): Abgleich des Zeichens mit den Konten.
// Alle Namen und Adressen sind erfunden.
const assert = require('assert');
const K = require('../js/kontakt.js');

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };
const D = '@werk.example';
const konten = [
  { displayName: 'Anna Muster-Groß', givenName: 'Anna', surname: 'Muster-Groß', mail: 'anna.muster-gross' + D },
  { displayName: 'Bernd Beispiel', givenName: 'Bernd', surname: 'Beispiel', mail: 'bernd.beispiel' + D },
  { displayName: 'Carla Beispiel', givenName: 'Carla', surname: 'Beispiel', mail: 'carla.beispiel' + D },
  { displayName: 'Dora Kröhn', givenName: 'Dora', surname: 'Krohen', mail: 'dora.kroehn' + D },   // Tippfehler im Nachnamen
  { displayName: 'Ehrlich, Emil', givenName: 'Emil', surname: null, mail: 'eehrlich' + D },
  { displayName: 'Besprechungsraum 1', surname: null, mail: 'raum1' + D },
  { displayName: 'Gast Muster', surname: 'Muster', mail: 'gast_extern.example#EXT#' + D },
];
const mails = (z) => K.kontaktTreffer(z, konten).map(p => p.mail);

gleich(K.kontaktNorm('Müller-Groß'), 'muellergross', 'Umlaute ausgeschrieben, nur Buchstaben');
gleich(mails('Muster-Groß'), ['anna.muster-gross' + D], 'Doppelname wie im Verzeichnis');
gleich(mails('Muster-Gross'), ['anna.muster-gross' + D], 'ß als ss');
gleich(mails('MUSTER-GROSS'), ['anna.muster-gross' + D], 'Großschreibung egal');
gleich(mails('Kröhn'), ['dora.kroehn' + D], 'über die Mail, wenn der Nachname falsch gepflegt ist');
gleich(mails('Ehrlich'), ['eehrlich' + D], 'über den Anzeigenamen „Nachname, Vorname“');
gleich(mails('Beispiel').length, 2, 'zwei Konten mit dem Namen');
gleich(mails('Unbekannt'), [], 'kein Konto');
gleich(mails('Mu'), [], 'zu kurz');
gleich(K.kontaktTreffer('Muster', konten).length, 0, 'Gastkonto zählt nicht, Teil eines Doppelnamens auch nicht');
gleich(K.kontaktName(konten[0]), 'Anna Muster-Groß', 'Name wie angezeigt');
gleich(K.kontaktName(konten[4]), 'Emil Ehrlich', '„Nachname, Vorname“ umgestellt');

console.log(`kontakt: ${n} Prüfungen grün`);
