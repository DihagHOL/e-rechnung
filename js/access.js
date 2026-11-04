/**
 * Zugriffskonfiguration
 * =====================
 * Steht nur in SharePoint (sites/IT, Dokumente/E-Rechnung/access-config.json), gepflegt
 * über einstellungen.html. Im öffentlichen Repo stehen keine Personen und keine Adressen.
 *   { "wgc": ["name@…"], "shb": [...], …,
 *     "_rollen": { "wgc": { "name@…": "vertrieb" } },
 *     "_app": { "admins": ["name@…"], "apiHost": "https://<function-app>.azurewebsites.net" } }
 * Schlüssel mit "_" sind keine Werke. Schreiben darf die Datei nur, wer dort Admin ist
 * (eigene SharePoint-Rechte an der Datei).
 *
 * Rolle je Werk und Person: FIBU sieht Eingangs- und Ausgangsrechnungen, Vertrieb nur den
 * Ausgang. Ohne Eintrag in _rollen gilt FIBU, so wie vor den Rollen.
 *
 * Diese Regeln steuern nur die Oberfläche. Was jemand wirklich lesen und schreiben darf,
 * entscheiden die SharePoint-Rechte an ERAR_<Werk> und AR_<Werk>.
 */
const ACCESS_CONFIG_DEFAULT = {};

/* Vollständige Firmenbezeichnungen */
const GESELLSCHAFT_NAMES = {
  wgc: 'Walzengießerei Coswig GmbH',
  shb: 'Stahl- und Hartgusswerk Bösdorf GmbH',
  zai: 'Dihag Zaigler GmbH',
};

/* Kurz-Labels für Badges & Tabs */
const GESELLSCHAFT_LABELS = {
  wgc: 'WGC',
  shb: 'SHB',
  zai: 'ZAI',
  eis: 'EIS',
  ewa: 'EWA',
  leg: 'LEG',
};

/* Alle Werke der Gruppe, aus denen die Einstellungen die Werke für die Zuweisung wählen */
const WERKE_ALLE = [
  ['WGC', 'Walzengießerei Coswig GmbH'],
  ['SHB', 'Stahl- und Hartgusswerk Bösdorf GmbH'],
  ['ZAI', 'Dihag Zaigler GmbH'],
  ['EIS', 'DIHAG Gienanth GmbH'], ['DSO', 'Werk DSO'], ['LEG', 'Lintorfer Eisengießerei GmbH'], ['EWA', 'Eisenwerk Arnstadt GmbH'],
  ['HOL', 'DIHAG Holding GmbH'], ['MEG', 'Meuselwitz Guss Eisengießerei GmbH'], ['SCH', 'Werk SCH'],
];

/* ── Laufzeit-Config (wird aus SharePoint geladen) ── */
let _runtimeConfig = null; // null = noch nicht geladen

function _activeConfig() {
  return _runtimeConfig || ACCESS_CONFIG_DEFAULT;
}

/** Werk-Schlüssel der Config (wgc, shb, …), ohne _app und andere Einträge */
function istWerkSchluessel(k) {
  return /^[a-z0-9]{2,8}$/.test(String(k || ''));
}

// Übergang, bis _app in access-config.json steht. Danach fällt das weg.
const _APP_UEBERGANG = { admins: ['administrator@dihag.com'], apiHost: 'https://erechnung-xml2pdf.azurewebsites.net' };

/** App-Einstellungen aus der Config: Admins und Adresse der Azure Function */
function getAppConfig() {
  const app = (_activeConfig()._app && typeof _activeConfig()._app === 'object') ? _activeConfig()._app : _APP_UEBERGANG;
  const host = String(app.apiHost || '').replace(/\/+$/, '');
  return {
    admins: Array.isArray(app.admins) ? app.admins.map(x => String(x).toLowerCase().trim()) : [],
    // nur die eigene Function-App, keine beliebige Adresse aus der Datei
    apiHost: /^https:\/\/[a-z0-9-]+\.azurewebsites\.net$/.test(host) ? host : '',
  };
}

