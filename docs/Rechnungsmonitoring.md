# Rechnungsmonitoring (Dashboard)

Der Reiter **`monitoring.html`** (`js/monitoring.js`) ist das werkübergreifende
Dashboard über alle Rechnungsbibliotheken einer eigenen SharePoint-Site
(`dihag.sharepoint.com/sites/Rechnungsmonitoring`). Es liest die Bibliotheken
**`ERAR_<Werk>`** (Eingang), **`AR_<Werk>`** (Ausgang) und optional die zentrale
`Rechnungseingang`-Stufe, aggregiert sie zu einer filterbaren Tabelle mit KPI-Kacheln.

Provisioniert werden die Bibliotheken/Spalten mit
[`scripts/provision-rechnungsmonitoring.ps1`](../scripts/provision-rechnungsmonitoring.ps1),
der Eingangs-Flow steht in [`Eingangsrechnungen-Flow.md`](Eingangsrechnungen-Flow.md).

---

## Zugriff

Welche Werke ein Benutzer sieht, steht in den **Einstellungen** (`einstellungen.html`, nur
Admins): Dort werden Werke angelegt und Benutzer (UPN) je Werk eingetragen. Die Zuweisung
gilt für Exportverlauf, Monitoring und die Werkauswahl im Konverter (`erlaubteWerke` in
`js/access.js`). Wer keinem Werk zugewiesen ist, sieht keins, Admins sehen alles. Beim Öffnen
ist das zugewiesene Werk im Filter vorgewählt (bei mehreren das erste), „Alle Werke“ bleibt
wählbar.

Je Werk und Person gibt es eine **Rolle**: **FIBU** sieht Eingangs- und Ausgangsrechnungen
(`ERAR_<Werk>` und `AR_<Werk>`), **Vertrieb** nur Ausgangsrechnungen (`AR_<Werk>`). Ohne Angabe
gilt FIBU, so wie vor den Rollen. Gespeichert wird nur der Vertrieb, in `access-config.json`
unter `_rollen` (`{ "wgc": { "name@…": "vertrieb" } }`). Die zentrale `Rechnungseingang`-Stufe
sieht, wer in mindestens einem Werk FIBU ist. Für eine Person, die nur Vertrieb ist, nennt der
Untertitel „Rolle Vertrieb: nur Ausgangsrechnungen“. Lieferantenregister und Liste
`KreditorMails` gehören zum Eingang und werden für so eine Person nicht geladen. Werk und Rolle
steuern die Anzeige, den tatsächlichen Zugriff regeln die SharePoint-Rechte:

| Rolle | `AR_<Werk>` | `ERAR_<Werk>` | Lieferantenregister, `KreditorMails` | `monitoring-einstellungen.json` |
|---|---|---|---|---|
| FIBU | Mitwirken | Lesen oder Mitwirken | Lesen oder Mitwirken | Lesen |
| Vertrieb | Mitwirken (für den Export aus dem Konverter) | keine | keine | Lesen |

Bibliotheken, die noch die Site-Rechte erben, bekommen dafür eigene Rechte (Kopie der bisherigen).

## Laden

- **Nacheinander und seitenweise**: immer nur ein Abruf gegen SharePoint, die Tabelle
  füllt sich nach jeder Seite, Fortschritt im Untertitel. 429/503 werden wiederholt, eine
  Bibliothek mit Fehler hält die anderen nicht auf.
- **Neueste zuerst** (`$orderby=fields/Created desc`). Jenseits von 5000 Items verlangt
  `$orderby` eine indizierte `Created`-Spalte (setzt das Provisioning), sonst lädt das
  Monitoring ungeordnet alles.
- **Die letzten 6 Monate** (`MON.ladeMonate`): Je Bibliothek endet das Laden, sobald eine
  Seite vor diesen Tag reicht. Liegt danach noch etwas, steht „geladen ab …“ unter dem Titel
  und der Knopf **„Ältere laden“** über der Tabelle holt je weitere 6 Monate, dort weiter, wo
  das Laden aufgehört hat. Ein festes Limit gibt es nicht mehr. Kacheln, Suche und Dubletten
  gelten für das, was geladen ist. Eine Dublette zu einer Rechnung vor diesem Tag zeigt sich
  also erst nach „Ältere laden“.

