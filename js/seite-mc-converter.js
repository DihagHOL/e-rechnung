/* Seiten-Skript von mc-converter.html. Stand früher inline in der Seite; die Content-Security-Policy
   erlaubt nur Skripte aus eigenen Dateien. */
/* ── Zustand ── */
let _srcText = null;
let _result  = null;
let _fileBase = 'zahlung';
let _mode = 'sepa';          // 'sepa' = pain.001 -> 001.09, 'azv' = DTAZV -> AXZ
let _accounts = {};          // AZV: { 'BLZ/KTO': { iban, bic } } aus Eingabe oder Speicher
let _towns = {};             // AZV: { <Posten-Index>: 'Ort' } fuer Empfaenger ohne Ort
let _azvOptsKey = '';

/* Eingaben fuer AZV merken (nur in diesem Browser). Fehlt der Speicher,
   laeuft alles ohne Vorbelegung weiter. */
const AZV_STORE = 'mcConverter.azv.v1';
function azvStore() {
  try { return JSON.parse(localStorage.getItem(AZV_STORE)) || { accounts: {}, towns: {} }; }
  catch { return { accounts: {}, towns: {} }; }
}
function azvSave(fn) {
  try { const s = azvStore(); fn(s); localStorage.setItem(AZV_STORE, JSON.stringify(s)); } catch { /* ohne Speicher */ }
}

/* ── Upload-Zone ── */
document.addEventListener('DOMContentLoaded', () => {
  const zone  = document.getElementById('upload-zone');
  const input = document.getElementById('xml-input');

  zone.addEventListener('click', e => { if (e.target.id !== 'btn-change-file') input.click(); });
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });
  document.getElementById('btn-change-file').addEventListener('click', e => { e.stopPropagation(); input.click(); });

  document.getElementById('btn-download-xml').addEventListener('click', downloadXml);
  document.getElementById('btn-copy-xml').addEventListener('click', copyXml);

  ['opt-batch', 'opt-instr', 'opt-clean'].forEach(id =>
    document.getElementById(id).addEventListener('change', () => { if (_srcText) runConvert(); }));

  // AZV: Belastungskonto (IBAN/BIC) und fehlende Orte der Empfaenger
  document.getElementById('mc-azv-opts').addEventListener('change', e => {
    const el = e.target.closest('input[data-acc]');
    if (!el) return;
    const key = el.dataset.acc;
    const val = el.value.replace(/\s+/g, '').toUpperCase();
    _accounts[key] = Object.assign({}, _accounts[key], { [el.dataset.f]: val });
    azvSave(s => { s.accounts[key] = Object.assign({}, s.accounts[key], { [el.dataset.f]: val }); });
    runConvert();
  });
  document.getElementById('mc-txn-body').addEventListener('change', e => {
    const el = e.target.closest('input.mc-town');
    if (!el || !_result) return;
    const idx = el.dataset.idx;
    const town = el.value.trim();
    _towns[idx] = town;
    const t = _result.txns[idx];
    if (t && t.cdtrIban) azvSave(s => { if (town) s.towns[t.cdtrIban] = town; else delete s.towns[t.cdtrIban]; });
    runConvert();
  });
});

