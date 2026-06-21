import 'dotenv/config';
import express from 'express';
import Mustache from 'mustache';
import OpenAI from 'openai';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

/* ---------- Modelle (zentral, damit Wechsel ein One-Liner bleibt) ----------
 * Hinweis: gemini-2.0-flash(-001/-lite) wird ab 2026-06-01 abgeschaltet.
 * Default deshalb auf eine aktuelle Generation. Überschreibbar via .env. */
const DEFAULT_MODEL       = 'google/gemini-2.5-flash-lite';
const DEFAULT_VIDEO_MODEL = 'google/gemini-2.5-flash';
const DEFAULT_PDF_MODEL   = 'google/gemini-2.5-flash';
const DEFAULT_LONG_MODEL  = 'google/gemini-2.5-pro';
// Leichte Sprache stellt hohe Anforderungen an Grammatik (Genitiv, Nominalstil,
// Satzlänge, Worterklärungen). Dafür ein stärkeres Modell als das Standard-Lite.
const DEFAULT_PLAIN_MODEL = 'google/gemini-2.5-flash';

const MODEL       = process.env.OPENROUTER_MODEL       || DEFAULT_MODEL;
const VIDEO_MODEL = process.env.OPENROUTER_VIDEO_MODEL || DEFAULT_VIDEO_MODEL;
const PDF_MODEL   = process.env.OPENROUTER_PDF_MODEL   || DEFAULT_PDF_MODEL;
const LONG_MODEL  = process.env.OPENROUTER_LONG_MODEL  || DEFAULT_LONG_MODEL;
const PLAIN_MODEL = process.env.OPENROUTER_PLAIN_MODEL || DEFAULT_PLAIN_MODEL;

const PORT = process.env.PORT || 3000;
const HOTRELOAD = process.env.HOTRELOAD !== '0';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, 'extension');
const PROMPT_DIR = join(__dirname, 'prompts');

const hasKey = Boolean(process.env.OPENROUTER_API_KEY);
const client = hasKey
  ? new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'X-Title': 'Suntino' },
    })
  : null;
if (!hasKey) {
  console.warn('\n[!] OPENROUTER_API_KEY ist nicht gesetzt. Nutze deinen eigenen Key im Plugin oder lege eine .env an.\n');
}

/* ---------- Rate-Limiting (10 Zusammenfassungen/Tag pro IP, ohne eigenen Key) ---------- */
const DAILY_LIMIT = 10;
const rateLimits = new Map(); // ip → { count, resetAt }

function nextMidnightUtc() {
  const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.getTime();
}
function checkRateLimit(ip) {
  const now = Date.now();
  let e = rateLimits.get(ip) || { count: 0, resetAt: nextMidnightUtc() };
  if (now >= e.resetAt) e = { count: 0, resetAt: nextMidnightUtc() };
  if (e.count >= DAILY_LIMIT) { rateLimits.set(ip, e); return false; }
  e.count++;
  rateLimits.set(ip, e);
  return true;
}
// Stale Einträge stündlich aufräumen
setInterval(() => { const now = Date.now(); for (const [ip, e] of rateLimits) if (now >= e.resetAt) rateLimits.delete(ip); }, 3_600_000);

function clientFor(userKey) {
  if (userKey) {
    return new OpenAI({ apiKey: userKey, baseURL: 'https://openrouter.ai/api/v1', defaultHeaders: { 'X-Title': 'Suntino' } });
  }
  return client;
}

const app = express();
app.set('trust proxy', 1); // Railway / Reverse-Proxy: echte Client-IP aus X-Forwarded-For
app.use(express.json({ limit: '12mb' }));

/* ---------- CORS ---------- */
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ====================================================================== */
/* Prompt-Bausteine                                                       */
/* ====================================================================== */

const LENGTH = {
  kurz:   { words: 'ca. 80–120 Wörter',   detail: 'nur die wichtigsten Kernpunkte', maxWords: 120, maxRows: 6 },
  mittel: { words: 'ca. 180–260 Wörter',  detail: 'die zentralen Aussagen mit etwas Kontext', maxWords: 260, maxRows: 10 },
  lang:   { words: 'ca. 400–550 Wörter',  detail: 'umfassend, inklusive relevanter Details und Beispiele', maxWords: 550, maxRows: 16 },
};

const LENGTH_RATIO = { kurz: 0.25, mittel: 0.4, lang: 0.6 };
const LENGTH_MIN = { kurz: 6, mittel: 10, lang: 14 };

