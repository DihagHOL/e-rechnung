/* Seiten-Skript von prozess.html. Stand früher inline in der Seite; die Content-Security-Policy
   erlaubt nur Skripte aus eigenen Dateien. */
/* ── Prozessdiagramme (bpmn-js, lokal) ─────────────────────────────────────
   Führend sind die Modelle im RMS (rms.dihag.de, Prozesse/KONZERN). Die Seite
   liest sie live von dort, sobald das Konto Zugriff hat. Sonst zeigt sie die
   Kopie aus dem Repository (docs/bpmn). Unterprozesse sind eigene Modelle,
   die per Aufrufaktivität (⊞) eingebunden sind; ein Klick darauf öffnet sie. */
const PROC = { eingang: null, ausgang: null, zahlung: null };
const GRAPH = 'https://graph.microsoft.com/v1.0';
const GRAPH_SCOPES = ['https://graph.microsoft.com/Sites.ReadWrite.All', 'https://graph.microsoft.com/Files.ReadWrite.All'];
const MODELL_MARKER = /\[\[rms:modell=([^\]]+)\]\]/;
let MODELLE = {}, RMS = { url: 'https://rms.dihag.de', driveId: '' };
const _esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function initProzess() {
  try {
    const j = await fetch('docs/bpmn/modelle.json', { cache: 'no-cache' }).then(r => r.json());
    RMS = Object.assign(RMS, j.rms || {});
    for (const m of j.modelle) MODELLE[m.key] = m;
    for (const m of j.modelle) if (m.haupt) PROC[m.tab] = { haupt: m.key, cur: m.key, calls: [] };
  } catch (e) {
    console.error('Modell-Liste nicht lesbar:', e);
  }
  document.querySelectorAll('.ptab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
    showTab(b.dataset.go);
    document.getElementById('prozesse').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  for (const key of Object.keys(PROC)) if (PROC[key]) buildControls(key);
  document.addEventListener('fullscreenchange', () => {
    for (const key of Object.keys(PROC)) if (PROC[key] && PROC[key].viewer) setTimeout(() => fitView(key), 60);
  });
  window.addEventListener('resize', () => {
    const key = currentTab();
    if (key && PROC[key] && PROC[key].viewer) PROC[key].viewer.get('canvas').resized();
  });
  const start = location.hash.replace('#', '');
  showTab(PROC[start] ? start : 'eingang');
}

function currentTab() {
  const t = document.querySelector('.ptab.active');
  return t ? t.dataset.tab : null;
}

function showTab(key) {
  document.querySelectorAll('.ptab').forEach(b => b.classList.toggle('active', b.dataset.tab === key));
  document.querySelectorAll('.ppanel').forEach(p => { p.hidden = p.id !== 'panel-' + key; });
  history.replaceState(null, '', '#' + key);
  loadDiagram(key);
}

/* ── Modelle laden: RMS zuerst, Repository als Rückfall ── */

/** Token nur still holen. Ohne Zugriff auf das RMS bleibt die Seite beim
    Repository-Stand, statt den Leser auf eine Anmeldeseite zu schicken. */
async function tokenStill() {
  try {
    if (typeof _msal === 'undefined' || !_msal || !_account) return null;
    const r = await _msal.acquireTokenSilent({ scopes: GRAPH_SCOPES, account: _account });
    return r.accessToken;
  } catch (e) { return null; }
}

async function holeModell(key) {
  const m = MODELLE[key];
  if (!m) throw new Error('Modell unbekannt: ' + key);
  if (m.cache) return m.cache;
  if (RMS.driveId && m.itemId) {
    const token = await tokenStill();
    if (token) {
      try {
        const h = { Authorization: 'Bearer ' + token };
        const basis = `${GRAPH}/drives/${RMS.driveId}/items/${m.itemId}`;
        const [meta, xml] = await Promise.all([
          fetch(basis + '?$select=name,lastModifiedDateTime,lastModifiedBy,webUrl', { headers: h })
            .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))),
          fetch(basis + '/content', { headers: h })
            .then(r => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))),
        ]);
        m.cache = { xml, quelle: 'rms', geaendert: meta.lastModifiedDateTime,
          von: (meta.lastModifiedBy && meta.lastModifiedBy.user && meta.lastModifiedBy.user.displayName) || '' };
        return m.cache;
      } catch (e) {
        console.warn('RMS nicht erreichbar, nehme die Kopie aus dem Repository:', m.name, e.message);
      }
    }
  }
  if (!m.datei) throw new Error('Kein Zugriff auf das RMS, und im Repository gibt es keine Kopie.');
  const res = await fetch(m.datei, { cache: 'no-cache' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  m.cache = { xml: await res.text(), quelle: 'repo' };
  return m.cache;
}

/** Das Ziel einer Aufrufaktivität: Datei-Kennung aus dem RMS-Marker, sonst die Prozess-Kennung. */
function zielVonAufruf(bo) {
  const doku = (bo.documentation || []).map(d => d.text || '').join('\n');
  const mk = doku.match(MODELL_MARKER);
  const itemId = mk ? mk[1].trim() : '';
  let m = Object.values(MODELLE).find(x => (itemId && x.itemId === itemId)
    || (!itemId && bo.calledElement && x.kennung === bo.calledElement));
  if (!m && itemId) {
    // Im RMS neu eingebunden und noch nicht in der Modell-Liste: direkt von dort lesen.
    m = MODELLE['rms:' + itemId] = { key: 'rms:' + itemId, name: bo.name || 'Unterprozess', itemId, datei: '', kennung: bo.calledElement || '' };
  }
  return m ? m.key : null;
}

/* ── Bedienleiste ── */

function buildControls(key) {
  const cfg = PROC[key];
  const views = document.getElementById('views-' + key);
  views.addEventListener('click', e => {
    const b = e.target.closest('button[data-modell]');
    if (b) zeigeModell(key, b.dataset.modell);
  });
  const acts = document.querySelector(`[data-actions="${key}"]`);
  acts.innerHTML =
      `<button type="button" data-act="in" title="Vergrößern">＋</button>`
    + `<button type="button" data-act="out" title="Verkleinern">－</button>`
    + `<button type="button" data-act="fit" title="Ganzes Diagramm zeigen">⤢ Einpassen</button>`
    + `<button type="button" data-act="full" title="Vollbild">⛶ Vollbild</button>`
    + `<button type="button" data-act="svg" title="Aktuelle Ansicht als Bild speichern">🖼 SVG</button>`
    + `<button type="button" data-act="bpmn" class="dl" title="Angezeigtes Modell als BPMN-Datei speichern">⬇ BPMN</button>`;
  acts.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b || !cfg.viewer) return;
    const canvas = cfg.viewer.get('canvas');
    if (b.dataset.act === 'in') canvas.zoom(canvas.zoom() * 1.25);
    if (b.dataset.act === 'out') canvas.zoom(canvas.zoom() / 1.25);
    if (b.dataset.act === 'fit') fitView(key);
    if (b.dataset.act === 'full') {
      const box = document.getElementById('box-' + key);
      if (document.fullscreenElement) document.exitFullscreen(); else if (box.requestFullscreen) box.requestFullscreen();
    }
    if (b.dataset.act === 'svg') saveSvg(key);
    if (b.dataset.act === 'bpmn') saveBpmn(key);
  });
}

