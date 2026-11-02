# Ausgangsrechnungen SHB (Stahl- und Hartgusswerk Bösdorf) im Konverter

Stand: 02.11.2026

SHB erkennt der Konverter am Absender (shb-guss.de, Bösdorf, Hartgusswerk), an „Rechnungs-Nr.“ oder „Invoice No.“ und an einer Summenzeile („Nettowert“, „Rechnungsbetrag“ oder „Amount total“). Der Parser steht in `js/parser.js` (`_isGermanSHBInvoice`, `extractMetadataGermanSHB`, `extractBuyerGermanSHB`, `extractLineItemsGermanSHB`). Stammdaten: SHB Stahl- und Hartgusswerk Bösdorf GmbH, Werkstraße 7, 04249 Leipzig, USt-IdNr. DE812264517, Steuer-Nr. 232/118/07369, Amtsgericht Leipzig HRB 13893, Geschäftsführung Viktor Babushchak.

## Belegarten

Grundlage waren neun Belege vom November 2026, sechs mit Textebene und drei gescannt.

| Beleg | So kommt er an |
|---|---|
| Rechnung deutsch mit 19 % | Rechnung (380). Bezeichnung mit Menge, „Preis“ als Hauptposition, MTZ und ETZ als eigene Positionen |
| Rechnung mit zweiter Preiszeile | „Transport / Verpackg. (Rahmen)“, Modellkosten und Ähnliches werden eine eigene Position. Steht statt „Preis“ etwa „Modellaufbereitung“, kommt das an die Bezeichnung |
| Steuerfrei innergemeinschaftlich (deutsch oder englisch) | Ohne „Nettowert“ und MwSt-Zeile ist der Rechnungsbetrag netto, Steuer 0 %, Kategorie K. Die USt-IdNr. des Kunden kommt aus „I. Ust-Id-Nr“ oder „Your VAT-No.“, der Befreiungstext aus dem Beleg |
| Steuerfrei nach § 4 Nr. 2 UStG (Seeschifffahrt) | Kategorie E mit dem Befreiungstext aus dem Beleg, keine Ausfuhr |
| Anzahlungsrechnung | Titel „Anzahlungsrechnung“: Rechnungsart 386. Die Zeile „50 % Anzahlung“ ist die Hauptposition, „Diese Rechnung berechtigt nicht zum Vorsteuerabzug!“ geht in die Hinweise |
| Rechnung mit V-Nummer (Word) | „Rechnungs-Nr.: V2600030“, Bezeichnung in derselben Zeile wie „0001“, jede Zeile doppelt im PDF. Doppelte Zeilen zählen einmal |
| Proforma (englisch) | Wird gelesen, die App warnt vor dem Export. Ohne Lieferdatum lehnt KoSIT eine innergemeinschaftliche Lieferung ab (BR-IC-11) |

Bestellung des Kunden (BT-13), Kunden-Nr. (BT-46), Lieferschein (BT-16), Leistungsdatum und Lieferanschrift liest der Parser deutsch und englisch („Your Order No.“, „Cust. ID-No.“, „Delivery No.“, „Date of delivery“, „Delivery Address“). „Order N°“ ist der eigene Auftrag und wird nicht übernommen.

## Zahlungskonto

SHB druckt zwei Konten. Im Fuß steht DE07 8207 0000 0338 6695 00, die Zahlungsaufforderung („Wir erbitten die Zahlungen auf unser Konto …“, „Please send your payment to …“) nennt bei Rechnungen DE77 8207 0000 0338 6695 01, bei Proforma und Anzahlungen DE07 … 00. Bis 02.11.2026 nahm der Konverter immer das Konto aus dem Fuß. Jetzt gilt das Konto der Zahlungsaufforderung, ohne Aufforderung das aus dem Fuß. Eine IBAN mit falscher Prüfziffer (aus der Texterkennung) wird nicht übernommen. Liegt die IBAN bei derselben Bank wie das Stammdatenkonto, gilt dessen BIC (DEUTDE8EXXX), auch für andere Werke.

## Ansprechpartner und Hinweise

XRechnung verlangt Ansprechpartner, Telefon und E-Mail (BR-DE-5 bis 7). Steht „Uns. Zeichen“ im Kopf, ist das der Ansprechpartner, Telefon und E-Mail aus dem Kopf gehen dann vor die Stammdaten. Sonst gilt „Vertrieb“ mit Zentrale und sales@shb-guss.de.

Zahlungsbedingung („Zahlungseingang : Bis zum …“, „Zahlungsbedingung: 100 % Vorkasse“, „Payment Terms“, „Receipt of payment“) und Preisstellung kommen in die Hinweise. Die Zeile „Zahlungsbedingung: …“ wird BT-20, das Datum aus „Bis zum“ die Fälligkeit. Steht auf dem Beleg keine Zahlungsbedingung, fehlt beides, und KoSIT meldet BR-CO-25. Dann vor dem Export eintragen.

## Gescannte Belege

Drei der neun Belege waren Bilder ohne Textebene (Kopierer, „Microsoft Print to PDF“). Die App liest sie mit Tesseract (`js/ocr.js`). Der Parser verträgt die typischen Lesefehler: Semikolon statt Doppelpunkt, fehlende Leerzeichen („Date ofdelivery“, „Upto“), „pes.“ oder „pces.“ statt „pcs.“, „E€“ statt „€“, „Hartqusswerk“ und „Werkstr, 7“ in der Absenderzeile. Alle drei Scans kamen so vollständig und mit KoSIT ohne Fehler heraus. Die Texterkennung dauert etwa 10 Sekunden je Beleg und bleibt fehleranfälliger als ein PDF aus dem ERP. Besser ist es, wenn SHB die Rechnungen direkt als PDF aus dem System speichert statt zu drucken und zu scannen.

## Prüfung

- Sechs Belege mit Textebene: Kopf, Kunde, Steuer, Konto und Positionen richtig, Summen wie im Beleg. KoSIT: vier ohne Fehler, die Anzahlungsrechnung mit der bekannten Warnung zu 386, die Proforma mit BR-IC-11 (kein Lieferdatum).
- Drei Scans über die Texterkennung der App: Summen wie im Beleg, KoSIT ohne Fehler, die Anzahlung mit der Warnung zu 386.
- Test im Repo: `node tests/shb-ausgang.test.js` (erfundene Belege: steuerfrei innergemeinschaftlich, Inland mit Transportzeile, § 4 Nr. 2, Anzahlung mit doppelten Zeilen, englisch, OCR-Fehler).

## Grenzen

- Eine Länderzeile in der Lieferanschrift („Czech Republic“, „Griechenland“) landet im Namen der Lieferanschrift.
- Ohne Zahlungsbedingung auf dem Beleg bleibt die Fälligkeit leer (siehe oben).
