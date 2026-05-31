const BACKEND = 'http://localhost:3000';

const els = {
  favicon: document.getElementById('favicon'),
  sourceTitle: document.getElementById('sourceTitle'),
  sourceMeta: document.getElementById('sourceMeta'),
  fokusGrid: document.getElementById('fokusGrid'),
  lengthSeg: document.getElementById('lengthSeg'),
  segIndicator: document.getElementById('segIndicator'),
  zielsprache: document.getElementById('zielsprache'),
  plain: document.getElementById('plain'),
  autoRun: document.getElementById('autoRun'),
  reloadBtn: document.getElementById('reloadBtn'),
  result: document.getElementById('result'),
  summary: document.getElementById('summary'),
  copyBtn: document.getElementById('copyBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  ttsBtn: document.getElementById('ttsBtn'),
  askBtn: document.getElementById('askBtn'),
  fallbackBtn: document.getElementById('fallbackBtn'),
  qa: document.getElementById('qa'),
  qaThread: document.getElementById('qaThread'),
  qaForm: document.getElementById('qaForm'),
  qaInput: document.getElementById('qaInput'),
  status: document.getElementById('status'),
  error: document.getElementById('error'),
  // Settings
  settingsBtn: document.getElementById('settingsBtn'),
  settingsClose: document.getElementById('settingsClose'),
  settingsPanel: document.getElementById('settingsPanel'),
  settingsScrim: document.getElementById('settingsScrim'),
};

function setStatus(msg, kind = '') {
  els.status.textContent = msg || '';
  els.status.className = 'status' + (kind ? ' ' + kind : '');
}
function showError(msg) { els.error.textContent = msg; els.error.hidden = false; }
function clearError() { els.error.hidden = true; els.error.textContent = ''; }

/* ====================================================================== */
/* State                                                                  */
/* ====================================================================== */

const LENGTH_ORDER = ['kurz', 'mittel', 'lang'];

let page = { text: '', title: '', url: '', kind: 'text' };
let prefs = {
  fokus: 'ueberblick',
  length: 'mittel',
  zielsprache: 'de',
  plain: false,
  autoRun: true,
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

/* ====================================================================== */
/* Persistenz                                                             */
/* ====================================================================== */

async function loadPrefs() {
  const saved = await chrome.storage.local.get(['fokus', 'length', 'plain', 'zielsprache', 'autoRun']);
  if (saved.fokus) prefs.fokus = saved.fokus;
  if (saved.length) prefs.length = saved.length;
  if (typeof saved.plain === 'boolean') prefs.plain = saved.plain;
  if (saved.zielsprache) prefs.zielsprache = saved.zielsprache;
  if (typeof saved.autoRun === 'boolean') prefs.autoRun = saved.autoRun;
}
function savePrefs() {
  chrome.storage.local.set({
    fokus: prefs.fokus, length: prefs.length, plain: prefs.plain,
    zielsprache: prefs.zielsprache, autoRun: prefs.autoRun,
  });
}
function reflectPrefs() {
  els.fokusGrid.querySelectorAll('.focus-card').forEach((b) =>
    b.setAttribute('aria-checked', String(b.dataset.val === prefs.fokus))
  );
  els.lengthSeg.querySelectorAll('.seg-opt').forEach((b) =>
    b.setAttribute('aria-checked', String(b.dataset.val === prefs.length))
  );
  els.segIndicator.style.setProperty('--seg-i', String(LENGTH_ORDER.indexOf(prefs.length)));
  els.zielsprache.value = prefs.zielsprache;
  els.plain.checked = prefs.plain;
  els.autoRun.checked = prefs.autoRun;
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
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{2,4})\s+(.*)$/);
    const todoLi = line.match(/^\s*-\s+\[( |x|X)\]\s+(.*)$/);
    const li = line.match(/^\s*[-*]\s+(.*)$/);
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
    return false;
  }

  if (page.text.length < 40) {
    setSource(page.title || 'Seite', 'Kaum Text gefunden', favUrl);
    els.reloadBtn.disabled = true;
    return false;
  }

  if (page.paperLike && prefs.fokus === 'ueberblick' && !prefs._userTouchedFokus) {
    prefs.fokus = 'wissenschaftlich';
    reflectPrefs();
  }

  const words = page.text.split(/\s+/).length;
  setSource(page.title || 'Seite', `~${words.toLocaleString('de')} Wörter`, favUrl);
  return true;
}

/* ====================================================================== */
/* Cache                                                                  */
/* ====================================================================== */

