const BACKEND = 'http://localhost:3000';

const els = {
  mainView: document.getElementById('mainView'),
  favicon: document.getElementById('favicon'),
  sourceTitle: document.getElementById('sourceTitle'),
  sourceMeta: document.getElementById('sourceMeta'),
  fokusTrigger: document.getElementById('fokusTrigger'),
  fokusValue: document.getElementById('fokusValue'),
  fokusMenu: document.getElementById('fokusMenu'),
  lengthTrigger: document.getElementById('lengthTrigger'),
  lengthValue: document.getElementById('lengthValue'),
  lengthMenu: document.getElementById('lengthMenu'),
  zielsprache: document.getElementById('zielsprache'),
  plain: document.getElementById('plain'),
  autoRun: document.getElementById('autoRun'),
  fontSizeSeg: document.getElementById('fontSizeSeg'),
  reloadBtn: document.getElementById('reloadBtn'),
  result: document.getElementById('result'),
  summaryScroll: document.getElementById('summaryScroll'),
  summary: document.getElementById('summary'),
  shareBtn: document.getElementById('shareBtn'),
  shareMenu: document.getElementById('shareMenu'),
  copyBtn: document.getElementById('copyBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  ttsBtn: document.getElementById('ttsBtn'),
  qa: document.getElementById('qa'),
  qaThread: document.getElementById('qaThread'),
  qaForm: document.getElementById('qaForm'),
  qaInput: document.getElementById('qaInput'),
  error: document.getElementById('error'),
  toast: document.getElementById('toast'),
  // Settings
  settingsBtn: document.getElementById('settingsBtn'),
  settingsClose: document.getElementById('settingsClose'),
  settingsPanel: document.getElementById('settingsPanel'),
  customFocusList: document.getElementById('customFocusList'),
  customFocusForm: document.getElementById('customFocusForm'),
  customFocusEditorTitle: document.getElementById('customFocusEditorTitle'),
  customFocusId: document.getElementById('customFocusId'),
  customFocusName: document.getElementById('customFocusName'),
  customFocusDesc: document.getElementById('customFocusDesc'),
  customFocusPrompt: document.getElementById('customFocusPrompt'),
  customFocusNew: document.getElementById('customFocusNew'),
  customFocusDelete: document.getElementById('customFocusDelete'),
  focusReset: document.getElementById('focusReset'),
  focusDialog: document.getElementById('focusDialog'),
  focusDialogScrim: document.getElementById('focusDialogScrim'),
  focusDialogClose: document.getElementById('focusDialogClose'),
  // Bestätigungsdialog
  confirmScrim: document.getElementById('confirmScrim'),
  confirmDialog: document.getElementById('confirmDialog'),
  confirmTitle: document.getElementById('confirmTitle'),
  confirmText: document.getElementById('confirmText'),
  confirmOk: document.getElementById('confirmOk'),
  confirmCancel: document.getElementById('confirmCancel'),
};

function showError(msg) { els.error.textContent = msg; els.error.hidden = false; }
function clearError() { els.error.hidden = true; els.error.textContent = ''; }
let toastTimer = null;
function showToast(msg) {
  clearTimeout(toastTimer);
  els.toast.textContent = msg;
  els.toast.hidden = false;
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2200);
}

/* ====================================================================== */
/* State                                                                  */
/* ====================================================================== */

const STANDARD_DESC = 'Ausgewogene, strukturierte Zusammenfassung';
const DEFAULT_FOCUS_POINTS = [
  { id: 'standard', name: 'Standard', desc: STANDARD_DESC, prompt: '', locked: true },
  {
    id: 'zahlen',
    name: 'Zahlen & Fakten',
    desc: 'Konkrete Zahlen, Daten & Fakten als Tabelle',
    prompt:
      'Extrahiere konkrete Zahlen, Daten, Fakten, Messwerte, Zeitangaben, Geldbeträge und Eigennamen. ' +
      'Beginne mit einem kurzen TL;DR. Stelle die Fakten danach kompakt als Markdown-Tabelle mit den Spalten "Wert", "Kontext" und "Einordnung" dar. ' +
      'Nenne nur belastbare Angaben aus der Quelle und erfinde nichts.',
  },
  {
    id: 'procontra',
    name: 'Pro & Contra',
    desc: 'Argumente, Vor- & Nachteile gegenübergestellt',
    prompt:
      'Identifiziere Argumente, Vor- und Nachteile, Chancen und Risiken zum Hauptthema. ' +
      'Beginne mit einem kurzen TL;DR und stelle die Informationen danach kompakt dar, idealerweise als Markdown-Tabelle mit den Spalten "Pro", "Contra" und "Einordnung". ' +
      'Erfinde keine Argumente und kennzeichne fehlende Gegenpositionen klar.',
  },
];

const SUPPORTED_LANGS = new Set([
  'auto', 'de', 'en', 'es', 'fr', 'it', 'pt', 'nl', 'pl', 'tr', 'uk', 'ru',
  'ar', 'he', 'fa', 'hi', 'bn', 'ta', 'te', 'mr', 'pa', 'ur', 'zh-Hans',
  'ja', 'ko', 'vi', 'id', 'ms', 'th', 'sw', 'sv', 'da', 'no', 'fi',
  'cs', 'el', 'ro', 'hu',
]);

const FONT_SIZES = new Set(['normal', 'gross', 'sehrgross']);

let page = { text: '', title: '', url: '', kind: 'text' };
let prefs = {
  fokus: 'standard',
  length: 'mittel',
  zielsprache: 'auto',
  plain: false,
  autoRun: true,
  fontSize: 'normal',
  focusPoints: cloneDefaultFocusPoints(),
};
let lastKey = null;
let currentMarkdown = '';
let lastFokusUsed = null;
let abort = null;
let qaAbort = null;
let qaHistory = [];
let qaCurrentUrlKey = null;
let tabSwitchTimer = null;
let currentTabId = null;
let settingsRefreshPending = false;

