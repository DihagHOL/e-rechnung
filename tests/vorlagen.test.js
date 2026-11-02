// node tests/vorlagen.test.js
const assert = require('assert');
const V = require('../js/vorlagen.js');

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };

// Datum und Leistungsmonat
gleich(V.vlHeute(new Date(2026, 0, 5, 0, 30)), '2026-01-05', 'Ortszeit, nicht UTC');
gleich(V.vlPlusTage('2026-10-29', 14), '2026-11-12', 'plus Tage über den Monat');
gleich(V.vlPlusTage('2026-12-31', 0), '2026-12-31', 'plus 0');
gleich(V.vlTageZwischen('2026-10-02', '2026-10-16'), 14, 'Zahlungsziel');
gleich(V.vlTageZwischen('', '2026-10-16'), null, 'ohne Rechnungsdatum');
gleich(V.vlLeistungsmonat('2026-10-02', 'monat'), '2026-10', 'Monat des Rechnungsdatums');
gleich(V.vlLeistungsmonat('2026-10-06', 'vormonat'), '2026-09', 'Vormonat');
gleich(V.vlLeistungsmonat('2027-01-04', 'vormonat'), '2026-12', 'Vormonat über den Jahreswechsel');
gleich(V.vlMonatsgrenzen('2026-02'), { start: '2026-02-01', ende: '2026-02-28', text: 'Februar 2026', jahr: '2026' }, 'Februar');
gleich(V.vlMonatsgrenzen('2028-02').ende, '2028-02-29', 'Schaltjahr');
gleich(V.vlMonatsgrenzen('2026-03').text, 'März 2026', 'Umlaut im Monatsnamen');

// Platzhalter hin und zurück
gleich(V.vlPlatzhalter('Managementumlage {monat}', '2026-10'), 'Managementumlage Oktober 2026', '{monat}');
gleich(V.vlPlatzhalter('Jahr {jahr}, {monat}', '2026-09'), 'Jahr 2026, September 2026', '{jahr} und {monat}');
gleich(V.vlPlatzhalter('ohne', ''), 'ohne', 'ohne Monat unverändert');
gleich(V.vlPlatzhalter(5, '2026-10'), 5, 'Zahl bleibt Zahl');
gleich(V.vlZurueck('für den Monat Oktober 2026 die Umlage', '2026-10'), 'für den Monat {monat} die Umlage', 'zurück zu {monat}');
gleich(V.vlZurueck('Oktober 2025', '2026-10'), 'Oktober 2025', 'anderes Jahr bleibt');

// Nummernkreis
const kreis = { muster: '{n}/{jjjj}', letzte: { 2026: 120 } };
gleich(V.vlNummerBilden('{n}/{jjjj}', 121, 2026), '121/2026', 'bilden');
gleich(V.vlNummerBilden('HOL-{n}-{jj}', 7, '2026'), 'HOL-7-26', 'kurzes Jahr');
gleich(V.vlNummerLesen('{n}/{jjjj}', '113/2026'), { n: 113, jahr: '2026' }, 'lesen');
gleich(V.vlNummerLesen('{n}/{jjjj}', ' 113/2026 '), { n: 113, jahr: '2026' }, 'lesen mit Leerzeichen');
gleich(V.vlNummerLesen('{n}/{jjjj}', '113-2026'), null, 'falsches Trennzeichen');
gleich(V.vlNummerLesen('{n}/{jjjj}', '053.488'), null, 'fremde Nummer');
gleich(V.vlNummerLesen('{n}/{jjjj}', '007/2026'), null, 'führende Null passt nicht zum Muster');
gleich(V.vlNummerLesen('HOL-{n}-{jj}', 'HOL-7-26'), { n: 7, jahr: '2026' }, 'kurzes Jahr lesen');
gleich(V.vlNaechsteNummer(kreis, '2026'), '121/2026', 'nächste im Jahr');
gleich(V.vlNaechsteNummer(kreis, '2027'), '1/2027', 'neues Jahr beginnt bei 1');
gleich(V.vlNaechsteNummer(null, '2026'), '', 'ohne Kreis kein Vorschlag');
gleich(V.vlNummerMerken(kreis, '121/2026'), { muster: '{n}/{jjjj}', letzte: { 2026: 121 } }, 'höhere Nummer gemerkt');
gleich(V.vlNummerMerken(kreis, '119/2026'), null, 'niedrigere Nummer ändert nichts');
gleich(V.vlNummerMerken(kreis, '120/2026'), null, 'gleiche Nummer ändert nichts');
gleich(V.vlNummerMerken(kreis, 'RE-5'), null, 'Nummer außerhalb des Musters');
gleich(V.vlNummerMerken(kreis, '3/2027').letzte, { 2026: 120, 2027: 3 }, 'neues Jahr dazu');
gleich(kreis.letzte, { 2026: 120 }, 'Kreis selbst unverändert');

