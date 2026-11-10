# Rechnungspostfach über Graph oder EWS lesen

Power Automate hört Rechnungspostfächer mit dem Outlook-Auslöser ab. Das geht nur im eigenen
Tenant. Für ein Postfach in einem anderen Tenant (zuerst Hasenclever, Werk `DSO`, Dihag Solutions GmbH) liest die
Function das Postfach über Microsoft Graph, und ein Flow legt die Anhänge wie bei den anderen
Werken in `ERAR_<Werk>` ab.

## Zugriff

Im Tenant des Postfachs gibt es eine App-Registrierung mit der Anwendungsberechtigung
`Mail.Read`. Sinnvoll ist eine Application Access Policy, die die App auf dieses eine Postfach
beschränkt. Zum Lesen reicht das, die Function markiert nichts als gelesen. Soll der Flow Mails in
Ordner verschieben (Archiv-Mails bei DSO), braucht die App `Mail.ReadWrite`. Welche Rechte die App
wirklich hat, zeigt `?diagnose=1`.

Die Zugangsdaten stehen nur in den App-Einstellungen der Function, nie im Code oder im Flow:

| Einstellung | Inhalt |
|---|---|
| `POSTFACH_<WERK>_TENANT` | Tenant-ID des Postfachs |
| `POSTFACH_<WERK>_CLIENT` | Anwendungs-ID der App-Registrierung |
| `POSTFACH_<WERK>_SECRET` | Wert des geheimen Schlüssels |
| `POSTFACH_<WERK>_ADRESSE` | Adresse des Postfachs |
| `POSTFACH_<WERK>_ORDNER` | optional, Standard `inbox` |

Den geheimen Schlüssel trägt die IT selbst ein, etwa so (Wert in Anführungszeichen):

```bash
az functionapp config appsettings set -g <Ressourcengruppe> -n <Function-App> --settings POSTFACH_DSO_SECRET="<Wert>"
```

Läuft der Schlüssel ab, meldet die Function „Anmeldung am Tenant des Postfachs fehlgeschlagen“.
Dann einen neuen Schlüssel anlegen und die Einstellung ersetzen.

## Exchange im eigenen Haus (EWS)

> **EIS seit 10.11.2026 über Umleitung.** Der Exchange von EIS steht hinter einem Proxy, der
> Anfragen aus Azure-Rechenzentren sperrt (HTTP 403, siehe `?diagnose=1`). Deshalb leitet eine
> Posteingangsregel im Rechnungspostfach von EIS jede Mail an ein freigegebenes Postfach in Exchange
> Online um. Der Flow „E-R-Rechnung_EIS (nur Monitoring)“ ist eine Kopie von
> „E-R-Rechnung_SHB (nur Monitoring)“ mit dem Outlook-Auslöser auf dieses Postfach. Beim Umleiten
> bleibt der Lieferant Absender. Kommt die Rechnung eines Lieferanten mit strenger DMARC-Regel nicht
> an, hilft Weiterleiten statt Umleiten. Lieferantenmails sind aus.
>
> Dazu die Archiv-Logik von HOL: je E-Rechnung eine Archiv-Mail, ohne E-Rechnung eine je Mail,
> Betreff „[ARCHIV] Rechnung …“. Sie geht über die Outlook-Verbindung des Flows zurück an das
> Rechnungspostfach von EIS. Dort verschiebt eine Regel sie in `ArchiviertUndGeprueft`, und zwar vor
> der Umleitung und mit „keine weiteren Regeln“, damit sie nicht zurückkommt. Kommt sie doch zurück,
> verarbeitet der Flow sie nicht („[ARCHIV]“ im Betreff). Scheitert ein Anhang oder die Archiv-Mail,
> endet der Lauf als Fehler. Der Weg über EWS unten bleibt für Postfächer, die die Function erreicht.

