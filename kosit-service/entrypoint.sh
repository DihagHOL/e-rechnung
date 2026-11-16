#!/usr/bin/env bash
# Startet den KoSIT-Validator im Daemon-Modus (nur intern, 127.0.0.1:8081) und davor den
# Wächter proxy.py auf 0.0.0.0:8080, der Schlüssel (DIENST_KEY) und Größe prüft.
set -euo pipefail

JAR="$(find /opt/kosit/validator -name 'validationtool-*-standalone.jar' | sort | head -1)"
SCEN="$(find /opt/kosit/config -name 'scenarios.xml' | head -1)"
REPO="$(dirname "$SCEN")"

if [ -z "$JAR" ] || [ -z "$SCEN" ]; then
  echo "FEHLER: Validator-JAR oder scenarios.xml nicht gefunden." >&2
  exit 1
fi

echo "KoSIT-Daemon startet:"
echo "  JAR:        $JAR"
echo "  Szenarien:  $SCEN"
echo "  Repository: $REPO"
if [ -z "${DIENST_KEY:-}" ]; then
  echo "  WARNUNG: DIENST_KEY ist nicht gesetzt, der Dienst ist ohne Schlüssel erreichbar." >&2
fi

# -D Daemon, -H Host, -P Port, -s Szenarien, -r Ressourcen-Verzeichnis
java -jar "$JAR" -s "$SCEN" -r "$REPO" -D -H 127.0.0.1 -P 8081 &
JAVA_PID=$!

# Port 8080 erst öffnen, wenn der Daemon antwortet: Die Plattform schickt Anfragen, sobald
# der Port offen ist. Vorher wäre jede Prüfung ein Fehler.
for _ in $(seq 1 120); do
  if curl -fsS -o /dev/null http://127.0.0.1:8081/; then break; fi
  if ! kill -0 "$JAVA_PID" 2>/dev/null; then
    echo "FEHLER: KoSIT-Daemon ist beim Start beendet." >&2
    exit 1
  fi
  sleep 1
done

python3 /opt/kosit/proxy.py &
PROXY_PID=$!

# Endet einer der beiden Prozesse, endet der Container und wird neu gestartet
trap 'kill "$JAVA_PID" "$PROXY_PID" 2>/dev/null || true' TERM INT
wait -n "$JAVA_PID" "$PROXY_PID" || true
kill "$JAVA_PID" "$PROXY_PID" 2>/dev/null || true
exit 1
