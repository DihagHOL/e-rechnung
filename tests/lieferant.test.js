// node tests/lieferant.test.js
// Erfundene Rechnungstexte in den Layouts, die pdf-parse bzw. pdf.js liefern.
const assert = require('assert');
const { lieferantAusText, istEigen } = require('../js/lieferant.js');

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };
const NL = String.fromCharCode(10);
const text = zeilen => zeilen.join(NL);

// 1) Absenderzeile oben, USt-IdNr. mit Leerzeichen im Fuß, eigene USt-IdNr. als „Ihre"
let r = lieferantAusText(text([
  'Muster Werkzeuge GmbH - Hauptstr. 5 - 01234 Musterstadt',
  'Walzengießerei Coswig GmbH', 'Grenzstraße 1', '01640 Coswig',
  'Rechnung 771234', 'Datum21.09.2026', 'Kundennummer4702',
  'Ihre Ust.Id DE140598967',
  'Summe869,90', 'MwSt. 19%165,28', 'Gesamt1.035,18',
  'Muster Werkzeuge GmbH', 'Hauptstr. 5', '01234 Musterstadt',
  'USt-Id-Nr.: DE 123 456 789', 'IBAN: DE14 7656 0060 0004 8843 96',
]));
gleich(r.name, 'Muster Werkzeuge GmbH', 'Name aus Absenderzeile');
gleich(r.vat, 'DE123456789', 'USt-IdNr. des Lieferanten, nicht die eigene');
gleich(r.nummer, '771234', 'Nummer hinter „Rechnung"');
gleich(r.datum, '2026-09-21', 'Datum angeklebt');
gleich(r.brutto, 1035.18, 'Gesamt angeklebt');
gleich(r.kleinunternehmer, false, 'kein § 19');

// 2) Werte vor den Beschriftungen, Nummer mit angeklebtem Wort
r = lieferantAusText(text([
  'Walzengießerei Coswig GmbH', 'Rechnung', 'Grenzstr. 1',
  '47835649', 'Rechnungs-Nr.:', '15.09.2026', 'Rechnungs-Datum:', '01640 Coswig',
  'Rechnung Nr. 914722Kunden Nr. 103160',
  'Beispiel Technik GmbH & Co. KG | Postfach 2001 | 71268 Renningen',
  'Rechnungsbetrag:', '         967,03',
  'Beispiel Technik GmbH & Co.KG', 'USt.Id.Nr. DE 987654321',
]));
gleich(r.nummer, '47835649', 'Wert vor der Beschriftung');
gleich(r.datum, '2026-09-15', 'Datum vor der Beschriftung');
gleich(r.brutto, 967.03, 'Betrag in der Zeile danach');
gleich(r.name, 'Beispiel Technik GmbH & Co. KG', 'GmbH & Co. KG vollständig');
gleich(r.vat, 'DE987654321', 'USt-IdNr. im Fuß');

// 3) Absender ohne Rechtsform, Kleinunternehmer
r = lieferantAusText(text([
  'Malerbetrieb Kunz, Am Markt 3, 04509 Delitzsch',
  'DIHAG Zaigler GmbH', 'Rechnung', 'Rechnungsnummer: 2026-118', 'Rechnungsdatum: 02.02.2027',
  'Malerarbeiten Halle 2', 'Gesamtbetrag 1.480,00 EUR',
  'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
]));
gleich(r.name, 'Malerbetrieb Kunz', 'Absender ohne Rechtsform');
gleich(r.nummer, '2026-118', 'Rechnungsnummer mit Label');
gleich(r.datum, '2027-02-02', 'Rechnungsdatum mit Label');
gleich(r.kleinunternehmer, true, '§ 19 UStG erkannt');
gleich(r.vat, '', 'keine USt-IdNr.');

// 4) Nur eigene Gesellschaften im Text: kein Lieferant
r = lieferantAusText(text([
  'SHB Stahl- und Hartgusswerk Bösdorf GmbH', 'USt-IdNr. DE 812 264 517',
  'Lintorfer Eisengießerei GmbH', 'Rechnung Nr. 4711', 'Datum: 01.03.2026', 'Endbetrag 120,00',
]));
gleich(r.name, '', 'eigene Gesellschaft nie als Lieferant');
gleich(r.vat, '', 'eigene USt-IdNr. nie als Lieferant');

// 5) Scan ohne Text
r = lieferantAusText('   ');
gleich(r.lesbar, false, 'Scan erkannt');
gleich(r.name + r.vat + r.nummer, '', 'Scan liefert nichts');

// 6) IBAN nicht als USt-IdNr.
r = lieferantAusText(text([
  'Probe Handel AG · Ring 1 · 10115 Berlin', 'Rechnung Nr. 55501', 'Datum 03.03.2026',
  'Bankverbindung IBAN DE12345678901234567890', 'Zu zahlen 99,00',
]));
gleich(r.vat, '', 'IBAN ist keine USt-IdNr.');
gleich(r.name, 'Probe Handel AG', 'AG aus Absenderzeile');