let _runtimeConfigLaden = null;   // laufender Ladevorgang, mehrere Aufrufer teilen ihn

/**
 * Laufzeit-Config aus SharePoint laden.
 * Wird einmalig nach Login aufgerufen; bei Fehler greift der Default.
 * Abhängig von spLoadAccessConfig() aus sharepoint.js.
 */
async function loadRuntimeAccessConfig() {
  if (_runtimeConfig) return; // bereits geladen
  if (!_runtimeConfigLaden) _runtimeConfigLaden = _runtimeConfigHolen();
  return _runtimeConfigLaden;
}

async function _runtimeConfigHolen() {
  try {
    const cfg = await spLoadAccessConfig();
    if (cfg && typeof cfg === 'object') {
      _runtimeConfig = cfg;
    }
  } catch (e) {
    // Kein JSON in SharePoint → Fallback auf Default (kein Fehler)
    console.info('[access] Keine SP-Config gefunden, nutze Default.');
  }
}

/* ── Zugriffs-Checks ── */

/**
 * Gibt zurück, auf welche Gesellschaften der UPN Zugriff hat.
 * @param   {string}   upn
 * @returns {string[]}  z.B. ['wgc'], ['shb'], ['wgc','shb'] oder []
 */
function getAccessFor(upn) {
  const u = (upn || '').toLowerCase().trim();
  const cfg = _activeConfig();
  return Object.keys(cfg).filter(g => istWerkSchluessel(g) &&
    Array.isArray(cfg[g]) && cfg[g].some(x => String(x).toLowerCase().trim() === u)
  ).map(g => g.toLowerCase());
}

/**
 * Zugriff des aktuell eingeloggten Users ermitteln.
 * @returns {string[]}
 */
function getCurrentUserAccess() {
  const account = typeof getAuthUser === 'function' ? getAuthUser() : null;
  return account ? getAccessFor(account.username) : [];
}

/**
 * Welche Werke darf der angemeldete Benutzer sehen bzw. auswählen (Monitoring, Konverter)?
 * Admins: alle. Sonst nur die zugewiesenen, ohne Zuweisung keins.
 * @param   {string[]} alle  Werk-Kürzel, Groß-/Kleinschreibung egal
 * @returns {string[]}
 */
function erlaubteWerke(alle) {
  if (isCurrentUserAdmin()) return alle.slice();
  const access = getCurrentUserAccess();
  return alle.filter(w => access.includes(String(w).toLowerCase()));
}

/* ── Rollen je Werk ── */

const ROLLEN = {
  fibu:     { label: 'FIBU',     titel: 'FIBU: Eingangs- und Ausgangsrechnungen', richtungen: ['Eingang', 'Ausgang'] },
  vertrieb: { label: 'Vertrieb', titel: 'Vertrieb: nur Ausgangsrechnungen',       richtungen: ['Ausgang'] },
};
const ROLLE_STANDARD = 'fibu';

/** Rolle einer Person in einem Werk laut cfg ('fibu' oder 'vertrieb'). */
function rolleIn(cfg, werk, upn) {
  const alle = cfg && cfg._rollen && typeof cfg._rollen === 'object' ? cfg._rollen : {};
  const imWerk = alle[String(werk || '').toLowerCase()];
  const r = imWerk && typeof imWerk === 'object' ? String(imWerk[String(upn || '').toLowerCase().trim()] || '') : '';
  return ROLLEN[r] ? r : ROLLE_STANDARD;
}

function getRolle(upn, werk) {
  return rolleIn(_activeConfig(), werk, upn);
}

/**
 * Was der angemeldete Benutzer je Werk sehen darf, z. B. { wgc: ['Eingang', 'Ausgang'], shb: ['Ausgang'] }.
 * Admins: null, also alles. Ohne Werkzuweisung: {}.
 */
