/* Seiten-Skript von monitoring.html. Stand früher inline in der Seite; die Content-Security-Policy
   erlaubt nur Skripte aus eigenen Dateien. */
onAuthReady(async () => {
  initAdminNav();
  monInitFilterEvents();
  // Werkzuweisung aus den Einstellungen (einstellungen.html): Wer Werken zugewiesen
  // ist, sieht nur diese, Admins alle, die SharePoint sie lesen lässt. Ohne Zuweisung keins.
  try { await loadRuntimeAccessConfig(); } catch (e) { /* ohne Config keine Zuweisung */ }
  // Das zugewiesene Werk ist beim Öffnen vorgewählt (bei mehreren das erste der Liste)
  const zugewiesen = getCurrentUserAccess();
  if (!isCurrentUserAdmin() && !zugewiesen.length) {
    if (zugriffLadeFehler()) return _monShowSetup('Einstellungen nicht geladen', zugriffLadeHinweis());
    return _monShowSetup('Kein Werk zugewiesen',
      'Dir ist in den Einstellungen noch kein Werk zugeordnet. Bitte die IT, dich einem Werk zuzuordnen.');
  }
  const standardWerk = (WERKE_ALLE.map(w => w[0]).find(c => zugewiesen.includes(c.toLowerCase()))
    || (zugewiesen[0] || '')).toUpperCase();
  // Rolle je Werk: FIBU sieht Ein- und Ausgang, Vertrieb nur den Ausgang
  loadMonitoring(isCurrentUserAdmin() ? [] : zugewiesen, { standardWerk, richtungen: erlaubteRichtungen() });
});

authInit();
