/**
 * Microsoft Entra ID (Azure AD) Authentication Guard
 * MSAL.js 3.x — Single-Tenant: nur DIHAG-Konten
 */

const _AUTH = {
  clientId:    '50389599-4d5d-4267-8fef-38ff29080669',
  tenantId:    'fdb70646-023a-403b-a4b9-1f474a935123',
  // Eigene Domain, nicht github.io: Das Repo liegt seit 02.11.2026 bei DihagHOL, die alte
  // github.io-Adresse gibt 404. Muss in Entra (App-Registrierung, SPA) eingetragen sein.
  redirectUri: 'https://e-rechnung.dihag-extern.com/',
};

let _msal = null;
let _account = null;
let _postAuthCbs = [];
let _authFertig = false;

/** Callback registrieren, der nach erfolgreichem Login aufgerufen wird (mehrere möglich). */
function onAuthReady(cb) {
  _postAuthCbs.push(cb);
  if (_authFertig) cb(_account);   // Login schon durch: gleich aufrufen
}

async function authInit() {
  _msal = new msal.PublicClientApplication({
    auth: {
      clientId:                _AUTH.clientId,
      authority:               `https://login.microsoftonline.com/${_AUTH.tenantId}`,
      redirectUri:             _AUTH.redirectUri,
      postLogoutRedirectUri:   _AUTH.redirectUri,
    },
    cache: {
      cacheLocation:        'sessionStorage',
      storeAuthStateInCookie: true,
    },
  });
  // initialize() nur in MSAL 3.x — MSAL 2.x braucht das nicht

  // Redirect-Response verarbeiten (Rückkehr vom Login)
  let response = null;
  try {
    response = await _msal.handleRedirectPromise();
  } catch (err) {
    _showAuthError(err);
    return;
  }

  if (response) _account = response.account;

  const accounts = _msal.getAllAccounts();

  if (!_account && accounts.length === 0) {
    // Nicht angemeldet → Microsoft-Login starten
    await _msal.loginRedirect({ scopes: ['User.Read'], prompt: 'select_account' });
    return;
  }

  if (!_account) _account = accounts[0];
  _msal.setActiveAccount(_account);

  // Seite einblenden
  document.body.classList.remove('auth-guard');

  // User-Info in Header rendern
  _renderUser(_account);

  // Post-Auth-Callbacks aufrufen (z.B. SharePoint-Daten laden)
  _authFertig = true;
  for (const cb of _postAuthCbs) cb(_account);
}

function _renderUser(account) {
  const nameEl     = document.getElementById('auth-name');
  const initEl     = document.getElementById('auth-initials');
  const emailEl    = document.getElementById('auth-email');
  if (!nameEl) return;

  const display = account.name || account.username || '';
  const emailOnly = account.username || '';
  nameEl.textContent  = display;
  if (emailEl) emailEl.textContent = emailOnly;

  if (initEl) {
    const parts = display.trim().split(/\s+/).filter(Boolean);
    initEl.textContent = parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : display.slice(0, 2).toUpperCase();
  }
}

function authLogout() {
  if (_msal) _msal.logoutRedirect({ account: _account });
}

function getAuthUser() { return _account; }

/**
 * Muss sich der Benutzer neu anmelden, weil das Token nicht still zu holen ist?
 * Das Refresh-Token einer Single-Page-App lebt höchstens 24 Stunden (AADSTS700084). MSAL
 * versucht es dann im unsichtbaren Fenster; ohne Drittanbieter-Cookies (Firefox, Safari)
 * scheitert das mit Zeitüberschreitung, also nicht als InteractionRequiredAuthError.
 * Netzwerkfehler und eine schon laufende Anmeldung zählen nicht.
 */
