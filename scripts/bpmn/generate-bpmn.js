'use strict';
/**
 * BPMN-Generator: E-Rechnungs-Prozesse der DIHAG
 * ==============================================
 * Erzeugt die elf Modelle der E-Rechnung im Hausschema des RMS: drei
 * Hauptprozesse und acht Unterprozesse, die per Aufrufaktivität (⊞)
 * eingebunden sind. Jedes Modell hat eine feste Prozess-Kennung, Bahnen,
 * typisierte Aufgaben und Farben (bioc/color).
 *
 * Führend sind die Modelle im RMS (rms.dihag.de, Reiter Prozesse, Ablage
 * KONZERN). Die Seite prozess.html liest sie von dort. Dieser Generator ist
 * der Weg für den Erstimport und für größere Umbauten; danach wird im RMS
 * weitergepflegt.
 *
 * Aufruf:  node scripts/bpmn/generate-bpmn.js
 * Ausgabe: docs/bpmn/*.bpmn und docs/bpmn/modelle.json
 * Eingabe: docs/bpmn/rms-ids.json (Datei-Kennungen im RMS, nach dem Import)
 *
 * Raster: c = Spalte (von links), r = Zeile innerhalb der Bahn.
 */
const fs = require('fs');
const path = require('path');

/* ── Raster & Maße ─────────────────────────────────────────────────────── */
const COL_W = 170, ROW_H = 120;
const TASK_W = 132, TASK_H = 84, EV = 36, GW = 50;
const POOL_X = 100, POOL_HEAD = 30, LANE_HEAD = 30, POOL_GAP = 70, TOP = 60, BLACKBOX_H = 70;
const CONTENT_X = POOL_X + POOL_HEAD + LANE_HEAD + 20;

/* ── Farben (identisch zur Legende auf prozess.html) ───────────────────── */
const ACTOR = {
  extern: { lane: '#F6F7F9', fill: '#E9ECF0', stroke: '#5B6472' },  // Lieferant, Kunde, Bank
  auto:   { lane: '#F3F8FE', fill: '#D8E8F8', stroke: '#17509E' },  // Postfach & Power Automate
  api:    { lane: '#F8F5FD', fill: '#E6DDF7', stroke: '#5B3FA8' },  // Prüfdienst (Azure)
  archiv: { lane: '#F1FAF8', fill: '#D2EEE8', stroke: '#0F766E' },  // SharePoint, Monitoring, GoBD
  mensch: { lane: '#FFF8F1', fill: '#FFE3C8', stroke: '#C2410C' },  // Buchhaltung, Vertrieb, Treasury
  app:    { lane: '#F3F6FB', fill: '#DCE5F2', stroke: '#1A2644' },  // Browser-Apps (Konverter, MC-Converter)
  erp:    { lane: '#F7F7F6', fill: '#E6E6E4', stroke: '#424241' },  // ERP, MultiCash, Versand
};
const TONE = {
  ok:   { fill: '#DDF3E4', stroke: '#1E7B3A' },
  warn: { fill: '#FFF1CC', stroke: '#A65F00' },
  err:  { fill: '#FDE2E1', stroke: '#B42318' },
  gate: { fill: '#FFF8DB', stroke: '#8A6100' },
  plan: { fill: '#F1F1F3', stroke: '#8A8F98' },
};

/* ── Elementarten (Hausschema: Aufgaben sind 👤 user, ⚙ service oder ✋ manual) ── */
const KIND = {
  start:       { tag: 'startEvent',  size: 'ev' },
  msgStart:    { tag: 'startEvent',  size: 'ev', def: 'message' },
  end:         { tag: 'endEvent',    size: 'ev' },
  errEnd:      { tag: 'endEvent',    size: 'ev', def: 'error' },
  boundaryErr: { tag: 'boundaryEvent', size: 'ev', def: 'error' },
  service:     { tag: 'serviceTask', size: 'task' },
  user:        { tag: 'userTask',    size: 'task' },
  manual:      { tag: 'manualTask',  size: 'task' },
  call:        { tag: 'callActivity', size: 'task' },
  gw:          { tag: 'exclusiveGateway', size: 'gw' },
  gwInc:       { tag: 'inclusiveGateway', size: 'gw' },
  gwPar:       { tag: 'parallelGateway',  size: 'gw' },
};

const R = b => b.x + b.w, B = b => b.y + b.h, CX = b => b.x + b.w / 2, CY = b => b.y + b.h / 2;
const rnd = v => Math.round(v);
const isGw = n => KIND[n.k].size === 'gw';
const sizeOf = k => (KIND[k].size === 'ev' ? [EV, EV] : KIND[k].size === 'gw' ? [GW, GW] : [TASK_W, TASK_H]);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colorOf(n, actor) {
  if (n.tone) return TONE[n.tone];
  if (n.k === 'start' || n.k === 'msgStart' || n.k === 'end') return TONE.ok;
  if (n.k === 'errEnd' || n.k === 'boundaryErr') return TONE.err;
  if (isGw(n)) return TONE.gate;
  const a = ACTOR[actor] || ACTOR.app;
  return { fill: a.fill, stroke: a.stroke };
}
const colorAttrs = c => (c
  ? ` bioc:stroke="${c.stroke}" bioc:fill="${c.fill}" color:background-color="${c.fill}" color:border-color="${c.stroke}"`
  : '');

/* Kurzschreibweise für Sequenzflüsse: F(von, nach, Beschriftung, Optionen) */
const F = (from, to, name, o) => ({ from, to, name: name || '', o: o || {} });

const ANSICHT = 'https://e-rechnung.dihag-extern.com/prozess.html';

/* ═════════════════════════════════════════════════════════════════════════
 *  HAUPTPROZESSE
 * ═════════════════════════════════════════════════════════════════════════ */

const EINGANG = {
  key: 'eingang', file: '01-rechnungseingang.bpmn', tab: 'eingang', haupt: true,
  name: 'E-Rechnung Rechnungseingang', kennung: 'Process_ERechnung_Eingang',
  doku: 'Eingangsrechnungen kommen per Mail ins Rechnungspostfach des Werks. Ein Flow je Werk (WGC, SHB, ZAI, HOL, LEG, EWA) gibt jeden PDF- oder XML-Anhang an den Prüfdienst und legt Original und Prüfergebnis in ERAR_<Werk> ab. Bei WGC und SHB arbeitet die Buchhaltung direkt im Monitoring (seit 05.11.2026 ohne die alte Eingangsrechnungsliste), die anderen Werke schicken eine Archiv-Mail ins eigene Postfach. Die Kreditorenbuchhaltung prüft im Monitoring und schätzt sonstige Rechnungen ein. WGC und SHB holen die Freigabe im Monitoring ein und buchen dann. ZAI, HOL, LEG, EWA, EIS und DSO erfassen im SAP, dort läuft auch die Genehmigung, die Rechnung geht nicht noch einmal durchs Monitoring.',
  pools: [
    { id: 'P_Lief', name: 'Lieferant', actor: 'extern', blackbox: true },
    {
      id: 'P_Ein', name: 'DIHAG · Rechnungseingang (eigener Flow je Werk: WGC, SHB, ZAI, HOL, LEG, EWA)', main: true,
      lanes: [
        { id: 'LA', name: 'Werks-Postfach & Power Automate', actor: 'auto' },
        { id: 'LB', name: 'Prüfdienst (Azure)', actor: 'api' },
        { id: 'LC', name: 'SharePoint & Monitoring', actor: 'archiv' },
        { id: 'LD', name: 'Kreditorenbuchhaltung', actor: 'mensch' },
      ],
      nodes: [
        { id: 'A_start', k: 'msgStart', n: 'Neue Mail mit Anhang im Werks-Postfach', lane: 'LA', c: 1, r: 0 },
        { id: 'A_gw', k: 'gw', n: 'Eigene Archiv-Mail („[ARCHIV]“ im Betreff)?', lane: 'LA', c: 2, r: 0 },
        { id: 'A_move', k: 'service', n: 'Archiv-Mail nach „ArchiviertUndGeprueft“ verschieben', lane: 'LA', c: 3, r: 1 },
        { id: 'A_endArch', k: 'end', n: 'einsortiert', lane: 'LA', c: 4, r: 1 },
        { id: 'A_att', k: 'service', n: 'Nur PDF- und XML-Anhänge weitergeben', lane: 'LA', c: 5, r: 0 },
        { id: 'B_intake', k: 'call', ref: 'intake', n: 'Eingangsprüfung (/api/intake)', lane: 'LB', c: 6, r: 0 },
        { id: 'C_orig', k: 'service', n: 'Original in ERAR_<Werk> ablegen (Name: Nummer_USt-IdNr)', lane: 'LC', c: 7, r: 0 },
        { id: 'C_meta', k: 'service', n: 'Metadaten setzen (Lieferant, Konformität, Buchung, Prüf-Flags, Mail-Vorgang)', lane: 'LC', c: 8, r: 0 },
        { id: 'C_side', k: 'call', ref: 'neben', n: 'Nebendateien ablegen', lane: 'LC', c: 9, r: 0 },
        { id: 'A_gwErr', k: 'gw', n: 'Ergebnis rot oder falsches Werk?', lane: 'LA', c: 10, r: 0 },
        { id: 'A_liefMail', k: 'service', n: 'Lieferanten-Mail mit Prüfbericht senden', lane: 'LA', c: 12, r: 1, tone: 'plan' },
        { id: 'A_gwWerk', k: 'gw', n: 'Welches Werk?', lane: 'LA', c: 13, r: 0 },
        // ZAI, HOL, LEG, EWA: Übergabe über das Postfach
        { id: 'A_merk', k: 'service', n: 'Datei für die Archiv-Mail vormerken', lane: 'LA', c: 14, r: 0 },
        { id: 'A_archSend', k: 'service', n: 'Archiv-Mail je E-Rechnung an das eigene Postfach senden', lane: 'LA', c: 18, r: 0 },
        // Kreditorenbuchhaltung
        { id: 'D_check', k: 'user', n: 'Rechnung prüfen und im Monitoring als geprüft markieren', lane: 'LD', c: 19, r: 0 },
        { id: 'D_gw', k: 'gw', n: 'Buchungsweg laut Prüfergebnis?', lane: 'LD', c: 20, r: 0, lp: 'below' },
        { id: 'D_4eyes', k: 'user', n: 'Im Vier-Augen-Prinzip prüfen (Reverse-Charge, innergem., steuerfrei)', lane: 'LD', c: 21, r: 1, tone: 'warn' },
        { id: 'D_800', k: 'call', ref: 'einschaetzung', n: 'Sonstige Rechnung einschätzen (800.000 €, Kleinbetrag, Ausland)', lane: 'LD', c: 21, r: 2 },
        { id: 'D_rej', k: 'user', n: 'Nicht buchen, Zurückweisung an den Lieferanten senden', lane: 'LD', c: 21, r: 3, tone: 'err' },
        { id: 'E_rej', k: 'end', n: 'zurückgewiesen', lane: 'LD', c: 22, r: 3, tone: 'err' },
        { id: 'D_gwAnn', k: 'gw', n: 'Rechnung angenommen?', lane: 'LD', c: 22, r: 2, lp: 'below' },
        { id: 'E_rueck', k: 'end', n: 'zurückgesandt (Variante 1)', lane: 'LD', c: 23, r: 2, tone: 'warn' },
        { id: 'D_gwWo', k: 'gw', n: 'Wo wird genehmigt?', lane: 'LD', c: 22, r: 0 },
        { id: 'D_frei', k: 'call', ref: 'freigabe', n: 'Eingangsrechnung freigeben (Genehmigung)', lane: 'LD', c: 23, r: 0 },
        { id: 'D_gwFrei', k: 'gw', n: 'Freigegeben?', lane: 'LD', c: 24, r: 0 },
        { id: 'D_klaer', k: 'user', n: 'Ablehnung mit dem Genehmiger klären', lane: 'LD', c: 25, r: 1, tone: 'err' },
        { id: 'E_abl', k: 'end', n: 'nicht gebucht (abgelehnt)', lane: 'LD', c: 26, r: 2, tone: 'err' },
        { id: 'D_book', k: 'manual', n: 'Im ERP erfassen und buchen', lane: 'LD', c: 25, r: 0 },
        { id: 'D_gwRf', k: 'gw', n: 'Rückfrage-Flag gesetzt?', lane: 'LD', c: 26, r: 0 },
        { id: 'E_ok', k: 'end', n: 'gebucht', lane: 'LD', c: 27, r: 0 },
        { id: 'D_kred', k: 'user', n: 'Rückfrage an den Lieferanten senden', lane: 'LD', c: 27, r: 1 },
        { id: 'E_kred', k: 'end', n: 'gebucht, Rückfrage gestellt', lane: 'LD', c: 28, r: 1, tone: 'warn' },
      ],
      flows: [
        F('A_start', 'A_gw'),
        F('A_gw', 'A_move', 'ja'),
        F('A_move', 'A_endArch'),
        F('A_gw', 'A_att', 'nein'),
        F('A_att', 'B_intake'),
        F('B_intake', 'C_orig'),
        F('C_orig', 'C_meta'),
        F('C_meta', 'C_side'),
        F('C_side', 'A_gwErr'),
        F('A_gwErr', 'A_liefMail', 'ja'),
        F('A_liefMail', 'A_gwWerk', '', { via: 'joinLeft' }),
        F('A_gwErr', 'A_gwWerk', 'nein'),
        F('A_gwWerk', 'A_merk', 'ZAI, HOL, LEG, EWA'),
        F('A_gwWerk', 'D_check', 'WGC, SHB'),
        F('A_merk', 'A_archSend', 'nach allen Anhängen'),
        F('A_archSend', 'D_check'),
        F('D_check', 'D_gw'),
        F('D_gw', 'D_gwWo', 'Automatik'),
        F('D_gw', 'D_4eyes', 'manuell'),
        F('D_gw', 'D_800', 'unter Vorbehalt'),
        F('D_gw', 'D_rej', 'zurückgewiesen'),
        F('D_4eyes', 'D_gwWo', 'geprüft', { in: 'bottom' }),
        F('D_800', 'D_gwAnn'),
        F('D_gwAnn', 'D_gwWo', 'ja'),
        F('D_gwAnn', 'E_rueck', 'nein'),
        F('D_rej', 'E_rej'),
        F('D_gwWo', 'D_frei', 'Monitoring'),
        F('D_gwWo', 'D_book', 'SAP', { via: 'above', gap: 12 }),
        F('D_frei', 'D_gwFrei'),
        F('D_gwFrei', 'D_book', 'ja'),
        F('D_gwFrei', 'D_klaer', 'nein'),
        F('D_klaer', 'E_abl'),
        F('D_book', 'D_gwRf'),
        F('D_gwRf', 'E_ok', 'nein'),
        F('D_gwRf', 'D_kred', 'ja'),
        F('D_kred', 'E_kred'),
      ],
      annotations: [
        { id: 'N_arch', of: 'A_move', lane: 'LA', c: 3, r: 2, w: 300, h: 72,
          text: 'ZAI, HOL, LEG, EWA. Schleifenschutz: Die eigene Archiv-Mail kommt hier wieder an und wird nur einsortiert. In diesem Ordner arbeitet die Buchhaltung.' },
        { id: 'N_lief', of: 'A_liefMail', lane: 'LA', c: 12, r: 2, w: 220, h: 84, tone: 'plan',
          text: 'Bei Zurückweisung oder Abweichung. Empfänger aus der E-Rechnung. Der Schalter „Lieferantenmails“ steht noch auf aus.' },
        { id: 'N_archSend', of: 'A_archSend', lane: 'LA', c: 17, r: 1, w: 300, h: 72,
          text: 'HOL, LEG, EWA: eine Archiv-Mail je E-Rechnung, die übrigen PDFs der Mail kommen mit. ZAI noch je Anhang. Die Originalmail bleibt im Posteingang.' },
        { id: 'N_wgc', of: 'A_gwWerk', lane: 'LA', c: 14, r: 1, w: 260, h: 72,
          text: 'WGC und SHB: seit 05.11.2026 ohne die alte Eingangsrechnungsliste. Die Buchhaltung arbeitet im Monitoring.' },
        { id: 'N_check', of: 'D_check', lane: 'LD', c: 19, r: 1, w: 220, h: 62,
          text: '„Als geprüft markieren“ speichert, wer wann geprüft hat.' },
        { id: 'N_status', of: 'D_check', lane: 'LD', c: 17, r: 1, w: 250, h: 96,
          text: 'WGC und SHB: Spalte „Status“ hinter dem Steller. Ohne Eintrag „Offen“ (hell, automatisch), „In Genehmigung“ durch die Anforderung ebenfalls hell. Von der Buchhaltung gesetzt: kräftig.' },
        { id: 'N_800', of: 'D_800', lane: 'LD', c: 19, r: 3, w: 220, h: 84,
          text: 'Kleinbetrag bis 250 € und Lieferant im Ausland sind ausgenommen. Die Mail an den Lieferanten geht aus dem Werks-Postfach.' },
        { id: 'N_wo', of: 'D_gwWo', lane: 'LD', c: 23, r: 1, w: 160, h: 96,
          text: 'Im SAP wird erfasst und genehmigt, im Monitoring ist danach nichts zu tun. Im SAP: ZAI, HOL, LEG, EWA, EIS und DSO. Im Monitoring: WGC und SHB.' },
        { id: 'N_kred', of: 'D_kred', lane: 'LD', c: 27, r: 2, w: 250, h: 72, tone: 'plan',
          text: 'Heute schickt die Buchhaltung die Rückfrage selbst. Mit dem Schalter „Lieferantenmails“ übernimmt das der Eingangs-Flow.' },
      ],
      groups: [
        { id: 'G_anhang', label: 'wiederholt sich je Anhang (PDF oder XML)',
          members: ['A_att', 'B_intake', 'C_orig', 'C_meta', 'C_side', 'A_gwErr', 'A_liefMail', 'A_gwWerk', 'A_merk',
                    'N_lief', 'N_wgc'] },
      ],
    },
  ],
  messages: [
    { from: 'P_Lief', to: 'A_start', name: 'Rechnung (PDF oder XML)' },
    { from: 'A_liefMail', to: 'P_Lief', name: 'Zurückweisung oder Abweichung (geplant)' },
    { from: 'D_rej', to: 'P_Lief', name: 'Zurückweisung', dx: 86 },
    { from: 'D_kred', to: 'P_Lief', name: 'Rückfrage', dx: 40 },
  ],
};

