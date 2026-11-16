#!/usr/bin/env python3
"""Vorgeschalteter Wächter für den KoSIT-Daemon.

Der KoSIT-Validator kennt keine Anmeldung. Der Container ist aber aus dem Internet erreichbar,
ohne Schutz kann ihn jeder benutzen. Deshalb lauscht der Daemon nur noch auf 127.0.0.1:8081,
nach außen (0.0.0.0:8080) antwortet dieses Skript:

POST /  (Body = XML)  -> prüft Schlüssel und Größe, reicht an den Daemon weiter und gibt
                         dessen Antwort unverändert zurück (200 = accept, 406 = reject)
GET  /                -> Health-JSON, 503 solange der Daemon noch nicht antwortet

Ist DIENST_KEY gesetzt, muss der Aufrufer ihn im Kopf X-Dienst-Schluessel mitschicken
(wie OCR_KEY beim OCR-Dienst). Ohne DIENST_KEY reicht das Skript alles durch.
"""
import hmac
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DAEMON = os.environ.get("KOSIT_INTERN", "http://127.0.0.1:8081/")
DIENST_KEY = os.environ.get("DIENST_KEY", "")
PORT = int(os.environ.get("PORT", "8080"))
MAX_BYTES = 32 * 1024 * 1024
ZEIT_S = 120


def daemon_bereit():
    try:
        with urllib.request.urlopen(DAEMON, timeout=3):
            return True
    except urllib.error.HTTPError:
        return True          # antwortet, nur nicht mit 200
    except Exception:  # noqa: BLE001
        return False


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype):
        b = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _json(self, code, text):
        self._send(code, text, "application/json; charset=utf-8")

    def _laenge(self):
        try:
            return int(self.headers.get("Content-Length", "0") or 0)
        except ValueError:
            return -1

    def _verwerfen(self, n):
        """Body ungenutzt weglesen, damit der Aufrufer die Antwort bekommt statt eines Abbruchs."""
        if n < 0 or n > MAX_BYTES:
            self.close_connection = True
            return
        while n > 0:
            teil = self.rfile.read(min(n, 65536))
            if not teil:
                break
            n -= len(teil)

    def do_GET(self):
        bereit = daemon_bereit()
        self._json(200 if bereit else 503, '{"service":"KoSIT","status":"%s","schluessel":%s}'
                   % ("ok" if bereit else "startet", "true" if DIENST_KEY else "false"))

    def do_POST(self):
        if DIENST_KEY and not hmac.compare_digest(
                self.headers.get("X-Dienst-Schluessel", "").encode("utf-8"), DIENST_KEY.encode("utf-8")):
            self._verwerfen(self._laenge())
            return self._json(401, '{"error":"Schluessel fehlt oder falsch"}')
        n = self._laenge()
        if n <= 0:
            self.close_connection = True
            return self._json(400, '{"error":"XML fehlt"}')
        if n > MAX_BYTES:
            self.close_connection = True
            return self._json(413, '{"error":"XML groesser als 32 MB"}')
        xml = self.rfile.read(n)
        anfrage = urllib.request.Request(DAEMON, data=xml, method="POST", headers={
            "Content-Type": self.headers.get("Content-Type", "application/xml")})
        try:
            with urllib.request.urlopen(anfrage, timeout=ZEIT_S) as r:
                return self._send(r.status, r.read(), r.headers.get("Content-Type", "application/xml"))
        except urllib.error.HTTPError as e:      # 406 = reject, mit Report im Body
            return self._send(e.code, e.read(), e.headers.get("Content-Type", "application/xml"))
        except Exception:  # noqa: BLE001 - Daemon nicht erreichbar oder Zeitlimit
            return self._json(502, '{"error":"KoSIT-Daemon antwortet nicht"}')

    def log_message(self, *args):  # Zugriffslog unterdrücken, Rechnungsinhalte gehören nicht ins Protokoll
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