// Vorlage anwenden
const stamm = { verkaeufer: 'Muster Holding GmbH', verkaeufstrasse: 'Musterallee 1', verkaeufplz: '40489',
  verkaeufstadt: 'Duesseldorf', verkaeufland: 'DE', verkaeufervat: 'DE111111125', iban: 'DE02120300000000202051',
  bic: 'BYLADEM1001', registernr: 'HRB 99999', verkaeuftel: '+49 211 0', verkaeuferemail: 'info@muster-holding.de' };
const umlage = {
  id: 'hol-umlage', werk: 'HOL', name: 'Umlage Muster Tochter', leistung: 'monat', zahlungszielTage: 0,
  daten: {
    kaeufer: 'Muster Tochter GmbH', kaeuferstrasse: 'Werkweg 3', kaeuferplz: '12345', kaeuferstadt: 'Musterstadt',
    steuerkategorie: 'O', befreiungsgrund: 'Nicht steuerbarer Innenumsatz (umsatzsteuerliche Organschaft)',
    notiz: 'Umlage für den Monat {monat}.',
    positionen: [{ beschreibung: 'Managementumlage {monat}', menge: 1, einheit: 'Monat', einzelpreis: 75000, mwst: 0 }],
  },
};
let a = V.vlAnwenden(umlage, { heute: '2026-10-02', stamm, kreis, kontakt: 'Erika Mustermann' });
gleich(a.felder.rechnungsnummer, '121/2026', 'Nummer aus dem Kreis');
gleich([a.felder.rechnungsdatum, a.felder.faelligkeitsdatum], ['2026-10-02', '2026-10-02'], 'sofort fällig');
gleich([a.felder.abrZeitraumStart, a.felder.abrZeitraumEnde], ['2026-10-01', '2026-10-31'], 'Leistungszeitraum Oktober');
gleich(a.felder.notiz, 'Umlage für den Monat Oktober 2026.', 'Notiz mit Monat');
gleich(a.positionen, [{ beschreibung: 'Managementumlage Oktober 2026', menge: 1, einheit: 'Monat', einzelpreis: 75000, mwst: 0 }], 'Position mit Monat');
gleich([a.felder.verkaeufer, a.felder.iban, a.felder.verkaeufkontakt, a.felder.verkaeuftel],
  ['Muster Holding GmbH', 'DE02120300000000202051', 'Erika Mustermann', '+49 211 0'], 'Stammdaten und Kontakt');
gleich([a.felder.kaeuferland, a.felder.waehrung, a.felder.rechnungsart, a.felder.kaeufermail], ['DE', 'EUR', '380', ''], 'Vorgaben');
gleich([a.felder.lieferdatum, a.felder.zahlungsreferenz, a.felder.vorrechnungsnummer], ['', '', ''], 'Felder der vorigen Rechnung leer');
a = V.vlAnwenden(umlage, { heute: '2026-11-03', monat: '2026-09', stamm, kreis });
gleich([a.felder.abrZeitraumStart, a.positionen[0].beschreibung], ['2026-09-01', 'Managementumlage September 2026'], 'Monat von Hand gesetzt');
a = V.vlAnwenden(Object.assign({}, umlage, { leistung: 'vormonat', zahlungszielTage: 14 }), { heute: '2026-10-06', stamm });
gleich([a.felder.abrZeitraumStart, a.felder.faelligkeitsdatum, a.felder.rechnungsnummer], ['2026-09-01', '2026-10-20', ''], 'Vormonat, 14 Tage, ohne Kreis');
a = V.vlAnwenden(null, { heute: '2026-10-06', stamm, kreis, kontakt: 'Erika Mustermann' });
gleich([a.felder.kaeufer, a.felder.abrZeitraumStart, a.felder.faelligkeitsdatum, a.positionen], ['', '', '', [{}]], 'leere Rechnung');
gleich(a.felder.verkaeufer, 'Muster Holding GmbH', 'leere Rechnung mit Stammdaten');
gleich(a.felder.rechnungsnummer, '121/2026', 'leere Rechnung mit Nummer');