function cacheKey(extra = {}) {
  return 'sum:' + JSON.stringify({
    u: normalizeUrl(page.url),
    f: extra.fokus ?? prefs.fokus,
    l: prefs.length, p: prefs.plain ? 1 : 0, z: prefs.zielsprache, k: page.kind,
  });
}
async function cacheGet(key) {
  try { const r = await chrome.storage.session.get(key); return r[key] || null; } catch { return null; }
}
async function cachePut(key, entry) {
  try { await chrome.storage.session.set({ [key]: entry }); } catch {}
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
  els.reloadBtn.classList.add('spinning');
  els.result.hidden = false;
  [els.copyBtn, els.downloadBtn, els.ttsBtn, els.askBtn, els.fallbackBtn].forEach((b) => (b.hidden = true));
  els.qa.hidden = true;
  els.summary.setAttribute('aria-busy', 'true');
  els.summary.innerHTML = '<span class="cursor"></span>';
  setStatus('Erstelle Zusammenfassung …');

  const body = {
    kind: page.kind, text: page.text, title: page.title, url: page.url,
    length: prefs.length, fokus, plain: prefs.plain, zielsprache: prefs.zielsprache,
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
    setStatus('Fertig.');
    await cachePut(key, { markdown: currentMarkdown, ts: Date.now(), fokus });
    if (qaCurrentUrlKey !== normalizeUrl(page.url)) resetQa();
  } catch (e) {
    if (e.name === 'AbortError') return;
    els.summary.removeAttribute('aria-busy');
    els.summary.innerHTML = '';
    els.result.hidden = true;
    setStatus('');
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
  setStatus(fromCache ? 'Aus Cache — sofort, kein API-Call.' : 'Fertig.', fromCache ? 'cached' : '');
  if (qaCurrentUrlKey !== normalizeUrl(page.url)) resetQa();
}

function showSummaryActions(fokus) {
  els.copyBtn.hidden = false;
  els.downloadBtn.hidden = false;
  els.ttsBtn.hidden = false;
  els.askBtn.hidden = page.kind === 'video'; // kein Text → kein Q&A
  els.fallbackBtn.hidden = fokus === 'ueberblick';
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
    .replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '').replace(/\n{2,}/g, '. ').replace(/\n/g, ' ');
}
function ttsLang() {
  return ({ de: 'de-DE', en: 'en-US', tr: 'tr-TR', fr: 'fr-FR', es: 'es-ES' })[prefs.zielsprache] || 'de-DE';
}
function setTtsState(playing) {
  els.ttsBtn.setAttribute('aria-pressed', String(playing));
  els.ttsBtn.querySelector('span').textContent = playing ? 'Stoppen' : 'Vorlesen';
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
function openQa() {
  if (page.kind === 'video') return;
  els.qa.hidden = false;
  els.qaInput.focus();
  els.qa.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function appendQaMsg(role, text) {
  const div = document.createElement('div');
  div.className = 'qa-msg ' + role;
  div.innerHTML = role === 'assistant' ? renderMarkdown(text) : escapeHtml(text);
  els.qaThread.appendChild(div);
  div.scrollIntoView({ block: 'end', behavior: 'smooth' });
  return div;
}
function escapeHtml(s) { return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

async function askQuestion(question) {
  if (!question || page.kind === 'video') return;
  if (!page.text || page.text.length < 40) {
    showError('Q&A braucht Seitentext — bei PDFs/Videos derzeit nicht verfügbar.');
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
        text: page.text, title: page.title, url: page.url, question,
        history: qaHistory.slice(0, -1), zielsprache: prefs.zielsprache, plain: prefs.plain,
      }),
      signal: qaAbort.signal,
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Backend-Fehler.'); }
    await consumeSse(r, (delta) => {
      acc += delta;
      msgEl.innerHTML = renderMarkdown(acc) + '<span class="cursor"></span>';
    });
    msgEl.innerHTML = renderMarkdown(acc);
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

els.fokusGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('.focus-card');
  if (!btn) return;
  prefs.fokus = btn.dataset.val;
  prefs._userTouchedFokus = true;
  reflectPrefs();
  onOptionChange();
});
els.lengthSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-opt');
  if (!btn) return;
  prefs.length = btn.dataset.val;
  reflectPrefs();
  onOptionChange();
});
els.zielsprache.addEventListener('change', () => { prefs.zielsprache = els.zielsprache.value; onOptionChange(); });
els.plain.addEventListener('change', () => { prefs.plain = els.plain.checked; onOptionChange(); });
els.autoRun.addEventListener('change', () => { prefs.autoRun = els.autoRun.checked; savePrefs(); });

els.reloadBtn.addEventListener('click', () => summarize({ force: true }));

els.copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentMarkdown);
    const span = els.copyBtn.querySelector('span');
    span.textContent = 'Kopiert ✓';
    setTimeout(() => { span.textContent = 'Kopieren'; }, 1500);
  } catch { showError('Zwischenablage nicht verfügbar.'); }
});

els.downloadBtn.addEventListener('click', () => {
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
els.askBtn.addEventListener('click', openQa);
els.fallbackBtn.addEventListener('click', () => summarize({ force: true, fokusOverride: 'ueberblick' }));

/* ====================================================================== */
/* Einstellungen-Popover                                                  */
/* ====================================================================== */

function openSettings() {
  els.settingsScrim.hidden = false;
  els.settingsPanel.hidden = false;
  els.settingsBtn.setAttribute('aria-expanded', 'true');
  document.addEventListener('keydown', onSettingsKey);
}
function closeSettings() {
  els.settingsScrim.hidden = true;
  els.settingsPanel.hidden = true;
  els.settingsBtn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('keydown', onSettingsKey);
}
function onSettingsKey(e) { if (e.key === 'Escape') closeSettings(); }

els.settingsBtn.addEventListener('click', () =>
  els.settingsPanel.hidden ? openSettings() : closeSettings()
);
els.settingsClose.addEventListener('click', closeSettings);
els.settingsScrim.addEventListener('click', closeSettings);

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