// 7) Mailadresse: Rechnungspostfach vor info@, eigene und noreply fallen weg
r = lieferantAusText(text([
  'Muster Werkzeuge GmbH - Hauptstr. 5 - 01234 Musterstadt',
  'Walzengießerei Coswig GmbH', 'Grenzstraße 1', '01640 Coswig',
  'Ihr Zeichen: einkauf@walze-coswig.de',
  'Rechnung 771234', 'Datum 21.09.2026', 'Gesamt 1.035,18',
  'Muster Werkzeuge GmbH · Hauptstr. 5 · Tel. 0123 4567 · E-Mailinfo@muster-werkzeuge.de',
  'Rechnungsfragen: rechnung (at) muster-werkzeuge.de · noreply@muster-werkzeuge.de',
  'Datenschutz: datenschutz@muster-werkzeuge.de',
]));
gleich(r.mail, 'rechnung@muster-werkzeuge.de', 'Rechnungspostfach des Lieferanten');
r = lieferantAusText(text([
  'Probe Handel AG · Ring 1 · 10115 Berlin', 'DIHAG Zaigler GmbH', 'Rechnung Nr. 55501', 'Datum 03.03.2026',
  'Ansprechpartner: Max Probe, Mail: max.probe@probe-handel.de', 'Zu zahlen 99,00', 'www.probe-handel.de  info@probe-handel.de',
]));
gleich(r.mail, 'info@probe-handel.de', 'allgemeines Postfach vor Person');
r = lieferantAusText(text([
  'Probe Handel AG · Ring 1 · 10115 Berlin', 'Rechnung Nr. 55501', 'Datum 03.03.2026', 'Zu zahlen 99,00',
  'Rechnungen bitte an rechnungseingang@dihag.com', 'Bestellt von a.muster@dihag-gienanth.com',
]));
gleich(r.mail, '', 'nur eigene Adressen: keine');

// 8) Lieferant im Ausland: Anschrift im Kopf, USt-IdNr. und IBAN (Beispiel-IBAN mit gültiger Prüfziffer)
r = lieferantAusText(text([
  'Beispiel Fonderia S.r.l. - Via Roma 12 - I-25100 Brescia',
  'Walzengießerei Coswig GmbH', 'Grenzstraße 1', '01640 Coswig', 'Germany',
  'Fattura / Rechnung Nr. 2027118', 'Datum 04.02.2027', 'Totale 4.210,00',
  'Partita IVA / VAT No. IT01234567897',
  'IBAN IT60 X054 2811 1010 0000 0123 456',
]));
gleich(r.ausland && r.ausland.land, 'IT', 'Italien erkannt');
gleich(r.ausland.gruende, ['Anschrift im Kopf: Italien', 'USt-IdNr. IT01234567897', 'IBAN IT'], 'alle drei Hinweise');
gleich(r.ausland.sicher, true, 'nichts spricht dagegen');

r = lieferantAusText(text([
  'Muster Gießerei GmbH · Hauptplatz 1 · A-4020 Linz', 'DIHAG Zaigler GmbH', 'Gummistraße 28', '95326 Kulmbach',
  'Rechnung Nr. 55012', 'Datum 03.03.2027', 'Zu zahlen 980,00', 'UID-Nr. ATU12345678',
]));
gleich(r.ausland && r.ausland.landName, 'Österreich', 'Kennzeichen vor der Postleitzahl');

// Anschrift im Kopf im Ausland, aber deutsche IBAN: nur ein Hinweis zum Prüfen
r = lieferantAusText(text([
  'Probe Metal Sp. z o.o.', 'ul. Długa 5', '00-950 Warszawa', 'Polska',
  'DIHAG Zaigler GmbH', 'Rechnung Nr. 77001', 'Datum 03.03.2027', 'Zu zahlen 1.200,00',
  'IBAN: DE89 3704 0044 0532 0130 00',
]));
gleich([r.ausland.land, r.ausland.sicher, r.ausland.dagegen], ['PL', false, ['IBAN DE']], 'Gleichstand bleibt ein Hinweis');

// Deutscher Lieferant mit Bank in Finnland, Lieferanschrift in den Niederlanden, Lastschrift vom eigenen Konto
r = lieferantAusText(text([
  'Muster Reinigungstechnik GmbH', 'Industriestr. 4', '89000 Musterstadt',
  'Musterbank Abp, Finland', 'IBAN FI21 1234 5600 0007 85',
  'DIHAG Zaigler GmbH', 'Lieferanschrift:', 'Muster Lager', 'Hafenweg 1', 'NL-1234 AB Rotterdam',
  'Rechnung Nr. 31025', 'Datum 20.10.2026', 'Zu zahlen 410,00', 'USt-IdNr. DE123456789',
  'Wir buchen per Lastschrift von Ihrem Konto IBAN AT61 1904 3002 3457 3201 ab',
]));
gleich(r.ausland, null, 'Bankzeile, Lieferanschrift und Lastschrift zählen nicht');

// Kein Hinweis: deutscher Lieferant ohne Auslandsbezug, IBAN mit falscher Prüfziffer
r = lieferantAusText(text([
  'Probe Handel AG · Ring 1 · 10115 Berlin', 'Rechnung Nr. 55501', 'Datum 03.03.2026',
  'Bankverbindung IBAN IT61 X054 2811 1010 0000 0123 456', 'Zu zahlen 99,00',
]));
gleich(r.ausland, null, 'IBAN mit falscher Prüfziffer zählt nicht');