/* ── Datei einlesen ── */
async function handleFile(file) {
  // Keine Endungspruefung: MultiCash-/DK-Exporte haben oft keine oder eine
  // fremde Endung. Ob es wirklich eine pain.001 ist, entscheidet der Inhalt
  // (convertPain001 wirft sonst eine klare Meldung).
  _fileBase = file.name.replace(/\.(xml|azv)$/i, '');
  showLoading(true, 'Datei wird gelesen…');
  try {
    // UTF-8 zuerst, sonst Windows-1252 (DTAZV-Exporte sind oft ANSI)
    const buf = await file.arrayBuffer();
    try { _srcText = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { _srcText = new TextDecoder('windows-1252').decode(buf); }
    _mode = isDtazv(_srcText) ? 'azv' : 'sepa';
    _accounts = {}; _towns = {}; _azvOptsKey = '';
    applyModeUi();
    document.getElementById('upload-zone').classList.add('has-file');
    document.getElementById('file-name-display').textContent = file.name;
    document.getElementById('file-size-display').textContent = (file.size / 1024).toFixed(1) + ' KB';
    document.getElementById('mc-options').style.display = 'flex';
    runConvert();
  } catch (err) {
    showLoading(false); console.error(err);
    showToast('Datei konnte nicht gelesen werden: ' + err.message, 'error');
  }
}

/* ── Oberflaeche je nach Dateiart ── */
function applyModeUi() {
  const azv = _mode === 'azv';
  document.getElementById('lbl-batch').style.display = azv ? 'none' : '';
  document.getElementById('lbl-instr').style.display = azv ? 'none' : '';
  document.getElementById('mc-azv-opts').style.display = azv ? 'flex' : 'none';
  document.getElementById('lbl-clean-text').textContent = azv
    ? 'Zeichensatz bereinigen (SWIFT: Umlaute → ae/oe/ue)'
    : 'SEPA-Zeichensatz erzwingen (Umlaute → ae/oe/ue)';
  document.getElementById('th-acct').textContent = azv ? 'Konto / Bank' : 'IBAN / BIC';
  document.getElementById('export-title').textContent = azv ? 'pain.001.001.09 AXZ herunterladen' : 'pain.001.001.09 herunterladen';
  document.getElementById('preview-title').textContent = azv ? '📄 pain.001.001.09 AXZ (Vorschau)' : '📄 pain.001.001.09 (Vorschau)';
}

/* Gemerkte IBAN/BIC und Orte uebernehmen, wenn noch nichts eingetragen ist */
function applyRemembered(r) {
  const s = azvStore();
  let changed = false;
  for (const a of r.accounts) {
    if (!_accounts[a.key] && s.accounts[a.key]) { _accounts[a.key] = Object.assign({}, s.accounts[a.key]); changed = true; }
  }
  for (const t of r.txns) {
    if (t.townMissing && _towns[t.idx] == null && t.cdtrIban && s.towns[t.cdtrIban]) { _towns[t.idx] = s.towns[t.cdtrIban]; changed = true; }
  }
  return changed;
}

/* AZV: Eingabefelder fuer das Belastungskonto (einmal je Datei aufbauen) */
function renderAzvOpts(r) {
  const key = r.accounts.map(a => a.key).join('|');
  const box = document.getElementById('mc-azv-opts');
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  if (key === _azvOptsKey) return;
  _azvOptsKey = key;
  box.innerHTML = r.accounts.map(a => `
    <div class="azv-acc">
      <div class="azv-acc-head">Belastungskonto BLZ ${esc(a.blz)} · Konto ${esc(a.kto)} (${esc(a.ccy)})</div>
      <label>IBAN <input data-acc="${esc(a.key)}" data-f="iban" value="${esc(a.iban)}" spellcheck="false"></label>
      <label>BIC der eigenen Bank (optional) <input data-acc="${esc(a.key)}" data-f="bic" value="${esc(a.bic)}" placeholder="z. B. DEUTDEFFXXX" spellcheck="false"></label>
    </div>`).join('')
    + '<div class="azv-note">Die IBAN wird aus BLZ und Kontonummer berechnet. Eingaben werden in diesem Browser gemerkt.</div>';
}

/* ── Konvertieren ── */
function runConvert() {
  showLoading(true, 'Wird umgestellt…');
  try {
    if (_mode === 'azv') {
      const opts = () => ({ sepaClean: document.getElementById('opt-clean').checked, accounts: _accounts, towns: _towns });
      _result = convertDtazv(_srcText, opts());
      if (applyRemembered(_result)) _result = convertDtazv(_srcText, opts());
      renderAzvOpts(_result);
    } else {
      _result = convertPain001(_srcText, {
        batchBooking: document.getElementById('opt-batch').checked,
        keepInstrId:  document.getElementById('opt-instr').checked,
        sepaClean:    document.getElementById('opt-clean').checked,
      });
    }
    render(_result);
    document.getElementById('result-area').style.display = 'block';
    showLoading(false);
    showToast(_mode === 'azv' ? 'Auslandszahlung auf pain.001.001.09 AXZ umgestellt.' : 'Umstellung auf pain.001.001.09 erfolgreich.', 'success');
  } catch (err) {
    showLoading(false); console.error(err);
    document.getElementById('result-area').style.display = 'none';
    showToast('Umstellung fehlgeschlagen: ' + err.message, 'error');
  }
}

/* ── Anzeige ── */
function render(r) {
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const dt  = s => (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) ? s.split('-').reverse().join('.') : (s || '–');
  const eur = s => Number(s || 0).toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' €';

  const azv = r.kind === 'axz';
  // Nachkommastellen wie im Betrag (USD 2, JPY 0, KWD 3)
  const money = (s, ccy) => {
    const dec = (String(s || '').split('.')[1] || '').length;
    return Number(s || 0).toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + ' ' + (ccy === 'EUR' || !ccy ? '€' : ccy);
  };
  const sumTxt = azv ? Object.entries(r.stats.sums).map(([c, v]) => money(v, c)).join(' · ') : eur(r.stats.ctrlSum);
  const ibanCalc = azv && r.accounts.some(a => !a.ibanOverridden) ? ' <span class="mc-sub">(aus BLZ und Konto berechnet)</span>' : '';

  const rows = [
    ['Quellformat',     `<code>${esc(r.stats.srcVersion)}</code>`],
    ['Zielformat',      `<code>${esc(r.stats.dstVersion)}</code> ✅`],
    ...(azv ? [['Einreichen per', 'EBICS-Auftragsart <strong>AXZ</strong> (nicht CCT)']] : []),
    ['Nachrichten-ID',  esc(r.stats.msgId) || '–'],
    ['Auftraggeber',    esc(r.stats.debtor || r.stats.initgParty) || '–'],
    ['Konto (IBAN)',    (esc(r.stats.debtorIban) || '–') + ibanCalc],
    ['Ausführung am',   dt(r.stats.execDate)],
    ['Anzahl Zahlungen', `<strong>${r.stats.nbOfTxs}</strong>`],
    [azv ? 'Summe' : 'Kontrollsumme', `<strong>${sumTxt}</strong>`],
  ];
  document.getElementById('mc-summary').innerHTML =
    rows.map(([k, v]) => `<tr><td class="xs-label">${k}</td><td class="xs-value">${v}</td></tr>`).join('');

  // Preflight (grün/rot) + Hinweise
  const msg = document.getElementById('mc-messages');
  const pf = r.preflight || { errors: [], notes: [] };
  let html = '';
  if (pf.errors.length) {
    html += `<div class="mc-err"><h4>✗ Preflight: ${pf.errors.length} Fehler — so nicht bankfertig</h4><ul>${
      pf.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
  } else if (azv) {
    html += `<div class="mc-ok">✅ <strong>Preflight bestanden, bankfertig für AXZ.</strong> ${pf.nbOfTxs} Posten, ${sumTxt}. `
          + `DK-Pflichtfelder, Ort und Land, IBAN-Prüfziffern, BIC-Format, Entgeltregelung, Summen, SWIFT-Zeichensatz und Feldlängen sind ok. `
          + `Einreichen per EBICS-Auftragsart AXZ.</div>`;
  } else {
    html += `<div class="mc-ok">✅ <strong>Preflight bestanden — bankfertig.</strong> ${pf.nbOfTxs} Posten, ${eur(pf.ctrlSum)}. `
          + `IBAN-Prüfziffern (Mod-97), BIC-Format, Summen, SEPA-Zeichensatz und Feldlängen sind ok.</div>`;
  }
  const hinweise = [...new Set([...pf.notes, ...r.warnings])];
  if (hinweise.length) {
    html += `<div class="mc-warn"><h4>⚠ ${hinweise.length} Hinweis(e) — bitte prüfen</h4><ul>${
      hinweise.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>`;
  }
  msg.innerHTML = html;

  // Download optisch an den Preflight koppeln (rot = mit Vorsicht)
  const dl = document.getElementById('btn-download-xml');
  dl.classList.toggle('btn-xrechnung', !pf.errors.length);
  document.getElementById('export-hint').textContent = pf.errors.length
    ? '⚠ Preflight-Fehler — vor dem Bank-Upload korrigieren'
    : azv ? 'Bankfertig, per EBICS-Auftragsart AXZ einreichen' : 'Bankfertige ISO-20022-Zahldatei (Preflight bestanden)';

  // Posten-Tabelle
  document.getElementById('mc-txn-count').textContent = r.txns.length;
  const FEE = { DEBT: 'OUR', SHAR: 'SHA', CRED: 'BEN' };
  if (azv) {
    document.getElementById('mc-txn-body').innerHTML = r.txns.map(t => {
      const place = [t.pstCd, t.town].filter(Boolean).join(' ');
      const adr = t.townMissing
        ? `<input class="mc-town${t.town ? ' filled' : ''}" data-idx="${t.idx}" value="${esc(t.town)}" placeholder="Ort fehlt (Pflicht)" title="Ort des Empfängers, Pflicht für AXZ">
           <div class="mc-sub">Land ${esc(t.ctry || '–')}${t.town ? '' : ' · Ort bitte eintragen'}</div>`
        : `<div class="mc-sub">${esc(place)} · ${esc(t.ctry)}</div>`;
      return `
      <tr>
        <td>${esc(t.cdtrNm)}${adr}</td>
        <td class="mono">${esc(t.cdtrIban)}<br>${esc(t.cdtrBic || 'ohne BIC')}</td>
        <td class="amt">${money(t.amount, t.ccy)}<div class="mc-sub" title="${esc(t.chrgTxt)}">${FEE[t.chrgBr] || t.chrgBr}${t.svcLvl === 'URGP' ? ' · Eilzahlung' : ''}</div></td>
        <td>${esc(t.ustrd)}</td>
      </tr>`;
    }).join('');
  } else document.getElementById('mc-txn-body').innerHTML = r.txns.map(t => `
    <tr>
      <td>${esc(t.cdtrNm)}</td>
      <td class="mono">${esc(t.cdtrIban)}<br>${esc(t.cdtrBic || 'ohne BIC')}</td>
      <td class="amt">${eur(t.amount)}</td>
      <td>${esc(t.ustrd)}</td>
    </tr>`).join('');

  // XML-Vorschau
  document.getElementById('mc-xml-out').textContent = r.xml;
}

/* ── Download / Kopieren ── */
function downloadXml() {
  if (!_result) return;
  const blob = new Blob([_result.xml], { type: 'application/xml' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = _fileBase + (_mode === 'azv' ? '_pain.001.001.09_AXZ.xml' : '_pain.001.001.09.xml');
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Datei heruntergeladen.', 'success');
}
async function copyXml() {
  if (!_result) return;
  try { await navigator.clipboard.writeText(_result.xml); showToast('XML in die Zwischenablage kopiert.', 'success'); }
  catch { showToast('Kopieren nicht möglich — bitte manuell markieren.', 'error'); }
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
  setTimeout(() => { toast.classList.add('fade-out'); toast.addEventListener('animationend', () => toast.remove()); }, 4000);
}

onAuthReady(() => initAdminNav());

authInit();