const AUSGANG = {
  key: 'ausgang', file: '02-rechnungsausgang.bpmn', tab: 'ausgang', haupt: true,
  name: 'E-Rechnung Rechnungsausgang', kennung: 'Process_ERechnung_Ausgang',
  doku: 'Ausgangsrechnungen entstehen im ERP als PDF oder im Reiter „Manuelle Rechnung“ aus einer Vorlage. Der Konverter liest das PDF (Parser für WGC, SHB, ZAI, EIS, EWA, LEG, MEG), prüft die Daten, erzeugt ZUGFeRD oder XRechnung, legt alles in AR_<Werk> ab und bereitet die Mail an den Kunden vor. Werke, die über EDIzone senden, laufen außerhalb dieses Tools.',
  pools: [
    { id: 'P_Kunde', name: 'Kunde', actor: 'extern', blackbox: true },
    {
      id: 'P_Aus', name: 'DIHAG · Rechnungsausgang (je Werk)', main: true,
      lanes: [
        { id: 'LV', name: 'Versand / Lager', actor: 'erp' },
        { id: 'LF', name: 'Vertrieb / Fakturierung', actor: 'mensch', rows: 2 },
        { id: 'LK', name: 'Konverter (Browser-App)', actor: 'app', rows: 2 },
        { id: 'LS', name: 'SharePoint & Monitoring', actor: 'archiv' },
      ],
      nodes: [
        { id: 'V_start', k: 'start', n: 'Lieferung oder Leistung erbracht', lane: 'LV', c: 0, r: 0 },
        { id: 'V_wa', k: 'manual', n: 'Warenausgang buchen (bei Warenlieferung)', lane: 'LV', c: 1, r: 0 },
        { id: 'F_gwErp', k: 'gw', n: 'Rechnung im ERP?', lane: 'LF', c: 2, r: 0 },
        { id: 'F_fakt', k: 'user', n: 'Faktura im ERP anlegen und PDF erzeugen', lane: 'LF', c: 3, r: 0 },
        { id: 'F_gwSap', k: 'gw', n: 'Versand über EDIzone (SAP)?', lane: 'LF', c: 4, r: 0 },
        { id: 'F_edi', k: 'service', n: 'E-Rechnung über EDIzone senden (eigener SAP-Prozess)', lane: 'LF', c: 5, r: 1, tone: 'plan' },
        { id: 'F_endEdi', k: 'end', n: 'über EDIzone versendet', lane: 'LF', c: 6, r: 1 },
        { id: 'K_vorl', k: 'user', n: 'Rechnung im Reiter „Manuelle Rechnung“ aus einer Vorlage anlegen', lane: 'LK', c: 3, r: 2 },
        { id: 'K_upload', k: 'user', n: 'PDF in den Konverter laden', lane: 'LK', c: 5, r: 0 },
        { id: 'K_erk', k: 'call', ref: 'erfassen', n: 'Erkennen und erfassen', lane: 'LK', c: 6, r: 0 },
        { id: 'K_exp', k: 'call', ref: 'erzeugen', n: 'Prüfen und E-Rechnung erzeugen', lane: 'LK', c: 7, r: 0 },
        { id: 'K_bErr', k: 'boundaryErr', n: 'Prüfung nicht bestanden', lane: 'LK', attachedTo: 'K_exp' },
        { id: 'K_fix', k: 'user', n: 'Daten korrigieren', lane: 'LK', c: 6, r: 1, tone: 'warn' },
        { id: 'S_abl', k: 'service', n: 'E-Rechnung, lesbares PDF und Prüfpfad in AR_<Werk> ablegen', lane: 'LS', c: 8, r: 0 },
        { id: 'S_meta', k: 'service', n: 'Metadaten setzen (Ausgang, Format, konform, USt-IdNr.-Nachweis)', lane: 'LS', c: 9, r: 0 },
        { id: 'K_mail', k: 'user', n: 'Mail-Entwurf mit Anhang erstellen (Outlook oder .eml)', lane: 'LK', c: 10, r: 0 },
        { id: 'F_send', k: 'user', n: 'Rechnung an den Kunden senden', lane: 'LF', c: 11, r: 0 },
        { id: 'F_end', k: 'end', n: 'versendet', lane: 'LF', c: 12, r: 0 },
      ],
      flows: [
        F('V_start', 'V_wa'),
        F('V_wa', 'F_gwErp'),
        F('F_gwErp', 'F_fakt', 'ja'),
        F('F_gwErp', 'K_vorl', 'nein'),
        F('F_fakt', 'F_gwSap'),
        F('F_gwSap', 'F_edi', 'ja'),
        F('F_edi', 'F_endEdi'),
        F('F_gwSap', 'K_upload', 'nein'),
        F('K_upload', 'K_erk'),
        F('K_erk', 'K_exp'),
        F('K_vorl', 'K_exp', '', { in: 'bottom' }),
        F('K_bErr', 'K_fix'),
        F('K_fix', 'K_erk', 'erneut'),
        F('K_exp', 'S_abl'),
        F('S_abl', 'S_meta'),
        F('S_meta', 'K_mail'),
        F('K_mail', 'F_send'),
        F('F_send', 'F_end'),
      ],
      annotations: [
        { id: 'N_edi', of: 'F_edi', lane: 'LF', c: 5, r: 2, w: 300, h: 56, tone: 'plan',
          text: 'Gilt nicht für EIS, EWA und LEG: Ihre SAP-Belege wandelt der Konverter.' },
        { id: 'N_vorl', of: 'K_vorl', lane: 'LK', c: 3, r: 3, w: 300, h: 72,
          text: 'HOL und EIS: Umlagen, Weiterbelastungen, Dienstleistungen. Nummer aus dem Nummernkreis, abgeglichen mit AR_<Werk>.' },
        { id: 'N_abl', of: 'S_abl', lane: 'LS', c: 8, r: 1, w: 300, h: 56,
          text: 'Ablegen darf, wer im Werk FIBU oder Vertrieb ist (Mitwirken auf AR_<Werk>).' },
        { id: 'N_mail', of: 'K_mail', lane: 'LK', c: 10, r: 1, w: 260, h: 72,
          text: 'Die Rechnungsadresse des Kunden ist gemerkt. Alternativ Datei herunterladen und im Kundenportal hochladen.' },
      ],
    },
  ],
  messages: [
    { from: 'F_send', to: 'P_Kunde', name: 'E-Rechnung (ZUGFeRD oder XRechnung)' },
  ],
};

