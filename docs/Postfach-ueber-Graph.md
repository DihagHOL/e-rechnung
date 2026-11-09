# Rechnungspostfach über Graph oder EWS lesen

Power Automate hört Rechnungspostfächer mit dem Outlook-Auslöser ab. Das geht nur im eigenen
Tenant. Für ein Postfach in einem anderen Tenant (zuerst Hasenclever, Werk `DSO`, Dihag Solutions GmbH) liest die
Function das Postfach über Microsoft Graph, und ein Flow legt die Anhänge wie bei den anderen
Werken in `ERAR_<Werk>` ab.

## Zugriff

Im Tenant des Postfachs gibt es eine App-Registrierung mit der Anwendungsberechtigung
`Mail.Read`. Sinnvoll ist eine Application Access Policy, die die App auf dieses eine Postfach
beschränkt. Mehr braucht es nicht: Die Function liest nur, sie verschiebt nichts und markiert
nichts als gelesen.

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

Die `id` ist die unveränderliche Graph-ID (`Prefer: IdType="ImmutableId"`). Sie bleibt gleich,
auch wenn jemand die Mail im Postfach verschiebt.

## Flow „E-R-Rechnung_<Werk> (nur Monitoring)“

Der Flow ist eine Kopie von „E-R-Rechnung_MEG (nur Monitoring)“ mit anderem Auslöser:

1. Wiederholung alle 15 Minuten.
2. `/api/postfach?werk=<Werk>&tage=2` holt die Liste.
3. Je Mail, nacheinander: Gibt es in `ERAR_<Werk>` schon eine Datei mit dieser Mail in
   `MailVorgang`, ist die Mail erledigt. Sonst holt `/api/postfach?…&id=` die Anhänge, und jeder
   Anhang läuft durch dieselben Schritte wie bei den anderen Werken (`/api/intake`, Original,
   lesbares PDF, Prüfbericht, Eigenschaften).

Weil das Postfach nur gelesen wird, entscheidet allein `MailVorgang`, ob eine Mail schon
abgelegt ist. Das Zeitfenster von zwei Tagen überbrückt Ausfälle bis zu dieser Dauer. Eine Mail
ohne PDF oder XML wird bei jedem Lauf im Fenster neu angesehen, abgelegt wird nichts.
Lieferantenmails sind aus, denn aus einem fremden Postfach kann der Flow nicht senden.

### Archiv-Mail (DSO, seit 09.11.2026)

Wie bei HOL schickt der Flow nach der Ablage je E-Rechnung eine Archiv-Mail, ohne E-Rechnung
eine für die ganze Mail (Aufbau siehe [Eingangsrechnungen-Flow.md](Eingangsrechnungen-Flow.md)).
Absender ist das Konto der Outlook-Verbindung des Flows, Empfänger das Postfach selbst. Die App
im fremden Tenant braucht dafür kein Senderecht. In den Ordner `ArchiviertUndGeprueft` kommt die
Mail über eine Posteingangsregel im Postfach: Absender ist das Konto der Verbindung und der Betreff
enthält „[ARCHIV]“. Die Regel prüft den Absender mit, damit eine fremde Mail mit „[ARCHIV]“ im
Betreff nicht ungeprüft im Ordner landet.

Erreicht eine Archiv-Mail doch den Posteingang, überspringt der Flow sie, wenn Betreff und
Absender passen. Scheitert ein Anhang oder die Archiv-Mail, merkt sich der Flow die Mail und
beendet den Lauf am Ende als Fehler. Die Mail gilt trotzdem als abgelegt und wird nicht
wiederholt, die fehlende Archiv-Mail muss dann jemand von Hand nachholen.
