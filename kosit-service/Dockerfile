# KoSIT-Validator im Daemon-Modus (HTTP) — offizieller Validator, Java 8.
# Baut die XRechnung-Konfiguration (release 2024-06-20, 3.0.2) fest ein.
#
# Build:  docker build -t erechnung-kosit .
# Run:    docker run -p 8080:8080 erechnung-kosit
# Test:   curl -X POST --data-binary @rechnung.xml http://localhost:8080/
#
# Nach außen antwortet proxy.py (Schlüssel DIENST_KEY, Größengrenze), der Daemon lauscht nur intern.
FROM eclipse-temurin:8-jre

ARG KOSIT_VER=1.5.0
ARG CONFIG_URL=https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/release-2024-06-20/validator-configuration-xrechnung_3.0.2_2024-06-20.zip
# SHA-256 der beiden Downloads. Weicht eine Datei ab, bricht der Build ab. Bei einer neuen
# Version die Summe mit erneuern (docs/Dienst-Schluessel.md, Abschnitt Prüfsummen).
ARG KOSIT_SHA256=ac78fb3e89d6daa81770049b004bd1408cad81100b885dd1d8da2cd169bd679f
ARG CONFIG_SHA256=128e59bd2a6ccd0d8796313cfd794480035da6f87998dcb157b8e6af5a1e4069

WORKDIR /opt/kosit

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ca-certificates python3 \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o validator.zip "https://github.com/itplr-kosit/validator/releases/download/v${KOSIT_VER}/validator-${KOSIT_VER}-distribution.zip" \
 && echo "${KOSIT_SHA256}  validator.zip" | sha256sum -c - \
 && mkdir validator && unzip -q validator.zip -d validator && rm validator.zip \
 && curl -fsSL -o config.zip "${CONFIG_URL}" \
 && echo "${CONFIG_SHA256}  config.zip" | sha256sum -c - \
 && mkdir config && unzip -q config.zip -d config && rm config.zip

COPY entrypoint.sh /opt/kosit/entrypoint.sh
COPY proxy.py /opt/kosit/proxy.py
RUN chmod +x /opt/kosit/entrypoint.sh

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=8s --start-period=25s \
  CMD curl -fsS http://localhost:8080/ >/dev/null || exit 1

ENTRYPOINT ["/opt/kosit/entrypoint.sh"]
