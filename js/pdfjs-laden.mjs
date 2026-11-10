/**
 * pdf.js laden
 * ============
 * pdf.js gibt es ab Version 4 nur noch als ES-Modul. Dieses Modul lädt es und stellt es
 * wie früher als window.pdfjsLib bereit, damit app.js, ocr.js, umsatzgrenze.js usw.
 * unverändert bleiben. Legacy-Build, weil der moderne Build neue Sprachfunktionen
 * (Map.getOrInsertComputed) ohne Ersatz voraussetzt.
 *
 * Module laufen nach dem Parsen der Seite, aber vor DOMContentLoaded. Code, der pdf.js
 * braucht, darf es deshalb erst in Ereignissen oder nach dem Laden benutzen.
 * Version im Dateinamen, damit kein Browser eine alte Datei aus dem Cache nimmt.
 *
 * Auch die legacy-Fassung setzt Promise.withResolvers voraus. Der Ersatz kommt deshalb zuerst,
 * hier auf der Seite und über pdfjs-worker.mjs im Worker (ältere Browser, etwa Edge auf Windows 8.1).
 */
import './vendor/promise-withresolvers.mjs';
import * as pdfjsLib from './vendor/pdf-6.4.299.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./pdfjs-worker.mjs', import.meta.url).href;
window.pdfjsLib = pdfjsLib;