## Zeilen-Aggregation

Eine Rechnung besteht oft aus mehreren Dateien (Original-PDF/-XML, extrahierte XML,
lesbares PDF, KoSIT-Bericht). Sie werden zu **einer Zeile** zusammengefasst (Gruppierung
über `baseKey` = Dateiname ohne Endung, Sidecar-Suffix und Datum). Die Dateien stehen als
kurze Abzeichen in der letzten Spalte: **PDF/XML** (Original), **Lesbar**, **Bericht**.

**Rechnungsnummer:** Sie steht im `Title`. Bei XML-Dateien setzt SharePoint den `Title`
selbst auf den Dateinamen (`20261967_DE811979246.xml`), auch wenn der Flow die Nummer
schreibt. Ein solcher Title zählt nicht. Dann gilt der Title einer anderen Datei der
Rechnung (Original-PDF, lesbares PDF), sonst wird die Nummer aus dem Dateinamen abgeleitet:
die USt-IdNr. bzw. das Lieferantenkürzel aus `dateibasis` und ein Zeitstempel einer zweiten
Datei (`_JJJJMMTThhmmss`) fallen weg. Eine Korrektur unter „Bearbeiten“ geht vor.

**Eine Mail = ein Vorgang:** Der Eingangs-Flow legt jeden Anhang als eigene Datei ab und
schreibt in die Spalte `MailVorgang` den Namen seines Laufs, bei allen Anhängen einer Mail
also denselben Wert (alle Werke, bei WGC, SHB und ZAI seit 05.11.2026). Das Monitoring fasst
danach zusammen:

- E-Rechnungen (ZUGFeRD, XRechnung) bleiben **je Rechnung eine Zeile**. Die Details nennen
  unter „In derselben Mail“ die anderen Nummern. PDF und XML derselben Rechnung (gleiche
  Nummer, gleicher Lieferant) sind eine Zeile und keine Dublette.
- Normale PDFs (Leistungsnachweis, Lieferschein, Belege einer Reisekostenabrechnung) kommen
  als **Anlagen** an die erste E-Rechnung der Mail.
- Ohne E-Rechnung ist die ganze Mail eine Zeile. Vorne steht das erste PDF, in dem der
  Prüfdienst eine Rechnungsnummer fand, sonst das erste PDF. Die übrigen sind Anlagen.

In der Spalte der Dateien steht eine einzelne Anlage als Abzeichen **Anlage**, mehrere als
**N Anlagen**. Die Details listen jede Anlage mit dem Namen beim Eingang, die Suche findet
auch diese Namen. Dateien ohne `MailVorgang` (ältere Eingänge, andere Werke) bleiben wie
bisher je Rechnung eine Zeile.

**Erstellt am** ist der Zeitpunkt, zu dem die erste Datei der Rechnung in SharePoint
angelegt wurde. Die Tabelle ist danach sortiert, die neuesten Vorgänge stehen oben.

## Spalten

Welche Spalten ein Werk zeigt und in welcher Reihenfolge, legt ein Admin über den Knopf
**„Spalten“** fest (Einzelheiten in [Genehmigung-im-Monitoring.md](Genehmigung-im-Monitoring.md)).
Standard: vorn „Bearbeiten“ mit den Dateien (PDF, XML, Bericht), dann Datum, Erstellt am, Werk, Richtung, Rechnungsnr., Steller / Empfänger, Netto, Fällig am,
Geprüft, Klassifizierung, Status, Buchung, Lieferant informiert, Konform., Fehler und, wo die
Bearbeitung an ist, Varialnummer, Bearbeitung, Genehmigung. Wählbar sind außerdem Brutto,
Bestellnummer, Kontierung und Notiz. Werke mit eigener Spaltenauswahl zeigen „Erstellt am“
hinter „Datum“ und „Geprüft“ vor „Klassifizierung“ (hinter Fällig am, Netto oder Steller /
Empfänger, je nachdem, was das Werk zeigt), bis der Admin ihre Spalten neu speichert. Danach
gilt seine Auswahl (`spaltenAm` in den Einstellungen, neue Spalten stehen in `MON_NEUE_SPALTEN`).

