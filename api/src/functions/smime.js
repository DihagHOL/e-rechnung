'use strict';
/**
 * HTTP-Trigger: S/MIME-signierte Mails auspacken (src/smime.js)
 * =============================================================
 *   POST /api/smime   { anhaenge: [{ name, contentType, contentBytes }] }   (die Anhänge aus dem Outlook-Auslöser)
 *     -> { anhaenge: [...], ausgepackt }
 *
 * Jeder Anhang „smime.p7m“ wird durch die PDFs und XMLs darin ersetzt, alle anderen bleiben, wie sie
 * sind. Die Eingangs-Flows rufen das auf, wenn eine Mail signiert ist, und laufen dann normal weiter.
 * Verschlüsselte Mails: 422 mit einem Text, der im Lauf als Fehler erscheint.
 *
 * authLevel "function": Aufruf mit dem Function-Key, wie /api/intake.
 */
const { app } = require('@azure/functions');
const { smimeAnhaenge } = require('../smime');

app.http('smime', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'smime',
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: 'JSON mit anhaenge erwartet' } };
    }
    try {
      const r = smimeAnhaenge(body && body.anhaenge);
      return { status: 200, jsonBody: r };
    } catch (e) {
      context.warn('S/MIME', e.message);
      return { status: e.status || 500, jsonBody: { error: e.message } };
    }
  },
});