const ZAHLUNG = {
  key: 'zahlung', file: '03-zahlungsausgang-mc-converter.bpmn', tab: 'zahlung', haupt: true,
  name: 'Zahlungsausgang (MC-Converter)', kennung: 'Process_Zahlungsausgang_MC',
  doku: 'Zahldateien aus ERP und MultiCash gehen durch den MC-Converter: SEPA-Überweisungen werden zu pain.001.001.09, Auslandszahlungen im DTAZV-Format zu pain.001.001.09 AXZ. Erst nach grünem Preflight lädt die Treasury hoch.',
  pools: [
    {
      id: 'P_Zahl', name: 'DIHAG · Zahlungslauf (je Werk)', main: true,
      lanes: [
        { id: 'LE', name: 'ERP / MultiCash', actor: 'erp' },
        { id: 'LM', name: 'MC-Converter (Browser-App)', actor: 'app', rows: 2 },
        { id: 'LT', name: 'Treasury / Buchhaltung', actor: 'mensch' },
      ],
      nodes: [
        { id: 'Z_start', k: 'start', n: 'Zahllauf ist fällig', lane: 'LE', c: 0, r: 0 },
        { id: 'Z_vor', k: 'user', n: 'Zahlungsvorschlag erstellen und freigeben', lane: 'LE', c: 1, r: 0 },
        { id: 'Z_exp', k: 'service', n: 'Zahldatei exportieren (SEPA oder DTAZV)', lane: 'LE', c: 2, r: 0 },
        { id: 'M_load', k: 'user', n: 'Datei in den MC-Converter laden (Endung egal)', lane: 'LM', c: 3, r: 0 },
        { id: 'M_conv', k: 'call', ref: 'umstellen', n: 'Auf pain.001.001.09 umstellen', lane: 'LM', c: 4, r: 0 },
        { id: 'M_pre', k: 'call', ref: 'preflight', n: 'Preflight', lane: 'LM', c: 5, r: 0 },
        { id: 'M_gw', k: 'gw', n: 'Preflight grün?', lane: 'LM', c: 6, r: 0 },
        { id: 'T_fix', k: 'user', n: 'Ursache im ERP oder in MultiCash korrigieren', lane: 'LT', c: 6, r: 0, tone: 'warn' },
        { id: 'M_dl', k: 'service', n: 'pain.001.001.09 herunterladen', lane: 'LM', c: 7, r: 0 },
        { id: 'T_up', k: 'user', n: 'Per EBICS hochladen (CCT oder AXZ) und im Vier-Augen-Prinzip freigeben', lane: 'LT', c: 8, r: 0 },
        { id: 'T_end', k: 'end', n: 'Zahlung beauftragt', lane: 'LT', c: 9, r: 0 },
      ],
      flows: [
        F('Z_start', 'Z_vor'), F('Z_vor', 'Z_exp'),
        F('Z_exp', 'M_load'),
        F('M_load', 'M_conv'), F('M_conv', 'M_pre'), F('M_pre', 'M_gw'),
        F('M_gw', 'M_dl', 'ja'),
        F('M_gw', 'T_fix', 'nein'),
        F('T_fix', 'Z_exp', 'neu exportieren', { via: 'left' }),
        F('M_dl', 'T_up'),
        F('T_up', 'T_end'),
      ],
      annotations: [
        { id: 'N_local', of: 'M_load', lane: 'LM', c: 3, r: 1, w: 280, h: 56,
          text: 'Läuft komplett im Browser. Die Zahldatei verlässt den Rechner nicht.' },
      ],
    },
    { id: 'P_Bank', name: 'Hausbank', actor: 'extern', blackbox: true },
  ],
  messages: [
    { from: 'T_up', to: 'P_Bank', name: 'pain.001.001.09 (CCT oder AXZ)' },
  ],
};

/* ═════════════════════════════════════════════════════════════════════════
 *  UNTERPROZESSE (eigene Modelle, eingebunden per ⊞)
 * ═════════════════════════════════════════════════════════════════════════ */

const INTAKE = {
  key: 'intake', file: '01a-eingangspruefung.bpmn', tab: 'eingang', von: 'eingang',
  name: 'E-Rechnung Eingangsprüfung', kennung: 'Process_ERechnung_Eingangspruefung',
  doku: 'Der Prüfdienst /api/intake prüft jeden Anhang: Art erkennen, PDF/A-Hülle und eingebettete XML (ZUGFeRD) oder XRechnung validieren, Kopfdaten lesen, Steuerkategorie und Abgleich PDF zu XML bewerten. Rot wird zurückgewiesen, gelb unter Vorbehalt gebucht. Ergebnis ist ein JSON mit Buchungsweg, Prüf-Flags und bei Bedarf der Lieferanten-Mail.',
  pools: [{
    id: 'P_Intake', name: 'Eingangsprüfung', main: true,
    lanes: [{ id: 'LI', name: 'Prüfdienst (Azure)', actor: 'api' }],
    nodes: [
      // Band 1: Art erkennen und validieren
      { id: 'I_start', k: 'start', n: 'Anhang vom Flow', lane: 'LI', c: 0, r: 2 },
      { id: 'I_norm', k: 'service', n: 'Inhalt erkennen (PDF, XML, base64 oder Flow-Hülle)', lane: 'LI', c: 1, r: 2 },
      { id: 'I_gwTyp', k: 'gw', n: 'PDF oder XML?', lane: 'LI', c: 2, r: 2 },
      { id: 'I_pdfa', k: 'service', n: 'PDF/A-Hülle mit veraPDF prüfen', lane: 'LI', c: 3, r: 2 },
      { id: 'I_extract', k: 'service', n: 'Eingebettete XML suchen', lane: 'LI', c: 4, r: 2 },
      { id: 'I_gwEinv', k: 'gw', n: 'Echte E-Rechnung (CII oder UBL) eingebettet?', lane: 'LI', c: 5, r: 2 },
      { id: 'I_lief', k: 'service', n: 'Lieferant, USt-IdNr., Nummer und Datum aus dem PDF-Text lesen', lane: 'LI', c: 6, r: 1, tone: 'warn' },
      { id: 'I_sonst', k: 'service', n: 'Sonstige Rechnung: unter Vorbehalt, Berichtigung anfordern', lane: 'LI', c: 7, r: 1, tone: 'warn' },
      { id: 'I_endSonst', k: 'end', n: 'Ergebnis: sonstige Rechnung', lane: 'LI', c: 8, r: 0, tone: 'warn' },
      { id: 'I_zf', k: 'service', n: 'Als ZUGFeRD einordnen', lane: 'LI', c: 6, r: 2 },
      { id: 'I_mustang', k: 'service', n: 'Tatsächliches Profil mit Mustang prüfen (mit Prüfbericht)', lane: 'LI', c: 7, r: 2 },
      { id: 'I_gwMin', k: 'gw', n: 'Profil MINIMUM oder BASIC-WL, oder Prüfung rot?', lane: 'LI', c: 8, r: 2 },
      { id: 'I_rej', k: 'service', n: 'Als keine E-Rechnung zurückweisen (harter Stopp)', lane: 'LI', c: 9, r: 1, tone: 'err' },
      { id: 'I_endRej', k: 'end', n: 'Ergebnis: zurückgewiesen', lane: 'LI', c: 10, r: 1, tone: 'err' },
      { id: 'I_gwPdfa', k: 'gw', n: 'PDF/A-3 in Ordnung?', lane: 'LI', c: 9, r: 2 },
      { id: 'I_fm', k: 'service', n: 'Formatmangel: unter Vorbehalt, Berichtigung anfordern', lane: 'LI', c: 10, r: 3, tone: 'warn' },
      { id: 'I_xr', k: 'service', n: 'Als XRechnung einordnen (reine XML)', lane: 'LI', c: 3, r: 4 },
      { id: 'I_kosit', k: 'service', n: 'XRechnung / EN 16931 mit KoSIT prüfen (mit Prüfbericht)', lane: 'LI', c: 4, r: 4 },
      { id: 'I_gwKr', k: 'gw', n: 'Prüfung rot?', lane: 'LI', c: 5, r: 4 },
      { id: 'I_rejX', k: 'service', n: 'Als ungültige E-Rechnung zurückweisen', lane: 'LI', c: 6, r: 3, tone: 'err' },
      { id: 'I_endRejX', k: 'end', n: 'Ergebnis: XRechnung zurückgewiesen', lane: 'LI', c: 7, r: 3, tone: 'err' },
      { id: 'I_daten', k: 'service', n: 'Kopfdaten lesen (Nummer, Datum, Beträge, Steuerkategorie)', lane: 'LI', c: 11, r: 2 },
      // Band 2: Regelwerk
      { id: 'I_werk', k: 'service', n: 'Richtung und Werk bestimmen (mit Empfänger-Gegenprobe)', lane: 'LI', c: 0, r: 8 },
      { id: 'I_gwSt', k: 'gw', n: 'Steuerkategorie AE, K, G, E oder O?', lane: 'LI', c: 1, r: 8 },
      { id: 'I_man', k: 'service', n: 'Buchungsweg „manuell“ setzen (Vier-Augen-Prüfung nötig)', lane: 'LI', c: 2, r: 9, tone: 'warn' },
      { id: 'I_gwZf', k: 'gw', n: 'Quelle ZUGFeRD?', lane: 'LI', c: 3, r: 8 },
      { id: 'I_abgl', k: 'service', n: 'PDF und XML abgleichen (Nummer, Steuer, Brutto, rundungstolerant)', lane: 'LI', c: 4, r: 8 },
      { id: 'I_gwMat', k: 'gw', n: 'Materielle Abweichung?', lane: 'LI', c: 5, r: 8 },
      { id: 'I_rf', k: 'service', n: 'Rückfrage-Flag setzen (die XML bleibt maßgeblich)', lane: 'LI', c: 6, r: 9, tone: 'warn' },
      { id: 'I_gwGelb', k: 'gw', n: 'Warnungen (gelb)?', lane: 'LI', c: 7, r: 8 },
      { id: 'I_vorb', k: 'service', n: 'Buchungsweg „unter Vorbehalt“ setzen', lane: 'LI', c: 8, r: 9, tone: 'warn' },
      { id: 'I_gwRend', k: 'gw', n: 'XRechnung-XML oder Formatmangel?', lane: 'LI', c: 9, r: 8 },
      { id: 'I_render', k: 'service', n: 'Lesbares PDF/A-3b aus der XML erzeugen', lane: 'LI', c: 10, r: 9 },
      { id: 'I_end', k: 'end', n: 'Prüfergebnis an den Flow (JSON)', lane: 'LI', c: 11, r: 8 },
    ],
    flows: [
      F('I_start', 'I_norm'), F('I_norm', 'I_gwTyp'),
      F('I_gwTyp', 'I_pdfa', 'PDF'), F('I_gwTyp', 'I_xr', 'XML'),
      F('I_pdfa', 'I_extract'), F('I_extract', 'I_gwEinv'),
      F('I_gwEinv', 'I_zf', 'ja'), F('I_gwEinv', 'I_lief', 'nein oder fremde XML'),
      F('I_lief', 'I_sonst'), F('I_sonst', 'I_endSonst'),
      F('I_zf', 'I_mustang'), F('I_mustang', 'I_gwMin'),
      F('I_gwMin', 'I_rej', 'ja'), F('I_rej', 'I_endRej'),
      F('I_gwMin', 'I_gwPdfa', 'nein'),
      F('I_gwPdfa', 'I_daten', 'ja'), F('I_gwPdfa', 'I_fm', 'nein'),
      F('I_fm', 'I_daten', '', { in: 'bottom' }),
      F('I_xr', 'I_kosit'), F('I_kosit', 'I_gwKr'),
      F('I_gwKr', 'I_rejX', 'ja'), F('I_rejX', 'I_endRejX'),
      F('I_gwKr', 'I_daten', 'nein', { via: 'below' }),
      F('I_daten', 'I_werk', '', { viaRow: 6 }),
      F('I_werk', 'I_gwSt'),
      F('I_gwSt', 'I_man', 'ja'), F('I_gwSt', 'I_gwZf', 'nein'), F('I_man', 'I_gwZf'),
      F('I_gwZf', 'I_abgl', 'ja'), F('I_gwZf', 'I_gwGelb', 'nein', { via: 'above', gap: 72 }),
      F('I_abgl', 'I_gwMat'),
      F('I_gwMat', 'I_rf', 'ja'), F('I_gwMat', 'I_gwGelb', 'nein'), F('I_rf', 'I_gwGelb', '', { via: 'joinLeft' }),
      F('I_gwGelb', 'I_vorb', 'ja'), F('I_gwGelb', 'I_gwRend', 'nein'), F('I_vorb', 'I_gwRend', '', { via: 'joinLeft' }),
      F('I_gwRend', 'I_render', 'ja'), F('I_gwRend', 'I_end', 'nein'), F('I_render', 'I_end'),
    ],
    annotations: [
      { id: 'IN_sonst', of: 'I_sonst', lane: 'LI', c: 3, r: 0, w: 420, h: 84,
        text: 'Auch fremde XML (z. B. openTRANS) zählt nicht als E-Rechnung. Die Kopfdaten aus dem Text sind ein Vorschlag, was unsicher ist, bleibt leer. Übergang: sonstige Rechnungen bis 31.12.2026 zulässig, bei Vorjahresumsatz bis 800.000 € bis 31.12.2027.' },
      { id: 'IN_kosit', of: 'I_kosit', lane: 'LI', c: 3, r: 5, w: 320, h: 56,
        text: 'Nur formale Verstöße (Leitweg-ID, elektronische Adresse) sind Hinweise und werten nicht ab.' },
      { id: 'IN_werk', of: 'I_werk', lane: 'LI', c: 0, r: 9, w: 225, h: 72,
        text: 'Ist eine DIHAG-Gesellschaft Verkäufer, gilt die Rechnung als Ausgang (Ablage in AR_<Werk>).' },
      { id: 'IN_end', of: 'I_end', lane: 'LI', c: 12, r: 9, w: 300, h: 72,
        text: 'Bei Zurückweisung oder Abweichung enthält das Ergebnis die Lieferanten-Mail: Empfänger aus der E-Rechnung, Text und Prüfbericht.' },
    ],
  }],
  messages: [],
};

