# Manuelle Rechnungen aus Vorlagen

Reiter **Manuelle Rechnung** (`index.html?modus=manuell`, Code in `js/vorlagen.js`). Er ist für
Rechnungen gedacht, die bisher in Word entstanden, etwa die Managementumlagen der Holding an die
Werke oder die monatliche Abschlagsrechnung aus einer Garantievereinbarung. Auch diese Rechnungen
müssen E-Rechnungen sein. Der Reiter nutzt dafür das Formular und den Export des Konverters.

## Ablauf

1. Werk wählen, z. B. HOL. Die Stammdaten des Rechnungsstellers kommen aus der Registry in
   `js/parser.js` und sind wie im Konverter gesperrt. Entsperren lassen sie sich nicht, ein anderes
   Werk bringt seine eigenen Stammdaten mit.
2. Vorlage und Leistungsmonat wählen, „Übernehmen“. Das Formular füllt sich mit Empfänger, Texten,
   Positionen und Steuerangaben. Rechnungsdatum ist heute, Fälligkeit und Leistungszeitraum folgen
   aus der Vorlage, die Rechnungsnummer aus dem Nummernkreis.
3. Alles außer den Stammdaten prüfen und bei Bedarf ändern (z. B. die Menge in MWh). Die Vorschau links zeigt das PDF so,
   wie es erzeugt wird.
4. Wie im Konverter „ZUGFeRD“ oder „XRechnung“ erzeugen oder „Mail erstellen“. Die Rechnung landet in
   `AR_<Werk>` im Monitoring. Wer dort ablegen soll, braucht „Mitwirken“ auf dieser Bibliothek.

Ein Original-PDF gibt es nicht, das PDF entsteht immer aus den Rechnungsdaten (PDF/A-3b, PDF und
XML stimmen überein). Die Fußzeile lautet „E-Rechnung nach EN 16931 · erstellt mit DIHAG E-Rechnung“.

## Vorlagen

Gespeichert in SharePoint, sites/IT, `Dokumente/E-Rechnung/rechnungsvorlagen.json`. Die Datei
enthält Kunden und Beträge und liegt deshalb nicht im Repo. Sie hat eigene Rechte, die Gruppe
„alle Werke“ hat darauf keinen Zugriff. Nur wer an der Datei „Mitwirken“ hat (seit 02.11.2026 die
HOL-Buchhaltung und die IT), sieht Vorlagen und Nummernkreis und kann Vorlagen anlegen, ändern und
löschen. Alle anderen bekommen im Reiter nur die leere Rechnung mit den Stammdaten und einen Hinweis.
Neue Personen, etwa für EIS, bekommen „Mitwirken“ direkt an der Datei (SharePoint, Zugriff verwalten).

- **Als Vorlage speichern** nimmt den Stand des Formulars: Empfänger, Rechnungsempfänger-Adresse,
  Referenzen, Notiz, Steuerkategorie, Positionen und den Ansprechpartner. Stammdaten,
  Rechnungsnummer, Daten und Anlagen gehören nicht zur Vorlage.
- Der Leistungsmonat wird im Text zu `{monat}` („Oktober 2026“), `{jahr}` steht für sein Jahr.
  Beim Übernehmen wird beides wieder ersetzt.
- Ob die Leistung im Monat des Rechnungsdatums oder im Vormonat liegt, merkt sich die Vorlage aus
  dem Leistungszeitraum. Ohne Zeitraum gibt es keinen Leistungsmonat.
- Das Zahlungsziel in Tagen ergibt sich aus Rechnungs- und Fälligkeitsdatum.
- Speichern läuft mit eTag: Hat jemand die Datei inzwischen geändert, lädt die App neu und
  versucht es noch einmal.

```json
{
  "version": 1,
  "nummernkreise": { "HOL": { "muster": "{n}/{jjjj}", "letzte": { "2026": 120 } } },
  "vorlagen": [{
    "id": "hol-umlage-…", "werk": "HOL", "name": "Managementumlage …",
    "leistung": "monat", "zahlungszielTage": 0,
    "daten": { "kaeufer": "…", "steuerkategorie": "O", "notiz": "… für den Monat {monat} …",
               "positionen": [{ "beschreibung": "Managementumlage {monat}", "menge": 1,
                                "einheit": "Monat", "einzelpreis": 0, "mwst": 0 }] },
    "am": "…", "von": "…", "geaendertAm": "…", "geaendertVon": "…"
  }]
}
```

## Nummernkreis

