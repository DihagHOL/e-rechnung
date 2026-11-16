'use strict';
/**
 * Aufrufe der Prüf-Container (KoSIT, veraPDF, Mustang)
 * ====================================================
 * Die Container sind aus dem Internet erreichbar. Damit nur der Prüfdienst sie nutzt, schickt
 * er den Schlüssel aus der App-Einstellung DIENST_KEY im Kopf X-Dienst-Schluessel mit, so wie
 * OCR_KEY beim OCR-Dienst. Der Container prüft ihn, wenn bei ihm DIENST_KEY gesetzt ist.
 * Ohne die Einstellung geht kein Kopf mit (Stand vor 11/2026, Container ohne Schlüssel).
 *
 * Jeder Aufruf hat ein Zeitlimit: Ein hängender Container hält sonst den Prüfdienst fest,
 * bis die Plattform abbricht. Power Automate wartet ohnehin nur 120 Sekunden.
 */
const ZEIT_MS = { kosit: 90000, verapdf: 90000, mustang: 100000 };

/** Kopfzeilen für einen Container-Aufruf, mit Schlüssel, wenn DIENST_KEY gesetzt ist. */
function dienstKopf(kopf) {
  const schluessel = process.env.DIENST_KEY || '';
  return Object.assign({}, kopf, schluessel ? { 'X-Dienst-Schluessel': schluessel } : {});
}

/** fetch an einen Container: Schlüssel im Kopf, Zeitlimit je Dienst. */
function dienstFetch(dienst, url, kopf, body) {
  return fetch(url, {
    method: 'POST',
    headers: dienstKopf(kopf),
    body,
    signal: AbortSignal.timeout(ZEIT_MS[dienst] || 90000),
  });
}

module.exports = { dienstKopf, dienstFetch, ZEIT_MS };