// Aus dem Formular: Monat wird zu {monat}, Stammdaten und Rechnungsnummer bleiben draußen
const formular = Object.assign({}, a.felder, {
  kaeufer: 'Muster Energie GmbH', kaeuferstrasse: 'Hafenstrasse 8', kaeuferplz: '20457', kaeuferstadt: 'Hamburg',
  notiz: 'Abschlag für den Oktober 2026.', vertragsnummer: 'Garantievereinbarung vom 01.01.2025',
  rechnungsdatum: '2026-10-29', faelligkeitsdatum: '2026-10-29', abrZeitraumStart: '2026-10-01', abrZeitraumEnde: '2026-10-31',
  positionen: [{ posnr: '1', beschreibung: 'Vergütung Oktober 2026', details: '', menge: 14000, einheit: 'MWh', einzelpreis: 20, rabatt: 0, mwst: 19 }],
});
const daten = V.vlAusFormular(formular, '2026-10');
gleich(daten.notiz, 'Abschlag für den {monat}.', 'Notiz zurück');
gleich(daten.positionen, [{ posnr: '1', beschreibung: 'Vergütung {monat}', menge: 14000, einheit: 'MWh', einzelpreis: 20, mwst: 19 }], 'Position ohne leere Felder');
gleich(['verkaeufer', 'iban', 'rechnungsnummer', 'rechnungsdatum', 'kaeuferland', 'waehrung'].filter(k => k in daten), [], 'keine Stammdaten, Nummer, Vorgaben');
gleich(daten.verkaeufkontakt, 'Erika Mustermann', 'Kontakt kommt mit');
gleich(V.vlLeistungAus(formular), 'monat', 'Leistung im Monat');
gleich(V.vlLeistungAus(Object.assign({}, formular, { rechnungsdatum: '2026-11-04' })), 'vormonat', 'Leistung im Vormonat');
gleich(V.vlLeistungAus(Object.assign({}, formular, { abrZeitraumStart: '' })), 'keine', 'ohne Zeitraum');
// Hin und zurück ergibt dieselbe Rechnung
const zurueck = V.vlAnwenden({ leistung: 'monat', zahlungszielTage: 0, daten }, { heute: '2026-10-29', stamm });
gleich([zurueck.felder.notiz, zurueck.positionen[0].beschreibung], ['Abschlag für den Oktober 2026.', 'Vergütung Oktober 2026'], 'Rundweg');

// Liste
let d = V.vlLeer();
d = V.vlVorlageSpeichern(d, umlage);
d = V.vlVorlageSpeichern(d, { id: 'eis-1', werk: 'EIS', name: 'Leasing' });
d = V.vlVorlageSpeichern(d, { id: 'hol-a', werk: 'HOL', name: 'Abschlag' });
gleich(V.vlVorlagenFuer(d, 'hol').map(x => x.id), ['hol-a', 'hol-umlage'], 'je Werk, nach Name');
const vorher = d;
d = V.vlVorlageSpeichern(d, Object.assign({}, umlage, { name: 'Umlage neu', am: 'spaeter', von: 'jemand' }));
gleich([d.vorlagen.length, d.vorlagen[0].name, d.vorlagen[0].von], [3, 'Umlage neu', undefined], 'gleiche id ersetzt, Anleger bleibt');
gleich(vorher.vorlagen[0].name, 'Umlage Muster Tochter', 'alte Daten unverändert');
d = V.vlVorlageLoeschen(d, 'hol-a');
gleich(V.vlVorlagenFuer(d, 'HOL').map(x => x.id), ['hol-umlage'], 'gelöscht');
gleich(V.vlNeueId('HOL', 'Umlage März').startsWith('hol-umlage-ma-rz-'), true, 'id aus Werk und Name');

