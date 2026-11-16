# python tests/dienste_test.py
# KoSIT-Wächter (kosit-service/proxy.py) und Mustang-Wrapper (mustang-service/server.py) mit Attrappen, ohne Java und Docker
import importlib.util, json, os, subprocess, sys, threading, time, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ER = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..') + os.sep
n = 0
def gleich(ist, soll, m):
    global n
    assert ist == soll, f'{m}: {ist!r} statt {soll!r}'
    n += 1

def lade(name, pfad, env):
    os.environ.update(env)
    spec = importlib.util.spec_from_file_location(name, pfad)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def starte(handler):
    srv = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}/'

def ruf(url, data=None, kopf=None, methode=None):
    req = urllib.request.Request(url, data=data, headers=kopf or {}, method=methode or ('POST' if data is not None else 'GET'))
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

# ── KoSIT-Wächter vor einem nachgestellten Daemon ──
class Daemon(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b'gui')
    def do_POST(self):
        body = self.rfile.read(int(self.headers['Content-Length']))
        code = 406 if b'schlecht' in body else 200
        antwort = b'<rep:report>' + body[:20] + b'</rep:report>'
        self.send_response(code); self.send_header('Content-Type', 'application/xml'); self.send_header('Content-Length', str(len(antwort))); self.end_headers(); self.wfile.write(antwort)
    def log_message(self, *a): pass
dsrv, durl = starte(Daemon)

P = lade('proxy_mit', ER + 'kosit-service/proxy.py', {'DIENST_KEY': 'testwert-1', 'KOSIT_INTERN': durl})
psrv, purl = starte(P.Handler)
gleich(ruf(purl)[0], 200, 'KoSIT GET Health')
gleich(json.loads(ruf(purl)[1])['schluessel'], True, 'Health zeigt Schlüssel an')
gleich(ruf(purl, b'<a/>')[0], 401, 'KoSIT ohne Schlüssel')
gleich(ruf(purl, b'<a/>', {'X-Dienst-Schluessel': 'falsch'})[0], 401, 'KoSIT falscher Schlüssel')
gleich(ruf(purl, b'<a/>', {'X-Dienst-Schluessel': 'f\xe4lsch'.encode('latin1').decode('latin1')})[0], 401, 'KoSIT Schlüssel mit Umlaut')
st, body = ruf(purl, b'<gut/>', {'X-Dienst-Schluessel': 'testwert-1', 'Content-Type': 'application/xml'})
gleich((st, body), (200, b'<rep:report><gut/></rep:report>'), 'KoSIT accept durchgereicht')
st, body = ruf(purl, b'<schlecht/>', {'X-Dienst-Schluessel': 'testwert-1'})
gleich((st, body.startswith(b'<rep:report>')), (406, True), 'KoSIT reject mit Report durchgereicht')
gleich(ruf(purl, b'', {'X-Dienst-Schluessel': 'testwert-1'})[0], 400, 'KoSIT leerer Body')
# zu groß: nur Kopf schicken
import http.client
c = http.client.HTTPConnection('127.0.0.1', psrv.server_address[1], timeout=10)
c.putrequest('POST', '/'); c.putheader('X-Dienst-Schluessel', 'testwert-1'); c.putheader('Content-Length', str(P.MAX_BYTES + 1)); c.endheaders()
gleich(c.getresponse().status, 413, 'KoSIT zu groß am Kopf abgewiesen')
c.close()
dsrv.shutdown(); dsrv.server_close()
gleich(ruf(purl)[0], 503, 'KoSIT Health 503 ohne Daemon')
gleich(ruf(purl, b'<a/>', {'X-Dienst-Schluessel': 'testwert-1'})[0], 502, 'KoSIT 502 ohne Daemon')
psrv.shutdown()
os.environ.pop('DIENST_KEY')
dsrv2, durl2 = starte(Daemon)
P2 = lade('proxy_ohne', ER + 'kosit-service/proxy.py', {'KOSIT_INTERN': durl2})
psrv2, purl2 = starte(P2.Handler)
gleich(ruf(purl2, b'<gut/>')[0], 200, 'KoSIT ohne DIENST_KEY wie bisher offen')
psrv2.shutdown(); dsrv2.shutdown()

# ── Mustang: Schlüssel, Grenzen, Aufruf mit nachgestelltem java ──
M = lade('mustang_mit', ER + 'mustang-service/server.py', {'DIENST_KEY': 'testwert-2'})
aufrufe = []
class R: stdout = b'<validation><summary status="valid"/></validation>'; stderr = b''
def fake_run(cmd, capture_output, timeout):
    aufrufe.append(cmd)
    if open(cmd[-1], 'rb').read() == b'%PDF-haengt': raise subprocess.TimeoutExpired(cmd, timeout)
    if open(cmd[-1], 'rb').read() == b'<kaputt/>': raise RuntimeError('a < b & c')
    return R
M.subprocess.run = fake_run
msrv, murl = starte(M.Handler)
gleich(ruf(murl)[0], 200, 'Mustang GET Health')
gleich(ruf(murl, b'%PDF-1.7')[0], 401, 'Mustang ohne Schlüssel')
k = {'X-Dienst-Schluessel': 'testwert-2'}
st, body = ruf(murl, b'%PDF-1.7 x', k)
gleich((st, b'status="valid"' in body, aufrufe[-1][-1].endswith('.pdf'), os.path.exists(aufrufe[-1][-1])), (200, True, True, False), 'Mustang PDF geprüft, Datei danach weg')
ruf(murl, b'<rsm:CrossIndustryInvoice/>', k)
gleich(aufrufe[-1][-1].endswith('.xml'), True, 'Mustang XML als .xml')
gleich(ruf(murl, b'%PDF-haengt', k)[0], 504, 'Mustang Zeitlimit')
st, body = ruf(murl, b'<kaputt/>', k)
gleich((st, body), (500, b'<error>a &lt; b &amp; c</error>'), 'Mustang Fehlertext maskiert')
gleich(ruf(murl, b'', k)[0], 400, 'Mustang leerer Body')
c = http.client.HTTPConnection('127.0.0.1', msrv.server_address[1], timeout=10)
c.putrequest('POST', '/'); c.putheader('X-Dienst-Schluessel', 'testwert-2'); c.putheader('Content-Length', str(M.MAX_BYTES + 1)); c.endheaders()
gleich(c.getresponse().status, 413, 'Mustang zu groß am Kopf abgewiesen')
c.close()
c = http.client.HTTPConnection('127.0.0.1', msrv.server_address[1], timeout=10)
c.putrequest('POST', '/'); c.putheader('X-Dienst-Schluessel', 'testwert-2'); c.putheader('Content-Length', 'abc'); c.endheaders()
gleich(c.getresponse().status, 400, 'Mustang Content-Length ungültig')
c.close()
msrv.shutdown()
print(f'dienste: {n} Prüfungen grün')
