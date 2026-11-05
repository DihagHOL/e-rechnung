# Ausgangsrechnungen LEG (Lintorfer Eisengießerei) im Konverter

Stand: 05.11.2026

Die Lintorfer Eisengießerei stellt ihre Rechnungen mit demselben SAP Adobe-Formular wie das Eisenwerk Arnstadt. Der Konverter liest beide mit einem Parser. Wie der Beleg gelesen wird, welche Felder übernommen werden und wie Währung, Adresszusatz und Skonto behandelt werden, steht in [Ausgangsrechnungen-EWA.md](Ausgangsrechnungen-EWA.md). Hier stehen nur die Besonderheiten von LEG.

Das Werk erkennt der Konverter am Fuß (lintorfereg.de, HRB 42982). Stammdaten: Lintorfer Eisengießerei GmbH, Rehhecke 83-87, 40885 Ratingen, USt-IdNr. DE811154479, Steuer-Nr. 147/5846/1173, Amtsgericht Düsseldorf HRB 42982, Geschäftsführung Dipl.-Ing. Gunnar Jentsch und Viktor Babushchak. Kontakt-Mail ist info@lintorfereg.de aus dem Fuß, die Bankverbindung kommt aus dem Beleg.

## Belegarten

Grundlage waren zehn Musterbelege.

| Beleg | So kommt er an |
|---|---|
| Rechnung deutsch mit und ohne USt, englisch, französisch | Rechnung (380), Steuer 19 % oder steuerfreie innergemeinschaftliche Lieferung |
| Rechnung mit Fracht | „Frachtzuschlag 130,90" oder „Freight in Delivery 123.50" unter der Zwischensumme wird eine eigene Position |
| Anzahlungsrechnung | Vor den Positionen steht „100% Anzahlung bei Auftragserteilung", die Position hat keinen Preis, der Betrag steht nur im Endbetrag. Der Konverter macht daraus eine Vorauszahlungsrechnung (386) über den Endbetrag. |
| Schlussrechnung | Der Block „Anzahlungen" vor den Positionen (Nettobetrag, Steuerbetrag, Endbetrag, Haben-Betrag) wird als „bereits gezahlt" übernommen (BT-113). Der Zahlbetrag ist Endbetrag minus Haben-Betrag. |
| Lastschrift | Läuft als Rechnung (380), XRechnung lässt den Code für Lastschriften nicht zu. Mit dem Hinweis auf § 13b UStG wird die Steuer als Reverse Charge (AE) ausgewiesen. |
| Modellkosten, Dienstleistung | Normale Rechnung, die Einheit „LE" wird zu Stück |

Bei den Positionen kommen Metall- und Energieteuerungszuschlag (MTZ, ETZ) je 1.000 kg zum Preis hinzu, wie der Teuerungszuschlag bei EWA. Seriennummern, Zeichnungsnummer und Werkstoff stehen in der Positionsbeschreibung.

Der Anzahlungsbeleg hat deutsche Beschriftung, aber englische Zahlen (20,100.00). Deshalb bestimmt der Konverter das Zahlenformat aus den Beträgen und nicht aus der Sprache.

## Umfang

Wie bei EWA: Rechnungen an Kunden im Inland wandelt der Konverter ohne Rückfrage um. Bei EU-Ausland und Drittland weist er beim Laden darauf hin und fragt beim Export nach. Eine Erinnerung an ein unterschriebenes Original gibt es nicht.

## PDF/A beim ZUGFeRD

Das SAP-Formular verweist nur auf die Schriften Helvetica und Helvetica-Bold und bettet sie nicht ein. PDF/A-3b verlangt eingebettete Schriften (veraPDF-Regel 6.2.11.4.1), alles andere erfüllt das Formular schon. Bis zum 05.11.2026 fiel jedes LEG-Original deshalb bei der Prüfung durch, und der Konverter hat die ZUGFeRD-Rechnung aus den Daten im eigenen Layout erzeugt.

Jetzt bettet der Konverter beim ZUGFeRD-Export Liberation Sans ein. Die Schrift hat dieselben Laufweiten wie Helvetica, das SAP-Layout bleibt also. Bei allen zehn Musterbelegen steht danach jedes Zeichen an derselben Stelle wie im Original, und veraPDF meldet PDF/A-3b ohne Fehler. Für EWA gilt dasselbe, das Formular ist das gleiche.

## Prüfung

- Alle zehn Musterbelege liest der Parser vollständig, Nettosumme, Steuer und Endbetrag stimmen.
- KoSIT: neun ohne Fehler und Warnung. Die Anzahlungsrechnung ist gültig, XRechnung warnt aber beim Code 386, weil es ihn nicht empfiehlt.
- Die elf EWA-Belege laufen nach dem Umbau auf den gemeinsamen Parser weiter ohne Fehler und Warnung.
- Im Browser mit pdf.js geprüft: Rechnung mit Fracht, Versandanschrift und Skonto, Schlussrechnung mit Zahlbetrag 0.
- Test im Repo: `node tests/leg-ausgang.test.js` (erfundene Belege: Anzahlung mit englischen Zahlen, Schlussrechnung, Lastschrift mit § 13b und Fracht).

## Grenzen

- Die Schlussrechnung nennt die Anzahlungsrechnung nicht mit Nummer. Ein Bezug (BT-25) auf die Anzahlung fehlt deshalb.
- Zusatzzeilen der Versandanschrift (zum Beispiel der Name eines Werks oder einer Halle) haben in der Lieferanschrift kein eigenes Feld.