// Nummernvorschlag aus Zähler und den Nummern in AR_<Werk>
const kreisEis = { muster: '{n}/{jj}', letzte: { 2026: 134 } };
gleich(V.vlHoechsteNummer('{n}/{jj}', ['133/26', '136/26', '9000123', '140/25', ''], '2026'), 136, 'höchste im Jahr, fremde Formate zählen nicht');
gleich(V.vlNaechsteNummer(kreisEis, '2026', ['133/26', '136/26']), '137/26', 'AR liegt vor dem Zähler');
gleich(V.vlNaechsteNummer(kreisEis, '2026', ['120/26']), '135/26', 'Zähler liegt vor AR');
gleich(V.vlNaechsteNummer(kreisEis, '2026', null), '135/26', 'ohne AR wie bisher');
gleich(V.vlNaechsteNummer(kreisEis, '2027', ['136/26']), '1/27', 'neues Jahr');
gleich(V.vlAnwenden(null, { heute: '2026-11-02', kreis: kreisEis, vergeben: ['138/26'] }).felder.rechnungsnummer, '139/26', 'Übernehmen nutzt AR');
gleich(V.vlAnwenden(null, { heute: '2026-11-02' }).felder.zahlungsart, '58', 'Zahlungsart Vorgabe Überweisung');
gleich(V.vlAnwenden({ daten: { zahlungsart: '97' } }, { heute: '2026-11-02' }).felder.zahlungsart, '97', 'Zahlungsart aus der Vorlage');

// Speichern in die gesperrte Datei: _vlAendern mit nachgebildetem SharePoint
const konflikt = () => Object.assign(new Error('geändert'), { code: 'KONFLIKT' });
const sharepoint = (ladenFolge, speichern) => {
  let i = 0;
  global.spLoadVorlagen = async () => ladenFolge[Math.min(i++, ladenFolge.length - 1)];
  global.spSaveVorlagen = speichern;
  Object.assign(V._vl, { daten: null, etag: '', geladen: false, sichtbar: false, fehler: '' });
};
const ergaenzen = d => Object.assign(d, { neu: true });

(async () => {
  // Nicht freigegeben: Lesen 404, Anlegen scheitert, weil es die Datei gibt
  let versuche = 0;
  sharepoint([{ daten: null, etag: '' }], async () => { versuche++; throw konflikt(); });
  await assert.rejects(V._vlAendern(ergaenzen), { message: V.VL_NICHT_FREIGEGEBEN }); n++;
  gleich(versuche, 2, 'nach dem zweiten Versuch Schluss');

  // Jemand legt die Datei gerade an: beim zweiten Laden ist sie da, Speichern mit eTag klappt
  const gespeichert = [];
  sharepoint([{ daten: null, etag: '' }, { daten: V.vlLeer(), etag: '"e1"' }], async (d, etag) => {
    gespeichert.push(etag);
    if (!etag) throw konflikt();
    return '"e2"';
  });
  gleich(await V._vlAendern(ergaenzen), true, 'gleichzeitig angelegt');
  gleich([gespeichert, V._vl.etag, V._vl.daten.neu], [['', '"e1"'], '"e2"', true], 'zweiter Versuch mit eTag');

  // Freigegeben, aber jemand war schneller: neu laden, nochmal
  sharepoint([{ daten: V.vlLeer(), etag: '"a"' }, { daten: V.vlLeer(), etag: '"b"' }], async (d, etag) => {
    if (etag === '"a"') throw konflikt();
    return '"c"';
  });
  gleich(await V._vlAendern(ergaenzen), true, 'Konflikt mit eTag');
  gleich(V._vl.etag, '"c"', 'neuer eTag');

  console.log(`vorlagen: ${n} Prüfungen ok`);
})().catch(e => { console.error(e); process.exit(1); });
