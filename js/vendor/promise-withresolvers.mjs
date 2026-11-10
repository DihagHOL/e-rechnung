/**
 * Ersatz für Promise.withResolvers
 * ================================
 * pdf.js 6 ruft Promise.withResolvers direkt auf, auch in der legacy-Fassung. Ältere Browser
 * kennen es nicht (Chrome und Edge vor 119, Firefox vor 121, Safari vor 17.4, unter Windows 7
 * und 8.1 bleiben Chrome und Edge auf 109). Dort scheitert das Laden jedes PDFs mit
 * „Promise.withResolvers is not a function“. Neuere Browser lassen das hier unberührt.
 *
 * Wird vor pdf.js geladen: auf der Seite von pdfjs-laden.mjs, im Worker von pdfjs-worker.mjs.
 */
if (typeof Promise.withResolvers !== 'function') {
  Object.defineProperty(Promise, 'withResolvers', {
    configurable: true,
    writable: true,
    value: function withResolvers() {
      let resolve, reject;
      const promise = new this((ja, nein) => { resolve = ja; reject = nein; });
      return { promise, resolve, reject };
    },
  });
}
