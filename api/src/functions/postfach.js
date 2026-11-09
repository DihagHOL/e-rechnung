'use strict';
/**
 * HTTP-Trigger: Rechnungspostfach eines Werks über Graph lesen (src/postfach.js)
 * =============================================================================
 *   GET /api/postfach?werk=<Kürzel>[&tage=2]   -> { werk, postfach, seit, anzahl, mails: [{ id, empfangen, betreff, von, antwortAn }] }
 *   GET /api/postfach?werk=<Kürzel>&id=<ID>    -> { id, empfangen, betreff, von, antwortAn, anhaenge: [{ name, contentType, size, contentBytes }] }
 *   GET /api/postfach?werk=<Kürzel>&ordner=<Name>[&unterordner=1][&tage=2][&zeit=geaendert][&ab=JJJJ-MM-TT]
 *       -> wie oben, aber aus diesem Ordner („IRIS“, „Posteingang/IRIS“), mit unterordner=1 samt allen Ordnern darunter.
 *       zeit=geaendert: Zeitfenster nach letzter Änderung (auch später einsortierte Mails).
 *       ab: nur Mails, die ab diesem Tag eingegangen sind (Stichtag)
 *   POST /api/postfach?werk=<Kürzel>&id=<ID>&nach=<Ordner>   -> { id, ordner }, verschiebt die Mail (nur Graph, Mail.ReadWrite)
 *   GET /api/postfach?werk=<Kürzel>&diagnose=1 -> Graph: { rollen, ordner: [{ pfad, anzahl }] }
 *                                                EWS: { ausgehendeIp, land, server: [{ ip, status, server }] }, ohne Anmeldung
 *
 * authLevel "function": Der Flow „E-R-Rechnung_<Werk> (nur Monitoring)“ ruft es mit dem Function-Key auf.
 * Ohne vollständige App-Einstellungen POSTFACH_<WERK>_* antwortet es mit 404.
 */
const { app } = require('@azure/functions');
const { zugang, mailsSeit, mailMitAnhaengen, ordnerId, ordnerMitUnterordnern, verschieben, graphDiagnose } = require('../postfach');
const { ewsDiagnose } = require('../ews');

app.http('postfach', {
  methods: ['GET', 'POST'],
  authLevel: 'function',
  route: 'postfach',
  handler: async (request, context) => {
    const z = zugang(request.query.get('werk'));
    if (!z) {
      return { status: 404, jsonBody: { error: 'Für dieses Werk ist kein Postfach eingerichtet (App-Einstellungen POSTFACH_<WERK>_*).' } };
    }
    try {
      if (request.query.get('diagnose')) return { status: 200, jsonBody: await (z.art === 'ews' ? ewsDiagnose(z) : graphDiagnose(z)) };
      const id = request.query.get('id');
      if (request.method === 'POST') {
        const nach = request.query.get('nach');
        if (!id || !nach) return { status: 400, jsonBody: { error: 'id und nach fehlen' } };
        return { status: 200, jsonBody: await verschieben(z, id, nach) };
      }
      if (id) return { status: 200, jsonBody: await mailMitAnhaengen(z, id) };
      const tage = Math.min(Math.max(parseFloat(request.query.get('tage')) || 2, 0.05), 14);
      const seit = new Date(Date.now() - tage * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');
      const ordner = request.query.get('ordner');
      if (ordner && z.art !== 'graph') return { status: 400, jsonBody: { error: 'Ordner wählen geht nur über Graph' } };
      const abRoh = String(request.query.get('ab') || '');
      if (abRoh && !/^\d{4}-\d{2}-\d{2}$/.test(abRoh)) return { status: 400, jsonBody: { error: 'ab als JJJJ-MM-TT angeben' } };
      const ab = abRoh ? abRoh + 'T00:00:00Z' : '';
      const ids = !ordner ? '' : request.query.get('unterordner') === '1' ? await ordnerMitUnterordnern(z, ordner) : await ordnerId(z, ordner);
      const mails = await mailsSeit(z, seit, ids, request.query.get('zeit') === 'geaendert', ab);
      return { status: 200, jsonBody: { werk: z.werk, postfach: z.adresse, ordner: ordner || z.ordner, seit, anzahl: mails.length, mails } };
    } catch (e) {
      context.warn('Postfach', z.werk, e.message);
      return { status: [400, 404, 409].includes(e.status) ? e.status : 502, jsonBody: { error: e.message } };
    }
  },
});
