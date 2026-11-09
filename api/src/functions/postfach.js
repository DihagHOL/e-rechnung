'use strict';
/**
 * HTTP-Trigger: Rechnungspostfach eines Werks über Graph lesen (src/postfach.js)
 * =============================================================================
 *   GET /api/postfach?werk=<Kürzel>[&tage=2]   -> { werk, postfach, seit, anzahl, mails: [{ id, empfangen, betreff, von, antwortAn }] }
 *   GET /api/postfach?werk=<Kürzel>&id=<ID>    -> { id, empfangen, betreff, von, antwortAn, anhaenge: [{ name, contentType, size, contentBytes }] }
 *
 * authLevel "function": Der Flow „E-R-Rechnung_<Werk> (nur Monitoring)“ ruft es mit dem Function-Key auf.
 * Ohne vollständige App-Einstellungen POSTFACH_<WERK>_* antwortet es mit 404.
 */
const { app } = require('@azure/functions');
const { zugang, mailsSeit, mailMitAnhaengen } = require('../postfach');

app.http('postfach', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'postfach',
  handler: async (request, context) => {
    const z = zugang(request.query.get('werk'));
    if (!z) {
      return { status: 404, jsonBody: { error: 'Für dieses Werk ist kein Postfach eingerichtet (App-Einstellungen POSTFACH_<WERK>_*).' } };
    }
    try {
      const id = request.query.get('id');
      if (id) return { status: 200, jsonBody: await mailMitAnhaengen(z, id) };
      const tage = Math.min(Math.max(parseFloat(request.query.get('tage')) || 2, 0.05), 14);
      const seit = new Date(Date.now() - tage * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');
      const mails = await mailsSeit(z, seit);
      return { status: 200, jsonBody: { werk: z.werk, postfach: z.adresse, seit, anzahl: mails.length, mails } };
    } catch (e) {
      context.warn('Postfach', z.werk, e.message);
      return { status: e.status === 404 ? 404 : 502, jsonBody: { error: e.message } };
    }
  },
});
