# Schlüssel für die Prüf-Container (DIENST_KEY)

Die Container für KoSIT, veraPDF und Mustang laufen als Azure Container Apps mit externem
Ingress. Bis 11/2026 nahmen sie jede Anfrage aus dem Internet an. Wer die Adresse kannte,
konnte sie benutzen oder mit großen Dateien lahmlegen. Der OCR-Dienst hatte von Anfang an
einen Schlüssel (`OCR_KEY`), die drei anderen bekommen ihn jetzt auch.

## Was sich ändert

| Stelle | Verhalten |
|---|---|
| Prüfdienst (`api/src/dienst.js`) | Schickt den Wert der App-Einstellung `DIENST_KEY` im Kopf `X-Dienst-Schluessel` an KoSIT, veraPDF und Mustang. Ohne die Einstellung geht kein Kopf mit. Jeder Aufruf hat ein Zeitlimit. |
| veraPDF (`verapdf-service/server.js`) | Prüft den Schlüssel, wenn im Container `DIENST_KEY` gesetzt ist. Sonst 401. Größengrenze 64 MB, Zeitlimit 120 Sekunden je Prüfung, höchstens zwei Prüfungen gleichzeitig. |
| Mustang (`mustang-service/server.py`) | Wie veraPDF, Zeitlimit 180 Sekunden. |
| KoSIT (`kosit-service/proxy.py`) | Der Validator selbst kennt keine Anmeldung. Er lauscht nur noch im Container (127.0.0.1:8081). Nach außen antwortet `proxy.py`, prüft Schlüssel und Größe (32 MB) und reicht die Anfrage durch. |

`GET /` bleibt bei allen offen (Health-Check der Plattform) und zeigt mit `"schluessel": true`,
ob der Schlüssel aktiv ist. Rechnungsdaten gibt `GET` nicht zurück.

Ohne `DIENST_KEY` im Container verhalten sich die neuen Images wie die alten. Die Umstellung
geht deshalb ohne Unterbrechung, wenn die Reihenfolge stimmt.

## Stand

Umgestellt am 16.11.2026. Der Schlüssel liegt nur in Azure: als App-Einstellung `DIENST_KEY`
der Function-App und als Secret `dienst-key` in den drei Containern. Die Container laufen mit
den Images `v20261116`, `latest` zeigt auf dieselben. Der Stand davor liegt je Image unter dem
Tag `vor-schluessel`.

Geprüft nach der Umstellung: Ohne oder mit falschem Schlüssel antworten alle drei Container mit
401. Über den Prüfdienst liefern `/api/validate` (XRechnung über KoSIT, ZUGFeRD über Mustang und
veraPDF) und `/api/intake` dieselben Ergebnisse wie vorher, auch die Ablehnung einer fehlerhaften
XML (BR-CL-01).

Schlüssel wechseln: neuen Wert zuerst in den drei Containern setzen, direkt danach in der
Function-App. Dazwischen scheitern Prüfungen mit 401, deshalb beides zügig hintereinander.

## Umstellung

Den Schlüssel selbst erzeugen (lang und zufällig, zum Beispiel 40 Zeichen aus einem
Passwortmanager) und nirgends im Repo ablegen. In den Befehlen steht dafür `<schluessel>`.

1. **Prüfdienst zuerst.** Er schickt den Schlüssel dann schon mit, die alten Container
   ignorieren den Kopf.

   ```bash
   az functionapp config appsettings set -g rg-erechnung-api -n <function-app> --settings "DIENST_KEY=<schluessel>"
   ```

   ```bash
   func azure functionapp publish <function-app>
   ```

2. **Images neu bauen** (im Repo-Ordner, ohne lokales Docker).

   ```bash
   az acr build -r dihagerechnungacr -t erechnung-kosit:latest kosit-service
   ```

   ```bash
   az acr build -r dihagerechnungacr -t erechnung-verapdf:latest verapdf-service
   ```

   ```bash
   az acr build -r dihagerechnungacr -t erechnung-mustang:latest mustang-service
   ```

3. **Schlüssel in den Containern setzen.** Die neue Revision zieht dabei das neue Image.
   Für `erechnung-kosit`, `erechnung-verapdf` und `erechnung-mustang` je einmal:

   ```bash
   az containerapp secret set -g rg-erechnung-api -n <app> --secrets dienst-key=<schluessel>
   ```

   ```bash
   az containerapp update -g rg-erechnung-api -n <app> --image dihagerechnungacr.azurecr.io/<app>:latest --set-env-vars DIENST_KEY=secretref:dienst-key
   ```

4. **Prüfen.** Ohne Schlüssel muss 401 kommen, über den Prüfdienst muss alles laufen wie vorher.

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST --data-binary "<a/>" https://<fqdn-des-containers>/
   ```

   Danach eine Rechnung über `/api/validate` oder den Eingangs-Flow schicken und das Ergebnis
   im Monitoring ansehen.

Zurück geht es je Container mit `az containerapp update ... --remove-env-vars DIENST_KEY`.
Ganz auf den alten Stand: zusätzlich `--image dihagerechnungacr.azurecr.io/<app>:vor-schluessel`.

## Prüfsummen der Downloads

Die Dockerfiles laden den KoSIT-Validator, die XRechnung-Konfiguration, den veraPDF-Installer
und die Mustang-CLI beim Bauen aus dem Netz. Seit 16.11.2026 prüft jeder Build die SHA-256
der geladenen Datei (`ARG ..._SHA256` im jeweiligen Dockerfile). Weicht sie ab, bricht der
Build ab, statt eine veränderte Datei ins Image zu nehmen.

Die Summen stammen vom 16.11.2026. Abgeglichen: Mustang-CLI und beide KoSIT-JARs sind
bitgleich mit den Dateien in den Images, die seit September laufen, und die Dateigrößen
stimmen mit den GitHub-Releases überein. Für den veraPDF-Installer gibt es nur den Wert von
diesem Tag.

Neue Version eines Werkzeugs: Versionsnummer und Summe im Dockerfile zusammen ändern. Die
Summe der neuen Datei liefert zum Beispiel:

```bash
curl -fsSL <url-der-neuen-datei> | sha256sum
```

Nicht abgedeckt: Die Pakete aus `apt-get` und die Basis-Images (`eclipse-temurin`) kommen bei
jedem Build in der aktuellen Fassung, ebenso lädt der CI-Lauf (`.github/workflows/validate.yml`)
die Werkzeuge ohne Prüfsumme.

## Dependabot

Für das Repository sind seit 16.11.2026 die Dependabot-Warnungen und die automatischen
Sicherheits-Updates eingeschaltet. GitHub meldet damit bekannte Lücken in den Paketen des
Prüfdienstes (`api/package-lock.json`) und schlägt die Korrektur als Pull Request vor. Nach dem
Übernehmen muss der Prüfdienst neu veröffentlicht werden. Die mitgelieferten Bibliotheken unter
`js/vendor` (pdf.js, Tesseract) sieht Dependabot nicht, sie werden von Hand aktualisiert.

## Tests

- `node tests/api-haertung.test.js`: Schlüssel und Zeitlimit im Prüfdienst
- `node tests/verapdf-dienst.test.js`: veraPDF-Wrapper mit nachgestellter CLI
- `python tests/dienste_test.py`: KoSIT-Wächter und Mustang-Wrapper mit Attrappen