const NEBEN = {
  key: 'neben', file: '01b-nebendateien.bpmn', tab: 'eingang', von: 'eingang',
  name: 'E-Rechnung Nebendateien ablegen', kennung: 'Process_ERechnung_Nebendateien',
  doku: 'Neben dem Original legt der Flow je nach Prüfergebnis das lesbare PDF, den KoSIT-Prüfbericht und bei ZUGFeRD die XML separat in ERAR_<Werk> ab.',
  pools: [{
    id: 'P_Neben', name: 'Nebendateien ablegen', main: true,
    lanes: [{ id: 'LN', name: 'SharePoint & Monitoring', actor: 'archiv' }],
    nodes: [
      { id: 'S_start', k: 'start', n: 'Prüfergebnis liegt vor', lane: 'LN', c: 0, r: 2 },
      { id: 'S_split', k: 'gwInc', n: 'Was liegt vor?', lane: 'LN', c: 1, r: 2 },
      { id: 'S_lesbar', k: 'service', n: 'Lesbares PDF als _lesbar.pdf ablegen', lane: 'LN', c: 2, r: 1 },
      { id: 'S_kosit', k: 'service', n: 'Prüfbericht als _KoSIT-Bericht.xml ablegen', lane: 'LN', c: 2, r: 2 },
      { id: 'S_xml', k: 'service', n: 'XML separat ablegen', lane: 'LN', c: 2, r: 3 },
      { id: 'S_join', k: 'gwInc', n: '', lane: 'LN', c: 3, r: 2 },
      { id: 'S_end', k: 'end', n: 'Nebendateien abgelegt', lane: 'LN', c: 4, r: 2 },
    ],
    flows: [
      F('S_start', 'S_split'),
      F('S_split', 'S_lesbar', 'lesbares PDF'), F('S_split', 'S_kosit', 'Prüfbericht'), F('S_split', 'S_xml', 'nur ZUGFeRD'),
      F('S_lesbar', 'S_join'), F('S_kosit', 'S_join'), F('S_xml', 'S_join'),
      F('S_join', 'S_end'),
    ],
    annotations: [
      { id: 'SN_lesbar', of: 'S_lesbar', lane: 'LN', c: 2, r: 0, w: 280, h: 56,
        text: 'Entsteht bei XRechnung-XML und bei ZUGFeRD mit Formatmangel. Das Original bleibt immer erhalten.' },
      { id: 'SN_xml', of: 'S_xml', lane: 'LN', c: 2, r: 4, w: 280, h: 56,
        text: 'Bei reiner XRechnung ist das Original schon die XML, darum keine zweite Datei.' },
    ],
  }],
  messages: [],
};

const EINSCHAETZUNG = {
  key: 'einschaetzung', file: '01c-einschaetzung.bpmn', tab: 'eingang', von: 'eingang',
  name: 'E-Rechnung Sonstige Rechnung einschätzen', kennung: 'Process_ERechnung_Einschaetzung',
  doku: 'Für eine sonstige Rechnung (PDF ohne E-Rechnung) klärt die Kreditorenbuchhaltung im 800k-Dialog des Monitorings, ob der Lieferant eine E-Rechnung schicken muss. Ausgenommen sind Kleinbeträge bis 250 € brutto und Lieferanten im Ausland. Sonst schätzt sie den Vorjahresumsatz des Lieferanten gegen die Grenze von 800.000 € ein, und ein Flow schickt die passende Mail aus dem Werks-Postfach. Einschätzung, Bestätigungen und Mailaufträge stehen im Lieferantenregister und in der Liste KreditorMails.',
  pools: [
    {
      id: 'P_Ein8', name: 'Sonstige Rechnung einschätzen (800k-Dialog im Monitoring)', main: true,
      lanes: [
        { id: 'LM8', name: 'SharePoint & Monitoring', actor: 'archiv' },
        { id: 'LK8', name: 'Kreditorenbuchhaltung', actor: 'mensch' },
        { id: 'LP8', name: 'Power Automate (Werks-Postfach)', actor: 'auto' },
      ],
      nodes: [
        { id: 'E8_start', k: 'start', n: 'Sonstige Rechnung unter Vorbehalt', lane: 'LM8', c: 0, r: 0 },
        { id: 'E8_reg', k: 'service', n: 'Lieferant im Lieferantenregister nachschlagen', lane: 'LM8', c: 1, r: 0 },
        { id: 'E8_aus', k: 'service', n: 'Hinweise auf Ausland prüfen (Land im Kopf, IBAN, USt-IdNr.)', lane: 'LM8', c: 2, r: 0 },
        { id: 'E8_lief', k: 'user', n: 'Lieferant prüfen und bestätigen', lane: 'LK8', c: 3, r: 0 },
        { id: 'E8_gwKlein', k: 'gw', n: 'Kleinbetrag bis 250 € brutto?', lane: 'LK8', c: 4, r: 0 },
        { id: 'E8_klein', k: 'user', n: 'Kleinbetrag bestätigen', lane: 'LK8', c: 4, r: 1 },
        { id: 'E8_endKlein', k: 'end', n: 'ausgenommen: Kleinbetrag', lane: 'LK8', c: 4, r: 2 },
        { id: 'E8_gwAus', k: 'gw', n: 'Lieferant im Ausland?', lane: 'LK8', c: 5, r: 0 },
        { id: 'E8_ausBest', k: 'user', n: 'Ausland bestätigen', lane: 'LK8', c: 5, r: 1 },
        { id: 'E8_endAus', k: 'end', n: 'ausgenommen: Lieferant im Ausland', lane: 'LK8', c: 5, r: 2 },
        { id: 'E8_umsatz', k: 'user', n: 'Vorjahresumsatz des Lieferanten einschätzen (über oder bis 800.000 €)', lane: 'LK8', c: 6, r: 0 },
        { id: 'E8_vorl', k: 'service', n: 'Vorlage nach Rechnungsjahr und Einschätzung vorschlagen', lane: 'LM8', c: 7, r: 0 },
        { id: 'E8_mail', k: 'user', n: 'Mail prüfen und „Speichern und senden“ wählen', lane: 'LK8', c: 8, r: 0 },
        { id: 'E8_auftrag', k: 'service', n: 'Mailauftrag in der Liste KreditorMails anlegen', lane: 'LM8', c: 9, r: 0 },
        { id: 'E8_send', k: 'service', n: 'Mail aus dem Werks-Postfach senden', lane: 'LP8', c: 10, r: 0 },
        { id: 'E8_status', k: 'service', n: 'Status setzen, „Lieferant informiert“ an der Rechnung zeigen', lane: 'LM8', c: 11, r: 0 },
        { id: 'E8_gwVar', k: 'gw', n: 'Vorlage Variante 1 (Rücksendung)?', lane: 'LM8', c: 12, r: 0 },
        { id: 'E8_endRueck', k: 'end', n: 'Rechnung zurückgesandt', lane: 'LM8', c: 13, r: 1, tone: 'warn' },
        { id: 'E8_endOk', k: 'end', n: 'Rechnung angenommen, Lieferant informiert', lane: 'LM8', c: 13, r: 0 },
      ],
      flows: [
        F('E8_start', 'E8_reg'), F('E8_reg', 'E8_aus'), F('E8_aus', 'E8_lief'), F('E8_lief', 'E8_gwKlein'),
        F('E8_gwKlein', 'E8_klein', 'ja'), F('E8_klein', 'E8_endKlein'),
        F('E8_gwKlein', 'E8_gwAus', 'nein'),
        F('E8_gwAus', 'E8_ausBest', 'ja'), F('E8_ausBest', 'E8_endAus'),
        F('E8_gwAus', 'E8_umsatz', 'nein'),
        F('E8_umsatz', 'E8_vorl'), F('E8_vorl', 'E8_mail'), F('E8_mail', 'E8_auftrag'),
        F('E8_auftrag', 'E8_send'), F('E8_send', 'E8_status'), F('E8_status', 'E8_gwVar'),
        F('E8_gwVar', 'E8_endRueck', 'ja'), F('E8_gwVar', 'E8_endOk', 'nein'),
      ],
      annotations: [
        { id: 'EN8_aus', of: 'E8_aus', lane: 'LM8', c: 1, r: 1, w: 300, h: 72,
          text: 'Aus dem Text der Rechnung, bei Scans per Texterkennung. Die IBAN zählt nur mit gültiger Prüfziffer und hinter „IBAN“.' },
        { id: 'EN8_vorl', of: 'E8_mail', lane: 'LK8', c: 6, r: 1, w: 320, h: 96,
          text: 'Rechnungsjahr 2026: Ankündigung oder Hinweis. 2027: über 800.000 € Variante 1 (Rücksendung), bis 800.000 € Variante 2 (Akzeptanz). Ab 2028 gilt die Pflicht für alle.' },
        { id: 'EN8_send', of: 'E8_send', lane: 'LP8', c: 11, r: 1, w: 280, h: 62,
          text: 'Flow „Kreditor-Mail senden“. Das Postfach je Werk steht im Flow, nicht in der Liste.' },
      ],
    },
    { id: 'P_Lief8', name: 'Lieferant', actor: 'extern', blackbox: true },
  ],
  messages: [
    { from: 'E8_send', to: 'P_Lief8', name: 'Ankündigung, Rücksendung oder Akzeptanz' },
  ],
};

