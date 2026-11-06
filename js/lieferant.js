/**
 * Lieferant aus dem PDF-Text lesen (sonstige Rechnungen ohne XML)
 * ===============================================================
 * Bei einer PDF ohne eingebettete E-Rechnung gibt es keine strukturierten
 * Daten. Aus dem Text lassen sich die wichtigsten Angaben trotzdem meist
 * sicher lesen: Lieferant (Absenderzeile über der Anschrift, Fußzeile),
 * USt-IdNr., Mailadresse, Rechnungsnummer, Rechnungsdatum und Bruttobetrag. Dazu der
 * Hinweis auf § 19 UStG (Kleinunternehmer, keine E-Rechnungspflicht).
 *
 * Läuft im Browser (Monitoring, 800k-Dialog) und im Prüfdienst
 * (api/vendor, /api/intake). Eigene Gesellschaften der DIHAG sind immer
 * Empfänger und werden nie als Lieferant genommen.
 *
 * Ergebnis ist ein Vorschlag. Jedes Feld fehlt lieber, als falsch zu sein.
 */
(function (global) {
  'use strict';

  // USt-IdNr. der eigenen Gesellschaften: die aus js/parser.js (_COMPANY_REGISTRY, wie in
  // api/src/eigene.js) und die der Schmiedeberger Gießerei (SCH).
  const EIGENE_VAT = ['DE140598967', 'DE812264517', 'DE368990137', 'DE368676368',
    'DE811154479', 'DE812737567', 'DE281233945', 'DE150528912', 'DE140462641'];
  // Namensteile der eigenen Gesellschaften (klein, ohne Umlaut-Varianten). „Schmiederberger“
  // schreiben manche Lieferanten aus Tschechien.
  const EIGENE_NAMEN = ['dihag', 'gienanth', 'walzengie', 'coswig guss', 'hartgusswerk', 'leipzig guss',
    'zaigler', 'lintorfer eisengie', 'lintorf guss', 'meuselwitz guss', 'schmiedeberg', 'schmiederberg', 'arnstadt guss',
    'eisenwerk arnstadt'];

  const RECHTSFORM = /(GmbH\s*&\s*Co\.?\s*KG(?:aA)?|GmbH|gGmbH|mbH|AG\s*&\s*Co\.?\s*KG|\bAG\b|\bSE\b|\bKG\b|\bOHG\b|\bUG\b|e\.\s?K\.|\be\.V\.|\bLtd\.?|\bLimited\b|\bInc\.?|\bS\.?A\.?S?\b|\bS\.p\.A\.|\bS\.r\.l\.|\bB\.V\.|\bN\.V\.|s\.r\.o\.|a\.s\.|Sp\. z o\.o\.)/;
  const UMLAUT = s => s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  const KLEIN = s => UMLAUT(String(s || '').toLowerCase());

  // Bricht der Name im Anschriftenfeld um, steht nur der Rest in der Zeile:
  // „SHB Stahl- und Hartgusswerk / Bösdorf GmbH“, „Eisenwerk / Arnstadt GmbH“.
  const EIGENE_KURZ = /^(?:boesdorf|arnstadt|amstadt|coswig|lintorf|meuselwitz|schmiedeberg|eisenberg)\s+(?:gmbh|mbh)\b/;

  function istEigen(name) {
    const k = KLEIN(name).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    return EIGENE_NAMEN.some(e => k.includes(UMLAUT(e))) || EIGENE_KURZ.test(k) || /werk\s+a(?:rn|m)stad/.test(k);
  }

  /* ── USt-IdNr. ─────────────────────────────────────────────────────── */

  // DE mit 9 Ziffern (auch mit Leerzeichen), sonst EU-Formate hinter einem Label.
  const VAT_DE = /\bDE[ ]?(\d{3})[ ]?(\d{3})[ ]?(\d{3})(?!\d)/g;
  const VAT_LABEL = /(USt\.?[- ]?Id[A-Za-z.-]*|UID[- ]?Nr\.?|VAT[- ]?(?:ID|No\.?|Reg\.? No\.?|number)?|Umsatzsteuer[- ]?(?:ID|Identifikationsnummer)[A-Za-z.-]*)[ .:]*/i;
  const VAT_EU = /\b(ATU\d{8}|BE0?\d{9,10}|NL\d{9}B\d{2}|FR[0-9A-Z]{2}\d{9}|IT\d{11}|ES[0-9A-Z]\d{7}[0-9A-Z]|PL\d{10}|CZ\d{8,10}|DK\d{8}|LU\d{8}|SE\d{12}|CHE[- ]?\d{3}\.?\d{3}\.?\d{3})\b/;

  function vatKandidaten(zeilen) {
    const out = [];
    zeilen.forEach((z, i) => {
      // „Unsere USt.-IdNr.“ direkt unter „Ihre USt.-IdNr.“ ist die des Lieferanten
      const fremd = /\b(Ihre|Kunden|Your|Empf(?:ä|ae)nger)\b/i.test(z)
        || (/\b(Ihre|Kunden|Your)\b/i.test(zeilen[i - 1] || '') && !/\b(Unsere|Our)\b/i.test(z));
      let m;
      VAT_DE.lastIndex = 0;
      while ((m = VAT_DE.exec(z))) {
        const v = 'DE' + m[1] + m[2] + m[3];
        // IBAN-Teile (DE + 2 Prüfziffern + BLZ) nicht als USt-IdNr. nehmen
        const davor = z.slice(Math.max(0, m.index - 8), m.index);
        if (/IBAN|Konto/i.test(davor)) continue;
        out.push({ vat: v, zeile: i, label: VAT_LABEL.test(z) || VAT_LABEL.test(zeilen[i - 1] || ''), fremd });
      }
      if (VAT_LABEL.test(z) || VAT_LABEL.test(zeilen[i - 1] || '')) {
        // erst wie geschrieben (Wortgrenzen bleiben), dann ohne Leerzeichen („ATU 1234 5678“)
        const e = VAT_EU.exec(z) || VAT_EU.exec(z.replace(/\s+/g, ''));
        if (e) out.push({ vat: e[1].replace(/[- .]/g, ''), zeile: i, label: true, fremd });
      }
    });
    return out.filter(k => !EIGENE_VAT.includes(k.vat));
  }

  /* ── Name ──────────────────────────────────────────────────────────── */

  // Kein Firmenname: Satzanfänge, Beschriftungen, Füllpunkte, Ziffernfolgen, OCR-Reste wie „Lı5ea“
  function keinName(name) {
    return /\.{3,}|^\d+[/.]|[a-zäöüßı]\d|\d[a-zäöüßı]|\d\s*(?:KG|AG)$/.test(name)
      || /^(Zust(?:ä|ae)ndig|Gerichtsstand|Sitz\b|Gesch(?:ä|ae)ftsf|Finanzamt|Steuernummer|Lieferbedingung|Zahlungsbeding|Versandart|Verpackung|Rechtsform|Bruttogewicht|Nettogewicht|Gewicht|Bearbeiter|Sachbearbeiter)/i.test(name)
      // Nur die Gattung ohne Firmenwort: Der eigentliche Name steht im Logo
      || /^\S*(?:gesellschaft|fachgro(?:ß|ss)handel)\s+(?:mbH|GmbH|AG|KG)/i.test(name)
      || /\b(Amtsgericht|Registergericht|Handelsregister|Bank|Sparkasse|Postbank|Commerzbank|Verwaltungs|PHG|Komplement)/i.test(name);
  }

  // Teil einer Zeile, der der Firmenname ist: bis einschließlich Rechtsform.
  function nameAusZeile(z) {
    if (/^\s*(?:Empf|Abs|Lief)\.\s*:?/i.test(z)) return '';            // Angaben zur Fracht
    const teile = z.split(/\s+[-–|·•I]\s+|\s{3,}|\s*\|\s*|\s*·\s*|,\s+(?=\D)/);
    for (let i = 0; i < teile.length; i++) {
      const t = teile[i];
      const m = RECHTSFORM.exec(t);
      if (!m) continue;
      let name = t.slice(0, m.index + m[0].length).trim();
      name = name.replace(/^(Firma|Ihre|Rechnungssteller|Lieferant|Absender|Kontoinhaber|Ansprechpartner|Zahlungsempf(?:ä|ae)nger|Verk(?:ä|ae)ufer|Aussteller)\s*:?\s+/i, '').trim();
      // „RHM Rohstoff - Handelsgesellschaft mbH“: Der Strich gehört zum Namen
      if (i > 0 && /^\S*(?:gesellschaft|handel|technik|service|logistik)\s+\S+$/i.test(name) && !/\d/.test(teile[i - 1])) name = `${teile[i - 1].trim()} - ${name}`;
      if (name.length < 4 || name.length > 80) continue;
      if (!/[A-Za-zÄÖÜäöü]{2}/.test(name.replace(RECHTSFORM, ''))) continue;
      if (keinName(name)) continue;
      return name;
    }
    return '';
  }

  /** Wörter aus der Domain des Absenders, die im Firmennamen stehen können. */
  function domainWoerter(absender) {
    const mail = String(absender || '').toLowerCase().trim();
    const dom = mail.split('@')[1] || '';
    if (!dom || istEigeneMail(mail)) return [];
    return dom.split('.').slice(0, -1).join('-').split(/[^a-z0-9]+/)
      .filter(w => w.length >= 4 && !/^(rechnung|rechnungen|invoice|invoices|billing|portal|mail|email|service|online|group|gruppe|gmbh|team|info)$/.test(w));
  }

  function nameKandidaten(zeilen, vatZeilen, absender) {
    const n = zeilen.length;
    const map = new Map();
    const woerter = domainWoerter(absender);
    zeilen.forEach((z, i) => {
      const name = nameAusZeile(z);
      if (!name || istEigen(name)) return;
      const key = KLEIN(name).replace(/[^a-z0-9]+/g, '');
      const e = map.get(key) || { name, punkte: 0, zeilen: [] };
      e.zeilen.push(i);
      // Absenderzeile: Name, Straße, PLZ Ort in einer Zeile, oben auf der Seite
      if (/\d{4,5}\s+[A-ZÄÖÜ]/.test(z) && /[-–|·•]/.test(z) && i < 25) e.punkte += 4;
      if (i < 8) e.punkte += 2;
      if (i > n - 30) e.punkte += 1;                       // Fußbereich
      if (vatZeilen.some(v => Math.abs(v - i) <= 6)) e.punkte += 2;
      if (/^\s*(Ihre|Lieferung an|Rechnungsempf|Firma\s*:)/i.test(z)) e.punkte -= 3;
      e.punkte += 1;                                       // jedes Vorkommen zählt
      // Name passt zur Domain der Rechnungsmail
      if (woerter.some(w => key.includes(w))) e.punkte += 6;
      // längere, vollständige Schreibweise behalten (z. B. „GmbH & Co. KG")
      if (name.length > e.name.length && KLEIN(name).startsWith(KLEIN(e.name).slice(0, 6))) e.name = name;
      map.set(key, e);
    });
    // Domain der Rechnungsmail, der Name steht aber mitten in einer mehrspaltigen Zeile
    if (![...map.values()].some(e => e.punkte >= 6)) {
      for (const w of woerter) {
        const re = new RegExp(`\\b${w}\\b[^,;|·]{0,40}?${RECHTSFORM.source}`, 'gi');
        for (const z of zeilen) {
          for (const m of UMLAUT(z).matchAll(re)) {
            const name = m[0].replace(/\s+/g, ' ').trim();
            if (istEigen(name) || keinName(name)) continue;
            const key = KLEIN(name).replace(/[^a-z0-9]+/g, '');
            const e = map.get(key) || { name, punkte: 5, zeilen: [] };
            e.punkte += 1;
            map.set(key, e);
          }
        }
      }
    }
    // Absenderzeile ohne Rechtsform („REL technischer Großhandel, Seestr. 23a, 01640 Coswig")
    if (!map.size) {
      const absender = /^\s*([^,|·•]{3,60}?)\s*(?:,|\s[-–|·•]\s)\s*[^,|·•]{3,40}?\d+\s?[a-z]?\s*(?:,|\s[-–|·•]\s)\s*\d{4,5}\s+[A-ZÄÖÜ]/;
      for (let i = 0; i < Math.min(n, 30); i++) {
        const m = absender.exec(zeilen[i]);
        if (!m || istEigen(m[1]) || keinName(m[1]) || /^(Postfach|Lieferung|Lieferanschrift|Rechnungsanschrift|Kommission)/i.test(m[1])) continue;
        map.set('absender', { name: m[1].trim(), punkte: 3, zeilen: [i] });
        break;
      }
    }
    return [...map.values()].sort((a, b) => b.punkte - a.punkte);
  }

  /* ── Nummer, Datum, Betrag ─────────────────────────────────────────── */

  const DATUM = /(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})(?!\d)/;
  function isoDatum(m) {
    const t = Number(m[1]), mo = Number(m[2]);
    let j = Number(m[3]);
    if (j < 100) j += 2000;
    if (t < 1 || t > 31 || mo < 1 || mo > 12 || j < 2000 || j > 2100) return '';
    return `${j}-${String(mo).padStart(2, '0')}-${String(t).padStart(2, '0')}`;
  }

  function rechnungsdatum(zeilen) {
    const label = /(Rechnungs-?\s?|Beleg-?|Invoice\s*)datum|Invoice date|Datum der Rechnung/i;
    for (let i = 0; i < zeilen.length; i++) {
      if (!label.test(zeilen[i])) continue;
      // „30 Tage nach Rechnungsdatum … Zahlung bis …“ ist die Zahlungsbedingung
      if (/(nach|ab)\s+Rechnungs-?\s?datum|Zahlung\s/i.test(zeilen[i])) continue;
      const hier = zeilen[i].slice(zeilen[i].search(label));
      // Manche Layouts setzen den Wert vor die Beschriftung
      const vorher = /^\s*\d{1,2}\.\d{1,2}\.\d{2,4}\s*$/.test(zeilen[i - 1] || '') ? zeilen[i - 1] : '';
      const m = DATUM.exec(hier) || DATUM.exec(zeilen[i + 1] || '') || DATUM.exec(vorher);
      if (m && isoDatum(m)) return isoDatum(m);
    }
    for (let i = 0; i < Math.min(zeilen.length, 60); i++) {
      // „Datum21.09.2026" oder „22.09.2026Datum"
      const z = zeilen[i];
      if (!/(^|[^A-Za-z])Datum|Datum($|[^A-Za-z])/.test(z) || /Liefer|Leistung|Bestell|Auftrag|Druck|Fällig|Faellig|bis zum/i.test(z)) continue;
      const m = DATUM.exec(z);
      if (m && isoDatum(m)) return isoDatum(m);
    }
    return '';
  }

  function rechnungsnummer(zeilen) {
    const label = /(Rechnungs-?\s?(?:nummer|nr\.?)|Rechn\.?\s?-?Nr\.?|Rechnung\s*(?:Nr\.?|Nummer)|Beleg-?(?:nummer|nr\.?)|Invoice\s*(?:No\.?|Number|#))\s*[:.]?\s*/i;
    const wert = /^([A-Z]{0,4}[-/]?\d[0-9A-Z]*(?:[-/.][0-9A-Z]+){0,3})/i;
    // „914722Kunden Nr." : angeklebtes nächstes Wort abschneiden
    const sauber = w => w.replace(/[A-ZÄÖÜ][a-zäöü]+.*$/, '');
    for (let i = 0; i < zeilen.length; i++) {
      const z = zeilen[i];
      const m = label.exec(z);
      if (!m) continue;
      const rest = z.slice(m.index + m[0].length).trim();
      // ohne Wert dahinter: Zeile danach, sonst Zeile davor (Wert vor der Beschriftung)
      const kandidaten = rest ? [rest] : [(zeilen[i + 1] || '').trim(), (zeilen[i - 1] || '').trim()];
      for (const k of kandidaten) {
        const w = wert.exec(k);
        if (!w) continue;
        const v = sauber(w[1]);
        if (/\d{3,}/.test(v) && !DATUM.test(rest ? v : k) && (rest || k.length <= 24)) return v;
      }
    }
    // „Rechnung 516686" bzw. „Rechnung\nNummerR26/002110"
    for (let i = 0; i < Math.min(zeilen.length, 60); i++) {
      const z = zeilen[i].trim();
      let m = /^Rechnung\s+([A-Z]{0,4}[-/]?\d{4,}[0-9A-Z/-]*)$/i.exec(z)
           || /^Nummer\s*([A-Z]{0,4}[-/]?\d[0-9A-Z/-]{3,})$/i.exec(z);
      if (m) return m[1];
    }
    return '';
  }

  const BETRAG = /(-?\d{1,3}(?:[.\s]\d{3})*,\d{2}|-?\d+,\d{2})(?!\d)/g;
  const zahl = s => Number(String(s).replace(/[.\s]/g, '').replace(',', '.'));

  // Lieber kein Betrag als ein falscher: nur eindeutige Summenbezeichnungen, der
  // Wert in derselben Zeile oder allein in der Zeile danach. Ein bloßes „Gesamt"
  // zählt nur, wenn die Zeile aus nichts anderem als „Gesamt" und Betrag besteht
  // (sonst trifft es Positionen oder Beiblätter).
  function bruttobetrag(zeilen) {
    const stark = /(Gesamt\s*Brutto|Bruttobetrag|Rechnungsbetrag|Endbetrag|Endsumme|Gesamtbetrag|Zahlbetrag|zu zahlen(?:der Betrag)?|Summe brutto|Total amount|Amount due)/i;
    const schwach = /^\s*(?:Gesamt|Summe|Total)\s*(?:EUR|€)?\s*:?\s*(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2})\s*(?:EUR|€)?\s*$/i;
    const nurBetrag = /^\s*(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2})\s*(?:EUR|€)?\s*$/;
    let treffer = null;
    for (let i = 0; i < zeilen.length; i++) {
      const z = zeilen[i];
      if (/netto|ohne\s*mwst|Abschlag|Skonto|Übertrag|Uebertrag|Gesamtpreis/i.test(z)) continue;
      const s = schwach.exec(z);
      if (s) { treffer = zahl(s[1]); continue; }
      const m = stark.exec(z);
      if (!m) continue;
      BETRAG.lastIndex = 0;
      const b = BETRAG.exec(z.slice(m.index));
      const danach = nurBetrag.exec(zeilen[i + 1] || '');
      if (b) treffer = zahl(b[1]);            // letzter Treffer gewinnt (Summe steht unten)
      else if (danach) treffer = zahl(danach[1]);
    }
    return treffer;
  }

  /** Alle Beträge im Text, kaufmännisch gerundet in Cent, ohne Doppelte. */
  function alleBetraege(zeilen) {
    const cents = new Set();
    for (const z of zeilen) {
      BETRAG.lastIndex = 0;
      let m;
      while ((m = BETRAG.exec(z))) {
        const c = Math.round(Math.abs(zahl(m[1])) * 100);
        if (c > 0) cents.add(c);
      }
    }
    return [...cents].slice(-400);
  }

  // Passen netto + Steuer = brutto zum üblichen Steuersatz? Dann stimmen die drei Beträge sehr
  // wahrscheinlich, egal wie die Summenzeilen beschriftet sind.
  const SAETZE = [0.19, 0.07];
  const passtSatz = (n, s) => SAETZE.some(q => Math.abs(s - n * q) <= Math.max(2, n * 0.0005));

  /** Größtes Tripel netto + Steuer = brutto im Text, Beträge in Cent, sonst null. */
  function summenTripel(cents) {
    const da = new Set(cents);
    const groesste = cents.slice().sort((a, b) => b - a);
    for (const b of groesste) {
      for (const n of groesste) {
        if (n >= b) continue;
        if (b - n > n) break;
        if (da.has(b - n) && passtSatz(n, b - n)) return { netto: n / 100, brutto: b / 100 };
      }
    }
    return null;
  }

  /** Netto zu einem bekannten Bruttobetrag: Summenzeile, sonst über den Steuerbetrag im Text. */
  function nettobetrag(zeilen, brutto, cents) {
    const stark = /(Netto\s*-?\s*(?:betrag|summe|gesamt|wert|rechnungsbetrag|warenwert)|Gesamt\s*-?\s*netto|Summe\s*-?\s*netto|Rechnungs-?summe\s*netto|Warenwert\s*netto|Zwischensumme\s*netto|Net\s+(?:amount|total|value)|Total\s+(?:net|excl))/i;
    const kurz = /^\s*(?:Summe\s+|Gesamt\s+)?(Netto|Warenwert|Zwischensumme)\s*(?:EUR|€)?\s*:?\s*(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2})\s*(?:EUR|€)?\s*$/i;
    const nurBetrag = /^\s*(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2})\s*(?:EUR|€)?\s*$/;
    let treffer = null;
    let sicher = false;       // Warenwert und Zwischensumme gelten nur mit passendem Bruttobetrag
    for (let i = 0; i < zeilen.length; i++) {
      const z = zeilen[i];
      if (/Skonto|Abschlag|Übertrag|Uebertrag|Einzelpreis|Positionen/i.test(z)) continue;
      const k = kurz.exec(z);
      if (k) { treffer = zahl(k[2]); sicher = /netto/i.test(k[1]); continue; }
      const m = stark.exec(z);
      if (!m) continue;
      BETRAG.lastIndex = 0;
      const b = BETRAG.exec(z.slice(m.index));
      const danach = nurBetrag.exec(zeilen[i + 1] || '');
      if (b || danach) { treffer = zahl((b || danach)[1]); sicher = true; }
    }
    if (brutto != null) {
      const bc = Math.round(Math.abs(brutto) * 100);
      // Die Summenzeile zählt nur, wenn sie zum Bruttobetrag passt
      if (treffer != null && Math.abs(treffer) <= Math.abs(brutto) + 0.005) {
        const t = Math.round(Math.abs(treffer) * 100);
        if (t === bc || cents.includes(bc - t)) return treffer;
      }
      for (const n of cents) {
        if (n < bc && cents.includes(bc - n) && passtSatz(n, bc - n)) return (brutto < 0 ? -n : n) / 100;
      }
      return null;
    }
    return sicher ? treffer : null;
  }

  const FREMDWAEHRUNG = /\b(CZK|USD|GBP|CHF|PLN|SEK|DKK|NOK|HUF|RON|CNY|JPY)\b|K\u010d/;

  /** Währung, wenn der Text klar etwas anderes als Euro nennt, sonst ''. */
  function waehrung(zeilen) {
    const eur = zeilen.filter(z => /\bEUR\b|€/.test(z)).length;
    const anz = {};
    for (const z of zeilen) {
      const m = FREMDWAEHRUNG.exec(z);
      if (m) { const k = m[1] || 'CZK'; anz[k] = (anz[k] || 0) + 1; }
    }
    const beste = Object.keys(anz).sort((a, b) => anz[b] - anz[a])[0];
    return beste && anz[beste] > eur ? beste : '';
  }

  /* ── Fälligkeit ────────────────────────────────────────────────────── */

  function plusTage(iso, tage) {
    const [j, m, t] = iso.split('-').map(Number);
    return new Date(Date.UTC(j, m - 1, t + tage)).toISOString().slice(0, 10);
  }

  /**
   * Fälligkeit: ausdrückliches Datum hinter „fällig“, „zahlbar bis“ und ähnlich, sonst
   * Rechnungsdatum + Tage aus der Zahlungsbedingung („30 Tage netto“). Zeilen, die nur
   * eine Skontofrist nennen, zählen nicht.
   */
  function faelligkeit(zeilen, datum) {
    const label = /(f(?:ä|ae)llig(?:keit)?(?:sdatum)?|zahlbar\s+(?:bis|am|zum|sp(?:ä|ae)testens)|Zahlungsziel|Zahlungstermin|zu\s+zahlen\s+bis|Zahlung(?:\s+[a-z]+){0,2}\s+bis|due\s+date|payable\s+(?:by|until|on)|payment\s+due)/i;
    const skonto = /Skonto|Rabatt|discount/i;
    const ohneAbzug = /netto|ohne\s+(?:jeden\s+)?Abzug|rein\s+netto|without\s+deduction|net\b/i;
    const daten = [];
    zeilen.forEach((z, i) => {
      const m = label.exec(z);
      if (!m) return;
      const rest = z.slice(m.index);
      if (skonto.test(z) && !ohneAbzug.test(z)) return;
      const d = DATUM.exec(rest) || (/^\s*\d{1,2}\.\d{1,2}\.\d{2,4}\s*$/.test(zeilen[i + 1] || '') ? DATUM.exec(zeilen[i + 1]) : null);
      const iso = d ? isoDatum(d) : '';
      if (iso && (!datum || iso >= datum)) daten.push(iso);
    });
    if (daten.length) return daten.sort().slice(-1)[0];
    if (!datum) return '';
    const tage = [];
    const muster = [
      /(\d{1,3})\s*Tage?n?\s*(?:rein\s*)?(?:netto|ohne\s+(?:jeden\s+)?Abzug)/gi,
      /netto\s+(?:innerhalb\s+)?(?:von\s+)?(\d{1,3})\s*Tage/gi,
      /Zahlungsziel\s*:?\s*(\d{1,3})\s*Tage/gi,
      /zahlbar\s+(?:innerhalb\s+)?(?:von\s+)?(\d{1,3})\s*Tage/gi,
      /innerhalb\s+(?:von\s+)?(\d{1,3})\s*Tagen?\s+(?:nach|ab)\s+(?:Rechnung|Erhalt|Zugang)/gi,
      /(\d{1,3})\s*days\s*(?:net|after)/gi,
      /net\s+(\d{1,3})\s*days/gi,
    ];
    for (const z of zeilen) {
      for (const re of muster) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(z))) {
          const n = Number(m[1]);
          // „14 Tage 2 % Skonto“ steht selten direkt davor, die Spanne schließt sie aus
          if (n >= 1 && n <= 120 && !/Skonto/i.test(z.slice(m.index, m.index + m[0].length))) tage.push(n);
        }
      }
    }
    if (tage.length) return plusTage(datum, Math.max(...tage));
    if (zeilen.some(z => /zahlbar\s+sofort|sofort\s+(?:f(?:ä|ae)llig|netto|ohne\s+Abzug)/i.test(z))) return datum;
    return '';
  }

  /* ── Mailadresse ───────────────────────────────────────────────────── */

  // Domains der eigenen Gesellschaften. Solche Adressen sind nie die des Lieferanten.
  const EIGENE_DOMAINS = ['dihag', 'walze-coswig', 'shb-guss', 'lintorfereg', 'ewa-guss', 'gienanth', 'zaigler', 'meuselwitz-guss'];
  const MAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

  function istEigeneMail(mail) {
    const domain = String(mail || '').toLowerCase().split('@')[1] || '';
    return EIGENE_DOMAINS.some(d => domain.includes(d));
  }

  // Adresse für Rechnungsfragen: Rechnungspostfach vor allgemeinem Postfach vor Person.
  // Nicht zustellbare (noreply) und eigene Adressen fallen weg. Die Adressen des
  // Empfängers sind immer eigene. Passt die Domain zum Namen des Lieferanten, zählt das mit.
  function mailAusZeilen(zeilen, name) {
    const nameTeile = KLEIN(name).split(/[^a-z0-9]+/).filter(t => t.length >= 4 && !/^(gmbh|mbh|kg|ag|und|technik|handel|service)$/.test(t));
    const n = zeilen.length;
    const kandidaten = new Map();
    zeilen.forEach((roh, i) => {
      // „E-Mailinfo@…" (angeklebte Beschriftung), „info (at) firma.de", „info @ firma.de"
      const z = roh.replace(/\bE-?Mail\s*:?\s*/gi, ' ').replace(/\bMail\s*:\s*/gi, ' ')
        .replace(/\s*[[(]at[\])]\s*/gi, '@').replace(/\s*@\s*/g, '@');
      for (const mail of z.match(MAIL) || []) {
        const lokal = mail.split('@')[0].toLowerCase();
        if (istEigeneMail(mail) || /^(no-?reply|do-?not-?reply|noreply|mailer-daemon|postmaster)/.test(lokal)) continue;
        const k = mail.toLowerCase();
        const e = kandidaten.get(k) || { mail, punkte: 0 };
        if (/rechnung|invoice|buchhaltung|accounting|fibu|debitor|billing|faktura|abrechnung/.test(lokal)) e.punkte += 4;
        else if (/^(info|kontakt|contact|office|mail|service|verkauf|vertrieb|sales|zentrale)$/.test(lokal)) e.punkte += 2;
        else if (/datenschutz|privacy|dsb|jobs|karriere|bewerbung|newsletter|marketing/.test(lokal)) e.punkte -= 3;
        const domain = k.split('@')[1].replace(/[^a-z0-9]+/g, '');
        if (nameTeile.some(t => domain.includes(t))) e.punkte += 2;
        if (i > n - 30) e.punkte += 1;
        kandidaten.set(k, e);
      }
    });
    const liste = [...kandidaten.values()].filter(e => e.punkte >= 0).sort((a, b) => b.punkte - a.punkte);
    return liste.length ? liste[0].mail : '';
  }

  /* ── Sitz im Ausland ───────────────────────────────────────────────── */

  // Die E-Rechnungspflicht gilt nur, wenn Lieferant und Empfänger in Deutschland ansässig
  // sind (§ 14 Abs. 2 UStG). Hinweise auf einen Lieferanten im Ausland: das Land in der
  // Anschrift im Kopf der Rechnung, die IBAN und die USt-IdNr. Die Anschrift des Empfängers
  // (eigene Gesellschaft) liegt in Deutschland und zeigt deshalb nie ein anderes Land.
  // [Kennung, Name, Schreibweisen, Kennzeichen vor der Postleitzahl]
  const LAENDER = [
    ['AT', 'Österreich', 'Österreich|Oesterreich|Austria|Autriche', 'A|AT'],
    ['CH', 'Schweiz', 'Schweiz|Switzerland|Suisse|Svizzera', 'CH'],
    ['IT', 'Italien', 'Italien|Italia|Italy|Italie', 'I|IT'],
    ['FR', 'Frankreich', 'Frankreich|France', 'F|FR'],
    ['NL', 'Niederlande', 'Niederlande|Nederland|Netherlands|Holland', 'NL'],
    ['BE', 'Belgien', 'Belgien|Belgique|België|Belgie|Belgium', 'B|BE'],
    ['LU', 'Luxemburg', 'Luxemburg|Luxembourg', 'L|LU'],
    ['PL', 'Polen', 'Polen|Polska|Poland|Pologne', 'PL'],
    ['CZ', 'Tschechien', 'Tschechien|Tschechische Republik|Česká republika|Ceska republika|Czech Republic|Czechia', 'CZ'],
    ['SK', 'Slowakei', 'Slowakei|Slovensko|Slovakia|Slovak Republic', 'SK'],
    ['HU', 'Ungarn', 'Ungarn|Magyarország|Magyarorszag|Hungary', 'H|HU'],
    ['SI', 'Slowenien', 'Slowenien|Slovenija|Slovenia', 'SI|SLO'],
    ['HR', 'Kroatien', 'Kroatien|Hrvatska|Croatia', 'HR'],
    ['DK', 'Dänemark', 'Dänemark|Daenemark|Danmark|Denmark', 'DK'],
    ['SE', 'Schweden', 'Schweden|Sverige|Sweden', 'S|SE'],
    ['NO', 'Norwegen', 'Norwegen|Norge|Norway', 'N|NO'],
    ['FI', 'Finnland', 'Finnland|Suomi|Finland', 'FI|FIN'],
    ['ES', 'Spanien', 'Spanien|España|Espana|Spain', 'E|ES'],
    ['PT', 'Portugal', 'Portugal', 'P|PT'],
    ['GB', 'Großbritannien', 'Großbritannien|Grossbritannien|Vereinigtes Königreich|United Kingdom|Great Britain|England|Scotland', 'GB|UK'],
    ['IE', 'Irland', 'Irland|Ireland', 'IRL|IE'],
    ['RO', 'Rumänien', 'Rumänien|Rumaenien|România|Romania', 'RO'],
    ['BG', 'Bulgarien', 'Bulgarien|Bulgaria', 'BG'],
    ['GR', 'Griechenland', 'Griechenland|Greece', 'GR'],
    ['LT', 'Litauen', 'Litauen|Lietuva|Lithuania', 'LT'],
    ['LV', 'Lettland', 'Lettland|Latvija|Latvia', 'LV'],
    ['EE', 'Estland', 'Estland|Eesti|Estonia', 'EE'],
    ['TR', 'Türkei', 'Türkei|Tuerkei|Türkiye|Turkiye|Turkey', 'TR'],
    ['US', 'USA', 'USA|U[.]S[.]A[.]|United States', ''],
    ['CN', 'China', 'China|Volksrepublik China', ''],
    ['JP', 'Japan', 'Japan', ''],
    ['IN', 'Indien', 'Indien|India', ''],
  ];
  const BUCHSTABE = 'A-Za-zÀ-ž';
  const LAND_RE = LAENDER.map(([land, name, namen, kennz]) => ({
    land, name,
    wort: new RegExp(`(?<![${BUCHSTABE}])(?:${namen})(?![${BUCHSTABE}])`, 'i'),
    // „I-57025 Piombino“, „CH-8000 Zürich“, „AT 4020 Linz“ (ein Buchstabe nur mit Bindestrich)
    plz: kennz ? new RegExp(`(?<![A-Za-z0-9])(?:${kennz.split('|').map(k => k.length === 1 ? k + '-' : k + '[- ]').join('|')})`
      + `\\d{2,6}(?:-\\d{3})?\\s+[A-ZÄÖÜ][${BUCHSTABE}]{2,}`) : null,
  }));
  const LANDNAME = Object.fromEntries(LAENDER.map(([land, name]) => [land, name]));

  /** Steht das Land wie in einer Anschrift: allein, hinter Postleitzahl und Ort oder zwischen Trennzeichen? */
  function wieAnschrift(z, m) {
    const vor = z.slice(0, m.index), nach = z.slice(m.index + m[0].length);
    const leer = s => /^[\s,.;|·•–-]*$/.test(s);
    const plzDavor = /\d{4,5}/.test(vor);
    return (leer(nach) && (leer(vor) || plzDavor || /[,|·•–-]\s*$/.test(vor))) || (plzDavor && /^\s*[,|·•–-]/.test(nach));
  }

  /**
   * Land aus der Anschrift im Kopf (erste 20 Zeilen). Lieferanschriften, Bankverbindungen und
   * Ursprungsangaben zählen nicht („… Bank Abp, Finland“ bei einem deutschen Lieferanten).
   */
  function landImKopf(zeilen) {
    let sperre = -1;
    for (let i = 0; i < Math.min(zeilen.length, 20); i++) {
      const z = zeilen[i];
      if (/Liefer(?:an)?schrift|Lieferadresse|Versandanschrift|Warenempf|Shipping|Ship to|Deliver(?:y)? (?:to|address)|Consignee/i.test(z)) sperre = i + 3;
      if (i <= sperre || /Origin|Ursprung|Herkunft|Made in|Bank|Sparkasse|IBAN|BIC|SWIFT|Konto|Account/i.test(z)) continue;
      for (const l of LAND_RE) {
        if (l.plz && l.plz.test(z)) return l.land;
        const m = l.wort.exec(z);
        if (m && wieAnschrift(z, m)) return l.land;
      }
    }
    return '';
  }

  // Länge der IBAN je Land: Die Prüfziffer wird über genau diese Länge gerechnet.
  const IBAN_LAENGE = { AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FR: 27,
    GB: 22, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MT: 31, NL: 18, NO: 15,
    PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, TR: 26 };

  function ibanOk(iban) {
    let rest = 0;
    for (const c of iban.slice(4) + iban.slice(0, 4)) {
      const wert = /[0-9]/.test(c) ? c : String(c.charCodeAt(0) - 55);
      for (const z of wert) rest = (rest * 10 + Number(z)) % 97;
    }
    return rest === 1;
  }

  /**
   * Länder der IBAN mit gültiger Prüfziffer. Gelesen wird hinter „IBAN“ in derselben Zeile
   * oder in der Zeile darunter. Zeilen zu einer Lastschrift vom Konto des Empfängers zählen nicht.
   */
  function ibanLaender(zeilen) {
    const laender = new Set();
    zeilen.forEach((z, i) => {
      const label = /IBAN/i.exec(z);
      const teil = label ? z.slice(label.index + 4) : /IBAN/i.test(zeilen[i - 1] || '') ? z : '';
      if (!teil || /Lastschrift|abgebucht|Mandat|Ihr(?:em|e)? Konto|Ihre IBAN|your account|direct debit/i.test(z)) return;
      const kompakt = teil.replace(/\s+/g, '').toUpperCase();
      const re = /([A-Z]{2})\d{2}/g;
      let m;
      while ((m = re.exec(kompakt))) {
        const iban = kompakt.substr(m.index, IBAN_LAENGE[m[1]] || 0);
        if (iban.length === IBAN_LAENGE[m[1]] && /^[A-Z0-9]+$/.test(iban) && ibanOk(iban)) {
          laender.add(m[1]);
          re.lastIndex = m.index + iban.length;
        }
      }
    });
    return [...laender];
  }

  /**
   * Hinweis auf einen Lieferanten ohne Sitz in Deutschland, sonst null. sicher: Die Gründe für
   * das Ausland überwiegen die Angaben für Deutschland (deutsche IBAN, deutsche USt-IdNr.). Bei
   * Gleichstand bleibt es ein Hinweis zum Prüfen, aber nur, wenn die Anschrift im Kopf ins
   * Ausland zeigt (eine IBAN in Finnland allein macht einen deutschen Lieferanten nicht ausländisch).
   * @returns {null|{land:string, landName:string, gruende:string[], dagegen:string[], sicher:boolean}}
   */
  function auslandAusZeilen(zeilen, vat) {
    const gruende = [], dagegen = [];
    const kopf = landImKopf(zeilen);
    if (kopf) gruende.push('Anschrift im Kopf: ' + LANDNAME[kopf]);
    const vatLand = vat ? (/^CHE/.test(vat) ? 'CH' : vat.slice(0, 2)) : '';
    if (vatLand && vatLand !== 'DE') gruende.push('USt-IdNr. ' + vat);
    else if (vatLand === 'DE') dagegen.push('USt-IdNr. ' + vat);
    const ibans = ibanLaender(zeilen);
    const fremd = ibans.filter(l => l !== 'DE');
    if (ibans.length && fremd.length === ibans.length) gruende.push('IBAN ' + fremd.join(', '));
    else if (ibans.length && !fremd.length) dagegen.push('IBAN DE');
    const land = kopf || (vatLand !== 'DE' && vatLand) || (fremd.length === 1 && fremd[0]) || '';
    const sicher = gruende.length > dagegen.length;
    if (!land || !(sicher || (kopf && gruende.length === dagegen.length))) return null;
    return { land, landName: LANDNAME[land] || land, gruende, dagegen, sicher };
  }

  /* ── Hauptfunktion ─────────────────────────────────────────────────── */

  /**
   * @param {string} text  PDF-Text (Zeilen durch Zeilenumbruch getrennt)
   * @param {{absender?:string}} [optionen]  Absender der Rechnungsmail, hilft bei der Wahl des Namens
   * @returns {{name:string, vat:string, mail:string, nummer:string, datum:string, faelligkeit:string,
   *            netto:(number|null), brutto:(number|null), waehrung:string, summenGeprueft:boolean,
   *            kleinunternehmer:boolean, ausland:(null|{land, landName, gruende}), lesbar:boolean}}
   */
  function lieferantAusText(text, optionen) {
    const roh = String(text || '');
    const zeilen = roh.split(/\r?\n/).map(z => z.replace(/\s+$/, '')).filter(z => z.trim());
    const lesbar = (roh.match(/[A-Za-z0-9]/g) || []).length >= 80;
    const leer = { name: '', vat: '', mail: '', nummer: '', datum: '', faelligkeit: '', netto: null, brutto: null, waehrung: '',
      summenGeprueft: false, kleinunternehmer: false, ausland: null, lesbar };
    if (!lesbar) return leer;

    const vats = vatKandidaten(zeilen);
    const eigeneVat = vats.filter(v => !v.fremd);
    const vatWahl = (eigeneVat.find(v => v.label) || eigeneVat[0] || {}).vat || '';
    const vatZeilen = vats.filter(v => v.vat === vatWahl).map(v => v.zeile);

    const namen = nameKandidaten(zeilen, vatZeilen, optionen && optionen.absender);
    const name = namen.length && namen[0].punkte >= 3 ? namen[0].name.replace(/\s+/g, ' ') : '';

    // Summen: Beschriftete Zeile und Tripel netto + Steuer = brutto. Passt beides nicht
    // zusammen, gewinnt das Tripel, weil seine drei Beträge sich gegenseitig bestätigen.
    const cents = alleBetraege(zeilen);
    const tripel = summenTripel(cents);
    let brutto = bruttobetrag(zeilen);
    let netto = nettobetrag(zeilen, brutto, cents);
    if (tripel && (brutto == null || (netto == null && Math.abs(brutto) < tripel.brutto))) {
      brutto = tripel.brutto;
      netto = tripel.netto;
    }
    const datum = rechnungsdatum(zeilen);
    return {
      name,
      vat: vatWahl,
      mail: mailAusZeilen(zeilen, name),
      nummer: rechnungsnummer(zeilen),
      datum,
      faelligkeit: faelligkeit(zeilen, datum),
      netto,
      brutto,
      waehrung: waehrung(zeilen),
      summenGeprueft: !!(tripel && brutto === tripel.brutto && netto === tripel.netto),
      kleinunternehmer: /§\s*19\s*(Abs\.?\s*1\s*)?UStG|Kleinunternehmer/i.test(roh),
      ausland: auslandAusZeilen(zeilen, vatWahl),
      lesbar,
    };
  }

  /**
   * Browser: Text eines PDFs mit pdf.js (globales pdfjsLib) zeilenweise lesen.
   * Textstücke mit gleicher Grundlinie werden zu einer Zeile zusammengefasst.
   * Im Prüfdienst (Node) setzt api/src/kopfdaten.js pdfjsLib aus pdfjs-dist.
   * @param {ArrayBuffer|Uint8Array} daten   wird kopiert, das Original bleibt unberührt
   * @param {object} [optionen]             weitere Optionen für getDocument, maxSeiten: Standard 4
   * @returns {Promise<string>}
   */
  async function textAusPdf(daten, optionen) {
    const lib = global.pdfjsLib;
    if (!lib) throw new Error('pdf.js nicht geladen');
    const doc = await lib.getDocument(Object.assign({ data: new Uint8Array(daten) }, optionen || {})).promise;
    const zeilen = [];
    for (let p = 1; p <= Math.min(doc.numPages, (optionen && optionen.maxSeiten) || 4); p++) {
      const inhalt = await (await doc.getPage(p)).getTextContent();
      const reihen = new Map();
      for (const it of inhalt.items) {
        if (!it.str || !it.str.trim()) continue;
        const y = Math.round(it.transform[5] / 2) * 2;
        if (!reihen.has(y)) reihen.set(y, []);
        reihen.get(y).push({ x: it.transform[4], s: it.str });
      }
      [...reihen.keys()].sort((a, b) => b - a).forEach(y => {
        zeilen.push(reihen.get(y).sort((a, b) => a.x - b.x).map(t => t.s).join(' ').replace(/\s+/g, ' ').trim());
      });
    }
    return zeilen.join('\n');
  }

  /**
   * Zeilen aus positionierten Textstücken ({ text, x, y, page }), etwa aus der
   * Texterkennung (js/ocr.js). Gleiche Seite und Grundlinie ergeben eine Zeile.
   * @returns {string}
   */
  function textAusItems(items) {
    const stuecke = (items || []).filter(it => it && it.text && String(it.text).trim())
      .map(it => ({ page: it.page || 1, x: it.x, y: it.y, s: String(it.text) }))
      .sort((a, b) => a.page - b.page || b.y - a.y);
    const reihen = [];
    for (const st of stuecke) {
      const r = reihen[reihen.length - 1];
      // bis 3 Punkte Höhenunterschied gelten als dieselbe Zeile
      if (r && r.page === st.page && Math.abs(r.y - st.y) <= 3) r.teile.push(st);
      else reihen.push({ page: st.page, y: st.y, teile: [st] });
    }
    return reihen.map(r => r.teile.sort((a, b) => a.x - b.x).map(t => t.s).join(' ').replace(/\s+/g, ' ').trim())
      .join(String.fromCharCode(10));
  }

  const api = { lieferantAusText, istEigen, keinName, istEigeneMail, EIGENE_VAT, textAusPdf, textAusItems };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(global, api);
})(typeof window !== 'undefined' ? window : globalThis);