**Geprüft**: Der Knopf **„Als geprüft markieren“** setzt die Markierung mit Name und Datum,
in der Zelle steht dann „✓ Geprüft“ mit Kürzel und Datum (Tooltip: Name und Uhrzeit). Ein
Klick auf „✓ Geprüft“ nimmt sie nach einer Rückfrage zurück. Die Markierung liegt im
Lieferantenregister unter `rechnungen` (Feld `geprueft`), gilt für alle Rechnungen, auch
E-Rechnungen, und ändert nichts an Buchung oder Bearbeitungsstatus. Die Spalte lässt sich
sortieren, die aufgeklappte Zeile nennt unter „Prüfung“, wer markiert hat. Das gilt nur im
Eingang: Ausgangsrechnungen haben weder Knopf noch Markierung, und in einer reinen
Ausgangsansicht fehlt die Spalte.

**Formatmangel** erscheint nicht bei Kleinbeträgen bis 250 € brutto. Sie dürfen immer sonstige
Rechnung sein (§ 33 UStDV). Das Feld bleibt gesetzt, die 800k-Logik braucht es, ausgeblendet
wird nur der Hinweis in der Spalte Buchung und in der aufgeklappten Zeile.

**Steller / Empfänger** zeigt in dieser Reihenfolge:

1. der Name, der an dieser Rechnung eingetragen ist (unter „Bearbeiten“ oder bei der
   800k-Einschätzung),
2. der Name aus der E-Rechnung (XML),
3. der Name aus dem Lieferantenregister, erkannt über die USt-IdNr. oder eine gemerkte
   Schreibweise (kursiv).

Ein grünes **✓** dahinter ist das Siegel der Kreditorenbuchhaltung: Sie hat den Lieferanten
geprüft und bestätigt. Der Tooltip nennt wer und wann.

4. den Namen, den der Prüfdienst beim Eingang aus dem PDF gelesen hat (grau und kursiv, Tooltip
   „aus der Rechnung gelesen, nicht bestätigt“).

Darunter steht grün die Absenderadresse der Rechnungsmail, die der Eingangs-Flow mitschreibt.

**Gelesene Werte:** Bei einer PDF ohne E-Rechnung liest `/api/intake` beim Eingang Lieferant,
USt-IdNr., Nummer, Datum, Fälligkeit, Netto und Brutto aus dem PDF, bei einem Scan über den
OCR-Dienst ([`ocr-service/`](../ocr-service/README.md)). Die Rechnung muss dafür niemand öffnen.
Netto, Brutto und „Fällig am“ stehen dann grau und kursiv in der Tabelle, so wie der Name. Eigene Werke sind nie
Lieferant, auch wenn ihr Name in der Anschrift umbricht („Bösdorf GmbH“). Beschriftungen und reine
Gattungen wie „Speditionsgesellschaft mbH“ bleiben leer.
Ein
Betrag gilt nur, wenn er sicher ist: Das Netto wird nur übernommen, wenn es zum Brutto passt.
Fehlt eine Summenzeile, reicht ein Tripel im Text, das netto + Steuer = brutto zu 19 oder 7 %
ergibt. Die Fälligkeit kommt aus dem Datum hinter „fällig“ oder „zahlbar bis“, sonst aus
Rechnungsdatum + Tage („30 Tage netto“), Skontofristen zählen nicht. Gelesene Werte steuern
keine Buchung. Der 800k-Dialog liest einen Scan, den der Eingang schon gelesen hat, nicht noch
einmal.

„Fällig am“ wird nur rot, wo die Buchung im Monitoring läuft (Bearbeitung an) und die Rechnung
nicht als gebucht markiert ist. Die anderen Werke buchen im SAP, dort kennt das Monitoring den
Stand nicht.