const FREIGABE = {
  key: 'freigabe', file: '01d-freigabe.bpmn', tab: 'eingang', von: 'eingang',
  name: 'E-Rechnung Eingangsrechnung freigeben', kennung: 'Process_ERechnung_Freigabe',
  doku: 'Die Kreditorenbuchhaltung trägt im Monitoring Varialnummer, Kontierung und Bestellnummer ein und fordert die Genehmigung an. Ein Flow je Werk schickt die Rechnung mit PDF an den Genehmiger und schreibt die Antwort an die Rechnung. Bei Genehmigung geht auf Wunsch eine Info an die Adresse zum Austragen im abas, bei Ablehnung eine Mail an den, der angefordert hat. Das ersetzt die Eingangsrechnungslisten auf gruppe_wgc und gruppe_shb. Gilt für WGC und SHB. ZAI, HOL, LEG, EWA, EIS und DSO genehmigen im SAP.',
  pools: [{
    id: 'P_Frei', name: 'Eingangsrechnung freigeben (Monitoring und Genehmigungs-Flow je Werk)', main: true,
    lanes: [
      { id: 'LB9', name: 'Kreditorenbuchhaltung', actor: 'mensch' },
      { id: 'LS9', name: 'SharePoint & Monitoring', actor: 'archiv' },
      { id: 'LF9', name: 'Power Automate', actor: 'auto' },
      { id: 'LG9', name: 'Genehmiger', actor: 'mensch' },
    ],
    nodes: [
      { id: 'G_start', k: 'start', n: 'Rechnung zum Buchen bereit', lane: 'LB9', c: 1, r: 0 },
      { id: 'G_edit', k: 'user', n: 'Varialnummer, Kontierung und Bestellnummer eintragen', lane: 'LB9', c: 2, r: 0 },
      { id: 'G_anf', k: 'user', n: 'Genehmiger wählen und Genehmigung anfordern', lane: 'LB9', c: 3, r: 0 },
      { id: 'G_set', k: 'service', n: 'Anforderung an der Rechnung speichern (Status „In Genehmigung“)', lane: 'LS9', c: 4, r: 0 },
      { id: 'G_quit', k: 'service', n: 'Anforderung quittieren', lane: 'LF9', c: 5, r: 0 },
      { id: 'G_send', k: 'service', n: 'Genehmigung mit PDF an den Genehmiger senden', lane: 'LF9', c: 6, r: 0 },
      { id: 'G_pruef', k: 'user', n: 'Rechnung prüfen und genehmigen oder ablehnen', lane: 'LG9', c: 7, r: 0 },
      { id: 'G_gw', k: 'gw', n: 'Genehmigt?', lane: 'LF9', c: 8, r: 0 },
      { id: 'G_ja', k: 'service', n: 'Genehmigt, Genehmiger und Kommentar speichern', lane: 'LF9', c: 9, r: 0 },
      { id: 'G_gwAbas', k: 'gw', n: 'Info zum Austragen im abas angegeben?', lane: 'LF9', c: 10, r: 0 },
      { id: 'G_abas', k: 'service', n: 'Info mit PDF an die abas-Adresse senden', lane: 'LF9', c: 11, r: 1 },
      { id: 'G_vermerk', k: 'service', n: 'Info abas gesendet vermerken', lane: 'LF9', c: 12, r: 1 },
      { id: 'G_endJa', k: 'end', n: 'genehmigt', lane: 'LF9', c: 13, r: 0 },
      { id: 'G_nein', k: 'service', n: 'Abgelehnt und Kommentar speichern', lane: 'LF9', c: 9, r: 2 },
      { id: 'G_neinMail', k: 'service', n: 'Ablehnung an den Anfordernden melden', lane: 'LF9', c: 10, r: 2 },
      { id: 'G_endNein', k: 'end', n: 'abgelehnt', lane: 'LF9', c: 11, r: 2, tone: 'err' },
    ],
    flows: [
      F('G_start', 'G_edit'),
      F('G_edit', 'G_anf'), F('G_anf', 'G_set'), F('G_set', 'G_quit'), F('G_quit', 'G_send'),
      F('G_send', 'G_pruef'), F('G_pruef', 'G_gw'),
      F('G_gw', 'G_ja', 'ja'), F('G_gw', 'G_nein', 'nein'),
      F('G_ja', 'G_gwAbas'),
      F('G_gwAbas', 'G_abas', 'ja'), F('G_gwAbas', 'G_endJa', 'nein'),
      F('G_abas', 'G_vermerk'), F('G_vermerk', 'G_endJa'),
      F('G_nein', 'G_neinMail'), F('G_neinMail', 'G_endNein'),
    ],
    annotations: [
      { id: 'GN_start', of: 'G_start', lane: 'LB9', c: 1, r: 1, w: 150, h: 84,
        text: 'Nur WGC und SHB. ZAI, HOL, LEG, EWA, EIS und DSO genehmigen im SAP.' },
      { id: 'GN_anf', of: 'G_anf', lane: 'LB9', c: 2, r: 1, w: 220, h: 84,
        text: 'Mehrere Genehmiger mit „;“, dann gilt die erste Antwort. Die abas-Adresse ist je Werk vorbelegt.' },
      { id: 'GN_send', of: 'G_send', lane: 'LF9', c: 5, r: 1, w: 300, h: 84,
        text: 'Ein Flow je Werk, zum Beispiel „Genehmigung WGC (Monitoring)“. Er startet nur, wenn „Genehmigung anfordern“ gesetzt ist. Eine Genehmigung wartet höchstens 30 Tage.' },
    ],
  }],
  messages: [],
};

const ERFASSEN = {
  key: 'erfassen', file: '02a-erkennen-und-erfassen.bpmn', tab: 'ausgang', von: 'ausgang',
  name: 'E-Rechnung Erkennen und erfassen', kennung: 'Process_ERechnung_Erfassen',
  doku: 'Der Konverter liest das Rechnungs-PDF (bei Scans per Texterkennung), erkennt Werk und Layout, befüllt die Felder vor und schlägt die gemerkte Rechnungsadresse des Kunden vor. Der Vertrieb prüft und ergänzt.',
  pools: [{
    id: 'P_Erf', name: 'Erkennen und erfassen', main: true,
    lanes: [
      { id: 'LKK', name: 'Konverter (Browser-App)', actor: 'app' },
      { id: 'LKV', name: 'Vertrieb / Fakturierung', actor: 'mensch' },
    ],
    nodes: [
      { id: 'E_start', k: 'start', n: 'PDF hochgeladen', lane: 'LKK', c: 0, r: 1 },
      { id: 'E_gwText', k: 'gw', n: 'Textebene vorhanden?', lane: 'LKK', c: 1, r: 1 },
      { id: 'E_ocr', k: 'service', n: 'Text erkennen (OCR)', lane: 'LKK', c: 2, r: 2 },
      { id: 'E_werk', k: 'service', n: 'Werk erkennen, passenden Rechnungs-Parser wählen', lane: 'LKK', c: 3, r: 1 },
      { id: 'E_fill', k: 'service', n: 'Felder vorbefüllen, Verkäufer-Stammdaten sperren', lane: 'LKK', c: 4, r: 1 },
      { id: 'E_check', k: 'user', n: 'Daten prüfen und ergänzen (Belegart, Zahlungsart, Leitweg-ID)', lane: 'LKV', c: 5, r: 0 },
      { id: 'E_gwEU', k: 'gw', n: 'Kunde im EU-Ausland mit USt-IdNr?', lane: 'LKK', c: 6, r: 1 },
      { id: 'E_vat', k: 'service', n: 'USt-IdNr qualifiziert prüfen (BZSt / VIES) und Nachweis sichern', lane: 'LKK', c: 7, r: 2 },
      { id: 'E_fmt', k: 'user', n: 'Format wählen (ZUGFeRD als Standard oder XRechnung)', lane: 'LKV', c: 8, r: 0 },
      { id: 'E_end', k: 'end', n: 'Daten vollständig', lane: 'LKK', c: 9, r: 1 },
    ],
    flows: [
      F('E_start', 'E_gwText'),
      F('E_gwText', 'E_werk', 'ja'), F('E_gwText', 'E_ocr', 'nein, Scan'), F('E_ocr', 'E_werk'),
      F('E_werk', 'E_fill'), F('E_fill', 'E_check'), F('E_check', 'E_gwEU'),
      F('E_gwEU', 'E_fmt', 'nein'), F('E_gwEU', 'E_vat', 'ja'), F('E_vat', 'E_fmt'),
      F('E_fmt', 'E_end', '', { out: 'vertical' }),
    ],
    annotations: [
      { id: 'EN_werk', of: 'E_werk', lane: 'LKK', c: 3, r: 0, w: 160, h: 72,
        text: 'Eigene Parser: WGC, SHB, ZAI, EIS, EWA, LEG, MEG.' },
      { id: 'EN_fill', of: 'E_fill', lane: 'LKK', c: 4, r: 0, w: 160, h: 84,
        text: 'Entsperren nur bewusst, es landet im Prüfpfad. Die Rechnungsadresse des Kunden ist gemerkt.' },
      { id: 'EN_fmt', of: 'E_fmt', lane: 'LKV', c: 9, r: 0, w: 200, h: 72,
        text: 'Standard ist ZUGFeRD. XRechnung z. B. für öffentliche Auftraggeber mit Leitweg-ID.' },
    ],
  }],
  messages: [],
};

const ERZEUGEN = {
  key: 'erzeugen', file: '02b-pruefen-und-erzeugen.bpmn', tab: 'ausgang', von: 'ausgang',
  name: 'E-Rechnung Prüfen und erzeugen', kennung: 'Process_ERechnung_Erzeugen',
  doku: 'Vor dem Export prüft der Konverter Pflichtfelder (auch Telefon und Mail des Ansprechpartners), IBAN, Summen und USt-IdNr. EIS, EWA und LEG senden E-Rechnungen nur an Kunden im Inland und fragen sonst nach. Danach entsteht die XML nach EN 16931, wird zurückgelesen und als ZUGFeRD oder XRechnung mit Prüfpfad ausgegeben.',
  pools: [{
    id: 'P_Erz', name: 'Prüfen und E-Rechnung erzeugen', main: true,
    lanes: [
      { id: 'LXK', name: 'Konverter (Browser-App)', actor: 'app' },
      { id: 'LXV', name: 'Vertrieb / Fakturierung', actor: 'mensch' },
    ],
    nodes: [
      { id: 'X_start', k: 'start', n: 'Export angestoßen', lane: 'LXK', c: 0, r: 1 },
      { id: 'X_pflicht', k: 'service', n: 'Pflichtfelder prüfen (auch Telefon und Mail des Ansprechpartners)', lane: 'LXK', c: 1, r: 1 },
      { id: 'X_pre', k: 'service', n: 'Vorab prüfen (IBAN-Prüfziffer, Summen, USt-IdNr-Format)', lane: 'LXK', c: 2, r: 1 },
      { id: 'X_gwHard', k: 'gw', n: 'Harter Fehler?', lane: 'LXK', c: 3, r: 1 },
      { id: 'X_err1', k: 'errEnd', n: 'Prüfung nicht bestanden', lane: 'LXK', c: 4, r: 0 },
      { id: 'X_gwSoft', k: 'gw', n: 'Abweichung zum Original-PDF?', lane: 'LXK', c: 4, r: 1 },
      { id: 'X_confirm', k: 'user', n: 'Warnung ansehen: fortfahren oder abbrechen', lane: 'LXV', c: 5, r: 0, tone: 'warn' },
      { id: 'X_gwAusl', k: 'gw', n: 'Kunde im Ausland bei EIS, EWA oder LEG?', lane: 'LXK', c: 6, r: 1 },
      { id: 'X_rueck', k: 'user', n: 'Rückfrage beantworten (E-Rechnung oder nur PDF)', lane: 'LXV', c: 7, r: 0, tone: 'warn' },
      { id: 'X_gwEr', k: 'gw', n: 'E-Rechnung erzeugen?', lane: 'LXV', c: 8, r: 0 },
      { id: 'X_endPdf', k: 'end', n: 'nur PDF, keine E-Rechnung', lane: 'LXV', c: 9, r: 0, tone: 'warn' },
      { id: 'X_xml', k: 'service', n: 'XML nach EN 16931 erzeugen', lane: 'LXK', c: 8, r: 1 },
      { id: 'X_self', k: 'service', n: 'Selbstprüfung: XML zurücklesen und vergleichen', lane: 'LXK', c: 9, r: 1 },
      { id: 'X_gwSelf', k: 'gw', n: 'Abweichung?', lane: 'LXK', c: 10, r: 1 },
      { id: 'X_err2', k: 'errEnd', n: 'Selbstprüfung fehlgeschlagen', lane: 'LXK', c: 11, r: 0 },
      { id: 'X_gwFmt', k: 'gw', n: 'Format?', lane: 'LXK', c: 11, r: 1 },
      { id: 'X_zf', k: 'service', n: 'ZUGFeRD-PDF/A-3b mit eingebetteter XML erzeugen', lane: 'LXK', c: 12, r: 1 },
      { id: 'X_xr', k: 'service', n: 'XRechnung-XML und lesbares PDF erzeugen', lane: 'LXK', c: 12, r: 2 },
      { id: 'X_audit', k: 'service', n: 'Prüfpfad schreiben (Hash, manuelle Änderungen, Prüfer)', lane: 'LXK', c: 13, r: 1 },
      { id: 'X_dl', k: 'service', n: 'Dateien zum Herunterladen bereitstellen', lane: 'LXK', c: 14, r: 1 },
      { id: 'X_end', k: 'end', n: 'E-Rechnung erstellt', lane: 'LXK', c: 15, r: 1 },
    ],
    flows: [
      F('X_start', 'X_pflicht'), F('X_pflicht', 'X_pre'), F('X_pre', 'X_gwHard'),
      F('X_gwHard', 'X_err1', 'ja'), F('X_gwHard', 'X_gwSoft', 'nein'),
      F('X_gwSoft', 'X_gwAusl', 'nein'), F('X_gwSoft', 'X_confirm', 'ja'), F('X_confirm', 'X_gwAusl', 'fortfahren', { out: 'vertical' }),
      F('X_gwAusl', 'X_xml', 'nein'), F('X_gwAusl', 'X_rueck', 'ja'),
      F('X_rueck', 'X_gwEr'), F('X_gwEr', 'X_xml', 'ja'), F('X_gwEr', 'X_endPdf', 'nein'),
      F('X_xml', 'X_self'), F('X_self', 'X_gwSelf'),
      F('X_gwSelf', 'X_err2', 'ja'), F('X_gwSelf', 'X_gwFmt', 'nein'),
      F('X_gwFmt', 'X_zf', 'ZUGFeRD'), F('X_gwFmt', 'X_xr', 'XRechnung'),
      F('X_zf', 'X_audit'), F('X_xr', 'X_audit'),
      F('X_audit', 'X_dl'), F('X_dl', 'X_end'),
    ],
    annotations: [
      { id: 'XN_pre', of: 'X_pre', lane: 'LXK', c: 2, r: 0, w: 160, h: 72,
        text: 'Harte Fehler: IBAN-Prüfziffer falsch, Summe nicht plausibel, Netto + MwSt ≠ Brutto.' },
      { id: 'XN_confirm', of: 'X_confirm', lane: 'LXV', c: 5, r: 1, w: 200, h: 56,
        text: '„Abbrechen“ beendet den Export, es entsteht keine Datei.' },
      { id: 'XN_rueck', of: 'X_rueck', lane: 'LXV', c: 7, r: 1, w: 300, h: 72,
        text: 'Ins Ausland geht bei diesen Werken das PDF, bei EIS ins Drittland unterschrieben (Präferenzangaben).' },
      { id: 'XN_zf', of: 'X_zf', lane: 'LXK', c: 12, r: 0, w: 200, h: 84,
        text: 'PDF aus den Rechnungsdaten. Inland im Profil XRECHNUNG, Ausland EN 16931.' },
    ],
  }],
  messages: [],
};