/* ====================================================================== */
/* Persistenz                                                             */
/* ====================================================================== */

async function loadPrefs() {
  const saved = await chrome.storage.local.get(['fokus', 'length', 'plain', 'zielsprache', 'autoRun', 'fontSize', 'focusPoints', 'customFocuses']);
  if (saved.fokus) prefs.fokus = saved.fokus === 'ueberblick' ? 'standard' : saved.fokus;
  if (saved.length) prefs.length = saved.length;
  if (typeof saved.plain === 'boolean') prefs.plain = saved.plain;
  if (saved.zielsprache) prefs.zielsprache = normalizeLanguage(saved.zielsprache);
  if (typeof saved.autoRun === 'boolean') prefs.autoRun = saved.autoRun;
  if (FONT_SIZES.has(saved.fontSize)) prefs.fontSize = saved.fontSize;
  if (Array.isArray(saved.focusPoints)) {
    prefs.focusPoints = sanitizeFocusPoints(saved.focusPoints);
  } else {
    prefs.focusPoints = [
      ...cloneDefaultFocusPoints(),
      ...sanitizeFocusPoints(saved.customFocuses || []).filter((f) => f.id !== 'standard'),
    ];
  }
  if (!getFocusById(prefs.fokus)) prefs.fokus = 'standard';
}
function savePrefs() {
  chrome.storage.local.set({
    fokus: prefs.fokus, length: prefs.length, plain: prefs.plain,
    zielsprache: prefs.zielsprache, autoRun: prefs.autoRun,
    fontSize: prefs.fontSize,
    focusPoints: prefs.focusPoints,
  });
}
function normalizeLanguage(lang) {
  const raw = String(lang || 'auto');
  if (SUPPORTED_LANGS.has(raw)) return raw;
  const base = raw.split('-')[0].toLowerCase();
  if (SUPPORTED_LANGS.has(base)) return base;
  if (base === 'zh') return 'zh-Hans';
  return 'auto';
}
function systemLanguage() {
  const nav = typeof navigator === 'undefined' ? {} : navigator;
  const candidates = [nav.language, ...(nav.languages || [])].filter(Boolean);
  for (const lang of candidates) {
    const normalized = normalizeLanguage(lang);
    if (normalized !== 'auto') return normalized;
  }
  return 'de';
}
function targetLanguage() {
  return prefs.zielsprache === 'auto' ? systemLanguage() : normalizeLanguage(prefs.zielsprache);
}
function reflectPrefs() {
  if (!getFocusById(prefs.fokus)) prefs.fokus = 'standard';
  renderSelects();
  els.zielsprache.value = prefs.zielsprache;
  els.plain.checked = prefs.plain;
  els.autoRun.checked = prefs.autoRun;
  applyFontSize();
  renderCustomFocusList();
}
function applyFontSize() {
  els.summaryScroll.dataset.fontsize = prefs.fontSize;
  els.fontSizeSeg.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.setAttribute('aria-checked', String(btn.dataset.size === prefs.fontSize));
  });
}

function cloneDefaultFocusPoints() {
  return DEFAULT_FOCUS_POINTS.map((item) => ({ ...item }));
}
function sanitizeFocusPoints(items) {
  const clean = items
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: String(item.id || newFocusId()).replace(/[^a-z0-9_-]/gi, '').slice(0, 60),
      name: String(item.name || '').trim().slice(0, 38),
      desc: String(item.desc || '').trim().slice(0, 80),
      prompt: String(item.prompt || '').trim().slice(0, 1800),
      locked: item.id === 'standard' || Boolean(item.locked && item.id === 'standard'),
    }))
    .filter((item) => item.id !== 'todos')
    .filter((item) => item.id && item.name && (item.locked || item.prompt))
    .slice(0, 20);
  const withoutDuplicateIds = [];
  const seen = new Set();
  for (const item of clean) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    withoutDuplicateIds.push(item);
  }
  if (!withoutDuplicateIds.some((item) => item.id === 'standard')) {
    withoutDuplicateIds.unshift({ ...DEFAULT_FOCUS_POINTS[0] });
  }
  return withoutDuplicateIds.map((item) => item.id === 'standard' ? { ...DEFAULT_FOCUS_POINTS[0] } : item);
}
function focusOptions() {
  return prefs.focusPoints;
}
function getFocusById(id) {
  return focusOptions().find((f) => f.id === id) || null;
}
function activeFocus() {
  return getFocusById(prefs.fokus) || getFocusById('standard');
}
function focusToBackend(id) {
  return id === 'standard' ? 'ueberblick' : id;
}
function focusPromptForBackend(id) {
  const focus = getFocusById(id);
  return focus?.locked ? '' : focus?.prompt || '';
}
const LENGTH_OPTIONS = [
  { value: 'kurz', name: 'Kurz' },
  { value: 'mittel', name: 'Mittel' },
  { value: 'lang', name: 'Lang' },
];
const CHECK_SVG = '<svg class="opt-check" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

