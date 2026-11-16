#!/usr/bin/env python3
"""Schlanker HTTP-Wrapper um Mustang-CLI.

POST /  (Body = ZUGFeRD/Factur-X-PDF ODER CII-XML)  -> Mustang-Validierungsreport (roh)
GET  /                                              -> Health-JSON

Der aufrufende Azure-Function-Wrapper (api/src/mustang.js) wertet den Report aus.
Es wird bewusst der ROHE Mustang-Report zurueckgegeben (kein Umbau hier), damit die
Auswertung an einer Stelle (mustang.js) liegt und revisionssicher archivierbar bleibt.

Ist DIENST_KEY gesetzt, muss der Aufrufer ihn im Kopf X-Dienst-Schluessel mitschicken
(wie OCR_KEY beim OCR-Dienst). Der Container ist aus dem Internet erreichbar, ohne
Schluessel kann ihn jeder benutzen. Dazu: Groessengrenze und hoechstens MUSTANG_PARALLEL
Pruefungen gleichzeitig (jede startet eine JVM), weitere warten.
"""
import hmac
import os
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from xml.sax.saxutils import escape

JAR = os.environ.get("MUSTANG_JAR", "/opt/mustang/Mustang-CLI.jar")
DIENST_KEY = os.environ.get("DIENST_KEY", "")
MAX_BYTES = 64 * 1024 * 1024
ZEIT_S = 180
PLAETZE = threading.BoundedSemaphore(max(1, int(os.environ.get("MUSTANG_PARALLEL", "2"))))


def validieren(data):
    """Datei schreiben, Mustang aufrufen, Report zurueckgeben. Wirft TimeoutExpired."""
    ext = ".pdf" if data[:5] == b"%PDF-" else ".xml"
    path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
            f.write(data)
            path = f.name
        r = subprocess.run(
            ["java", "-jar", JAR, "--action", "validate", "--source", path],
            capture_output=True, timeout=ZEIT_S)
        return (r.stdout.decode("utf-8", "replace").strip()
                or r.stderr.decode("utf-8", "replace").strip())
    finally:
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/xml; charset=utf-8"):
        b = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

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
        self._send(200, '{"service":"Mustang-Validierung","status":"ok","schluessel":%s}'
                   % ("true" if DIENST_KEY else "false"), "application/json; charset=utf-8")

    def do_POST(self):
        if DIENST_KEY and not hmac.compare_digest(
                self.headers.get("X-Dienst-Schluessel", "").encode("utf-8"), DIENST_KEY.encode("utf-8")):
            self._verwerfen(self._laenge())
            return self._send(401, "<error>Schluessel fehlt oder falsch</error>")
        n = self._laenge()
        if n < 0:
            self.close_connection = True
            return self._send(400, "<error>Content-Length ungueltig</error>")
        if n > MAX_BYTES:
            self.close_connection = True
            return self._send(413, "<error>Datei groesser als 64 MB</error>")
        data = self.rfile.read(n) if n else b""
        if not data:
            return self._send(400, "<error>leerer Body</error>")
        try:
            with PLAETZE:
                report = validieren(data)
        except subprocess.TimeoutExpired:
            return self._send(504, "<error>Mustang-Timeout</error>")
        except Exception as e:  # noqa: BLE001 - Fehler als Report zurueckgeben
            return self._send(500, "<error>%s</error>" % escape(str(e)))
        self._send(200, report or "<error>kein Report</error>")

    def log_message(self, *args):  # Zugriffslog unterdruecken
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
