# Texterkennung für gescannte Rechnungen als HTTP-Dienst (Tesseract + Poppler).
#
# Build:  az acr build -r <registry> -t erechnung-ocr:latest .
# Run:    docker run -p 8080:8080 erechnung-ocr
# Test:   curl -X POST --data-binary @scan.pdf http://localhost:8080/
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl poppler-utils tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng \
 && rm -rf /var/lib/apt/lists/* \
 && tesseract --version

WORKDIR /opt/ocr
COPY server.py /opt/ocr/server.py

# Ein Faden je Tesseract: Auf einem vCPU bringt OpenMP nichts und bremst parallele Aufrufe
ENV OMP_THREAD_LIMIT=1
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -fsS http://localhost:8080/ >/dev/null || exit 1

CMD ["python3", "/opt/ocr/server.py"]