function focusDesc(f) {
  return f.locked ? STANDARD_DESC : (f.desc || '');
}
function renderFokusOptions() {
  return prefs.focusPoints.map((f) => {
    const desc = focusDesc(f);
    return `<button class="select-option" type="button" role="option" data-value="${escapeAttr(f.id)}" aria-selected="${f.id === prefs.fokus}">
      <span class="opt-main"><span class="opt-name">${escapeHtml(f.name)}</span>${desc ? `<span class="opt-desc">${escapeHtml(desc)}</span>` : ''}</span>${CHECK_SVG}
    </button>`;
  }).join('');
}
function renderLengthOptions() {
  return LENGTH_OPTIONS.map((o) =>
    `<button class="select-option" type="button" role="option" data-value="${o.value}" aria-selected="${o.value === prefs.length}">
      <span class="opt-main"><span class="opt-name">${o.name}</span></span>${CHECK_SVG}
    </button>`
  ).join('');
}
function updateFokusTrigger() {
  const f = getFocusById(prefs.fokus) || getFocusById('standard');
  els.fokusValue.textContent = f ? f.name : 'Standard';
}
function updateLengthTrigger() {
  const o = LENGTH_OPTIONS.find((x) => x.value === prefs.length) || LENGTH_OPTIONS[1];
  els.lengthValue.textContent = o.name;
}
function renderSelects() {
  updateFokusTrigger();
  updateLengthTrigger();
  if (!els.fokusMenu.hidden) els.fokusMenu.innerHTML = renderFokusOptions();
  if (!els.lengthMenu.hidden) els.lengthMenu.innerHTML = renderLengthOptions();
}

/* ====================================================================== */
/* Markdown-Renderer                                                      */
/* ====================================================================== */

function renderMarkdown(md) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</ul>`); list = null; } };
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const h = line.match(/^(#{2,4})\s+(.*)$/);
    const todoLi = line.match(/^\s*-\s+\[( |x|X)\]\s+(.*)$/);
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    const tableRow = line.trim().startsWith('|') && line.trim().endsWith('|');
    const nextLine = lines[i + 1]?.trim() || '';
    const tableSep = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(nextLine);
    if (tableRow && tableSep) {
      closeList();
      const splitRow = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      i--;
      out.push('<table><thead><tr>' + header.map((cell) => `<th>${inline(cell)}</th>`).join('') + '</tr></thead><tbody>');
      rows.forEach((row) => {
        out.push('<tr>' + header.map((_, idx) => `<td>${inline(row[idx] || '')}</td>`).join('') + '</tr>');
      });
      out.push('</tbody></table>');
      continue;
    }
    if (h) {
      closeList();
      const tag = h[1].length === 2 ? 'h2' : 'h3';
      out.push(`<${tag}>` + inline(h[2]) + `</${tag}>`);
    } else if (todoLi) {
      if (list !== 'todo') { closeList(); out.push('<ul class="todo">'); list = 'todo'; }
      const checked = todoLi[1].toLowerCase() === 'x';
      out.push(`<li><input type="checkbox" ${checked ? 'checked' : ''} disabled><span>${inline(todoLi[2])}</span></li>`);
    } else if (li) {
      if (!list) { closeList(); out.push('<ul>'); list = 'plain'; }
      else if (list === 'todo') { closeList(); out.push('<ul>'); list = 'plain'; }
      out.push('<li>' + inline(li[1]) + '</li>');
    } else if (line === '') {
      closeList();
    } else {
      closeList();
      out.push('<p>' + inline(line) + '</p>');
    }
  }
  closeList();
  return out.join('');
}

/* ====================================================================== */
/* Seite lesen                                                            */
/* ====================================================================== */

function pageExtractor() {
  const main = document.querySelector('article, main, [role="main"]') || document.body;
  const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content || '';
  const hasCitation = Boolean(meta('citation_title') || meta('citation_doi'));
  const ogType = document.querySelector('meta[property="og:type"]')?.content || '';
  return {
    text: (main.innerText || '').trim(),
    title: document.title,
    url: location.href,
    paperLike: hasCitation || /scholar|article/i.test(ogType),
  };
}

function isYouTube(url = '') { return /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(url); }
function isPdfUrl(url = '')  { return /^https?:\/\/.+\.pdf(\?.*)?$/i.test(url); }

function normalizeUrl(url = '') {
  try {
    const u = new URL(url);
    if (/youtu\.be/.test(u.host)) return `yt:${u.pathname.replace(/^\//, '')}`;
    if (/youtube\.com/.test(u.host)) { const v = u.searchParams.get('v'); if (v) return `yt:${v}`; }
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid','ref','ref_src']
      .forEach((p) => u.searchParams.delete(p));
    u.hash = '';
    return u.origin + u.pathname + (u.search || '');
  } catch { return url || ''; }
}

function faviconFor(url) {
  try { const u = new URL(url); return `https://www.google.com/s2/favicons?sz=32&domain=${u.hostname}`; }
  catch { return ''; }
}

function setSource(title, meta, favUrl) {
  els.sourceTitle.textContent = title || 'Seite';
  els.sourceMeta.textContent = meta || '';
  if (favUrl !== undefined) els.favicon.src = favUrl || '';
}

async function loadCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id ?? null;
  const tabUrl = tab?.url || '';
  const blocked = /^(chrome|edge|about|chrome-extension|devtools|view-source):/.test(tabUrl);

  if (!tab?.id || blocked) {
    page = { text: '', title: tab?.title || '', url: tabUrl, kind: 'text' };
    setSource('Diese Seite kann nicht gelesen werden.', '', '');
    els.reloadBtn.disabled = true;
    clearSummaryState();
    return false;
  }
  els.reloadBtn.disabled = false;

  const favUrl = tab.favIconUrl || faviconFor(tabUrl);

  if (isYouTube(tabUrl)) {
    page = { text: '', title: tab.title || '', url: tabUrl, kind: 'video' };
    setSource(tab.title || tabUrl, 'YouTube-Video', favUrl);
    return true;
  }
  if (isPdfUrl(tabUrl)) {
    page = { text: '', title: tab.title || 'PDF', url: tabUrl, kind: 'pdf' };
    setSource(tab.title || 'PDF-Dokument', 'PDF', favUrl);
    return true;
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageExtractor });
    const r = result || {};
    page = { text: r.text || '', title: r.title || tab.title || '', url: r.url || tabUrl, kind: 'text', paperLike: Boolean(r.paperLike) };
  } catch {
    page = { text: '', title: tab.title, url: tabUrl, kind: 'text' };
    setSource('Seite konnte nicht gelesen werden.', '', favUrl);
    els.reloadBtn.disabled = true;
    clearSummaryState();
    return false;
  }

  if (page.text.length < 40) {
    setSource(page.title || 'Seite', 'Kaum Text gefunden', favUrl);
    els.reloadBtn.disabled = true;
    clearSummaryState();
    return false;
  }

  const words = page.text.split(/\s+/).length;
  setSource(page.title || 'Seite', `~${words.toLocaleString('de')} Wörter`, favUrl);
  return true;
}