const BUILTIN_FOCUS = new Set(['ueberblick', 'zahlen', 'procontra']);
// Stile, die Markdown-Tabellen erzeugen → höheres Token-Budget (s. buildMessages).
const TABLE_FOCUS = new Set(['zahlen', 'procontra']);

const LANG_NAMES = {
  de: 'Deutsch',
  en: 'Englisch',
  es: 'Spanisch',
  fr: 'Französisch',
  it: 'Italienisch',
  pt: 'Portugiesisch',
  nl: 'Niederländisch',
  pl: 'Polnisch',
  tr: 'Türkisch',
  uk: 'Ukrainisch',
  ru: 'Russisch',
  ar: 'Arabisch',
  he: 'Hebräisch',
  fa: 'Persisch',
  hi: 'Hindi',
  bn: 'Bengalisch',
  ta: 'Tamil',
  te: 'Telugu',
  mr: 'Marathi',
  pa: 'Punjabi',
  ur: 'Urdu',
  'zh-Hans': 'vereinfachtem Chinesisch',
  ja: 'Japanisch',
  ko: 'Koreanisch',
  vi: 'Vietnamesisch',
  id: 'Indonesisch',
  ms: 'Malaiisch',
  th: 'Thailändisch',
  sw: 'Suaheli',
  sv: 'Schwedisch',
  da: 'Dänisch',
  no: 'Norwegisch',
  fi: 'Finnisch',
  cs: 'Tschechisch',
  el: 'Griechisch',
  ro: 'Rumänisch',
  hu: 'Ungarisch',
};

function langClause(zielsprache) {
  const name = LANG_NAMES[zielsprache];
  return renderPrompt('partials/language.mustache', { languageName: name });
}

function renderPrompt(name, view = {}) {
  const template = readFileSync(join(PROMPT_DIR, name), 'utf8');
  return Mustache.render(template, view).trim();
}

function plainClause() {
  return renderPrompt('partials/plain.mustache');
}