// Eigene USt-IdNr.: dieselben wie im Prüfdienst (api/src/eigene.js), dazu SCH
const { EIGENE_VAT } = require('../js/lieferant.js');
const vatQuelle = require('fs').readFileSync(require('path').join(__dirname, '..', 'api', 'src', 'eigene.js'), 'utf8');
const prueferVat = (/EIGENE_UST_IDS = \[([^\]]+)\]/.exec(vatQuelle)[1].match(/DE\d{9}/g));
gleich(prueferVat.filter(v => !EIGENE_VAT.includes(v)), [], 'alle eigenen USt-IdNr. des Prüfdienstes');

gleich(istEigen('DIHAG Holding GmbH'), true, 'DIHAG eigen');
gleich(istEigen('Meuselwitz Guss GmbH'), true, 'MEG eigen');
gleich(istEigen('Telekom Deutschland GmbH'), false, 'fremd');

const { istEigeneMail, textAusItems } = require('../js/lieferant.js');
// Zeilen aus OCR-Stücken: gleiche Seite und fast gleiche Höhe = eine Zeile, links nach rechts
gleich(textAusItems([{ text: 'GmbH', x: 60, y: 701, page: 1 }, { text: 'Muster', x: 10, y: 700, page: 1 },
  { text: 'Rechnung', x: 10, y: 650, page: 1 }, { text: 'Fuß', x: 10, y: 800, page: 2 }]).split(NL),
  ['Muster GmbH', 'Rechnung', 'Fuß'], 'Zeilen aus OCR-Stücken');
gleich(istEigeneMail('rechnung@dihag-zaigler.com'), true, 'Zaigler-Mail eigen');
gleich(istEigeneMail('info@ewa-guss.de'), true, 'EWA-Mail eigen');
gleich(istEigeneMail('info@muster.de'), false, 'fremde Mail');

// Beträge, Fälligkeit, Währung (erfundene Texte)
{
  const kopf = 'Muster Werkzeuge GmbH\nMusterstraße 1, 01234 Musterstadt\nUSt-IdNr.: DE123456789\nRechnung Nr. 4711\nRechnungsdatum: 01.10.2026\n';
  const lies = t => lieferantAusText(kopf + t);
  let l = lies('Nettobetrag EUR 1.000,00\nMWSt. 19,00 % 190,00\nGesamtbetrag 1.190,00\nzahlbar bis 31.10.2026');
  gleich([l.netto, l.brutto, l.faelligkeit, l.summenGeprueft, l.waehrung], [1000, 1190, '2026-10-31', true, ''], 'Summenzeilen');
  l = lies('Warenwert\n1.000,00\nUSt 7 %\n70,00\nEndbetrag\n1.070,00');
  gleich([l.netto, l.brutto], [1000, 1070], 'Werte in der Zeile darunter, 7 %');
  l = lies('Pos 1 Schraube 100,00\nPos 2 Mutter 400,00\n500,00\n95,00\n595,00');
  gleich([l.netto, l.brutto, l.summenGeprueft], [500, 595, true], 'ohne Beschriftung: netto + Steuer = brutto');
  l = lies('Nettosumme 800,00\nRechnungsbetrag 1.190,00');
  gleich([l.netto, l.brutto], [null, 1190], 'Netto passt nicht zum Brutto: lieber leer');
  l = lies('Zwischensumme: 71,61 EUR\nSeite 2\nSumme 178.94 EUR');
  gleich([l.netto, l.brutto], [null, null], 'Zwischensumme allein ist kein Netto');
  l = lies('Gesamtbetrag 1.190,00\nZahlungsbedingung: 14 Tage 2 % Skonto, 30 Tage netto');
  gleich(l.faelligkeit, '2026-10-31', 'Tage netto ab Rechnungsdatum, nicht die Skontofrist');
  l = lies('Bei Zahlung bis 08.10.2026 2 % Skonto\nZahlung rein netto bis 22.10.2026');
  gleich(l.faelligkeit, '2026-10-22', 'Skontodatum zählt nicht');
  l = lies('Zahlungskonditionen:\n30 Tagen nach Rechnungsdatum ohne Abzug Zahlung bis 31.10.2026');
  gleich([l.datum, l.faelligkeit], ['2026-10-01', '2026-10-31'], 'Zahlungsbedingung ist kein Rechnungsdatum');
  l = lies('zahlbar sofort ohne Abzug');
  gleich(l.faelligkeit, '2026-10-01', 'sofort');
  l = lies('Gesamtbetrag 1.190,00');
  gleich(l.faelligkeit, '', 'ohne Angabe keine Fälligkeit');
  l = lies('Total CZK 12 100,00\nDPH CZK 2 100,00\nBetrag in CZK\nSumme CZK 10 000,00');
  gleich(l.waehrung, 'CZK', 'Fremdwährung');
}

console.log(`lieferant: ${n} Pruefungen gruen`);