Je Werk ein Muster mit `{n}` und `{jjjj}` (oder `{jj}`) und die letzte vergebene Nummer je Jahr.
Der Reiter schlägt die Nummer nach der höchsten vor, die er im Zähler oder unter den Rechnungen in
`AR_<Werk>` findet (Titel nach dem Muster im Jahr des Rechnungsdatums, andere Formate wie SAP-Nummern
zählen nicht). Die Liste lädt er beim Wechsel des Werks und vor jedem „Übernehmen“ neu. Nach dem
Erzeugen merkt er sich die verwendete Nummer, wenn sie höher ist. Rechnungen, die in Word entstehen
und nicht im Monitoring liegen, kennt er nicht. Deshalb prüft der Reiter vor dem Erzeugen, ob die
Nummer in `AR_<Werk>` schon vorkommt, und fragt dann nach.

## Neu im Konverter (gilt für beide Reiter)

| Feld | XML | Hinweis |
|------|-----|---------|
| Leistungszeitraum von/bis | BG-14 (BT-73, BT-74) | z. B. der Monat einer Umlage, ersetzt das Leistungsdatum |
| Vertragsreferenz | BT-12 | z. B. „Garantievereinbarung vom …“ |
| Steuerkategorie O | BT-118 = O, BT-121 = VATEX-EU-O | nicht steuerbar, z. B. Innenumsatz in der Organschaft |
| Einheiten kWh, MWh | KWH, MWH | |
| Zahlungsart | BT-81 | Überweisung (58, Standard), SEPA-Lastschrift (59) oder Verrechnung (97). Bei Lastschrift und Verrechnung steht das eigene Konto nicht in XML und PDF |
| Lastschrift: IBAN des Kunden, Mandatsreferenz, Gläubiger-ID | BT-91, BT-89, BT-90 | nur bei Lastschrift sichtbar und dann Pflicht (BR-DE-25, BR-DE-30, BR-DE-31) |
| Leistung am / von, bis je Position | BG-26 (BT-134, BT-135) | in den Details der Position, z. B. das Entnahmedatum. Nur „von“ ergibt einen Leistungstag |

Bei Kategorie O lässt das XML die USt-IdNr. von Verkäufer und Käufer weg (BR-O-02) und die
Positionen tragen keinen Steuersatz (BR-O-05). Positionen mit Umsatzsteuer sind daneben nicht
erlaubt, das Formular meldet das. Geprüft mit KoSIT (XRechnung grün) und veraPDF (PDF/A-3b), siehe
die Fälle `hol_innenumsatz_O` und `hol_abschlag_19_mwh` in `validation/generate-samples.js`.

Seit 02.11.2026 trägt ein ZUGFeRD für Kunden im Inland das ZUGFeRD-Profil XRECHNUNG (Anhang
`xrechnung.xml`, XMP `ConformanceLevel` XRECHNUNG). KoSIT und unser Eingang bewerten es damit grün.
Für Kunden im Ausland bleibt es beim Profil EN 16931 (`factur-x.xml`), weil Factur-X-Leser dort das
deutsche Profil nicht kennen müssen. KoSIT meldet dazu zwei Hinweise (Business process, BR-DE-21),
die Rechnung ist trotzdem gültig. `js/zugferd.js` liest das Profil aus dem XML, PDF und XML passen
also immer zusammen. Geprüft mit `zahlung_lastschrift_59` und `zahlung_verrechnung_97`.

## Werke

| Werk | Stand |
|------|-------|
| HOL | Stammdaten DIHAG Holding GmbH (Sitz Düsseldorf), Nummernkreis `{n}/{jjjj}`, Vorlagen für die Managementumlagen an zwei Werke und einen monatlichen Abschlag nach Menge (MWh) |
| EIS | Stammdaten DIHAG Gienanth GmbH, im Reiter mit der Bank der bisherigen Word-Rechnungen (Sparkasse Donnersberg, Registry `_manuell`), Nummernkreis `{n}/{jj}`, Vorlagen für Material nach Entnahmeschein, eine monatliche Dienstleistung und eine anteilige Weiterbelastung |

Eine Vorlage kann Positionen ohne Menge mitbringen, etwa die üblichen Artikel mit ihren Preisen
beim Material nach Entnahmeschein. Das Mengenfeld bleibt dann leer, und der Reiter erzeugt die
Rechnung erst, wenn jede Position eine Menge hat. Nicht benötigte Positionen werden gelöscht.

Einzelpreise gehen mit bis zu vier Nachkommastellen ins XML (z. B. 1,764 €), damit Menge mal Preis
die Zeilensumme ergibt. Das gilt auch im Konverter. Geprüft mit dem Fall `manuell_preis_3_stellen`.