function countWords(text = '') {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

function lengthForSource(length, sourceWords, plain = false) {
  const fallback = LENGTH[length] || LENGTH.mittel;
  if (!sourceWords) return fallback;
  const mode = LENGTH[length] ? length : 'mittel';
  // Leichte Sprache ist eine Umformulierung, KEINE Verdichtung: sehr kurze Sätze,
  // eigene Zeilen und Begriffserklärungen ("NATO" → "Die NATO ist ein Bündnis ...")
  // brauchen deutlich mehr Platz. Mit dem normalen, auf Verdichtung ausgelegten
  // Budget opfert das Modell zuerst genau diese Erklärungen. Daher bei plain:
  // größere Quote, höheres Cap, und der Verdichtungsmodus (oneLine) entfällt.
  const ratio = plain ? Math.min(0.95, LENGTH_RATIO[mode] * 2.2) : LENGTH_RATIO[mode];
  const cap = plain ? Math.round(fallback.maxWords * 1.8) : fallback.maxWords;
  const maxByRatio = Math.floor(sourceWords * ratio);
  const rawMaxWords = Math.max(LENGTH_MIN[mode], maxByRatio);
  // Bei plain darf die Ausgabe länger als die Quelle sein (Erklärungen); sonst nicht.
  const maxWords = plain
    ? Math.max(LENGTH_MIN[mode], Math.min(cap, rawMaxWords))
    : Math.max(4, Math.min(fallback.maxWords, rawMaxWords, sourceWords - 1));
  const oneLine = !plain && sourceWords <= 80;
  const detail = oneLine
    ? 'verdichte den Inhalt deutlich; keine Überschriften, kein TL;DR, keine Tabellen, keine zusätzlichen Beispiele'
    : plain
    ? `${fallback.detail}; nimm dir genug Platz, um schwere Wörter und Abkürzungen zu erklären`
    : `${fallback.detail}; bleibe deutlich kürzer als der Ausgangstext`;
  // Zeilenobergrenze für Tabellen-Stile (keine Tabellen bei sehr kurzen Quellen).
  const maxRows = oneLine ? 0 : (fallback.maxRows || LENGTH.mittel.maxRows);
  return {
    words: `maximal ${maxWords} Wörter`,
    detail,
    maxWords,
    maxRows,
    formatHint: oneLine
      ? 'Gib nur einen kurzen Satz oder wenige knappe Stichpunkte aus. Baue keine Struktur aus Überschriften, TL;DR oder Abschnitten.'
      : plain
      ? 'Die Regeln der Leichten Sprache haben Vorrang. Erkläre jedes schwere Wort, auch wenn der Text dadurch länger wird.'
      : 'Falls Stil-Regeln mehr Struktur verlangen, kürze die Struktur so weit, dass die maximale Wortzahl eingehalten wird.',
  };
}

function buildSystem({ fokus, customFocus, plain, zielsprache }) {
  const cleanCustomFocus = String(customFocus || '').trim().slice(0, 1800);
  const focusBlock = cleanCustomFocus
    ? renderPrompt('summary/custom-style.mustache', { customFocus: cleanCustomFocus })
    : renderPrompt(`summary/styles/${BUILTIN_FOCUS.has(fokus) ? fokus : 'ueberblick'}.mustache`);
  return renderPrompt('summary/system.mustache', {
    baseRules: renderPrompt('summary/base.mustache'),
    styleRules: focusBlock,
    plainRules: plain ? plainClause() : '',
    languageRules: langClause(zielsprache),
  });
}

function buildInstruction({ length, title, url, kind, sourceWords = 0, plain = false }) {
  const L = lengthForSource(length, sourceWords, plain);
  const kindInstruction =
    kind === 'video'     ? 'Fasse das oben verlinkte Video zusammen.' :
    kind === 'pdf'       ? 'Fasse das oben angehängte PDF zusammen.' :
    kind === 'selection' ? 'Fasse den oben stehenden, vom Nutzer markierten Textauszug zusammen.' :
                           'Fasse den oben stehenden Webseiten-Text zusammen.';
  return renderPrompt('summary/instruction.mustache', {
    kindInstruction,
    words: L.words,
    detail: L.detail,
    formatHint: L.formatHint || '',
    maxRows: L.maxRows || '',
    sourceWords: sourceWords ? sourceWords.toLocaleString('de-DE') : '',
    title,
    url,
  });
}

function wrapSource(text) {
  return renderPrompt('partials/source.mustache', { text });
}

/* ====================================================================== */
/* Routing: Text / YouTube / PDF                                          */
/* ====================================================================== */

function isYouTube(url = '') {
  return /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(url);
}
function isPdfUrl(url = '') {
  return /^https?:\/\/.+\.pdf(\?.*)?$/i.test(url);
}

/** Baut das messages-Array; wählt Modell anhand des Inhaltstyps. */
function buildMessages({ kind, text, url, title, length, fokus, customFocus, plain, zielsprache }) {
  const system = buildSystem({ fokus, customFocus, plain, zielsprache });
  const sourceWords = (kind === 'text' || kind === 'selection') ? countWords(text) : 0;
  const lengthTarget = lengthForSource(length, sourceWords, plain);
  const instruction = buildInstruction({ length, title, url, kind, sourceWords, plain });
  // max_tokens ist nur eine Sicherheitsgrenze (die Länge steuert der Prompt).
  // Tabellen-Stile begrenzen ihre Größe über die Zeilenanzahl (s. Prompt-Hinweis),
  // nicht über die Wortzahl — Markdown-Tabellen haben viel Syntax-Overhead, und
  // die Wortzahl bildet das nicht ab. Wir koppeln das Budget daher an maxRows,
  // großzügig bemessen (jede Zeile darf lange Kontext-Zellen haben), damit die
  // begrenzte Tabelle garantiert vollständig hineinpasst und nie mitten in einer
  // Zeile abgeschnitten wird. Custom-Stile können ebenfalls Tabellen anfordern.
  const hasCustom = Boolean(String(customFocus || '').trim());
  let maxTokens;
  if (TABLE_FOCUS.has(fokus)) {
    const rows = lengthTarget.maxRows || LENGTH.mittel.maxRows;
    maxTokens = Math.max(700, rows * 80 + 256);
  } else if (hasCustom) {
    // Könnte eine Tabelle sein → großzügiger als reiner Fließtext.
    maxTokens = lengthTarget.maxWords ? Math.ceil(lengthTarget.maxWords * 5) + 256 : 2048;
  } else {
    maxTokens = lengthTarget.maxWords ? Math.max(256, Math.ceil(lengthTarget.maxWords * 2.5) + 64) : 2048;
  }

  if (kind === 'video') {
    return {
      model: VIDEO_MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'video_url', video_url: { url } },
            { type: 'text', text: instruction },
          ],
        },
      ],
    };
  }

  if (kind === 'pdf') {
    return {
      model: PDF_MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            // OpenRouter "file"-Part — im OpenAI-SDK nicht typisiert, wird aber durchgereicht.
            { type: 'file', file: { file_data: url, filename: title || 'document.pdf' } },
            { type: 'text', text: instruction },
          ],
        },
      ],
      plugins: [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }],
    };
  }

  // text / selection
  const trimmed = String(text || '').slice(0, 120000);
  // sehr lange Seiten → großes Kontextmodell (gewinnt vor dem Leichte-Sprache-Modell,
  // da pro ohnehin stärker ist). Sonst hebt Leichte Sprache das Standard-Lite an.
  const model = trimmed.length > 50000 ? LONG_MODEL : (plain ? PLAIN_MODEL : MODEL);
  return {
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `${wrapSource(trimmed)}\n\n---\n\n${instruction}` },
    ],
  };
}