Liegt das Postfach auf einem Exchange-Server im eigenen Haus (EIS, Gienanth), liest die Function
es über Exchange Web Services (`src/ews.js`) mit dem Konto des Postfachs. Angemeldet wird mit
Basic über HTTPS, unverschlüsseltes HTTP lehnt die Function ab. Benutzt werden nur FindItem,
GetItem und GetAttachment, die am Postfach nichts ändern, auch nicht den Status „gelesen“.

| Einstellung | Inhalt |
|---|---|
| `POSTFACH_<WERK>_EWS` | Adresse von EWS, etwa `https://<server>/EWS/Exchange.asmx` |
| `POSTFACH_<WERK>_BENUTZER` | Konto in der Form `DOMÄNE\konto` |
| `POSTFACH_<WERK>_KENNWORT` | Kennwort des Kontos, trägt die IT selbst ein |
| `POSTFACH_<WERK>_ADRESSE` | optional, nur zur Anzeige |

Die `id` einer Mail ist hier die EWS-ItemId. Sie ändert sich, wenn jemand die Mail in einen anderen
Ordner verschiebt und wieder zurück. Dann legt der Flow sie ein zweites Mal ab, das Monitoring
zeigt das als Dublette.

Kommt die Function nicht durch, hilft `GET /api/postfach?werk=EIS&diagnose=1`. Die Antwort nennt die
IP, mit der die Function ins Internet geht, und das Land, in dem diese IP verortet wird. Dazu für jede IP
des Servers die Antwort auf eine leere Anfrage ohne Anmeldung: 401 vom IIS heißt durchgelassen, 403
von einem vorgeschalteten Proxy heißt gesperrt. Zugangsdaten werden dabei nicht gesendet.

## Endpunkt `/api/postfach`

- `GET /api/postfach?werk=DSO&tage=2`: Mails mit Anhängen der letzten zwei Tage, älteste zuerst,
  ohne Inhalt (`id`, `empfangen`, `betreff`, `von`, `antwortAn`). Höchstens 200 Mails.
- `GET /api/postfach?werk=DSO&id=<ID>`: eine Mail mit ihren PDF- und XML-Anhängen
  (`anhaenge`: `name`, `contentType`, `size`, `contentBytes` in Base64). Eingebettete Bilder und
  angehängte Mails fallen weg.
- `GET /api/postfach?werk=DSO&ordner=Vorkassen&unterordner=1&zeit=geaendert&ab=2026-11-09`: Liste
  aus einem anderen Ordner. Der Ordner steht mit Namen da (`Vorkassen`) oder mit Pfad
  (`Posteingang/IRISEingang`), wenn der Name mehrfach vorkommt. `unterordner=1` nimmt alle Ordner
  darunter mit. `zeit=geaendert` filtert nach der letzten Änderung statt nach dem Eingang, so fällt
  auch eine Mail ins Zeitfenster, die jemand später in den Ordner gezogen hat. `ab` ist ein
  Stichtag: Nur Mails, die ab diesem Tag eingegangen sind, zählen. Eine alte Mail, die jemand
  zwischen Unterordnern verschiebt, gilt so nicht als neu.
- `POST /api/postfach?werk=DSO&id=<ID>&nach=<Ordner>`: verschiebt die Mail. Das ist der einzige
  schreibende Aufruf, er braucht `Mail.ReadWrite`. Die ID der Mail bleibt dabei gleich.
- `GET /api/postfach?werk=DSO&diagnose=1`: Rechte der App laut Token und alle Ordner mit Pfad und
  Zahl der Mails, ohne Inhalte.

Die `id` ist die unveränderliche Graph-ID (`Prefer: IdType="ImmutableId"`). Sie bleibt gleich,
auch wenn jemand die Mail im Postfach verschiebt.

## Flow „E-R-Rechnung_<Werk> (nur Monitoring)“

Der Flow ist eine Kopie von „E-R-Rechnung_MEG (nur Monitoring)“ mit anderem Auslöser:

1. Wiederholung alle 15 Minuten. DSO läuft seit 09.11.2026 jede Minute, so oft wie der
   Outlook-Auslöser bei SHB nachsieht, und nie zweimal gleichzeitig (Parallelität des Auslösers 1).
   Damit nicht jeder Lauf alle Mails der letzten zwei Tage prüft, schaut er normal 72 Minuten
   zurück (`tage=0.05`). In den ersten zwei Minuten jeder Stunde nimmt er zwei Tage, als Netz
   nach Ausfällen.
2. `/api/postfach?werk=<Werk>&tage=2` holt die Liste.
3. Je Mail, nacheinander: Gibt es in `ERAR_<Werk>` schon eine Datei mit dieser Mail in
   `MailVorgang`, ist die Mail erledigt. Sonst holt `/api/postfach?…&id=` die Anhänge, und jeder
   Anhang läuft durch dieselben Schritte wie bei den anderen Werken (`/api/intake`, Original,
   lesbares PDF, Prüfbericht, Eigenschaften).

Weil das Postfach nur gelesen wird, entscheidet allein `MailVorgang`, ob eine Mail schon
abgelegt ist. Das Zeitfenster von zwei Tagen überbrückt Ausfälle bis zu dieser Dauer. Eine Mail
ohne PDF oder XML wird bei jedem Lauf im Fenster neu angesehen, abgelegt wird nichts.
Lieferantenmails sind aus, denn aus einem fremden Postfach kann der Flow nicht senden.

### Archiv-Mail und Ordner (DSO, seit 09.11.2026)

Der Flow liest bei DSO nicht den Posteingang, sondern zwei Ordner, nacheinander:

| Quelle | Archiv-Mail | landet in |
|---|---|---|
| `Posteingang/IRISEingang` | „[ARCHIV] Rechnung …“ | `Posteingang/ArchiviertUndGeprueftIRIS` |
| `Vorkassen` mit allen Unterordnern | „[ARCHIV OHNE IRIS] Rechnung …“ | `Posteingang/ArchiviertUndGeprueftOhneIRIS` |

Die Ordner stehen mit Namen im Flow, die Function sucht ihre ID. Gelesen wird mit
`zeit=geaendert`, so zählt auch eine Mail, die jemand später in einen der Ordner zieht. Der
Stichtag `ab=2026-11-09` hält die Mails von vorher heraus. Unter Vorkassen liegen Tausende, die
beim Weiterschieben (Gebucht, Zahllauf, Bezahlt) sonst als neu gälten. Wandert eine schon
abgelegte Mail weiter, etwa von IRISEingang nach Vorkassen, bleibt es bei der ersten Ablage und
Archiv-Mail.

Wie bei HOL geht nach der Ablage je E-Rechnung eine Archiv-Mail raus, ohne E-Rechnung eine für die
ganze Mail (Aufbau siehe [Eingangsrechnungen-Flow.md](Eingangsrechnungen-Flow.md)). Absender ist
das Konto der Outlook-Verbindung des Flows, Empfänger das Postfach selbst. Die Mail kommt im
Posteingang an. Zu Beginn jedes Laufs verschiebt der Flow die Archiv-Mails dieses Absenders aus
dem Posteingang: mit „[ARCHIV OHNE IRIS]“ nach `ArchiviertUndGeprueftOhneIRIS`, sonst nach
`ArchiviertUndGeprueftIRIS`. Eine Archiv-Mail liegt so höchstens ein bis zwei Minuten im
Posteingang. Dafür braucht die App `Mail.ReadWrite`, eine Posteingangsregel ist
nicht nötig.

Eine Archiv-Mail in einem der Quellordner überspringt der Flow, wenn Betreff und Absender passen.
Scheitert ein Anhang, die Archiv-Mail oder das Verschieben, merkt sich der Flow das und beendet den
Lauf am Ende als Fehler. Eine Mail mit Fehler gilt trotzdem als abgelegt und wird nicht
wiederholt, die fehlende Archiv-Mail muss dann jemand von Hand nachholen.
