/* Seiten-Skript von xml-zu-pdf.html. Stand früher inline in der Seite; die Content-Security-Policy
   erlaubt nur Skripte aus eigenen Dateien. */

/* ── Zustand ── */
let _pdfBytes = null;
let _pdfDoc   = null;
let _pageNum  = 1;
let _fileBase = 'rechnung';

/* ── Upload-Zone ── */
document.addEventListener('DOMContentLoaded', () => {
  const zone  = document.getElementById('upload-zone');
  const input = document.getElementById('xml-input');

  zone.addEventListener('click', e => {
    if (e.target.id !== 'btn-change-file') input.click();
  });
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });

  document.getElementById('btn-change-file').addEventListener('click', e => {
    e.stopPropagation();
    input.click();
  });

  document.getElementById('btn-download-pdf').addEventListener('click', downloadPdf);
  document.getElementById('btn-prev-page').addEventListener('click', () => gotoPage(_pageNum - 1));
  document.getElementById('btn-next-page').addEventListener('click', () => gotoPage(_pageNum + 1));
});

/* ── Datei verarbeiten ── */
async function handleFile(file) {
  if (!/\.xml$/i.test(file.name)) {
    showToast('Bitte eine XML-Datei auswählen.', 'error');
    return;
  }
  _fileBase = file.name.replace(/\.xml$/i, '');

  showLoading(true, 'XML wird gelesen…');
  try {
    const xmlText = await file.text();
    const data = parseInvoiceXML(xmlText);

    showLoading(true, 'PDF wird erzeugt…');
    _pdfBytes = await buildInvoicePdf(data);
    // PDF/A-3b finalisieren (OutputIntent + XMP + Trailer-ID), Schrift ist eingebettet
    if (typeof makeReadablePdfA3 === 'function') {
      try { _pdfBytes = await makeReadablePdfA3(_pdfBytes); } catch (e) { console.warn('PDF/A übersprungen:', e); }
    }

    // Datei-Info anzeigen
    document.getElementById('upload-zone').classList.add('has-file');
    document.getElementById('file-name-display').textContent = file.name;
    document.getElementById('file-size-display').textContent =
      (file.size / 1024).toFixed(1) + ' KB · ' + data.syntax + '-Syntax';

    renderSummary(data);
    // erst einblenden, dann rendern: die Vorschau braucht die Breite des Bereichs
    document.getElementById('result-area').style.display = 'block';
    await renderPreview();

    showLoading(false);
    showToast('E-Rechnung erfolgreich konvertiert.', 'success');
  } catch (err) {
    showLoading(false);
    console.error(err);
    showToast('Konvertierung fehlgeschlagen: ' + err.message, 'error');
  }
}

/* ── Zusammenfassung ── */
function renderSummary(d) {
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const eur = n => (n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' €';
  const dt  = s => s ? s.split('-').reverse().join('.') : '–';
  const rows = [
    ['Rechnungsnummer', esc(d.rechnungsnummer) || '–'],
    ['Rechnungsdatum',  dt(d.rechnungsdatum)],
    ['Aussteller',      esc(d.verkaeufer) || '–'],
    ['Empfänger',       esc(d.kaeufer) || '–'],
    ['Positionen',      d.positionen.length],
    ['Nettobetrag',     eur(d.netTotal)],
    ['MwSt.',           eur(d.vatTotal)],
    ['Gesamtbetrag',    `<strong>${eur(d.grossTotal)}</strong>`],
    ['Fällig am',       dt(d.faelligkeitsdatum)],
    ['Syntax',          d.syntax],
  ];
  document.getElementById('xml-summary').innerHTML =
    rows.map(([k, v]) => `<tr><td class="xs-label">${k}</td><td class="xs-value">${v}</td></tr>`).join('');
}

/* ── PDF-Vorschau (pdf.js) ── */
async function renderPreview() {
  _pdfDoc  = await pdfjsLib.getDocument({ data: _pdfBytes.slice(0) }).promise;
  _pageNum = 1;
  await renderPage();
}

async function renderPage() {
  const page    = await _pdfDoc.getPage(_pageNum);
  const wrapper = document.getElementById('pdf-canvas-wrapper');
  const canvas  = document.getElementById('pdf-canvas');
  const ctx     = canvas.getContext('2d');

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const raw = page.getViewport({ scale: 1 });
  const cssScale = Math.max(wrapper.clientWidth - 32, 300) / raw.width;   // nie 0 oder negativ
  const vp  = page.getViewport({ scale: cssScale * dpr });

  canvas.width  = vp.width;
  canvas.height = vp.height;
  canvas.style.width  = (vp.width  / dpr) + 'px';
  canvas.style.height = (vp.height / dpr) + 'px';
  await page.render({ canvasContext: ctx, viewport: vp }).promise;

  document.getElementById('page-info').textContent = `Seite ${_pageNum} / ${_pdfDoc.numPages}`;
  document.getElementById('btn-prev-page').disabled = _pageNum <= 1;
  document.getElementById('btn-next-page').disabled = _pageNum >= _pdfDoc.numPages;
}

async function gotoPage(n) {
  if (!_pdfDoc || n < 1 || n > _pdfDoc.numPages) return;
  _pageNum = n;
  await renderPage();
}

/* ── Download ── */
function downloadPdf() {
  if (!_pdfBytes) return;
  const blob = new Blob([_pdfBytes], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = _fileBase + '.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('PDF heruntergeladen.', 'success');
}

/* ── UI-Helfer ── */
function showLoading(visible, msg = 'Verarbeitung…') {
  const overlay = document.getElementById('loading-overlay');
  const t = document.getElementById('loading-text');
  if (t) t.textContent = msg;
  overlay.style.display = visible ? 'flex' : 'none';
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  // Meldungen enthalten oft Fehlertexte von außen: nur als Text einsetzen
  const icon = document.createElement('span'); icon.className = 'toast-icon'; icon.textContent = icons[type] || 'ℹ️';
  const text = document.createElement('span'); text.textContent = message;
  toast.append(icon, text);
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 4000);
}

onAuthReady(() => initAdminNav());

authInit();