## Rechnungsnummer und Lieferant korrigieren

Liest der Prüfdienst Nummer oder Lieferant falsch aus dem PDF-Text, korrigiert die
Buchhaltung beides oben im Dialog **„Bearbeiten“**. Gespeichert wird an der Datei, an der
die Bearbeitung hängt (Original-PDF, bei XRechnung das lesbare PDF): `Title` und
`Rechnungssteller`. Der Versionsverlauf der Datei hält fest, wer was geändert hat.

Ein geänderter Lieferant wird **bestätigt und gemerkt**. Stimmt ein gelesener Name, reicht
der Haken „Lieferant geprüft: bestätigen und für weitere Rechnungen merken“. Ist der
Lieferant schon bestätigt, steht neben „Lieferant“ das Siegel „✓ Bestätigt“.

## Lieferant bestätigen im 800k-Dialog

Neben „Lieferant“ steht der Knopf **„Bestätigen“**, solange die Kreditorenbuchhaltung den
Lieferanten mit diesem Namen nicht bestätigt hat. Ein Klick speichert sofort: Name,
USt-IdNr. (auch die im Dialog gelesene) und Schreibweise aus dem PDF-Text kommen ins
Register, die Rechnung wird dem Lieferanten zugeordnet, und aus dem Knopf wird das Siegel
**„✓ Bestätigt“** (Tooltip: wer und wann). Ändert jemand den Namen im Feld, gilt das Siegel
des neuen Namens. Die Einschätzung selbst (über oder bis 800.000 €) ist keine Bestätigung,
sie merkt den Lieferanten nur. Nach der Korrektur fasst
das Monitoring die Zeilen neu zusammen und prüft die Dubletten neu.

## Kleinbetrag und Lieferant im Ausland im 800k-Dialog

Zwei Fälle brauchen keine Einschätzung und keine Mail. Beide bestätigt die
Kreditorenbuchhaltung im Dialog mit einem Klick, so wie den Lieferanten:

- **Kleinbetrag** (§ 33 UStDV, bis 250 € brutto). Neben dem Feld **„Brutto“** steht
  „Kleinbetrag bestätigen“, sobald dort höchstens 250 € stehen. Vorbelegt ist der Betrag aus
  der Rechnung, sonst der aus dem PDF gelesene. Gespeichert wird an der Rechnung (Betrag, wer,
  wann), aus dem Knopf wird „✓ Kleinbetrag“, das ✕ daneben nimmt es zurück. Die Bestätigung
  gilt auch, wenn der Prüfdienst den Betrag falsch gelesen hat.
- **Lieferant ohne Sitz in Deutschland.** Die E-Rechnungspflicht gilt nur, wenn Lieferant
  und Empfänger in Deutschland ansässig sind (§ 14 Abs. 2 UStG). Beim Lesen des PDFs (auch per
  Texterkennung) sucht der Dialog nach dem Land in der Anschrift im Kopf (erste 20 Zeilen,
  ohne Lieferanschrift und Bankverbindung, auch mit Kennzeichen wie „I-25100“), nach der IBAN
  (nur mit gültiger Prüfziffer, keine Lastschrift vom eigenen Konto) und nach der USt-IdNr.
  Überwiegen die Hinweise aufs Ausland, steht dort „Der Lieferant sitzt vermutlich nicht in
  Deutschland (…)“. Bei Gleichstand, etwa Anschrift in Polen und deutsche IBAN, steht ein
  Hinweis zum Prüfen. Eine IBAN im Ausland allein gegen eine deutsche USt-IdNr. reicht nicht.
  Der Knopf **„Ausland bestätigen“** merkt den Lieferanten mit Land und Gründen, das gilt für
  alle seine Rechnungen. Ohne Treffer gibt es den Knopf trotzdem („Lieferant ohne Sitz in
  Deutschland?“). Ist der Lieferant schon als Ausland gemerkt, die Rechnung aber noch nicht
  ihm zugeordnet, ordnet „Rechnung zuordnen“ sie zu. „Zurücknehmen“ hebt die Bestätigung auf.
  Bei einer deutschen Betriebsstätte, die an der Leistung beteiligt ist, gilt die Pflicht
  trotzdem. Das prüft die Kreditorenbuchhaltung vor dem Klick.

