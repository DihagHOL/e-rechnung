# Rechnungspostfach über Graph lesen

Power Automate hört Rechnungspostfächer mit dem Outlook-Auslöser ab. Das geht nur im eigenen
Tenant. Für ein Postfach in einem anderen Tenant (zuerst Hasenclever, Werk `HAS`) liest die
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
az functionapp config appsettings set -g <Ressourcengruppe> -n <Function-App> --settings POSTFACH_HAS_SECRET="<Wert>"
```

Läuft der Schlüssel ab, meldet die Function „Anmeldung am Tenant des Postfachs fehlgeschlagen“.
Dann einen neuen Schlüssel anlegen und die Einstellung ersetzen.

## Endpunkt `/api/postfach`

- `GET /api/postfach?werk=HAS&tage=2`: Mails mit Anhängen der letzten zwei Tage, älteste zuerst,
  ohne Inhalt (`id`, `empfangen`, `betreff`, `von`, `antwortAn`). Höchstens 200 Mails.
- `GET /api/postfach?werk=HAS&id=<ID>`: eine Mail mit ihren PDF- und XML-Anhängen
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