function erlaubteRichtungen() {
  if (isCurrentUserAdmin()) return null;
  const account = typeof getAuthUser === 'function' ? getAuthUser() : null;
  const upn = account ? account.username : '';
  const out = {};
  for (const w of getAccessFor(upn)) out[w] = ROLLEN[getRolle(upn, w)].richtungen.slice();
  return out;
}

/** Arbeitskopie der Config für die Einstellungen: Werklisten und alle Einträge mit "_" (_app, _rollen). */
function zugriffKopie(cfg) {
  const out = {};
  for (const [k, v] of Object.entries(cfg || {})) {
    if (istWerkSchluessel(k.toLowerCase()) && Array.isArray(v)) out[k.toLowerCase()] = v.map(x => String(x));
    else if (k.startsWith('_')) out[k] = JSON.parse(JSON.stringify(v));
  }
  return out;
}

/** Rolle setzen. FIBU ist der Standard und wird nicht gespeichert. Ändert cfg. */
function rolleSetzen(cfg, werk, upn, rolle) {
  const w = String(werk || '').toLowerCase();
  const u = String(upn || '').toLowerCase().trim();
  if (!cfg._rollen || typeof cfg._rollen !== 'object') cfg._rollen = {};
  const imWerk = Object.assign({}, cfg._rollen[w]);
  if (ROLLEN[rolle] && rolle !== ROLLE_STANDARD) imWerk[u] = rolle; else delete imWerk[u];
  if (Object.keys(imWerk).length) cfg._rollen[w] = imWerk; else delete cfg._rollen[w];
  if (!Object.keys(cfg._rollen).length) delete cfg._rollen;
  return cfg;
}

/** Vor dem Speichern: Rollen von Personen, die nicht mehr im Werk stehen, und unbekannte Rollen fallen weg. */
function zugriffBereinigen(cfg) {
  const out = zugriffKopie(cfg);
  if (!out._rollen || typeof out._rollen !== 'object') { delete out._rollen; return out; }
  for (const w of Object.keys(out._rollen)) {
    const liste = (Array.isArray(out[w]) ? out[w] : []).map(x => String(x).toLowerCase().trim());
    const imWerk = out._rollen[w] && typeof out._rollen[w] === 'object' ? out._rollen[w] : {};
    for (const u of Object.keys(imWerk)) {
      if (!liste.includes(u) || !ROLLEN[imWerk[u]] || imWerk[u] === ROLLE_STANDARD) delete imWerk[u];
    }
    if (Object.keys(imWerk).length) out._rollen[w] = imWerk; else delete out._rollen[w];
  }
  if (!Object.keys(out._rollen).length) delete out._rollen;
  return out;
}

/**
 * Prüft ob der UPN Admin ist.
 * @param {string} upn
 * @returns {boolean}
 */
function isAdmin(upn) {
  const u = (upn || '').toLowerCase().trim();
  return !!u && getAppConfig().admins.includes(u);
}

/**
 * Prüft ob der aktuell eingeloggte User Admin ist.
 * @returns {boolean}
 */
function isCurrentUserAdmin() {
  const account = typeof getAuthUser === 'function' ? getAuthUser() : null;
  return account ? isAdmin(account.username) : false;
}

/**
 * Einstellungen-Tab in der Navigation ein-/ausblenden.
 * Muss nach Auth aufgerufen werden, lädt die Config bei Bedarf selbst.
 */
async function initAdminNav() {
  const link = document.getElementById('nav-einstellungen');
  if (!link) return;
  link.style.display = 'none';
  try { await loadRuntimeAccessConfig(); } catch (e) { /* ohne Config kein Admin */ }
  link.style.display = isCurrentUserAdmin() ? '' : 'none';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ROLLEN, ROLLE_STANDARD, rolleIn, getRolle, erlaubteRichtungen, zugriffKopie, rolleSetzen, zugriffBereinigen,
    istWerkSchluessel, getAccessFor, getAppConfig, _zugriffSetzen: cfg => { _runtimeConfig = cfg; } };
}
