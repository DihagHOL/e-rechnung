/**
 * Zugriffskonfiguration
 * =====================
 * Steht nur in SharePoint (sites/IT, Dokumente/E-Rechnung/access-config.json), gepflegt
 * über einstellungen.html. Im öffentlichen Repo stehen keine Personen und keine Adressen.
 *   { "wgc": ["name@…"], "shb": [...], …,
 *     "_app": { "admins": ["name@…"], "apiHost": "https://<function-app>.azurewebsites.net" } }
 * Schlüssel mit "_" sind keine Werke. Schreiben darf die Datei nur, wer dort Admin ist
 * (eigene SharePoint-Rechte an der Datei).
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