function friendly(err) {
  const status = err?.status;
  if (!err) return 'Kein API-Key verfügbar. Trage deinen OpenRouter-Key in den Plugin-Einstellungen ein.';
  if (status === 401) return 'Ungültiger API-Key. Bitte in den Einstellungen prüfen.';
  if (status === 402) return 'OpenRouter-Guthaben aufgebraucht oder Limit erreicht.';
  if (status === 404) return `Modell bei OpenRouter nicht gefunden (OPENROUTER_MODEL prüfen).`;
  if (status === 429) return 'Rate-Limit bei OpenRouter erreicht. Bitte kurz warten.';
  if (status >= 500) return 'Server-Fehler bei OpenRouter. Bitte erneut versuchen.';
  return err?.message || 'Unbekannter Fehler.';
}

/* ---------- SSE-Helfer ---------- */
function openSse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
}

async function streamCompletion(res, payload, activeClient) {
  const body = { temperature: 0.3, max_tokens: 2048, stream: true, ...payload };
  // OpenRouter akzeptiert "plugins" als Top-Level-Feld — der OpenAI-SDK schickt
  // unbekannte Felder als Teil des JSON-Body mit, also reicht das.
  const stream = await activeClient.chat.completions.create(body);
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
  }
  res.write(`event: done\ndata: {}\n\n`);
  res.end();
}

/* ====================================================================== */
/* /api/summarize                                                         */
/* ====================================================================== */

app.post('/api/summarize', async (req, res) => {
  const userKey = (req.headers['x-api-key'] || '').trim();
  const activeClient = clientFor(userKey);
  if (!activeClient) return res.status(503).json({ error: friendly() });
  if (!userKey && !checkRateLimit(req.ip || 'unknown')) {
    return res.status(429).json({ error: 'rate_limit', limit: DAILY_LIMIT });
  }

  const b = req.body || {};
  const length = ['kurz', 'mittel', 'lang'].includes(b.length) ? b.length : 'mittel';
  const customFocus = String(b.customFocus || '').trim().slice(0, 1800);
  const fokus  = BUILTIN_FOCUS.has(b.fokus) || customFocus ? b.fokus : 'ueberblick';
  const plain  = Boolean(b.plain);
  const zielsprache = LANG_NAMES[b.zielsprache] ? b.zielsprache : 'de';
  const title  = String(b.title || '').slice(0, 300);
  const url    = String(b.url   || '').slice(0, 1000);

  // Inhaltstyp bestimmen — explizit (kind) gewinnt, sonst aus URL ableiten.
  let kind = b.kind;
  if (!kind) {
    if (isYouTube(url)) kind = 'video';
    else if (isPdfUrl(url)) kind = 'pdf';
    else kind = 'text';
  }

  const text = String(b.text || '').trim();
  if (kind === 'text' && text.length < 40) {
    return res.status(400).json({ error: 'Auf dieser Seite wurde zu wenig Text gefunden.' });
  }
  if (kind === 'selection' && text.length < 8) {
    return res.status(400).json({ error: 'Auf dieser Seite wurde zu wenig Text gefunden.' });
  }
  if ((kind === 'video' || kind === 'pdf') && !url) {
    return res.status(400).json({ error: 'Für Video/PDF wird eine URL benötigt.' });
  }

  openSse(res);
  try {
    const payload = buildMessages({ kind, text, url, title, length, fokus, customFocus, plain, zielsprache });
    await streamCompletion(res, payload, activeClient);
  } catch (err) {
    console.error('summarize error:', err?.status, err?.message);
    res.write(`event: error\ndata: ${JSON.stringify({ message: friendly(err) })}\n\n`);
    res.end();
  }
});

/* ====================================================================== */
/* /api/qa  — kurze Konversation zur Seite (SSE)                          */
/* ====================================================================== */

