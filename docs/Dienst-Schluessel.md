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

## Tests

- `node tests/api-haertung.test.js`: Schlüssel und Zeitlimit im Prüfdienst
- `node tests/verapdf-dienst.test.js`: veraPDF-Wrapper mit nachgestellter CLI
- `python tests/dienste_test.py`: KoSIT-Wächter und Mustang-Wrapper mit Attrappen