const UMSTELLEN = {
  key: 'umstellen', file: '03a-umstellen.bpmn', tab: 'zahlung', von: 'zahlung',
  name: 'Zahldatei auf pain.001.001.09 umstellen', kennung: 'Process_Zahldatei_Umstellen',
  doku: 'Der MC-Converter erkennt die Dateiart am Inhalt. SEPA-Überweisungen (pain.001.003.03 oder 001.001.03) werden zu pain.001.001.09, DTAZV-Auslandszahlungen zu pain.001.001.09 AXZ nach DK-Schema GBIC_5.',
  pools: [{
    id: 'P_Umst', name: 'Zahldatei umstellen', main: true,
    lanes: [
      { id: 'LUM', name: 'MC-Converter (Browser-App)', actor: 'app' },
      { id: 'LUT', name: 'Treasury / Buchhaltung', actor: 'mensch' },
    ],
    nodes: [
      { id: 'U_start', k: 'start', n: 'Datei geladen', lane: 'LUM', c: 0, r: 1 },
      { id: 'U_ns', k: 'service', n: 'Dateiart erkennen (pain.001-Namespace oder DTAZV-Vorsatz)', lane: 'LUM', c: 1, r: 1 },
      { id: 'U_gw', k: 'gw', n: 'Welche Dateiart?', lane: 'LUM', c: 2, r: 1 },
      { id: 'U_stop', k: 'end', n: 'Abbruch: keine Überweisung, z. B. Lastschrift pain.008', lane: 'LUM', c: 3, r: 0, tone: 'err' },
      { id: 'U_struct', k: 'service', n: 'Struktur umstellen (Datum als <Dt>, BIC als <BICFI>, Sammelbuchung)', lane: 'LUM', c: 3, r: 1 },
      { id: 'U_strip', k: 'service', n: 'Adressen und Konto-Währung entfernen (IBAN genügt)', lane: 'LUM', c: 4, r: 1 },
      { id: 'U_sum', k: 'service', n: 'Anzahl und Kontrollsumme aus den Posten neu berechnen', lane: 'LUM', c: 5, r: 1 },
      { id: 'U_clean', k: 'service', n: 'SEPA-Zeichensatz erzwingen (Verwendungszweck max. 140 Zeichen)', lane: 'LUM', c: 6, r: 1 },
      { id: 'U_end', k: 'end', n: 'pain.001.001.09 (SEPA) erzeugt', lane: 'LUM', c: 7, r: 1 },
      { id: 'U_read', k: 'service', n: 'Q-, T- und Z-Sätze lesen und Nachsatz gegenprüfen', lane: 'LUM', c: 3, r: 3 },
      { id: 'U_map', k: 'service', n: 'Entgelt, Zahlungsart und Weisungen auf AXZ abbilden', lane: 'LUM', c: 4, r: 3 },
      { id: 'U_iban', k: 'service', n: 'IBAN des Belastungskontos aus BLZ und Konto berechnen', lane: 'LUM', c: 5, r: 3 },
      { id: 'U_adr', k: 'service', n: 'Adressen hybrid aufbauen (Ort und Land strukturiert)', lane: 'LUM', c: 6, r: 3 },
      { id: 'U_gwOrt', k: 'gw', n: 'Ort des Empfängers vorhanden?', lane: 'LUM', c: 7, r: 3 },
      { id: 'U_ort', k: 'user', n: 'Ort im MC-Converter eintragen', lane: 'LUT', c: 8, r: 0, tone: 'warn' },
      { id: 'U_endAxz', k: 'end', n: 'pain.001.001.09 AXZ erzeugt', lane: 'LUM', c: 8, r: 3, lp: 'above' },
    ],
    flows: [
      F('U_start', 'U_ns'), F('U_ns', 'U_gw'),
      F('U_gw', 'U_struct', 'SEPA'), F('U_gw', 'U_read', 'DTAZV'), F('U_gw', 'U_stop', 'andere Datei'),
      F('U_struct', 'U_strip'), F('U_strip', 'U_sum'), F('U_sum', 'U_clean'), F('U_clean', 'U_end'),
      F('U_read', 'U_map'), F('U_map', 'U_iban'), F('U_iban', 'U_adr'), F('U_adr', 'U_gwOrt'),
      F('U_gwOrt', 'U_endAxz', 'ja'), F('U_gwOrt', 'U_ort', 'nein'),
      F('U_ort', 'U_endAxz'),
    ],
    annotations: [
      { id: 'UN_ns', of: 'U_ns', lane: 'LUM', c: 1, r: 2, w: 160, h: 72,
        text: 'Erkennung am Inhalt, die Dateiendung spielt keine Rolle.' },
      { id: 'UN_struct', of: 'U_struct', lane: 'LUM', c: 4, r: 2, w: 280, h: 56,
        text: 'Im Reiter umschaltbar: Sammelbuchung, InstrId übernehmen, Zeichensatz.' },
      { id: 'UN_dtazv', of: 'U_map', lane: 'LUM', c: 4, r: 4, w: 300, h: 56,
        text: 'DTAZV nehmen die Banken ab 14.11.2026 nicht mehr an. Einreichen per EBICS-Auftragsart AXZ.' },
      { id: 'UN_ort', of: 'U_ort', lane: 'LUT', c: 9, r: 0, w: 250, h: 62,
        text: 'Ohne Ort lehnt die Bank die AXZ-Datei ab. Der Ort wird je Empfängerkonto gemerkt.' },
    ],
  }],
  messages: [],
};

const PREFLIGHT = {
  key: 'preflight', file: '03b-preflight.bpmn', tab: 'zahlung', von: 'zahlung',
  name: 'Zahldatei-Preflight', kennung: 'Process_Zahldatei_Preflight',
  doku: 'Der Preflight prüft die fertige pain.001.001.09 auf die Gründe, an denen Banken ablehnen. Bei Auslandszahlungen (AXZ) kommen die Pflichtfelder der DK dazu.',
  pools: [{
    id: 'P_Pre', name: 'Preflight', main: true,
    lanes: [{ id: 'LP', name: 'MC-Converter (Browser-App)', actor: 'app' }],
    nodes: [
      { id: 'P_start', k: 'start', n: 'umgestellte Datei', lane: 'LP', c: 0, r: 2 },
      { id: 'P_split', k: 'gwPar', n: '', lane: 'LP', c: 1, r: 2 },
      { id: 'P_iban', k: 'service', n: 'IBAN-Prüfziffer (Mod-97) je Konto prüfen', lane: 'LP', c: 2, r: 0 },
      { id: 'P_bic', k: 'service', n: 'BIC-Format prüfen', lane: 'LP', c: 2, r: 1 },
      { id: 'P_sum', k: 'service', n: 'Anzahl und Kontrollsumme gegen die Posten prüfen', lane: 'LP', c: 2, r: 2 },
      { id: 'P_txt', k: 'service', n: 'Zeichensatz und Feldlängen prüfen (SEPA bzw. SWIFT)', lane: 'LP', c: 2, r: 3 },
      { id: 'P_date', k: 'service', n: 'Ausführungsdatum prüfen', lane: 'LP', c: 2, r: 4 },
      { id: 'P_join', k: 'gwPar', n: '', lane: 'LP', c: 3, r: 2 },
      { id: 'P_gwAxz', k: 'gw', n: 'Auslandszahlung (AXZ)?', lane: 'LP', c: 4, r: 2 },
      { id: 'P_axz', k: 'service', n: 'AXZ-Pflichtfelder prüfen (Ort und Land, Entgelt, Service-Level, Währungsstellen)', lane: 'LP', c: 5, r: 3 },
      { id: 'P_gw', k: 'gw', n: 'Fehler gefunden?', lane: 'LP', c: 6, r: 2 },
      { id: 'P_green', k: 'end', n: 'grün: bankfertig', lane: 'LP', c: 7, r: 2 },
      { id: 'P_red', k: 'end', n: 'rot: nicht bankfertig', lane: 'LP', c: 7, r: 3, tone: 'err' },
    ],
    flows: [
      F('P_start', 'P_split'),
      F('P_split', 'P_iban'), F('P_split', 'P_bic'), F('P_split', 'P_sum'), F('P_split', 'P_txt'), F('P_split', 'P_date'),
      F('P_iban', 'P_join'), F('P_bic', 'P_join'), F('P_sum', 'P_join'), F('P_txt', 'P_join'), F('P_date', 'P_join'),
      F('P_join', 'P_gwAxz'),
      F('P_gwAxz', 'P_gw', 'nein'), F('P_gwAxz', 'P_axz', 'ja'), F('P_axz', 'P_gw', '', { via: 'joinLeft' }),
      F('P_gw', 'P_green', 'nein'), F('P_gw', 'P_red', 'ja'),
    ],
    annotations: [
      { id: 'PN_date', of: 'P_date', lane: 'LP', c: 2, r: 5, w: 300, h: 56,
        text: 'Ein Datum in der Vergangenheit ist nur ein Hinweis. Die Bank bucht am nächsten Bankarbeitstag.' },
      { id: 'PN_axz', of: 'P_axz', lane: 'LP', c: 5, r: 4, w: 290, h: 56,
        text: 'Über 50.000 € ins Ausland erinnert der Preflight an die AWV-Meldung an die Bundesbank.' },
    ],
  }],
  messages: [],
};

const MODELLE = [EINGANG, INTAKE, NEBEN, EINSCHAETZUNG, FREIGABE, AUSGANG, ERFASSEN, ERZEUGEN, ZAHLUNG, UMSTELLEN, PREFLIGHT];
const BY_KEY = Object.fromEntries(MODELLE.map(m => [m.key, m]));

/* ═════════════════════════════════════════════════════════════════════════
 *  LAYOUT
 * ═════════════════════════════════════════════════════════════════════════ */

function placeNode(n, cx, cy) {
  const [w, h] = sizeOf(n.k);
  n.b = { x: rnd(cx - w / 2), y: rnd(cy - h / 2), w, h };
}

/** Pools und Bahnen anordnen, Knoten platzieren. Geschlossene Pools (externe
 *  Partner) sind nur ein Band ohne Inhalt. */
