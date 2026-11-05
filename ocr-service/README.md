# OCR-Dienst

Liest gescannte Rechnungen (PDF ohne Textebene) schon beim Eingang, damit Lieferant,
USt-IdNr., Nummer, Datum, Fälligkeit und Beträge im Monitoring stehen, ohne dass jemand die
Rechnung öffnet. Tesseract (Deutsch und Englisch) und Poppler, dieselbe Auflösung wie die
Texterkennung im Browser (`js/ocr.js`).

```
/api/intake  ──  PDF ohne E-Rechnung
                 ├─ Textebene vorhanden  ──▶  pdf.js (api/src/pdftext.js)
                 └─ Scan                 ──▶  OCR-Dienst (OCR_URL)   ← dieser Ordner
```

Ausgewertet wird immer mit derselben Logik: `lieferantAusText` aus `js/lieferant.js`.
Ohne `OCR_URL` läuft `/api/intake` wie zuvor, Scans bleiben dann leer.

## Schnittstelle

- `POST /?seiten=3`, Body = PDF (bis 15 MB, höchstens 4 Seiten werden gelesen):
  `{ items: [{ text, x, y, pw, ph, w, page }], seiten, ms }`
- `GET /`: Health
- Ist `OCR_KEY` gesetzt, muss der Kopf `X-Dienst-Schluessel` passen, sonst 401.

Der Dienst speichert nichts und schreibt keine Rechnungsinhalte ins Protokoll.

## Bauen und deployen (Azure, ohne lokales Docker)

Aus dem Ordner `ocr-service`, Registry und Environment wie bei den anderen Diensten:

```bash
az acr build -r <registry> -t erechnung-ocr:latest .

az containerapp create -g <resource-group> -n erechnung-ocr --environment <environment> \
  --image <registry>.azurecr.io/erechnung-ocr:latest --target-port 8080 --ingress external \
  --cpu 1.0 --memory 2.0Gi --min-replicas 0 --max-replicas 3 \
  --scale-rule-name http-rule --scale-rule-type http --scale-rule-http-concurrency 2 \
  --secrets ocr-key=<schluessel> --env-vars OCR_KEY=secretref:ocr-key \
  --registry-server <registry>.azurecr.io

az functionapp config appsettings set -g <resource-group> -n <function-app> \
  --settings "OCR_URL=https://<fqdn>/" "OCR_KEY=<schluessel>"
```

`--min-replicas 0`: Ohne Scans läuft nichts und es entstehen keine Kosten. Der erste Scan nach
einer Pause braucht rund 10 Sekunden länger, weil der Container erst startet.