/* ====================================================================== */
/* Cache                                                                  */
/* ====================================================================== */

function cacheKey(extra = {}) {
  const focus = extra.fokus ?? prefs.fokus;
  const focusPoint = getFocusById(focus);
  return 'sum:' + JSON.stringify({
    u: normalizeUrl(page.url),
    f: focus, c: focusPoint?.prompt || '',
    l: prefs.length, p: prefs.plain ? 1 : 0, z: targetLanguage(), k: page.kind,
  });
}
async function cacheGet(key) {
  try { const r = await chrome.storage.session.get(key); return r[key] || null; } catch { return null; }
}
async function cachePut(key, entry) {
  try { await chrome.storage.session.set({ [key]: entry }); } catch {}
}

function setQaReady(ready) {
  els.qaForm.classList.toggle('is-disabled', !ready);
  els.qaForm.setAttribute('aria-disabled', String(!ready));
  els.qaInput.disabled = !ready;
  els.qaInput.placeholder = ready ? 'Rückfrage zur Seite stellen...' : 'Zusammenfassung wird benötigt...';
  els.qaForm.querySelector('.qa-send').disabled = !ready;
}

function clearSummaryState() {
  currentMarkdown = '';
  lastFokusUsed = null;
  els.result.hidden = true;
  els.summary.innerHTML = '';
  els.summaryScroll.scrollTop = 0;
  els.summary.removeAttribute('aria-busy');
  hideSummaryActions();
  resetQa();
  setQaReady(false);
  stopTts();
}

/* ====================================================================== */
/* Zusammenfassen                                                         */
/* ====================================================================== */

async function summarize({ force = false, fokusOverride = null } = {}) {
  if (!page.url) return;
  const fokus = fokusOverride || prefs.fokus;
  const key = cacheKey({ fokus });

  if ((page.kind === 'text' || page.kind === 'selection') && (!page.text || page.text.length < 40)) return;

  clearError();
  stopTts();

  if (!force) {
    const cached = await cacheGet(key);
    if (cached?.markdown) { showSummary(cached.markdown, fokus, true); lastKey = key; return; }
  }

  if (abort) abort.abort();
  abort = new AbortController();

  lastKey = key;
  lastFokusUsed = fokus;
  currentMarkdown = '';
  els.reloadBtn.classList.add('spinning');
  els.result.hidden = false;
  hideSummaryActions();
  setQaReady(false);
  els.qa.hidden = true;
  els.summary.setAttribute('aria-busy', 'true');
  els.summary.innerHTML = '<div class="summary-loading"><span class="loading-spinner" aria-hidden="true"></span><span>Zusammenfassung wird erstellt...</span></div>';
  els.summaryScroll.scrollTop = 0;

  const body = {
    kind: page.kind, text: page.text, title: page.title, url: page.url,
    length: prefs.length,
    fokus: focusToBackend(fokus),
    customFocus: focusPromptForBackend(fokus),
    plain: prefs.plain, zielsprache: targetLanguage(),
  };

  let acc = '';
  try {
    const r = await fetch(`${BACKEND}/api/summarize`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: abort.signal,
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Backend nicht erreichbar.'); }
    await consumeSse(r, (delta) => {
      acc += delta;
      els.summary.innerHTML = renderMarkdown(acc) + '<span class="cursor"></span>';
    });

    currentMarkdown = acc.trim();
    els.summary.innerHTML = renderMarkdown(currentMarkdown);
    els.summary.removeAttribute('aria-busy');
    showSummaryActions(fokus);
    await cachePut(key, { markdown: currentMarkdown, ts: Date.now(), fokus });
    if (qaCurrentUrlKey !== normalizeUrl(page.url)) resetQa();
  } catch (e) {
    if (e.name === 'AbortError') return;
    els.summary.removeAttribute('aria-busy');
    els.summary.innerHTML = '';
    els.result.hidden = true;
    hideSummaryActions();
    setQaReady(false);
    showError(
      e.message.includes('Failed to fetch') || e.message.includes('nicht erreichbar')
        ? 'Backend nicht erreichbar. Läuft der Server auf http://localhost:3000?'
        : e.message
    );
  } finally {
    els.reloadBtn.classList.remove('spinning');
  }
}

function showSummary(markdown, fokus, fromCache) {
  currentMarkdown = markdown;
  lastFokusUsed = fokus;
  els.result.hidden = false;
  els.summary.removeAttribute('aria-busy');
  els.summary.innerHTML = renderMarkdown(markdown);
  showSummaryActions(fokus);
  if (qaCurrentUrlKey !== normalizeUrl(page.url)) resetQa();
}

function showSummaryActions() {
  els.ttsBtn.hidden = false;
  els.shareBtn.hidden = false;
  setQaReady(Boolean(currentMarkdown));
}

function hideSummaryActions() {
  closeShareMenu();
  els.ttsBtn.hidden = true;
  els.shareBtn.hidden = true;
}

async function consumeSse(response, onDelta) {
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const events = buf.split('\n\n');
    buf = events.pop();
    for (const ev of events) {
      const lines = ev.split('\n');
      const type = (lines.find((l) => l.startsWith('event:')) || '').slice(6).trim();
      const dataLine = lines.find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      let data;
      try { data = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
      if (type === 'error') throw new Error(data.message || 'Fehler');
      if (data.delta) onDelta(data.delta);
    }
  }
}

/* ====================================================================== */
/* TTS                                                                    */
/* ====================================================================== */

let ttsUtterance = null;
function stripMarkdownForTts(md) {
  return md
    .replace(/```[\s\S]*?```/g, '').replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, '')
    .replace(/^\s*\|(.+)\|\s*$/gm, (_, row) => row.split('|').map((cell) => cell.trim()).filter(Boolean).join('. '))
    .replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '').replace(/\n{2,}/g, '. ').replace(/\n/g, ' ');
}
function ttsLang() {
  return ({
    de: 'de-DE', en: 'en-US', es: 'es-ES', fr: 'fr-FR', it: 'it-IT',
    pt: 'pt-PT', nl: 'nl-NL', pl: 'pl-PL', tr: 'tr-TR', uk: 'uk-UA',
    ru: 'ru-RU', ar: 'ar-SA', he: 'he-IL', fa: 'fa-IR', hi: 'hi-IN',
    bn: 'bn-BD', ta: 'ta-IN', te: 'te-IN', mr: 'mr-IN', pa: 'pa-IN',
    ur: 'ur-PK', 'zh-Hans': 'zh-CN', ja: 'ja-JP', ko: 'ko-KR',
    vi: 'vi-VN', id: 'id-ID', ms: 'ms-MY', th: 'th-TH', sw: 'sw-KE',
    sv: 'sv-SE', da: 'da-DK', no: 'nb-NO', fi: 'fi-FI', cs: 'cs-CZ',
    el: 'el-GR', ro: 'ro-RO', hu: 'hu-HU',
  })[targetLanguage()] || 'de-DE';
}
function setTtsState(playing) {
  els.ttsBtn.setAttribute('aria-pressed', String(playing));
  els.ttsBtn.title = playing ? 'Vorlesen stoppen' : 'Vorlesen';
  els.ttsBtn.setAttribute('aria-label', playing ? 'Vorlesen stoppen' : 'Vorlesen');
}
function speak() {
  if (!('speechSynthesis' in window) || !currentMarkdown) return;
  stopTts();
  const u = new SpeechSynthesisUtterance(stripMarkdownForTts(currentMarkdown));
  u.lang = ttsLang(); u.rate = 1.0;
  u.onend = () => { ttsUtterance = null; setTtsState(false); };
  u.onerror = () => { ttsUtterance = null; setTtsState(false); };
  ttsUtterance = u;
  speechSynthesis.speak(u);
  setTtsState(true);
}
function stopTts() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  ttsUtterance = null; setTtsState(false);
}
function toggleTts() { if (ttsUtterance) stopTts(); else speak(); }