function layoutMain(spec) {
  const N = {};
  let maxCol = 0;
  for (const p of spec.pools) {
    for (const n of p.nodes || []) if (n.c != null) maxCol = Math.max(maxCol, n.c);
    for (const a of p.annotations || []) maxCol = Math.max(maxCol, a.c + Math.ceil((a.w || 160) / COL_W) - 1);
  }
  const width = (CONTENT_X - POOL_X) + (maxCol + 1) * COL_W + 30;
  let y = TOP;
  for (const p of spec.pools) {
    p.x = POOL_X; p.y = y; p.w = width; p.laneGeo = [];
    if (p.blackbox) {
      p.h = BLACKBOX_H;
      y += p.h + POOL_GAP;
      continue;
    }
    for (const ld of p.lanes) {
      let rows = ld.rows || 1;
      for (const n of p.nodes) if (n.lane === ld.id && n.r != null) rows = Math.max(rows, n.r + 1);
      for (const a of p.annotations || []) if (a.lane === ld.id) rows = Math.max(rows, a.r + 1);
      const h = rows * ROW_H + 20;
      p.laneGeo.push({ ...ld, x: POOL_X + POOL_HEAD, y, w: width - POOL_HEAD, h });
      y += h;
    }
    p.h = y - p.y;
    y += POOL_GAP;
    const laneOf = o => p.laneGeo.find(l => l.id === o.lane);
    p.colLeft = c => CONTENT_X + c * COL_W;
    p.rowTop = (o, r) => laneOf(o).y + 10 + r * ROW_H;
    for (const n of p.nodes) {
      if (n.k === 'boundaryErr') continue;
      const lane = laneOf(n);
      if (!lane) throw new Error(`${spec.key}: Bahn "${n.lane}" für ${n.id} fehlt`);
      n.pool = p; n.actor = lane.actor;
      placeNode(n, CONTENT_X + n.c * COL_W + COL_W / 2, lane.y + 10 + n.r * ROW_H + ROW_H / 2);
      N[n.id] = n;
    }
    for (const n of p.nodes.filter(x => x.k === 'boundaryErr')) {
      const h = N[n.attachedTo];
      n.pool = p; n.actor = h.actor;
      placeNode(n, R(h.b) - 28, B(h.b));
      N[n.id] = n;
    }
  }
  return N;
}

function checkOverlaps(nodes, where) {
  const seen = new Map();
  for (const n of nodes) {
    if (n.k === 'boundaryErr') continue;
    const key = `${n.lane || ''}|${n.c}|${n.r}`;
    if (seen.has(key)) throw new Error(`${where}: ${n.id} liegt auf demselben Rasterplatz wie ${seen.get(key)}`);
    seen.set(key, n.id);
  }
}

/* ── Kanten führen (orthogonal) ───────────────────────────────────────── */

function route(f, N, inCnt, outCnt) {
  const s = N[f.from], t = N[f.to];
  if (!s || !t) throw new Error(`Fluss ${f.from} -> ${f.to}: Knoten fehlt`);
  const sb = s.b, tb = t.b, o = f.o;
  const sx = CX(sb), sy = CY(sb), tx = CX(tb), ty = CY(tb);
  // Übergang in ein tieferes Band: unten raus, durch die freie Zeile, oben rein
  // (rechts raus, damit Ein- und Ausgänge nicht dieselbe Kante teilen)
  if (o.viaRow != null) {
    const yv = t.pool.rowTop(t, o.viaRow) + ROW_H / 2, xr = R(sb) + 28;
    return [[R(sb), sy], [xr, sy], [xr, yv], [tx, yv], [tx, tb.y]];
  }
  // Senkrecht aus der Aufgabe in die Zeile des Ziels, dann waagerecht hinein
  if (o.out === 'vertical' && tx > sx) return [[sx, ty < sy ? sb.y : B(sb)], [sx, ty], [tb.x, ty]];
  // Kurz vor dem Ziel in dessen Zeile einmünden und von links hinein (Zusammenführung
  // vor einer Entscheidung, deren unterer Ausgang schon belegt ist)
  if (o.via === 'joinLeft') {
    const xj = tb.x - (o.gap || 24);
    return [[R(sb), sy], [xj, sy], [xj, ty], [tb.x, ty]];
  }
  if (o.via === 'above' || o.via === 'below') {
    const up = o.via === 'above';
    const g = o.gap || 28;
    const yv = up ? Math.min(sb.y, tb.y) - g : Math.max(B(sb), B(tb)) + g;
    return [[sx, up ? sb.y : B(sb)], [sx, yv], [tx, yv], [tx, up ? tb.y : B(tb)]];
  }
  if (o.via === 'left') return [[sb.x, sy], [tx, sy], [tx, ty < sy ? B(tb) : tb.y]];
  if (s.k === 'boundaryErr') return [[sx, B(sb)], [sx, ty], [tx < sx ? R(tb) : tb.x, ty]];
  // Von einer Entscheidung schräg nach unten rechts, oben in das Ziel
  if (o.in === 'top' && tx > sx && ty > sy) {
    const yv = tb.y - 30;
    return [[sx, B(sb)], [sx, yv], [tx, yv], [tx, tb.y]];
  }

  const sameRow = Math.abs(sy - ty) < 1, sameCol = Math.abs(sx - tx) < 1;
  if (sameRow) {
    if (tx > sx) return [[R(sb), sy], [tb.x, ty]];
    const yv = Math.max(B(sb), B(tb)) + 28;
    return [[sx, B(sb)], [sx, yv], [tx, yv], [tx, B(tb)]];
  }
  if (sameCol) return ty > sy ? [[sx, B(sb)], [tx, tb.y]] : [[sx, sb.y], [tx, B(tb)]];

  const split = isGw(s) && outCnt[s.id] > 1;
  const join = isGw(t) && inCnt[t.id] > 1;
  if (tx > sx) {
    if (split) return [[sx, ty < sy ? sb.y : B(sb)], [sx, ty], [tb.x, ty]];
    if (o.in || join) {
      const fromBelow = o.in ? o.in === 'bottom' : ty < sy;
      return [[R(sb), sy], [tx, sy], [tx, fromBelow ? B(tb) : tb.y]];
    }
    const mx = rnd((R(sb) + tb.x) / 2);
    return [[R(sb), sy], [mx, sy], [mx, ty], [tb.x, ty]];
  }
  // Rücksprung nach links in eine andere Zeile: außen herum
  const yv = ty > sy ? Math.max(B(sb), B(tb)) + 28 : Math.min(sb.y, tb.y) - 28;
  return ty > sy
    ? [[sx, B(sb)], [sx, yv], [tx, yv], [tx, B(tb)]]
    : [[sx, sb.y], [sx, yv], [tx, yv], [tx, tb.y]];
}

function labelLines(text, perLine) {
  return Math.max(1, Math.ceil(String(text).length / perLine));
}

function flowLabel(wp, name) {
  const lines = name.length > 16 ? 2 : 1;
  const w = Math.min(112, Math.max(24, rnd(name.length * 6.4 / lines) + 12));
  const h = lines === 2 ? 27 : 14;
  const [a, b] = wp;
  if (wp.length >= 3 && Math.abs(a[0] - b[0]) < 1 && Math.abs(wp[1][1] - wp[2][1]) < 1) {
    const c = wp[2];
    return { x: c[0] > b[0] ? b[0] + 8 : b[0] - w - 8, y: b[1] - h - 3, w, h };
  }
  if (Math.abs(a[1] - b[1]) < 1) return { x: b[0] > a[0] ? a[0] + 6 : a[0] - w - 6, y: a[1] - h - 3, w, h };
  return { x: a[0] + 6, y: rnd((a[1] + b[1]) / 2 - h / 2), w, h };
}

function nodeLabel(n, flows, N) {
  const b = n.b;
  if (!n.n || KIND[n.k].size === 'task') return null;
  if (isGw(n)) {
    const lines = labelLines(n.n, 16);
    const h = lines * 13 + 2, w = 96;
    let below = n.lp === 'below';
    if (!n.lp) below = flows.some(f => f.to === n.id && CY(N[f.from].b) < CY(b) - 1);
    return { x: rnd(CX(b) - 100), y: below ? B(b) + 4 : b.y - h - 4, w, h };
  }
  if (n.k === 'boundaryErr') return { x: b.x - 112, y: B(b) - 2, w: 108, h: 27 };
  const lines = labelLines(n.n, 20);
  const h = lines * 13 + 2;
  if (n.lp === 'above') return { x: rnd(CX(b) - 60), y: b.y - h - 5, w: 120, h };
  return { x: rnd(CX(b) - 60), y: B(b) + 5, w: 120, h };
}

/* ── Anmerkungen, Gruppen ─────────────────────────────────────────────── */

function placeAnnotation(a, host) {
  const w = a.w || 160, h = a.h || 56;
  a.b = { x: host.colLeft(a.c) + 10, y: rnd(host.rowTop(a, a.r) + (ROW_H - h) / 2), w, h };
}

function assocPath(nb, ab) {
  const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const ncx = CX(nb), ncy = CY(nb);
  if (ab.y >= B(nb)) return [[ncx, B(nb)], [cl(ncx, ab.x + 12, R(ab) - 12), ab.y]];
  if (B(ab) <= nb.y) return [[ncx, nb.y], [cl(ncx, ab.x + 12, R(ab) - 12), B(ab)]];
  if (ab.x >= R(nb)) return [[R(nb), ncy], [ab.x, cl(ncy, ab.y + 8, B(ab) - 8)]];
  return [[nb.x, ncy], [R(ab), cl(ncy, ab.y + 8, B(ab) - 8)]];
}

function groupBounds(g, byId) {
  const bs = g.members.map(id => {
    const o = byId[id];
    if (!o || !o.b) throw new Error(`Gruppe ${g.id}: Mitglied ${id} fehlt`);
    return o.b;
  });
  const x = Math.min(...bs.map(b => b.x)) - 18, y = Math.min(...bs.map(b => b.y)) - 24;
  const r = Math.max(...bs.map(R)) + 18, bo = Math.max(...bs.map(B)) + 16;
  return { x, y, w: r - x, h: bo - y };
}

/* ═════════════════════════════════════════════════════════════════════════
 *  XML
 * ═════════════════════════════════════════════════════════════════════════ */

const fmtB = b => `<dc:Bounds x="${rnd(b.x)}" y="${rnd(b.y)}" width="${rnd(b.w)}" height="${rnd(b.h)}" />`;
const fmtWp = wp => wp.map(([x, y]) => `<di:waypoint x="${rnd(x)}" y="${rnd(y)}" />`).join('');
const labelXml = lb => (lb ? `<bpmndi:BPMNLabel>${fmtB(lb)}</bpmndi:BPMNLabel>` : '');

function counts(flows) {
  const inCnt = {}, outCnt = {};
  for (const f of flows) {
    outCnt[f.from] = (outCnt[f.from] || 0) + 1;
    inCnt[f.to] = (inCnt[f.to] || 0) + 1;
  }
  return { inCnt, outCnt };
}

function flowId(f) { return `Flow_${f.from}_${f.to}`; }

/** Text der Dokumentation einer Aufrufaktivität, wie das RMS ihn schreibt:
 *  Klartextzeile plus Marker mit der Datei-Kennung im RMS. */
function callDoku(n, rms) {
  const ziel = BY_KEY[n.ref];
  if (!ziel) throw new Error(`Aufruf ${n.id}: Modell "${n.ref}" unbekannt`);
  const zeilen = ['Unterprozess: ' + ziel.name];
  const itemId = rms.modelle && rms.modelle[n.ref];
  if (itemId) zeilen.push(`[[rms:modell=${itemId}]]`);
  return zeilen.join('\n');
}

/** Semantik eines Knotens. */
function nodeSem(n, flows, rms) {
  const K = KIND[n.k];
  const attrs = [`id="${n.id}"`];
  if (n.n) attrs.push(`name="${esc(n.n)}"`);
  if (n.k === 'boundaryErr') attrs.push(`attachedToRef="${n.attachedTo}"`, 'cancelActivity="true"');
  if (n.k === 'call') attrs.push(`calledElement="${BY_KEY[n.ref].kennung}"`);
  let body = '';
  if (n.k === 'call') body += `<bpmn:documentation>${esc(callDoku(n, rms))}</bpmn:documentation>`;
  for (const f of flows) if (f.to === n.id) body += `<bpmn:incoming>${flowId(f)}</bpmn:incoming>`;
  for (const f of flows) if (f.from === n.id) body += `<bpmn:outgoing>${flowId(f)}</bpmn:outgoing>`;
  if (K.def === 'message') body += `<bpmn:messageEventDefinition id="${n.id}_def" />`;
  if (K.def === 'error') body += `<bpmn:errorEventDefinition id="${n.id}_def" errorRef="Error_Pruefung" />`;
  return `      <bpmn:${K.tag} ${attrs.join(' ')}>${body}</bpmn:${K.tag}>\n`;
}

