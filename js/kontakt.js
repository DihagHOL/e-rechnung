/**
 * Ansprechpartner aus dem Firmenverzeichnis (Entra ID)
 * =====================================================
 * MEG druckt unter „Unsere Zeichen“ den Nachnamen der Sachbearbeiterin. Der Konverter sucht
 * dazu Name und Mail unter den Konten mit der Maildomäne des Werks (aus der Registry, z. B.
 * info@<domäne>). Nur Lesen über User.ReadBasic.All, die Admin-Zustimmung für die App liegt vor.
 * Ein Treffer: Name und Mail ins Formular. Kein oder mehrere Treffer: Das Zeichen bleibt stehen,
 * die Mail der Zentrale auch, und der Hinweis bittet ums Prüfen.
 */

const KONTAKT_SCOPE = 'https://graph.microsoft.com/User.ReadBasic.All';

/** Für den Vergleich: klein, Umlaute ausgeschrieben, nur Buchstaben („Müller-Groß“ = „muellergross“). */
function kontaktNorm(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[^a-z]/g, '');
}

/**
 * Konten zum Zeichen. Zuerst nach Nachname im Verzeichnis oder in der Mail (vorname.nachname@),
 * nur wenn das nichts findet, nach einem Wort des Anzeigenamens (dort steht der Nachname auch
 * mal vorn oder im Feld Nachname steht etwas anderes).
 */
function kontaktTreffer(zeichen, personen) {
  const z = kontaktNorm(zeichen);
  if (z.length < 3) return [];
  const liste = (personen || []).filter(p => p && /@/.test(String(p.mail || '')) && !/#EXT#/i.test(String(p.mail)));   // ohne Gastkonten
  const ausMail = p => {
    const lokal = String(p.mail).split('@')[0];
    return lokal.includes('.') ? lokal.slice(lokal.indexOf('.') + 1) : '';
  };
  let treffer = liste.filter(p => kontaktNorm(p.surname) === z || kontaktNorm(ausMail(p)) === z);
  if (!treffer.length) treffer = liste.filter(p => String(p.displayName || '').split(/[\s,]+/).some(w => kontaktNorm(w) === z));
  const gesehen = new Set();
  return treffer.filter(p => {
    const k = String(p.mail).toLowerCase();
    if (gesehen.has(k)) return false;
    gesehen.add(k);
    return true;
  });
}

/** Name fürs Formular: „Nachname, Vorname“ wird „Vorname Nachname“. */
function kontaktName(p) {
  const dn = String((p && p.displayName) || '').trim();
  const komma = dn.match(/^([^,]+),\s*(.+)$/);
  return komma ? `${komma[2]} ${komma[1]}` : dn;
}

const _kontaktKonten = new Map();   // Domäne -> Promise<Konten>, einmal je Sitzung

async function _kontaktKontenLaden(domain) {
  if (typeof _msal === 'undefined' || !_msal || typeof _account === 'undefined' || !_account) {
    throw new Error('nicht angemeldet');
  }
  const token = (await _msal.acquireTokenSilent({ scopes: [KONTAKT_SCOPE], account: _account })).accessToken;
  const basis = (typeof SP !== 'undefined' && SP.graphBase) || 'https://graph.microsoft.com/v1.0';
  const filter = encodeURIComponent(`endswith(mail,'@${domain}')`);
  let url = `${basis}/users?$filter=${filter}&$count=true&$select=displayName,givenName,surname,mail&$top=999`;
  const konten = [];
  for (let seiten = 0; url && seiten < 10; seiten++) {
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}`, 'ConsistencyLevel': 'eventual', 'Accept': 'application/json' },
    });
    if (!resp.ok) throw new Error(`Verzeichnis (${resp.status})`);
    const d = await resp.json();
    konten.push(...(d.value || []));
    url = d['@odata.nextLink'] || null;
  }
  return konten.filter(p => p.mail && !/#EXT#/i.test(p.mail));
}

/**
 * Ansprechpartner zum Zeichen. Ergebnis { name, mail } bei genau einem Treffer, sonst
 * { treffer: Anzahl }. Fehler beim Abruf werfen.
 */
async function kontaktAusVerzeichnis(zeichen, domain) {
  const d = String(domain || '').toLowerCase().trim();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw new Error('keine Maildomäne');
  if (!_kontaktKonten.has(d)) {
    const laden = _kontaktKontenLaden(d);
    _kontaktKonten.set(d, laden);
    laden.catch(() => _kontaktKonten.delete(d));   // beim nächsten Beleg neu versuchen
  }
  const treffer = kontaktTreffer(zeichen, await _kontaktKonten.get(d));
  return treffer.length === 1 ? { name: kontaktName(treffer[0]), mail: treffer[0].mail, treffer: 1 } : { treffer: treffer.length };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { kontaktNorm, kontaktTreffer, kontaktName };
}
