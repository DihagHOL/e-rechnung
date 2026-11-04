/* Seiten-Skript von einstellungen.html. Stand früher inline in der Seite; die Content-Security-Policy
   erlaubt nur Skripte aus eigenen Dateien. */
/* ── In-Memory Arbeitskopie der Config ── */
let _editConfig = {};   // { wgc: ['user@…'], shb: [], _rollen: {…}, _app: {…} }; Werk-Schlüssel = zugewiesene Werke

/* ── Fehler-Benachrichtigung: E-Mail je Werk ── */
const WERKE_ALL = WERKE_ALLE;   // js/access.js
let _editFehler = {};

/* ── Init nach Login ── */
onAuthReady(async () => {
  // Admins stehen in der Config selbst (access-config.json, _app.admins). Ohne lesbare
  // Config gibt es keinen Admin und damit auch kein Speichern über einen leeren Stand.
  showOverlay(true);
  try { await loadRuntimeAccessConfig(); } catch (e) { /* unten: kein Zugriff */ }
  showOverlay(false);
  if (!_runtimeConfig || !isCurrentUserAdmin()) {
    document.getElementById('admin-access-denied').style.display = 'block';
    return;
  }

  document.getElementById('settings-content').style.display = 'block';
  // Ganze Config inklusive _app (Admins, Function) und _rollen, sonst gingen sie beim Speichern verloren
  _editConfig = zugriffKopie(_runtimeConfig);

  renderLists();

  // Fehler-Benachrichtigungs-Config laden + rendern
  try { _editFehler = (await spLoadFehlerConfig()) || {}; }
  catch (e) { _editFehler = {}; }
  renderFehlerGrid();

  // Rechnungsadressen der Kunden laden + rendern
  _kmGeladenAm = new Date().toISOString();
  try { _editKm = (await spLoadKundenMails()) || null; }
  catch (e) { _editKm = null; }
  if (!_editKm || !Array.isArray(_editKm.eintraege)) _editKm = { version: 1, eintraege: [] };
  renderKundenMails();
});

/* ── Rechnungsadressen der Kunden ── */
let _editKm = { version: 1, eintraege: [] };
let _kmGeaendert = false;
let _kmGeladenAm = '';

function _kmDatum(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString('de-DE') : '';
}

function renderKundenMails() {
  const body = document.getElementById('km-body');
  if (!body) return;
  const q = (document.getElementById('km-suche').value || '').trim().toLowerCase();
  const alle = _editKm.eintraege.map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.werk || '').localeCompare(b.e.werk || '') || (a.e.name || '').localeCompare(b.e.name || ''));
  const zeilen = q ? alle.filter(({ e }) => [e.werk, e.kundennummer, e.name, e.mail, e.vat].join(' ').toLowerCase().includes(q)) : alle;
  body.innerHTML = zeilen.length ? zeilen.map(({ e, i }) => `
    <tr>
      <td><span class="format-tag ${e.werk === 'WGC' || e.werk === 'SHB' ? e.werk.toLowerCase() : ''}" style="font-size:11px;">${esc(e.werk || 'alle')}</span></td>
      <td>${esc(e.kundennummer || '')}</td>
      <td>${esc(e.name || '')}${e.vat ? `<br><small>${esc(e.vat)}</small>` : ''}</td>
      <td>${esc(e.mail)}</td>
      <td class="km-am" title="${esc(e.von || '')}">${esc(_kmDatum(e.am))}${e.von ? '<br>' + esc(e.von.split('@')[0]) : ''}</td>
      <td><button class="btn btn-danger btn-sm" title="Entfernen" data-km-entfernen="${i}">✕</button></td>
    </tr>`).join('')
    : `<tr><td colspan="6" class="upn-empty">${q ? 'Kein Treffer.' : 'Noch keine Rechnungsadresse gemerkt.'}</td></tr>`;
  document.getElementById('km-anzahl').textContent = `${_editKm.eintraege.length} Kunden`;
  const sel = document.getElementById('km-neu-werk');
  if (sel && !sel.options.length) sel.innerHTML = WERKE_ALL.map(([c]) => `<option value="${c}">${c}</option>`).join('');
}