function _anmeldungNoetig(e) {
  if (typeof msal !== 'undefined' && e instanceof msal.InteractionRequiredAuthError) return true;
  const text = `${(e && e.errorCode) || ''} ${(e && e.message) || ''}`;
  if (/interaction_in_progress|no_network_connectivity|endpoints_resolution_error/i.test(text)) return false;
  return /AADSTS(700084|700082|50058|50078|50079|50076|70043|70008|65001)\b|invalid_grant|login_required|interaction_required|consent_required|monitor_window_timeout|token_renewal_error|no_tokens_found|block_iframe_reload|timed_out/i.test(text);
}

/** Höchstens eine Weiterleitung zur Anmeldung je Minute, sonst droht eine Schleife. */
const _ANMELDUNG_SPERRE = 'erechnung-neu-anmelden';
function _neuAnmeldenErlaubt() {
  try {
    const zuletzt = Number(sessionStorage.getItem(_ANMELDUNG_SPERRE) || 0);
    if (Date.now() - zuletzt < 60000) return false;
    sessionStorage.setItem(_ANMELDUNG_SPERRE, String(Date.now()));
  } catch (e) { /* ohne sessionStorage trotzdem anmelden */ }
  return true;
}

/**
 * Access-Token für eine Graph/SharePoint-Scope anfordern.
 * Bei fehlendem Consent oder abgelaufener Anmeldung → Redirect zu Microsoft.
 */
async function acquireToken(scopes) {
  if (!_msal || !_account) throw new Error('Nicht angemeldet');
  try {
    const result = await _msal.acquireTokenSilent({ scopes, account: _account });
    return result.accessToken;
  } catch (e) {
    if (_anmeldungNoetig(e) && _neuAnmeldenErlaubt()) {
      await _msal.acquireTokenRedirect({ scopes, account: _account });
      return null; // Page will redirect
    }
    throw e;
  }
}

/**
 * Access-Token per Popup anfordern (statt Redirect) — erhält den
 * Formularzustand der Seite. Für interaktive Aktionen wie "Mail erstellen".
 * Wirft, wenn der Consent verweigert/blockiert wird → Aufrufer kann fallbacken.
 */
async function acquireTokenPopupSafe(scopes) {
  if (!_msal || !_account) throw new Error('Nicht angemeldet');
  try {
    const result = await _msal.acquireTokenSilent({ scopes, account: _account });
    return result.accessToken;
  } catch (e) {
    if (_anmeldungNoetig(e)) {
      const result = await _msal.acquireTokenPopup({ scopes, account: _account });
      return result.accessToken;
    }
    throw e;
  }
}

function _showAuthError(err) {
  document.body.classList.remove('auth-guard');
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
                font-family:'Segoe UI',sans-serif;background:#f9fafb;">
      <div style="background:#fff;border-radius:12px;padding:40px;max-width:440px;width:90%;
                  box-shadow:0 4px 24px rgba(0,0,0,.12);text-align:center;">
        <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
        <h2 style="color:#1f2937;margin-bottom:8px;">Anmeldefehler</h2>
        <p id="auth-fehlertext" style="color:#6b7280;font-size:14px;margin-bottom:20px;"></p>
        <button id="auth-neu-laden"
          style="padding:10px 24px;background:#1a56a0;color:#fff;border:none;
                 border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">
          Erneut versuchen
        </button>
      </div>
    </div>`;
  // Fehlertext nur als Text einsetzen
  document.getElementById('auth-fehlertext').textContent = (err && err.message) || String(err);
  document.getElementById('auth-neu-laden').addEventListener('click', () => location.reload());
}

// Klicks, die früher als onclick im HTML standen (die Content-Security-Policy erlaubt keine
// Inline-Handler): Abmelden auf allen Seiten, Hinweisbanner schließen (data-schliessen="<id>").
if (typeof document !== 'undefined') document.addEventListener('click', e => {
  if (e.target.closest('.btn-auth-logout')) { authLogout(); return; }
  const schliessen = e.target.closest('[data-schliessen]');
  if (schliessen) {
    const ziel = document.getElementById(schliessen.dataset.schliessen);
    if (ziel) ziel.style.display = 'none';
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _anmeldungNoetig };
}