function flowsSem(flows) {
  return flows.map(f => `      <bpmn:sequenceFlow id="${flowId(f)}" sourceRef="${f.from}" targetRef="${f.to}"${f.name ? ` name="${esc(f.name)}"` : ''} />\n`).join('');
}

function artifactsSem(annotations, groups) {
  let x = '';
  for (const a of annotations || []) {
    x += `      <bpmn:textAnnotation id="${a.id}"><bpmn:text>${esc(a.text)}</bpmn:text></bpmn:textAnnotation>\n`;
    x += `      <bpmn:association id="Assoc_${a.id}" associationDirection="None" sourceRef="${a.of}" targetRef="${a.id}" />\n`;
  }
  for (const g of groups || []) x += `      <bpmn:group id="${g.id}" categoryValueRef="CV_${g.id}" />\n`;
  return x;
}

/* Verknüpfte Richtlinien im RMS, so geschrieben wie das RMS es selbst tut
   (Klartextzeile plus Marker [[rms:policies=…]]). */
const RICHTLINIEN = [{ id: '119', titel: 'ISMS-Richtlinie Aufbewahrungsfristen und -pflichten' }];

/** Prozess-Dokumentation: Einleitung, Herkunft, Link auf die Anwender-Ansicht, Richtlinien. */
function processDoku(spec) {
  const zeilen = [spec.doku];
  if (spec.von) zeilen.push(`Eingebunden in: ${BY_KEY[spec.von].name}.`);
  zeilen.push(`Anwender-Ansicht: ${ANSICHT}#${spec.tab}`);
  if (RICHTLINIEN.length) {
    zeilen.push('Im Einklang mit den Richtlinien: ' + RICHTLINIEN.map(r => r.titel).join('; '));
    zeilen.push(`[[rms:policies=${RICHTLINIEN.map(r => r.id).join(',')}]]`);
  }
  return zeilen.join('\n');
}

/** DI-Formen und -Kanten für eine Menge Knoten/Flüsse/Anmerkungen. */
function planeDi(nodes, flows, N, annotations, groups, byId) {
  const { inCnt, outCnt } = counts(flows);
  let x = '';
  for (const n of nodes) {
    const c = colorOf(n, n.actor);
    const extra = isGw(n) ? ' isMarkerVisible="true"' : '';
    x += `      <bpmndi:BPMNShape id="${n.id}_di" bpmnElement="${n.id}"${extra}${colorAttrs(c)}>${fmtB(n.b)}${labelXml(nodeLabel(n, flows, N))}</bpmndi:BPMNShape>\n`;
  }
  for (const f of flows) {
    const wp = route(f, N, inCnt, outCnt);
    const lb = f.name ? flowLabel(wp, f.name) : null;
    x += `      <bpmndi:BPMNEdge id="${flowId(f)}_di" bpmnElement="${flowId(f)}">${fmtWp(wp)}${labelXml(lb)}</bpmndi:BPMNEdge>\n`;
  }
  for (const a of annotations || []) {
    const c = a.tone ? TONE[a.tone] : { fill: '#FFFFFF', stroke: '#6B7280' };
    x += `      <bpmndi:BPMNShape id="${a.id}_di" bpmnElement="${a.id}"${colorAttrs(c)}>${fmtB(a.b)}</bpmndi:BPMNShape>\n`;
    x += `      <bpmndi:BPMNEdge id="Assoc_${a.id}_di" bpmnElement="Assoc_${a.id}">${fmtWp(assocPath(N[a.of].b, a.b))}</bpmndi:BPMNEdge>\n`;
  }
  for (const g of groups || []) {
    const gb = groupBounds(g, byId);
    x += `      <bpmndi:BPMNShape id="${g.id}_di" bpmnElement="${g.id}" bioc:stroke="#17509E" color:border-color="#17509E">${fmtB(gb)}`
       + `${labelXml({ x: gb.x + 10, y: gb.y + 6, w: 260, h: 14 })}</bpmndi:BPMNShape>\n`;
  }
  return x;
}

function build(spec, rms) {
  const N = layoutMain(spec);
  const categories = [];
  let usesError = false;
  const inner = spec.pools.filter(p => !p.blackbox);
  if (inner.length !== 1) throw new Error(`${spec.key}: genau ein eigener Pool erwartet`);

  for (const p of inner) {
    checkOverlaps(p.nodes, `${spec.key}/${p.id}`);
    for (const a of p.annotations || []) placeAnnotation(a, p);
  }

  // Semantik
  let collab = `  <bpmn:collaboration id="Collab_${spec.key}">\n`;
  for (const p of spec.pools) {
    collab += p.blackbox
      ? `    <bpmn:participant id="${p.id}" name="${esc(p.name)}" />\n`
      : `    <bpmn:participant id="${p.id}" name="${esc(p.name)}" processRef="${spec.kennung}" />\n`;
  }
  for (const m of spec.messages) collab += `    <bpmn:messageFlow id="Msg_${m.from}_${m.to}" name="${esc(m.name)}" sourceRef="${m.from}" targetRef="${m.to}" />\n`;
  collab += '  </bpmn:collaboration>\n';

  let procs = '';
  for (const p of inner) {
    let x = `  <bpmn:process id="${spec.kennung}" name="${esc(spec.name)}" isExecutable="false">\n`;
    x += `    <bpmn:documentation>${esc(processDoku(spec))}</bpmn:documentation>\n`;
    x += `    <bpmn:laneSet id="LaneSet_${p.id}">\n`;
    for (const l of p.lanes) {
      x += `      <bpmn:lane id="${l.id}" name="${esc(l.name)}">`;
      for (const n of p.nodes.filter(n => n.lane === l.id)) x += `<bpmn:flowNodeRef>${n.id}</bpmn:flowNodeRef>`;
      x += '</bpmn:lane>\n';
    }
    x += '    </bpmn:laneSet>\n';
    for (const n of p.nodes) {
      if (KIND[n.k].def === 'error') usesError = true;
      x += nodeSem(n, p.flows, rms);
    }
    x += flowsSem(p.flows);
    x += artifactsSem(p.annotations, p.groups);
    for (const g of p.groups || []) categories.push(g);
    x += '  </bpmn:process>\n';
    procs += x;
  }

  // DI
  let di = `  <bpmndi:BPMNDiagram id="Diagram_${spec.key}">\n    <bpmndi:BPMNPlane id="Plane_${spec.key}" bpmnElement="Collab_${spec.key}">\n`;
  const byId = { ...N };
  for (const p of inner) for (const a of p.annotations || []) byId[a.id] = a;
  for (const p of spec.pools) {
    const a = ACTOR[p.actor] || null;
    const pc = p.blackbox ? { fill: a.lane, stroke: a.stroke } : { fill: '#FFFFFF', stroke: '#1A2644' };
    di += `      <bpmndi:BPMNShape id="${p.id}_di" bpmnElement="${p.id}" isHorizontal="true"${colorAttrs(pc)}>${fmtB(p)}</bpmndi:BPMNShape>\n`;
    for (const l of p.laneGeo) {
      const ac = ACTOR[l.actor];
      di += `      <bpmndi:BPMNShape id="${l.id}_di" bpmnElement="${l.id}" isHorizontal="true"${colorAttrs({ fill: ac.lane, stroke: ac.stroke })}>${fmtB(l)}</bpmndi:BPMNShape>\n`;
    }
  }
  for (const p of inner) di += planeDi(p.nodes, p.flows, N, p.annotations, p.groups, byId);
  // Nachrichtenflüsse: Knoten oder geschlossener Pool auf beiden Seiten
  const poolById = Object.fromEntries(spec.pools.map(p => [p.id, p]));
  for (const m of spec.messages) {
    const sPool = poolById[m.from], tPool = poolById[m.to];
    const sNode = N[m.from], tNode = N[m.to];
    let wp, lx, ly;
    if (sPool) {   // aus einem geschlossenen Pool auf einen Knoten
      const tb = tNode.b, tx = CX(tb);
      const down = tNode.pool.y > sPool.y;
      wp = [[tx, down ? sPool.y + sPool.h : sPool.y], [tx, down ? tb.y : B(tb)]];
      lx = tx + 8; ly = rnd((wp[0][1] + wp[1][1]) / 2 - 14);
    } else {
      const sb = sNode.b, sx = CX(sb) + (m.dx || 0), sp = sNode.pool;
      const tp = tPool || tNode.pool;
      const down = tp.y > sp.y;
      const gapMid = down ? (sp.y + sp.h + tp.y) / 2 : (tp.y + tp.h + sp.y) / 2;
      if (tPool) wp = [[sx, down ? B(sb) : sb.y], [sx, down ? tPool.y : tPool.y + tPool.h]];
      else {
        const tb = tNode.b, tx = CX(tb);
        const y1 = down ? B(sb) : sb.y, y2 = down ? tb.y : B(tb);
        wp = Math.abs(sx - tx) < 1 ? [[sx, y1], [tx, y2]] : [[sx, y1], [sx, gapMid], [tx, gapMid], [tx, y2]];
      }
      lx = sx + 8; ly = rnd(gapMid - 14);
    }
    di += `      <bpmndi:BPMNEdge id="Msg_${m.from}_${m.to}_di" bpmnElement="Msg_${m.from}_${m.to}">${fmtWp(wp)}${labelXml({ x: lx, y: ly, w: 170, h: 27 })}</bpmndi:BPMNEdge>\n`;
  }
  di += '    </bpmndi:BPMNPlane>\n  </bpmndi:BPMNDiagram>\n';

  let defs = '';
  if (usesError || inner.some(p => p.nodes.some(n => n.k === 'boundaryErr')))
    defs += '  <bpmn:error id="Error_Pruefung" name="Prüfung nicht bestanden" errorCode="PRUEFUNG" />\n';
  for (const g of categories) defs += `  <bpmn:category id="Cat_${g.id}"><bpmn:categoryValue id="CV_${g.id}" value="${esc(g.label)}" /></bpmn:category>\n`;

  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" '
    + 'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" '
    + 'xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" '
    + 'xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0" '
    + `id="Definitions_${spec.key}" targetNamespace="https://e-rechnung.dihag-extern.com/bpmn" `
    + 'exporter="DIHAG BPMN-Generator (scripts/bpmn/generate-bpmn.js)" exporterVersion="2.0">\n'
    + defs + collab + procs + di
    + '</bpmn:definitions>\n';
}

/* ── Ausgabe ──────────────────────────────────────────────────────────── */
if (require.main === module) {
  const outDir = path.join(__dirname, '..', '..', 'docs', 'bpmn');
  fs.mkdirSync(outDir, { recursive: true });
  let rms = {};
  try { rms = JSON.parse(fs.readFileSync(path.join(outDir, 'rms-ids.json'), 'utf8')); } catch (e) { /* noch kein Import */ }
  for (const spec of MODELLE) {
    const xml = build(spec, rms);
    fs.writeFileSync(path.join(outDir, spec.file), xml, 'utf8');
    console.log(`geschrieben: docs/bpmn/${spec.file} (${(xml.length / 1024).toFixed(1)} KB)`);
  }
  // Modell-Liste für prozess.html: welche Datei, welche Kennung, wo im RMS
  const liste = {
    hinweis: 'Erzeugt von scripts/bpmn/generate-bpmn.js. Führend sind die Modelle im RMS.',
    rms: { url: 'https://rms.dihag.de', ablage: 'Prozesse/KONZERN', driveId: rms.driveId || '' },
    modelle: MODELLE.map(m => ({
      key: m.key, name: m.name, kennung: m.kennung, datei: 'docs/bpmn/' + m.file, tab: m.tab,
      haupt: !!m.haupt, von: m.von || '',
      unter: (m.pools.find(p => !p.blackbox).nodes || []).filter(n => n.k === 'call').map(n => n.ref),
      itemId: (rms.modelle && rms.modelle[m.key]) || '',
    })),
  };
  fs.writeFileSync(path.join(outDir, 'modelle.json'), JSON.stringify(liste, null, 2) + '\n', 'utf8');
  console.log('geschrieben: docs/bpmn/modelle.json');
}

module.exports = { MODELLE, build };