/* ====================================================================== */
/* Q&A                                                                    */
/* ====================================================================== */

function resetQa() {
  qaHistory = [];
  qaCurrentUrlKey = normalizeUrl(page.url);
  els.qaThread.innerHTML = '';
  els.qa.hidden = true;
  if (qaAbort) { qaAbort.abort(); qaAbort = null; }
}
function appendQaMsg(role, text) {
  els.qa.hidden = false;
  const div = document.createElement('div');
  div.className = 'qa-msg ' + role;
  div.innerHTML = role === 'assistant' ? renderMarkdown(text) : escapeHtml(text);
  els.qaThread.appendChild(div);
  scrollResultToBottom();
  return div;
}
function escapeHtml(s) { return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }
function scrollResultToBottom() {
  requestAnimationFrame(() => {
    els.summaryScroll.scrollTop = els.summaryScroll.scrollHeight;
  });
}

async function askQuestion(question) {
  if (!question) return;
  if (!currentMarkdown) {
    showError('Bitte warte, bis die Zusammenfassung fertig ist.');
    return;
  }
  clearError();
  appendQaMsg('user', question);
  qaHistory.push({ role: 'user', content: question });
  const msgEl = appendQaMsg('assistant', '');
  msgEl.innerHTML = '<span class="cursor"></span>';

  if (qaAbort) qaAbort.abort();
  qaAbort = new AbortController();

  let acc = '';
  try {
    const r = await fetch(`${BACKEND}/api/qa`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: page.text, summary: currentMarkdown, title: page.title, url: page.url, question,
        history: qaHistory.slice(0, -1), zielsprache: targetLanguage(), plain: prefs.plain,
      }),
      signal: qaAbort.signal,
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Backend-Fehler.'); }
    await consumeSse(r, (delta) => {
      acc += delta;
      msgEl.innerHTML = renderMarkdown(acc) + '<span class="cursor"></span>';
      scrollResultToBottom();
    });
    msgEl.innerHTML = renderMarkdown(acc);
    scrollResultToBottom();
    qaHistory.push({ role: 'assistant', content: acc });
  } catch (e) {
    if (e.name === 'AbortError') return;
    msgEl.innerHTML = `<em style="color:var(--err)">${escapeHtml(e.message)}</em>`;
  }
}

els.qaForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = els.qaInput.value.trim();
  if (!q) return;
  els.qaInput.value = '';
  askQuestion(q);
});

/* ====================================================================== */
/* Optionen-Interaktion                                                   */
/* ====================================================================== */

function onOptionChange() { savePrefs(); if (page.url) summarize(); }
function onSettingsChange({ refreshSummary = false } = {}) {
  savePrefs();
  if (refreshSummary) settingsRefreshPending = true;
}

/* ---- Custom-Dropdowns (Stil & Länge) ---- */
const dropdowns = new Map();
let openDropdownKey = null;

