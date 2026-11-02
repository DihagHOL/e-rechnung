# Ausgangsrechnungen MEG (Meuselwitz Guss) im Konverter

Stand: 02.11.2026

Meuselwitz Guss druckt die Rechnungen aus dem ERP über pdfFactory. Briefkopf und Fuß sind Grafik und stehen nicht in der Textebene. Den Beleg erkennt der Konverter deshalb an der eigenen USt-IdNr. im Kopf („UST-ID.Nr. DE150528912“) zusammen mit „Rechnungs-Nr.“ oder „invoice-no.“. Der Parser steht in `js/parser.js` (`_isMegInvoice`, `extractMeg`).

Stammdaten aus dem Rechnungsfuß: Meuselwitz Guss Eisengießerei GmbH, Industriepark Nord, 04610 Meuselwitz, USt-IdNr. DE150528912, Amtsgericht Jena HRB 203104, Geschäftsführung Viktor Babushchak, Telefon +49 3448 82-0, info@meuselwitz-guss.de, Deutsche Bank IBAN DE11 8607 0000 0208 9860 00, BIC DEUTDE8LXXX. Weil der Fuß nicht im Text steht, kommen Bank und Register immer aus diesen Stammdaten. Ändert sich das Konto, muss die Registry in `js/parser.js` angepasst werden.

## Belegarten

Grundlage waren zehn Belege vom September und Oktober 2026.

| Beleg | So kommt er an |
|---|---|
| Rechnung deutsch mit 19 % | Rechnung (380). Je Position die erste Preiszeile als Hauptposition (Grundpreis, „Preis /% kg“), Material-TZ, Energie-TZ, Teuerungszuschlag, Transportkosten, Werkszeugnis und Bearbeitung als eigene Positionen |
| Invoice englisch, steuerfrei | „basic price“, „name:“, „delivery note:“, „item price“, „total price“. Ohne MWSt-Zeile 0 %, Kategorie K über das Land des Kunden |
| Steuerbefreite innergemeinschaftliche Lieferung | Kategorie K, Befreiungstext aus dem Beleg. Steht die USt-IdNr. des Kunden in der Lieferadresse, gibt sie das Land der Lieferung |
| Schlussrechnung über den Rest | „50% Rest“ kommt an die Bezeichnung. Die Anzahlungsrechnung aus der Anlage („50% Anzahlung #… vom …“) wird als vorausgegangene Rechnung übernommen (BT-25, BT-26) |
| Proforma-Rechnung | Wird gelesen, die App warnt vor dem Export |
| Position mit überlagertem Text | Bei einer Frachtzeile liegen im PDF zwei Texte übereinander („650,00650,00 EUR“). Passt die Summe der Preiszeilen nicht zur „Positionssumme“, wird die Position eine Pauschale über die Positionssumme |

Mengen: „2, ST“ sind 2 Stück, „1 x 8,8 %kg“ ist 1 Stück mit 8,8 mal 100 kg. Bei der Hauptposition ist der Einzelpreis Gesamt durch Stückzahl, Zuschläge je 100 kg werden Pauschalen mit der Angabe vom Beleg in der Positionsbeschreibung. Artikel-Nr., Zeichnungs-Nr., Werkstoff und die Material-Nr. des Kunden stehen in der Positionsbeschreibung, die Pos-Nr. des Kunden als Bestellposition (BT-132), der Lieferschein als Positionshinweis und sein Datum als Leistungsdatum der Position (BG-26). Fett gedruckte Zeilen stehen im PDF doppelt und zählen einmal.

Aus dem Kopf übernimmt der Konverter Kunden-Nr., Bestell-Nr. (BT-13), Lieferanten-Nr., die USt-IdNr. des Kunden und den Bearbeiter („Ihren Auftrag bearbeitet“) als Ansprechpartner. Telefon und E-Mail sind die der Zentrale. Zahlungsbedingung und Preisstellung kommen in die Hinweise, „30 Tage netto“ ergibt die Fälligkeit. Skonto mit Frist in Tagen („14 Tage 3% Skonto“, „bei 15 Tage 2% Abzug“) schreibt xrechnung.js jetzt maschinenlesbar ins XML, für alle Werke. Freitext im Kopf (Ursprungsland, Leistungsempfänger, Schlussrechnung) geht in die Hinweise.

Fehlt beim Kunden die Straße (nur Name, Abteilung, PLZ und Ort), wird die Zusatzzeile zur Adresszeile.

## Prüfung

- Alle zehn Belege: Kopf, Kunde, Steuer und Positionen richtig, Nettosumme, Steuer und Endbetrag wie im Beleg.
- KoSIT: alle zehn ohne Fehler und ohne Warnung.
- Im Browser über den echten Upload geprüft (Rechnung mit Skonto, steuerfreie Lieferung mit zehn Positionen), ohne Konsolenfehler.
- Test im Repo: `node tests/meg-ausgang.test.js` (erfundene Belege: deutsch mit doppelten Zeilen und überlagerter Frachtzeile, englisch steuerfrei, Schlussrechnung ohne Straße).

## Grenzen

- Bank, Register und Geschäftsführung stehen nur im Fuß als Grafik. Der Konverter kann sie nicht gegen den Beleg prüfen.
- Die Azure Function erkennt MEG beim Eingang noch nicht (`api/src/werk.js`), wie LEG und EWA auch.