In der Spalte „Buchung“ stehen dann „Kleinbetrag ✓“ oder „Ausland ✓“ (ein Klick öffnet den
Dialog), „Lieferant informiert“ bleibt leer, und die Rechnung zählt nicht mehr zu
„800k-Einschätzung offen“. Die aufgeklappte Zeile nennt die Ausnahme unter „800.000 €“.
Das Abzeichen „Kleinbetrag“ ohne Bestätigung tragen Rechnungen bis 250 € brutto, deren Betrag
in der E-Rechnung steht oder durch Netto und Steuer abgesichert ist. Ein einzelner gelesener
Betrag reicht nicht, weil ein Lesefehler sonst die Einschätzung ausblenden würde. Solche
Rechnungen tragen „bis 250 € gelesen“ und bleiben offen, bis jemand sie bestätigt. Nur
Euro-Beträge zählen.

## 800k je Lieferant

Eine Einschätzung gilt für den Lieferanten, nicht für die einzelne Rechnung. Der Knopf
**„800k je Lieferant“** über der Tabelle zeigt deshalb alle offenen Rechnungen im aktuellen
Filter nach Lieferant, die mit den meisten Rechnungen zuerst. Gleiche USt-IdNr. ist ein
Lieferant, ohne USt-IdNr. gleicher Name, ein Name mit bekannter USt-IdNr. kommt zu dieser Gruppe.

- **bis 800k / über 800k** speichert die Einschätzung am Lieferanten und ordnet ihm alle seine
  offenen Rechnungen zu, in einem Schreibvorgang. Gelesene Schreibweisen werden gemerkt, künftige
  Rechnungen sind damit schon eingeschätzt. Mails gehen dabei nicht raus, „Lieferant informiert“
  steht auf Nein. Die Vorlage gibt es weiter im Dialog an der einzelnen Rechnung.
- **Ausland** gibt es bei USt-IdNr. außerhalb Deutschlands und merkt den Lieferanten wie im
  Einzeldialog.
- **Anzeigen** schließt den Dialog und filtert die Tabelle auf diesen Lieferanten.
- **Alle als Kleinbetrag bestätigen** erscheint, wenn gelesene Beträge bis 250 € offen sind.

Rechnungen ohne erkannten Lieferanten nennt der Dialog nur als Zahl, sie bleiben Einzelfälle.

## Lieferantenregister

`Monitoring/lieferanten-umsatzgrenze.json` auf der Monitoring-Site war das Register der
800k-Einschätzungen und ist jetzt das Lieferantenregister. Je Lieferant steht dort:

| Feld | Inhalt |
|------|--------|
| `name`, `vat`, `mail` | Name, USt-IdNr., Mailadresse für Kreditor-Mails |
| `aliase` | Schreibweisen aus dem PDF-Text, die schon einmal zu diesem Lieferanten bestätigt wurden (höchstens 10). Ein eigenes Werk wird nicht gemerkt |
| `bestaetigtAm`, `bestaetigtVon`, `bestaetigtVonName` | Siegel: letzte Bestätigung durch die Kreditorenbuchhaltung („Bestätigen“ im 800k-Dialog, „Bearbeiten“) |
| `vermutung`, `am`, `vonName`, `verlauf` | 800k-Einschätzung, falls es eine gibt |
| `ausland` | Lieferant ohne Sitz in Deutschland: `land`, `landName`, `gruende`, wer und wann |