function setupDropdown({ key, trigger, menu, render, onSelect }) {
  const ctrl = { trigger, menu, render, onSelect };
  dropdowns.set(key, ctrl);
  trigger.addEventListener('click', () => toggleDropdown(key));
  menu.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-value]');
    if (!opt) return;
    closeDropdown(key);
    trigger.focus();
    ctrl.onSelect(opt.dataset.value);
  });
}
function openDropdown(key) {
  if (openDropdownKey && openDropdownKey !== key) closeDropdown(openDropdownKey);
  closeShareMenu();
  const ctrl = dropdowns.get(key);
  ctrl.menu.innerHTML = ctrl.render();
  ctrl.menu.hidden = false;
  ctrl.trigger.setAttribute('aria-expanded', 'true');
  openDropdownKey = key;
  document.addEventListener('click', onDropdownOutside, true);
  document.addEventListener('keydown', onDropdownKey);
  (ctrl.menu.querySelector('[aria-selected="true"]') || ctrl.menu.querySelector('[data-value]'))?.focus();
}
function closeDropdown(key) {
  const ctrl = dropdowns.get(key);
  if (!ctrl || ctrl.menu.hidden) return;
  ctrl.menu.hidden = true;
  ctrl.trigger.setAttribute('aria-expanded', 'false');
  if (openDropdownKey === key) openDropdownKey = null;
  document.removeEventListener('click', onDropdownOutside, true);
  document.removeEventListener('keydown', onDropdownKey);
}
function toggleDropdown(key) {
  const ctrl = dropdowns.get(key);
  ctrl.menu.hidden ? openDropdown(key) : closeDropdown(key);
}
function onDropdownOutside(e) {
  if (!openDropdownKey) return;
  const ctrl = dropdowns.get(openDropdownKey);
  if (!ctrl.trigger.contains(e.target) && !ctrl.menu.contains(e.target)) closeDropdown(openDropdownKey);
}
function onDropdownKey(e) {
  if (!openDropdownKey) return;
  const ctrl = dropdowns.get(openDropdownKey);
  if (e.key === 'Escape') {
    const t = ctrl.trigger; closeDropdown(openDropdownKey); t.focus();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const opts = [...ctrl.menu.querySelectorAll('[data-value]')];
    const idx = opts.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? Math.min(opts.length - 1, idx + 1) : Math.max(0, idx - 1);
    opts[idx < 0 ? 0 : next]?.focus();
  }
}

setupDropdown({
  key: 'fokus', trigger: els.fokusTrigger, menu: els.fokusMenu, render: renderFokusOptions,
  onSelect: (value) => {
    prefs.fokus = value;
    prefs._userTouchedFokus = true;
    reflectPrefs();
    onOptionChange();
  },
});
setupDropdown({
  key: 'length', trigger: els.lengthTrigger, menu: els.lengthMenu, render: renderLengthOptions,
  onSelect: (value) => {
    prefs.length = value;
    reflectPrefs();
    onOptionChange();
  },
});
els.zielsprache.addEventListener('change', () => { prefs.zielsprache = normalizeLanguage(els.zielsprache.value); onSettingsChange({ refreshSummary: true }); });
els.plain.addEventListener('change', () => { prefs.plain = els.plain.checked; onSettingsChange({ refreshSummary: true }); });
els.autoRun.addEventListener('change', () => { prefs.autoRun = els.autoRun.checked; onSettingsChange(); });

function setFontSize(size) {
  if (!FONT_SIZES.has(size) || size === prefs.fontSize) return;
  prefs.fontSize = size;
  applyFontSize();
  savePrefs();
}
els.fontSizeSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (btn) setFontSize(btn.dataset.size);
});
els.fontSizeSeg.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  e.preventDefault();
  const order = ['normal', 'gross', 'sehrgross'];
  const idx = order.indexOf(prefs.fontSize);
  const next = e.key === 'ArrowRight' ? Math.min(order.length - 1, idx + 1) : Math.max(0, idx - 1);
  setFontSize(order[next]);
  els.fontSizeSeg.querySelector(`[data-size="${order[next]}"]`)?.focus();
});

els.reloadBtn.addEventListener('click', () => summarize({ force: true }));

async function copyText(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-999px';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('copy failed');
}

function openShareMenu() {
  if (openDropdownKey) closeDropdown(openDropdownKey);
  els.shareMenu.hidden = false;
  els.shareBtn.setAttribute('aria-expanded', 'true');
  document.addEventListener('click', onShareOutside, true);
  document.addEventListener('keydown', onShareKey);
}
function closeShareMenu() {
  if (els.shareMenu.hidden) return;
  els.shareMenu.hidden = true;
  els.shareBtn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('click', onShareOutside, true);
  document.removeEventListener('keydown', onShareKey);
}
function onShareOutside(e) {
  if (!els.shareBtn.contains(e.target) && !els.shareMenu.contains(e.target)) closeShareMenu();
}
function onShareKey(e) {
  if (e.key === 'Escape') { closeShareMenu(); els.shareBtn.focus(); }
}

els.shareBtn.addEventListener('click', () =>
  els.shareMenu.hidden ? openShareMenu() : closeShareMenu()
);

els.copyBtn.addEventListener('click', async () => {
  closeShareMenu();
  try {
    await copyText(currentMarkdown);
    clearError();
    showToast('In die Zwischenablage kopiert');
  } catch { showError('Zwischenablage nicht verfügbar.'); }
});