/** Ansicht-Knöpfe aus dem geladenen Hauptmodell: was es per ⊞ einbindet. */
function renderViews(key) {
  const cfg = PROC[key];
  const views = document.getElementById('views-' + key);
  views.innerHTML = '<span>Ansicht:</span>'
    + `<button type="button" data-modell="${_esc(cfg.haupt)}">Gesamtprozess</button>`
    + cfg.calls.map(c => `<button type="button" data-modell="${_esc(c.key)}">⊞ ${_esc(c.name)}</button>`).join('')
    + `<span class="bpmn-src" id="src-${key}"></span>`;
  views.querySelectorAll('button[data-modell]').forEach(b => b.classList.toggle('active', b.dataset.modell === cfg.cur));
  const m = MODELLE[cfg.cur], c = m && m.cache;
  const src = document.getElementById('src-' + key);
  if (!c || !src) return;
  const rmsLink = m.itemId
    ? ` · <a href="${_esc(RMS.url)}/?modell=${encodeURIComponent(m.itemId)}" target="_blank" rel="noopener">im RMS öffnen ↗</a>` : '';
  if (c.quelle === 'rms') {
    const d = c.geaendert ? new Date(c.geaendert).toLocaleDateString('de-DE') : '';
    src.innerHTML = `<b class="src-live">● live aus dem RMS</b>${d ? ' · geändert ' + d : ''}${c.von ? ' von ' + _esc(c.von) : ''}${rmsLink}`;
  } else {
    src.innerHTML = `<b class="src-repo">● Stand aus dem Repository</b> (kein Zugriff auf das RMS)${rmsLink}`;
  }
}