`rechnungen` ordnet einzelne Rechnungen (Dateischlüssel) einem Lieferanten zu und hält je
Rechnung `informiert`, `klein` (bestätigter Kleinbetrag mit Betrag) und `geprueft` (Spalte
„Geprüft“) fest, jeweils mit wer und wann. Gemerkt wird
bei der 800k-Einschätzung und unter „Bearbeiten“, das Siegel gibt es nur mit „Bestätigen“
bzw. einer Korrektur unter „Bearbeiten“. Eine neue Rechnung wird erkannt über
die Zuordnung, die USt-IdNr., den Namen, eine gemerkte Schreibweise oder die Absenderadresse:
Kommt die Rechnungsmail genau von der beim Lieferanten gemerkten `mail`, ist es dieser
Lieferant, auch wenn im PDF etwas anderes gelesen wurde. noreply-Adressen zählen nicht. Name,
Schreibweise und Adresse zählen nicht, wenn beide USt-IdNr. bekannt sind und sich unterscheiden.
Die Kreditorenbuchhaltung braucht „Mitwirken“ auf den **Ordner** `Dokumente/Monitoring`, nicht
nur auf einzelne Dateien darin: Die Registerdatei entsteht beim ersten Speichern und erbt die
Rechte des Ordners. Sieht ein Konto den Ordner nicht, sagt das der Untertitel des Monitorings
(„Lieferantenregister nicht lesbar“), und neben „Lieferant“ steht „Bestätigen nicht möglich“.

**Buchung**: Bis 10/2026 blieb sie bei gelb und rot auf Automatik. Für solche Rechnungen
zeigt das Monitoring die heutige Regel (gelb = Unter Vorbehalt, rot = Zurückgewiesen), der
Tooltip nennt den gespeicherten Wert.

## Ansicht

- Die Tabelle scrollt in einem eigenen Bereich. **Kopfzeile und erste Spalte bleiben
  stehen**. Seitlich scrollen geht über die Leiste **oben** über der Tabelle und unten, beide
  laufen mit.
- **Zeile anklicken** (oder Enter) klappt alle Angaben zur Rechnung auf: Rechnung,
  Lieferant, Beträge, Prüfung mit vollem Hinweis, 800.000 €, Bearbeitung, Dateien, auch aus
  Spalten, die gerade ausgeblendet sind. **„Alle aufklappen“** gilt für die angezeigten
  Zeilen.
- **Spaltenbreite** per Ziehen am rechten Rand einer Kopfzelle, Doppelklick setzt die Spalte
  zurück, „Breiten zurücksetzen“ alle. Eigene Breiten merkt sich der Browser je Werk. Der
  Admin kann seine Breiten im Dialog „Spalten“ als Standard für alle speichern, eigene
  Breiten gehen vor.
- Ein Pfeil im Kopf zeigt die Sortierung. Ohne Klick ist es **Erstellt am**, neueste zuerst.
- **Kompakt / Groß**: Kompakt zeigt eine Rechnung möglichst auf einer Zeile (Hinweise
  einzeilig, Abzeichen nebeneinander), Groß hat viel Luft und größere Schrift. Der Browser
  merkt sich die Wahl.
- **Vollbild** legt Filter und Tabelle über den ganzen Bildschirm, Esc beendet es.
- Beim Scrollen lädt die Tabelle die nächsten 200 Zeilen von selbst nach, der Knopf
  „Weitere anzeigen“ bleibt als Rückfall. Ein Pfeil unten rechts springt zum Anfang.

## KPI-Kacheln

Rechnungen gesamt · Eingang · Ausgang · **Fehler / rot** ·
**Dubletten** · Manuelle Prüfung · Zur Rückfrage · Zurückgewiesen · 800k-Einschätzung
offen · In Genehmigung (nur wenn ein Werk die Bearbeitung nutzt) · Typen. Die Kacheln
beziehen sich auf die gefilterte Auswahl, ein Klick filtert.

## Filter & Suche

Werk · Richtung · Typ · Konformität · Buchung (mit „Kleinbetrag bis 250 € brutto“ und
„Lieferant im Ausland (bestätigt)“) ·
Status · Bearbeitung · Genehmigt · Datum von/bis · Freitextsuche (Nummer, Steller,
Empfänger, USt-IdNr., Absendermail, Varialnummer, Kontierung, Bestellnummer, Notiz).