els.downloadBtn.addEventListener('click', () => {
  closeShareMenu();
  const filename = (page.title || 'zusammenfassung').replace(/[^\w\-]+/g, '_').slice(0, 80) + '.md';
  const blob = new Blob([currentMarkdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  if (chrome.downloads?.download) {
    chrome.downloads.download({ url, filename, saveAs: true }, () => setTimeout(() => URL.revokeObjectURL(url), 5000));
  } else {
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
});

els.ttsBtn.addEventListener('click', toggleTts);

/* ====================================================================== */
/* Fokus-Punkte                                                           */
/* ====================================================================== */

function newFocusId() {
  return 'focus_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function openFocusDialog(id = '') {
  const item = prefs.focusPoints.find((f) => f.id === id);
  els.customFocusId.value = item?.id || '';
  els.customFocusName.value = item?.name || '';
  els.customFocusDesc.value = item?.desc || '';
  els.customFocusPrompt.value = item?.prompt || '';
  els.customFocusName.disabled = Boolean(item?.locked);
  els.customFocusDesc.disabled = Boolean(item?.locked);
  els.customFocusPrompt.disabled = Boolean(item?.locked);
  els.customFocusDelete.hidden = !item || item.locked;
  els.customFocusEditorTitle.textContent = item ? 'Stil bearbeiten' : 'Neuen Stil erstellen';
  renderCustomFocusList();
  els.focusDialogScrim.hidden = false;
  els.focusDialog.hidden = false;
  els.customFocusName.focus();
}
function closeFocusDialog() {
  els.focusDialogScrim.hidden = true;
  els.focusDialog.hidden = true;
}
function renderCustomFocusList() {
  if (!els.customFocusList) return;
  els.customFocusList.innerHTML = '';
  let visibleCount = 0;
  prefs.focusPoints.forEach((item) => {
    if (item.locked) return;
    visibleCount++;
    const row = document.createElement('div');
    row.className = 'custom-focus-item';
    row.dataset.id = item.id;
    row.innerHTML = `
      <div class="focus-item-main">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.locked ? STANDARD_DESC : (item.desc || item.prompt))}</span>
        ${item.locked ? '<em class="focus-badge">Geschützt</em>' : ''}
      </div>
      <div class="focus-item-actions">
        <button class="focus-item-btn" type="button" data-action="edit" title="${item.locked ? 'Standard kann nicht bearbeitet werden' : 'Bearbeiten'}" aria-label="${escapeAttr(item.name)} bearbeiten" ${item.locked ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
        <button class="focus-item-btn focus-item-btn--danger" type="button" data-action="delete" title="${item.locked ? 'Standard kann nicht gelöscht werden' : 'Löschen'}" aria-label="${escapeAttr(item.name)} löschen" ${item.locked ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
    `;
    els.customFocusList.appendChild(row);
  });
  if (!visibleCount) {
    const empty = document.createElement('p');
    empty.className = 'custom-focus-empty';
    empty.textContent = 'Keine bearbeitbaren Stile. Lege einen neuen Stil an oder stelle die Standard-Stile wieder her.';
    els.customFocusList.appendChild(empty);
  }
}
function saveCustomFocusFromForm() {
  const existing = prefs.focusPoints.find((f) => f.id === els.customFocusId.value);
  if (existing?.locked) return;
  const name = els.customFocusName.value.trim();
  const prompt = els.customFocusPrompt.value.trim();
  if (!name || !prompt) {
    showError('Ein Stil braucht einen Namen und eine Anweisung.');
    return;
  }
  clearError();
  const id = els.customFocusId.value || newFocusId();
  const desc = els.customFocusDesc.value.trim();
  const item = { id, name: name.slice(0, 38), desc: desc.slice(0, 80), prompt: prompt.slice(0, 1800) };
  const idx = prefs.focusPoints.findIndex((f) => f.id === id);
  if (idx >= 0) prefs.focusPoints[idx] = item;
  else prefs.focusPoints.push(item);
  prefs.focusPoints = sanitizeFocusPoints(prefs.focusPoints);
  prefs.fokus = id;
  savePrefs();
  reflectPrefs();
  closeFocusDialog();
  settingsRefreshPending = true;
}
async function deleteFocusPoint(id = els.customFocusId.value) {
  if (!id) return;
  const item = prefs.focusPoints.find((f) => f.id === id);
  if (!item || item.locked) return;
  const ok = await askConfirm({
    title: 'Stil löschen?',
    text: `„${item.name}“ wird dauerhaft entfernt. Das lässt sich nicht rückgängig machen.`,
    confirmLabel: 'Löschen',
  });
  if (!ok) return;
  const deletedActiveFocus = prefs.fokus === id;
  prefs.focusPoints = prefs.focusPoints.filter((f) => f.id !== id);
  if (deletedActiveFocus) prefs.fokus = 'standard';
  savePrefs();
  reflectPrefs();
  closeFocusDialog();
  if (deletedActiveFocus || lastFokusUsed === id) settingsRefreshPending = true;
}
async function resetFocusPoints() {
  const ok = await askConfirm({
    title: 'Stile zurücksetzen?',
    text: 'Alle eigenen Stile werden gelöscht und die Standard-Stile wiederhergestellt.',
    confirmLabel: 'Zurücksetzen',
  });
  if (!ok) return;
  prefs.focusPoints = cloneDefaultFocusPoints();
  if (!getFocusById(prefs.fokus)) prefs.fokus = 'standard';
  savePrefs();
  reflectPrefs();
  closeFocusDialog();
  settingsRefreshPending = true;
}

els.customFocusNew.addEventListener('click', () => openFocusDialog(''));
els.customFocusList.addEventListener('click', (e) => {
  const row = e.target.closest('.custom-focus-item');
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!row || !action) return;
  if (action === 'edit') openFocusDialog(row.dataset.id);
  if (action === 'delete') deleteFocusPoint(row.dataset.id);
});
els.customFocusForm.addEventListener('submit', (e) => {
  e.preventDefault();
  saveCustomFocusFromForm();
});
els.customFocusDelete.addEventListener('click', () => deleteFocusPoint());
els.focusReset.addEventListener('click', resetFocusPoints);
els.focusDialogClose.addEventListener('click', closeFocusDialog);
els.focusDialogScrim.addEventListener('click', closeFocusDialog);

/* ====================================================================== */
/* Bestätigungsdialog                                                     */
/* ====================================================================== */

let confirmResolve = null;
function askConfirm({ title, text, confirmLabel = 'Bestätigen' }) {
  els.confirmTitle.textContent = title;
  els.confirmText.textContent = text;
  els.confirmOk.textContent = confirmLabel;
  els.confirmScrim.hidden = false;
  els.confirmDialog.hidden = false;
  els.confirmOk.focus();
  document.addEventListener('keydown', onConfirmKey);
  return new Promise((resolve) => { confirmResolve = resolve; });
}
function settleConfirm(result) {
  if (!confirmResolve) return;
  els.confirmScrim.hidden = true;
  els.confirmDialog.hidden = true;
  document.removeEventListener('keydown', onConfirmKey);
  const resolve = confirmResolve;
  confirmResolve = null;
  resolve(result);
}
function onConfirmKey(e) {
  if (e.key === 'Escape') settleConfirm(false);
  else if (e.key === 'Enter') settleConfirm(true);
}
els.confirmOk.addEventListener('click', () => settleConfirm(true));
els.confirmCancel.addEventListener('click', () => settleConfirm(false));
els.confirmScrim.addEventListener('click', () => settleConfirm(false));

/* ====================================================================== */
/* Einstellungen-Popover                                                  */
/* ====================================================================== */

function openSettings() {
  settingsRefreshPending = false;
  closeShareMenu();
  els.mainView.hidden = true;
  els.settingsPanel.hidden = false;
  els.settingsBtn.setAttribute('aria-expanded', 'true');
  document.addEventListener('keydown', onSettingsKey);
  els.settingsClose.focus();
}
function closeSettings() {
  els.settingsPanel.hidden = true;
  els.mainView.hidden = false;
  els.settingsBtn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('keydown', onSettingsKey);
  if (settingsRefreshPending && page.url) summarize({ force: true });
  settingsRefreshPending = false;
}
function onSettingsKey(e) { if (e.key === 'Escape') closeSettings(); }

els.settingsBtn.addEventListener('click', () =>
  els.settingsPanel.hidden ? openSettings() : closeSettings()
);
els.settingsClose.addEventListener('click', closeSettings);

/* ====================================================================== */
/* Tab-Wechsel mit Debounce                                               */
/* ====================================================================== */

function scheduleTabSwitch(delay = 500) {
  clearTimeout(tabSwitchTimer);
  tabSwitchTimer = setTimeout(async () => {
    const prevUrl = page.url;
    const ok = await loadCurrentPage();
    if (!ok) return;
    if (page.url === prevUrl) return;
    clearSummaryState();
    const key = cacheKey();
    const cached = await cacheGet(key);
    if (cached?.markdown) { showSummary(cached.markdown, prefs.fokus, true); lastKey = key; return; }
    if (prefs.autoRun) summarize();
  }, delay);
}

chrome.tabs.onActivated.addListener(() => scheduleTabSwitch(500));
chrome.tabs.onUpdated.addListener((id, info, tab) => {
  if (info.status === 'complete' && tab.active) scheduleTabSwitch(500);
});

/* ====================================================================== */
/* Nachrichten aus Background                                             */
/* ====================================================================== */

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'suntino:selection')  consumePendingSelection();
  if (msg.type === 'suntino:regenerate') summarize({ force: true });
  if (msg.type === 'suntino:toggle-tts') toggleTts();
});