app.post('/api/qa', async (req, res) => {
  const userKey = (req.headers['x-api-key'] || '').trim();
  const activeClient = clientFor(userKey);
  if (!activeClient) return res.status(503).json({ error: friendly() });

  const b = req.body || {};
  const text = String(b.text || '').trim().slice(0, 80000);
  const summary = String(b.summary || '').trim().slice(0, 30000);
  const question = String(b.question || '').trim().slice(0, 2000);
  const history = Array.isArray(b.history) ? b.history : [];
  const title = String(b.title || '').slice(0, 300);
  const url   = String(b.url   || '').slice(0, 1000);
  const zielsprache = LANG_NAMES[b.zielsprache] ? b.zielsprache : 'de';
  const plain = Boolean(b.plain);

  if (!question) return res.status(400).json({ error: 'Frage fehlt.' });
  if (text.length < 40 && summary.length < 40) {
    return res.status(400).json({ error: 'Keine Zusammenfassung oder kein Seitentext für Q&A vorhanden.' });
  }

  const system = renderPrompt('qa/system.mustache', {
    plainRules: plain ? plainClause() : '',
    languageRules: langClause(zielsprache),
  });

  const sourceMsg = {
    role: 'system',
    content: renderPrompt('qa/source.mustache', {
      title: title || '(ohne Titel)',
      url: url || '(ohne URL)',
      summary,
      text,
      source: text ? wrapSource(text) : '',
    }),
  };

  const messages = [
    { role: 'system', content: system },
    sourceMsg,
    ...history
      .filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) })),
    { role: 'user', content: question },
  ];

  openSse(res);
  try {
    await streamCompletion(res, { model: text.length > 50000 || summary.length > 15000 ? LONG_MODEL : MODEL, messages }, activeClient);
  } catch (err) {
    console.error('qa error:', err?.status, err?.message);
    res.write(`event: error\ndata: ${JSON.stringify({ message: friendly(err) })}\n\n`);
    res.end();
  }
});

/* ====================================================================== */
/* Hot-Reload + Health                                                    */
/* ====================================================================== */

function signature(files) {
  const h = createHash('sha1');
  for (const f of files) {
    try {
      const s = statSync(join(EXT_DIR, f));
      h.update(`${f}:${s.size}:${s.mtimeMs};`);
    } catch {
      h.update(`${f}:missing;`);
    }
  }
  return h.digest('hex').slice(0, 16);
}
function versions() {
  let all = [];
  try {
    all = readdirSync(EXT_DIR).filter((f) => !f.startsWith('.')).sort();
  } catch {}
  return { all: signature(all), core: signature(['manifest.json', 'background.js']) };
}

app.get('/api/version', (_req, res) => {
  if (!HOTRELOAD) return res.status(404).json({ error: 'hotreload aus' });
  res.json(versions());
});

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, model: MODEL, videoModel: VIDEO_MODEL, pdfModel: PDF_MODEL, longModel: LONG_MODEL, hasKey, hotreload: HOTRELOAD })
);

app.get('/', (_req, res) =>
  res.type('html').send(
    `<!doctype html><meta charset=utf-8><body style="font:15px system-ui;max-width:540px;margin:60px auto;padding:0 20px;color:#1a1a24">
     <h2>Suntino — Backend</h2>
     <p>Dieser Service ist das Backend für das Chrome-Plugin „Suntino". Er hat keine eigene Oberfläche.</p>
     <p>Anbieter: <code>OpenRouter</code> · Standardmodell: <code>${MODEL}</code> · Video: <code>${VIDEO_MODEL}</code> · PDF: <code>${PDF_MODEL}</code> · Lang: <code>${LONG_MODEL}</code></p>
     <p>API-Key: <b>${hasKey ? 'konfiguriert' : 'fehlt (.env anlegen)'}</b></p>
     <p>Lade das Plugin in Chrome unter <code>chrome://extensions</code> → „Entpackt laden" aus dem Ordner <code>extension/</code>.</p>
     </body>`
  )
);

app.listen(PORT, () => {
  console.log(`\n  Backend läuft auf http://localhost:${PORT}`);
  console.log(`  Standardmodell: ${MODEL}${hasKey ? '' : '  (kein API-Key — bitte .env anlegen)'}`);
  console.log(`  Video: ${VIDEO_MODEL} · PDF: ${PDF_MODEL} · Lang: ${LONG_MODEL}`);
  console.log(`  Dev-Hotreload: ${HOTRELOAD ? 'an' : 'aus'}\n`);
});