Vor „Datum von/bis“ steht, welches Datum gilt: **Rechnungsdatum** (Standard) oder
**Erstellt am**. Gefiltert wird nach dem Kalendertag in Deutschland.

## Konformität + Klartext-Hinweis

Die Ampel kommt aus der KoSIT-Prüfung (`Konformitaet`). Ist eine Rechnung **nicht**
grün, zeigt das Dashboard unter der Pille einen **verständlichen Ein-Satz-Grund** statt
kryptischer BR-Codes (`_monHinweis`). Quelle ist die Spalte `ValidierungsMeldung`: steht
dort der fertige API-`hinweis`, wird er direkt gezeigt; steht dort der rohe
`meldungenText` (mit BR-/CII-Codes), leitet das Dashboard den Satz selbst ab (häufigste
Ursache zuerst, z. B. „Positionen ohne USt-Kategorie-Code (BT-151) …"). Spiegelt die
Logik von `_hinweisAusBefunden` in [`api/src/kosit.js`](../api/src/kosit.js).

## Dublettenerkennung

Im Monitoring aus den geladenen Datensätzen (`_monMarkDupes`), ohne Extra-Spalte:

- **Dublette** = gleiche **Rechnungsnummer beim selben Lieferanten** im selben
  Werk und in derselben Richtung, verteilt auf mehrere Einträge. Jede betroffene Zeile
  bekommt das Abzeichen **⚠ Dublette**, dazu die KPI-Kachel **Dubletten**. Gelöscht oder
  überschrieben wird nichts, die Buchhaltung entscheidet.
- **Derselbe Lieferant** heißt: gleiche USt-IdNr., sonst derselbe Eintrag im
  Lieferantenregister oder derselbe Name. Zwei verschiedene USt-IdNr. sind immer
  verschiedene Lieferanten.
- **Gleiche Nummer, verschiedene Lieferanten** ist **keine** Dublette.
- **Inhalt:** Nach dem Laden holt das Monitoring für die Dubletten die Prüfsumme der
  Originaldateien, die SharePoint ohnehin je Datei führt (`quickXorHash`). Das Abzeichen
  sagt dann **gleiche Datei** (dieselbe Rechnung ist mehrfach eingegangen) oder **anderer
  Inhalt** (bitte prüfen: Kopie, Korrektur oder neue Rechnung). Ohne Prüfsumme bleibt es
  bei „mögliche Doppelerfassung“.

**Nicht überschreiben:** Erkannt wird nur, was als **getrennte Dateien** abgelegt ist.
`/api/intake` liefert den Dateinamen **`dateibasis`** = `<Nummer>_<StellerVat>`, damit
kollidieren verschiedene Lieferanten nicht. Kommt dieselbe Rechnung ein zweites Mal, hätte
die neue Datei denselben Namen. „Datei erstellen“ in Power Automate ersetzt dann die alte
(sie wird nur eine neue Version). Der Eingangs-Flow prüft deshalb vorher, ob der Name schon
belegt ist, und hängt dann einen Zeitstempel an (`<dateibasis>_JJJJMMTThhmmss`), siehe
[Eingangsrechnungen-Flow.md](Eingangsrechnungen-Flow.md), Schritt b.

> **Ausgang (AR) ist nicht betroffen:** dort ist der Aussteller immer das Werk selbst,
> die Nummern sind pro Werk eindeutig und der Dateiname trägt zusätzlich das Datum.

---

## Voraussetzungen

- Provisionierung der Bibliotheken/Spalten inkl. **indizierter `Created`-Spalte**
  (`scripts/provision-rechnungsmonitoring.ps1`).
- Die Metadaten-Spalten füllt der Konverter (Ausgang, `js/sharepoint.js`) bzw. der
  Power-Automate-Eingangs-Flow (`/api/intake`, bei PDFs ohne E-Rechnung aus dem PDF gelesen). Ohne Rechnungsnummer und ohne Lieferant
  (USt-IdNr., Register oder Name) kann eine Zeile nicht als Dublette bewertet werden.
