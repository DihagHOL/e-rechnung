#!/usr/bin/env python3
"""Texterkennung für gescannte Rechnungen.

POST /?seiten=3  (Body = PDF)  -> {"items": [{text, x, y, pw, ph, w, page}], "seiten": n, "ms": dauer}
GET  /                         -> Health-JSON

Die Items haben dieselbe Form wie im Browser (js/ocr.js): Wörter mit Position in PDF-Punkten,
y von unten, je Tesseract-Zeile eine gemeinsame Grundlinie. So liefert textAusItems aus
js/lieferant.js im Prüfdienst dieselben Zeilen wie der 800k-Dialog. Gespeichert wird nichts,
der Arbeitsordner verschwindet nach jedem Aufruf.

Ist OCR_KEY gesetzt, muss der Aufrufer ihn im Kopf X-Dienst-Schluessel mitschicken.
"""
import glob
import hmac
import json
import os
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DPI = 200                      # wie js/ocr.js (scale 2.78): niedriger verliert Datum und Zuschlagszeilen
SKALA = DPI / 72
SPRACHEN = "deu+eng"
MAX_BYTES = 15 * 1024 * 1024   # wie /api/pdfa
MAX_SEITEN = 4
ZEIT_RENDERN_S = 30
ZEIT_SEITE_S = 40
OCR_KEY = os.environ.get("OCR_KEY", "")
# Mehr gleichzeitige Erkennungen bremsen sich auf einem vCPU nur gegenseitig
PLAETZE = threading.BoundedSemaphore(int(os.environ.get("OCR_PARALLEL", "2")))


def items_aus_tsv(tsv, seite, bild_breite, bild_hoehe, skala=SKALA):
    """Tesseract-TSV (Wortebene, level 5) -> Items in PDF-Punkten, wie _tsvToItems in js/ocr.js."""
    pw, ph = bild_breite / skala, bild_hoehe / skala
    woerter, zeile_oben = [], {}
    for reihe in tsv.split("\n"):
        c = reihe.split("\t")
        if len(c) < 12 or c[0] != "5":
            continue
        text = c[11].strip()
        if not text:
            continue
        key = (c[2], c[3], c[4])
        oben = int(c[7])
        woerter.append((text, key, int(c[6]), int(c[8])))
        if key not in zeile_oben or oben < zeile_oben[key]:
            zeile_oben[key] = oben
    return [{"text": t, "x": links / skala, "y": ph - zeile_oben[k] / skala, "pw": pw, "ph": ph,
             "w": breite / skala, "page": seite} for t, k, links, breite in woerter]


def tesseract_tsv(png):
    r = subprocess.run(["tesseract", png, "stdout", "-l", SPRACHEN, "--psm", "3", "tsv"],
                       capture_output=True, timeout=ZEIT_SEITE_S, check=True)
    return r.stdout.decode("utf-8", "replace")


def bild_groesse(png):
    with open(png, "rb") as f:
        kopf = f.read(24)
    return int.from_bytes(kopf[16:20], "big"), int.from_bytes(kopf[20:24], "big")


def erkennen(pdf, seiten):
    with tempfile.TemporaryDirectory() as ordner:
        datei = os.path.join(ordner, "ein.pdf")
        with open(datei, "wb") as f:
            f.write(pdf)
        subprocess.run(["pdftoppm", "-r", str(DPI), "-f", "1", "-l", str(seiten), "-png", datei, os.path.join(ordner, "s")],
                       capture_output=True, timeout=ZEIT_RENDERN_S, check=True)
        bilder = sorted(glob.glob(os.path.join(ordner, "s*.png")))
        items = []
        for nr, png in enumerate(bilder, 1):
            b, h = bild_groesse(png)
            items.extend(items_aus_tsv(tesseract_tsv(png), nr, b, h))
        return items, len(bilder)


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, inhalt):
        b = json.dumps(inhalt, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        self._json(200, {"service": "OCR", "status": "ok", "sprachen": SPRACHEN})

    def do_POST(self):
        if OCR_KEY and not hmac.compare_digest(self.headers.get("X-Dienst-Schluessel", ""), OCR_KEY):
            return self._json(401, {"error": "Schlüssel fehlt oder falsch"})
        n = int(self.headers.get("Content-Length", "0") or 0)
        if not n or n > MAX_BYTES:
            return self._json(413 if n else 400, {"error": "PDF fehlt oder ist größer als 15 MB"})
        pdf = self.rfile.read(n)
        if pdf[:5] != b"%PDF-":
            return self._json(400, {"error": "kein PDF"})
        try:
            seiten = int(parse_qs(urlparse(self.path).query).get("seiten", ["3"])[0])
        except ValueError:
            seiten = 3
        seiten = max(1, min(seiten, MAX_SEITEN))
        start = time.monotonic()
        try:
            with PLAETZE:
                items, anzahl = erkennen(pdf, seiten)
        except subprocess.TimeoutExpired:
            return self._json(504, {"error": "Zeitlimit"})
        except subprocess.CalledProcessError:
            return self._json(422, {"error": "PDF nicht lesbar"})
        self._json(200, {"items": items, "seiten": anzahl, "ms": int((time.monotonic() - start) * 1000)})

    def log_message(self, *args):  # Zugriffslog unterdrücken, Rechnungsinhalte gehören nicht ins Protokoll
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