function whenSized(el) {
  return new Promise(resolve => {
    if (el.clientWidth && el.clientHeight) return resolve();
    if (!window.ResizeObserver) return setTimeout(resolve, 300);
    const ro = new ResizeObserver(() => {
      if (el.clientWidth && el.clientHeight) { ro.disconnect(); resolve(); }
    });
    ro.observe(el);
  });
}

async function loadDiagram(key) {
  const cfg = PROC[key];
  if (!cfg) return;
  if (cfg.viewer) { requestAnimationFrame(() => fitView(key)); return; }
  if (cfg.loading) return;
  const canvasEl = document.getElementById('canvas-' + key);
  cfg.loading = true;
  await whenSized(canvasEl);           // Viewer erst mit echter Größe starten (sonst Zoom = unendlich)
  const viewer = new BpmnJS({ container: canvasEl });
  cfg.viewer = viewer;
  cfg.needsFit = true;
  // Klick auf eine Aufrufaktivität (⊞) öffnet das eingebundene Modell
  viewer.get('eventBus').on('element.click', e => {
    const bo = e.element && e.element.businessObject;
    if (!bo || bo.$type !== 'bpmn:CallActivity') return;
    const ziel = zielVonAufruf(bo);
    if (ziel) zeigeModell(key, ziel);
  });
  // Größe beobachten: Reiterwechsel, Vollbild und Fenstergröße passen die Ansicht an.
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      viewer.get('canvas').resized();
      if (cfg.needsFit) fitView(key);
    }).observe(canvasEl);
  }
  await zeigeModell(key, cfg.haupt);
}

async function zeigeModell(key, modellKey) {
  const cfg = PROC[key];
  const canvasEl = document.getElementById('canvas-' + key);
  canvasEl.querySelectorAll('.bpmn-error').forEach(x => x.remove());
  try {
    const mod = await holeModell(modellKey);
    const { warnings } = await cfg.viewer.importXML(mod.xml);
    if (warnings && warnings.length) console.warn('BPMN-Hinweise (' + modellKey + '):', warnings);
  } catch (e) {
    canvasEl.insertAdjacentHTML('beforeend', '<div class="bpmn-error">Diagramm konnte nicht geladen werden: ' + _esc(e.message) + '</div>');
    return;
  }
  cfg.cur = modellKey;
  // Aufrufaktivitäten anklickbar machen; im Hauptmodell daraus die Ansicht-Knöpfe bauen
  const reg = cfg.viewer.get('elementRegistry'), canvas = cfg.viewer.get('canvas');
  const calls = [];
  reg.filter(el => el.businessObject && el.businessObject.$type === 'bpmn:CallActivity').forEach(el => {
    canvas.addMarker(el.id, 'pz-call');
    const ziel = zielVonAufruf(el.businessObject);
    if (ziel && !calls.some(c => c.key === ziel)) calls.push({ key: ziel, name: el.businessObject.name || MODELLE[ziel].name });
  });
  if (modellKey === cfg.haupt) cfg.calls = calls;
  renderViews(key);
  cfg.needsFit = true;
  fitView(key);
}

// Einpassen nur mit echter Größe (versteckter Reiter hat 0 px), sonst später nachholen.
function fitView(key) {
  const cfg = PROC[key];
  if (!cfg || !cfg.viewer) return;
  const el = document.getElementById('canvas-' + key);
  if (!el.clientWidth || !el.clientHeight) { cfg.needsFit = true; return; }
  const canvas = cfg.viewer.get('canvas');
  canvas.resized();
  try { canvas.zoom('fit-viewport', 'auto'); cfg.needsFit = false; }
  catch (e) { cfg.needsFit = true; }
}

function dateiName(key, endung) {
  const m = MODELLE[PROC[key].cur];
  const basis = m && m.datei ? m.datei.split('/').pop().replace(/\.bpmn$/, '')
    : String((m && m.name) || 'prozess').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-');
  return basis + endung;
}

function speichern(inhalt, typ, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([inhalt], { type: typ }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function saveSvg(key) {
  const { svg } = await PROC[key].viewer.saveSVG();
  speichern(svg, 'image/svg+xml', dateiName(key, '.svg'));
}

function saveBpmn(key) {
  const m = MODELLE[PROC[key].cur];
  if (m && m.cache) speichern(m.cache.xml, 'application/xml', dateiName(key, '.bpmn'));
}

onAuthReady(() => { initAdminNav(); initProzess(); });

authInit();

(function () {
  var m = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  var d = new Date(), el = document.getElementById('app-stand');
  if (el) el.textContent = m[d.getMonth()] + ' ' + d.getFullYear();
})();
