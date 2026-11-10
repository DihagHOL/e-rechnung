/**
 * Worker von pdf.js mit Ersatz für ältere Browser
 * ===============================================
 * Der Worker hat einen eigenen Kontext, ein Ersatz auf der Seite kommt dort nicht an. Module
 * werden in der Reihenfolge ihrer Imports ausgeführt: zuerst der Ersatz, dann pdf.js. Der Worker
 * von pdf.js meldet sich beim Laden selbst bei der Seite an. Der Export wird durchgereicht, weil
 * pdf.js ihn braucht, wenn es den Worker ersatzweise im Seitenfaden lädt.
 */
import './vendor/promise-withresolvers.mjs';
export { WorkerMessageHandler } from './vendor/pdf-6.4.299.worker.min.mjs';