async function consumePendingSelection() {
  const { pendingSelection } = await chrome.storage.session.get('pendingSelection');
  if (!pendingSelection?.text) return;
  await chrome.storage.session.remove('pendingSelection');
  page = {
    text: pendingSelection.text, title: pendingSelection.title || 'Auswahl',
    url: pendingSelection.url || '', kind: 'selection',
  };
  const words = page.text.split(/\s+/).length;
  setSource(pendingSelection.title || 'Markierter Text', `Auswahl · ~${words.toLocaleString('de')} Wörter`, faviconFor(pendingSelection.url || ''));
  els.reloadBtn.disabled = false;
  summarize({ force: true });
}

/* ====================================================================== */
/* Hotreload                                                              */
/* ====================================================================== */

async function startHotReload() {
  let on = false;
  try { const r = await fetch(`${BACKEND}/api/health`); on = r.ok && (await r.json()).hotreload; } catch {}
  if (!on) return;
  let baseAll = null, baseCore = null;
  setInterval(async () => {
    try {
      const r = await fetch(`${BACKEND}/api/version`);
      if (!r.ok) return;
      const { all, core } = await r.json();
      if (baseAll === null) { baseAll = all; baseCore = core; return; }
      if (core !== baseCore) { chrome.runtime.reload(); return; }
      if (all !== baseAll) { baseAll = all; location.reload(); }
    } catch {}
  }, 2000);
}

/* ====================================================================== */
/* Start                                                                  */
/* ====================================================================== */

(async function init() {
  await loadPrefs();
  reflectPrefs();

  const { pendingSelection } = await chrome.storage.session.get('pendingSelection');
  if (pendingSelection?.text && (Date.now() - (pendingSelection.ts || 0) < 15_000)) {
    await consumePendingSelection();
  } else {
    const ok = await loadCurrentPage();
    if (ok) {
      const key = cacheKey();
      const cached = await cacheGet(key);
      if (cached?.markdown) { showSummary(cached.markdown, prefs.fokus, true); lastKey = key; }
      else summarize();
    }
  }
  startHotReload();
})();
