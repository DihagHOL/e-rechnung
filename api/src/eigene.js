'use strict';
/**
 * USt-IdNr. der eigenen DIHAG-Gesellschaften (Registry in js/parser.js, verkaeufervat).
 * Genutzt von /api/vat (anfragende USt-IdNr.) und /api/pdfa (Verkäufer der Rechnung).
 * tests/vat-api.test.js prüft, dass die Liste zur Registry passt.
 */
const EIGENE_UST_IDS = ['DE140598967', 'DE812264517', 'DE368990137', 'DE368676368',
  'DE811154479', 'DE812737567', 'DE281233945', 'DE150528912'];

module.exports = { EIGENE_UST_IDS };