function _kmEinfuegen(neu) {
  const gleich = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const idx = _editKm.eintraege.findIndex(e => gleich(e.werk, neu.werk)
    && (neu.kundennummer ? gleich(e.kundennummer, neu.kundennummer) : gleich(e.name, neu.name)));
  const user = (typeof getAuthUser === 'function' && getAuthUser()) || {};
  const eintrag = { vat: '', ...neu, am: new Date().toISOString(), von: user.username || '' };
  if (idx >= 0) _editKm.eintraege[idx] = { ..._editKm.eintraege[idx], ...eintrag };
  else _editKm.eintraege.push(eintrag);
}

function kmHinzufuegen() {
  const werk = document.getElementById('km-neu-werk').value;
  const kundennummer = document.getElementById('km-neu-nr').value.trim();
  const name = document.getElementById('km-neu-name').value.trim();
  const mail = document.getElementById('km-neu-mail').value.trim();
  if (!kundennummer && !name) { showToast('Bitte Kunden-Nr. oder Namen angeben.', 'error'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(mail)) { showToast('Ungültige E-Mail-Adresse.', 'error'); return; }
  _kmEinfuegen({ werk, kundennummer, name, mail });
  ['km-neu-nr', 'km-neu-name', 'km-neu-mail'].forEach(id => { document.getElementById(id).value = ''; });
  _kmGeaendert = true;
  renderKundenMails();
  updateHint('ungespeicherte Änderungen');
}

function kmImportieren() {
  const feld = document.getElementById('km-import-text');
  const { eintraege, fehler } = kundenMailZeilen(feld.value);
  if (!eintraege.length) { showToast('Keine gültige Zeile gefunden.', 'error'); return; }
  eintraege.forEach(_kmEinfuegen);
  feld.value = '';
  _kmGeaendert = true;
  renderKundenMails();
  updateHint('ungespeicherte Änderungen');
  showToast(`${eintraege.length} übernommen${fehler ? `, ${fehler} Zeile(n) ohne gültige Mail übersprungen` : ''}.`, fehler ? 'info' : 'success');
}

function kmEntfernen(i) {
  const e = _editKm.eintraege[i];
  if (!e || !confirm(`Rechnungsadresse von ${e.name || e.kundennummer} (${e.mail}) entfernen?`)) return;
  _editKm.eintraege.splice(i, 1);
  _kmGeaendert = true;
  renderKundenMails();
  updateHint('ungespeicherte Änderungen');
}

/* ── Fehler-Benachrichtigung: Werk-Kacheln rendern ── */
function renderFehlerGrid() {
  const grid = document.getElementById('fehler-mail-grid');
  if (!grid) return;
  grid.innerHTML = WERKE_ALL.map(([code, name]) => {
    const cls = (code === 'WGC') ? 'wgc' : (code === 'SHB') ? 'shb' : '';
    const val = esc(_editFehler[code] || '');
    return `
      <div class="card">
        <div class="card-header">
          <span class="card-icon"><span class="format-tag ${cls}" style="font-size:12px;">${code}</span></span>
          <h3>${esc(name)}</h3>
        </div>
        <div class="card-body">
          <input type="email" id="fehler-input-${code.toLowerCase()}" class="upn-input"
                 placeholder="fehler-benachrichtigung@dihag.com" value="${val}">
        </div>
      </div>`;
  }).join('');
}

/* ── Werk-Karten mit UPN-Listen rendern ── */
/** Auswahl der Rolle (FIBU, Vertrieb) für eine Person oder für „Hinzufügen“. */
function _rolleAuswahl(rolle, attribute) {
  return `<select class="upn-rolle${rolle === 'vertrieb' ? ' vertrieb' : ''}" ${attribute} title="${esc(ROLLEN[rolle].titel)}">`
    + Object.entries(ROLLEN).map(([k, r]) => `<option value="${k}"${k === rolle ? ' selected' : ''}>${esc(r.label)}</option>`).join('')
    + '</select>';
}

function _werkName(code) {
  const w = WERKE_ALL.find(([c]) => c === code.toUpperCase());
  return w ? w[1] : 'Werk ' + code.toUpperCase();
}

function renderLists() {
  const grid = document.getElementById('werk-grid');
  const reihenfolge = WERKE_ALL.map(([c]) => c.toLowerCase());
  const werke = Object.keys(_editConfig).filter(istWerkSchluessel)
    .sort((a, b) => (reihenfolge.indexOf(a) + 1 || 99) - (reihenfolge.indexOf(b) + 1 || 99));
  grid.innerHTML = werke.length ? werke.map(g => {
    const cls = g === 'wgc' || g === 'shb' ? g : '';
    const upns = _editConfig[g] || [];
    return `
      <div class="card">
        <div class="card-header">
          <span class="card-icon"><span class="format-tag ${cls}" style="font-size:12px;">${esc(g.toUpperCase())}</span></span>
          <h3>${esc(_werkName(g))}</h3>
          <button class="btn btn-danger btn-sm werk-entfernen" title="Werk entfernen" data-werk-entfernen="${g}">Werk entfernen</button>
        </div>
        <div class="card-body">
          <div class="upn-list">${upns.length ? upns.map((upn, idx) => `
            <div class="upn-row">
              <span class="upn-avatar">${esc(upn.slice(0, 1).toUpperCase())}</span>
              <span class="upn-text">${esc(upn)}</span>
              ${_rolleAuswahl(rolleIn(_editConfig, g, upn), `data-rolle-werk="${g}" data-idx="${idx}" aria-label="Rolle von ${esc(upn)}"`)}
              <button class="btn btn-danger btn-sm" title="Entfernen" data-upn-entfernen="${g}" data-idx="${idx}">✕</button>
            </div>`).join('') : '<div class="upn-empty">Noch keine Benutzer eingetragen.</div>'}</div>
          <div class="upn-add-row">
            <input type="email" id="upn-input-${g}" placeholder="name@dihag.com" class="upn-input"
                   data-werk="${g}">
            ${_rolleAuswahl(ROLLE_STANDARD, `id="rolle-neu-${g}" aria-label="Rolle der neuen Person"`)}
            <button class="btn btn-primary btn-sm" data-upn-hinzufuegen="${g}">+ Hinzufügen</button>
          </div>
        </div>
      </div>`;
  }).join('') : '<div class="upn-empty">Noch kein Werk angelegt.</div>';

  const frei = WERKE_ALL.filter(([c]) => !(c.toLowerCase() in _editConfig));
  const sel = document.getElementById('werk-neu');
  sel.innerHTML = frei.map(([c, n]) => `<option value="${c.toLowerCase()}">${esc(c)} · ${esc(n)}</option>`).join('');
  sel.parentElement.style.display = frei.length ? '' : 'none';
}

/* ── Werk hinzufügen / entfernen ── */
function addWerk() {
  const g = document.getElementById('werk-neu').value;
  if (!g || g in _editConfig) return;
  _editConfig[g] = [];
  renderLists();
  updateHint('ungespeicherte Änderungen');
}

function removeWerk(g) {
  const n = (_editConfig[g] || []).length;
  if (n && !confirm(`${g.toUpperCase()} mit ${n} zugewiesenen Benutzer(n) entfernen?`)) return;
  delete _editConfig[g];
  renderLists();
  updateHint('ungespeicherte Änderungen');
}

/* ── UPN hinzufügen ── */
function addUpn(gesellschaft) {
  const input = document.getElementById(`upn-input-${gesellschaft}`);
  const upn = (input.value || '').trim().toLowerCase();
  if (!upn) { showToast('Bitte eine E-Mail-Adresse eingeben.', 'error'); return; }
  if (!upn.includes('@')) { showToast('Ungültige E-Mail-Adresse.', 'error'); return; }
  if ((_editConfig[gesellschaft] || []).map(x => x.toLowerCase()).includes(upn)) {
    showToast('Dieser Benutzer ist bereits eingetragen.', 'error'); return;
  }
  if (!_editConfig[gesellschaft]) _editConfig[gesellschaft] = [];
  _editConfig[gesellschaft].push(upn);
  const rolle = document.getElementById(`rolle-neu-${gesellschaft}`);
  rolleSetzen(_editConfig, gesellschaft, upn, rolle ? rolle.value : ROLLE_STANDARD);
  input.value = '';
  renderLists();
  updateHint('ungespeicherte Änderungen');
}

/* ── UPN entfernen ── */
function removeUpn(gesellschaft, idx) {
  const [upn] = _editConfig[gesellschaft].splice(idx, 1);
  if (upn) rolleSetzen(_editConfig, gesellschaft, upn, ROLLE_STANDARD);
  renderLists();
  updateHint('ungespeicherte Änderungen');
}

/* ── Speichern ── */
async function saveSettings() {
  showOverlay(true, 'Wird in SharePoint gespeichert…');
  try {
    // Rollen von Personen, die nicht mehr im Werk stehen, fallen weg; _app bleibt unverändert
    const neu = zugriffBereinigen(_editConfig);
    if (_runtimeConfig && _runtimeConfig._app && !neu._app) throw new Error('Die App-Einstellungen (_app) fehlen, nichts gespeichert.');
    await spSaveAccessConfig(neu);
    _runtimeConfig = zugriffKopie(neu);   // Cache aktualisieren
    _editConfig = zugriffKopie(neu);

    // Fehler-Benachrichtigungs-E-Mails einsammeln + speichern
    const fehler = {};
    for (const [code] of WERKE_ALL) {
      const el = document.getElementById('fehler-input-' + code.toLowerCase());
      const v = el ? (el.value || '').trim() : '';
      if (v && !v.includes('@')) throw new Error('Ungültige E-Mail bei ' + code + ': ' + v);
      if (v) fehler[code] = v;
    }
    await spSaveFehlerConfig(fehler);
    _editFehler = fehler;

    // Rechnungsadressen nur schreiben, wenn hier etwas geändert wurde: der Konverter
    // merkt sich neue Adressen beim Export, die sollen nicht überschrieben werden.
    if (_kmGeaendert) {
      // Was der Konverter seit dem Laden gemerkt hat, bleibt erhalten
      const aktuell = await spLoadKundenMails().catch(() => null);
      const k = e => [e.werk, e.kundennummer || e.name].join('|').toLowerCase();
      const hier = new Set(_editKm.eintraege.map(k));
      ((aktuell && aktuell.eintraege) || [])
        .filter(e => e.am && e.am > _kmGeladenAm && !hier.has(k(e)))
        .forEach(e => _editKm.eintraege.push(e));
      await spSaveKundenMails(_editKm);
      _kmGeladenAm = new Date().toISOString();
      renderKundenMails();
      _kmGeaendert = false;
    }

    showOverlay(false);
    showToast('Einstellungen erfolgreich gespeichert.', 'success');
    updateHint('Gespeichert ✓');
  } catch (e) {
    showOverlay(false);
    showToast('Speichern fehlgeschlagen: ' + e.message, 'error');
  }
}

/* ── Helpers ── */
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function updateHint(text) {
  const el = document.getElementById('settings-save-hint');
  if (el) el.textContent = text;
}

function showOverlay(on, text) {
  const el = document.getElementById('loading-overlay');
  if (!el) return;
  el.style.display = on ? 'flex' : 'none';
  if (text) {
    const t = document.getElementById('loading-text');
    if (t) t.textContent = text;
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
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

/* ── Ereignisse (früher onclick im HTML; die Content-Security-Policy erlaubt keine Inline-Handler) ── */
const _werkGrid = document.getElementById('werk-grid');
_werkGrid.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.werkEntfernen) removeWerk(b.dataset.werkEntfernen);
  else if (b.dataset.upnEntfernen) removeUpn(b.dataset.upnEntfernen, Number(b.dataset.idx));
  else if (b.dataset.upnHinzufuegen) addUpn(b.dataset.upnHinzufuegen);
});
_werkGrid.addEventListener('change', e => {
  const s = e.target.closest('select[data-rolle-werk]');
  if (!s) return;
  const werk = s.dataset.rolleWerk;
  const upn = (_editConfig[werk] || [])[Number(s.dataset.idx)];
  if (!upn) return;
  rolleSetzen(_editConfig, werk, upn, s.value);
  s.classList.toggle('vertrieb', s.value === 'vertrieb');
  s.title = ROLLEN[s.value].titel;
  updateHint('ungespeicherte Änderungen');
});
_werkGrid.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.werk) addUpn(e.target.dataset.werk);
});
document.getElementById('fehler-mail-grid').addEventListener('input', () => updateHint('ungespeicherte Änderungen'));
document.getElementById('km-body').addEventListener('click', e => {
  const b = e.target.closest('[data-km-entfernen]');
  if (b) kmEntfernen(Number(b.dataset.kmEntfernen));
});
document.getElementById('km-suche').addEventListener('input', () => renderKundenMails());
document.getElementById('km-neu-mail').addEventListener('keydown', e => { if (e.key === 'Enter') kmHinzufuegen(); });
document.getElementById('km-neu-btn').addEventListener('click', () => kmHinzufuegen());
document.getElementById('km-import-btn').addEventListener('click', () => kmImportieren());
document.getElementById('werk-hinzufuegen').addEventListener('click', () => addWerk());
document.getElementById('btn-save-settings').addEventListener('click', () => saveSettings());

authInit();
