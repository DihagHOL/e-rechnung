/* Seiten-Skript von index.html. Stand früher inline in der Seite; die Content-Security-Policy
   erlaubt nur Skripte aus eigenen Dateien. */
authInit();

// "Stand" dynamisch = aktueller Monat/Jahr (bleibt nie veraltet)
(function () {
  var m = ['Januar','Februar','März','April','Mai','Juni','Juli','August',
           'September','Oktober','November','Dezember'];
  var d = new Date(), el = document.getElementById('app-stand');
  if (el) el.textContent = m[d.getMonth()] + ' ' + d.getFullYear();
})();
