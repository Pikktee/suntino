# AGENTS.md

## Project overview

Suntino — Chrome extension (Manifest V3) that summarizes web pages, YouTube videos, and PDFs. Opens in the Side Panel. Backend is a local Express server that proxies OpenRouter via the OpenAI SDK. Single-package, no monorepo.

## Commands

```
npm start          # Start backend on http://localhost:3000
npm run icons      # Regenerate extension PNG icons from extension/icons/icon.svg
```

No linter, formatter, typecheck, test runner, or build step exists.
For quick syntax checks, use:

```
node --check server.js
node --check extension/sidepanel.js
```

## Setup

- Copy `.env.example` → `.env` and set `OPENROUTER_API_KEY` (required; server warns if missing)
- Load the extension in Chrome: `chrome://extensions` → "Entpackt laden" → select `extension/`
- The extension hardcodes `BACKEND = 'http://localhost:3000'` in `extension/sidepanel.js:1`. If you change `PORT` in `.env`, update both.

## Architecture

```
extension/    ← Chrome extension (client-side, no build step)
  manifest.json
  background.js     ← service worker: sidePanel setup, context menu, keyboard commands
  sidepanel.html/js/css  ← side panel UI: compact controls, summary rendering, settings, Q&A, TTS

server.js      ← Express backend (single file)
  /api/summarize    ← SSE-streamed summarization
  /api/qa           ← SSE-streamed Q&A about the page
  /api/health       ← health + current model info
  /api/version      ← file-change signatures for hot-reload

prompts/       ← Mustache prompt templates used by server.js
  summary/     ← summarization system/instruction/style templates
  qa/          ← Q&A system/source templates
  partials/    ← shared language, plain-language, source wrappers
```

The extension extracts page text by injecting `pageExtractor()` into the active tab via `chrome.scripting.executeScript`. For YouTube/PDF URLs, it sends only the URL to the backend (no text extraction). Selections from the context menu are routed via `chrome.storage.session`.

## Side panel UX

- The Chrome Side Panel already shows the extension title (plus the native pin/close controls), so `sidepanel.html` should not add a second visible "Suntino" app header. The extension cannot add buttons into Chrome's native side panel header.
- Style and length controls are custom dropdowns (`select-trigger` + `select-menu`, not native `<select>`) near the source card; avoid showing all modes as large cards in the main view. The code still uses historical `fokus` ids internally. The style dropdown shows each style's optional `desc` under its name. (Zielsprache in settings stays a native `<select>` due to its long option list.)
- The uppercase `Stil`/`Länge` label sits inside the bordered `select-trigger` (left of the value), not as a separate element outside the box.
- Deleting a style or resetting styles to defaults must go through the in-panel confirmation dialog (`askConfirm`), never a native `confirm()`.
- Settings has a `Barrierefreiheit` section holding the font-size control and `Leichte Sprache` (Easy Language — the legally defined, stricter A1/A2 accessibility register, not the looser B1 "Einfache Sprache"; internally still the `prefs.plain` flag and `prompts/partials/plain.mustache`). Font size is a segmented A-button control (`#fontSizeSeg`, `prefs.fontSize` ∈ `normal|gross|sehrgross`) that only scales the reading area (summary + Q&A) via `--reading-scale` / `data-fontsize` on `#summaryScroll` — it does not regenerate the summary and does not scale the rest of the UI. Summary/Q&A inner sizes are `em`-relative so they scale together. (Chrome's page zoom does not work reliably in the side panel, hence the dedicated setting.)
- The source card, the summary-specific `actionBar`, and the result share one bordered `.summary-block`: the `.summary-header` (favicon + title + word count, with the `actionBar` right-aligned beneath it) sits on top, the scrolling reading area (`#result` / `#summaryScroll`) below. `.summary-block` carries `min-width: 0` so the reading area wraps instead of overflowing; `.summary-block:has(.result[hidden])` collapses the card to just the header when there is no summary yet.
- The `actionBar` holds only summary-related actions: `reload` (always visible), plus `tts` and `share` (shown once a summary exists). The app-level `settings` button (`#settingsBtn`, `.settings-control`) is the third cell of the `control-strip`, right of the `Stil`/`Länge` dropdowns — not in the `actionBar`. There is no separate top bar.
- The `share` button opens a small dropdown menu (`shareMenu`) holding `copy` and Markdown download; it is the place for future export options. Close it on outside-click, Escape, action, or when opening settings.
- Q&A is a persistent bottom input (`qa-dock`) with placeholder "Rückfrage zur Seite stellen..."; it is disabled until a summary is loaded. Avoid adding a separate "Rückfrage stellen" button.
- Q&A messages belong inside the result scroll area (`summaryScroll`) below the generated summary, not in a fixed overlay, and should auto-scroll downward while answers stream.
- Q&A threads are cached per normalized page URL in `chrome.storage.session` under `qa:<url>` and restored when the page's summary is shown again (see `restoreQa`/`saveQaCache`). Summaries are cached under `sum:<...>`.
- The `Allgemein` settings section has a `cacheClearBtn` ("Cache leeren") that clears `chrome.storage.session` (cached summaries + Q&A) via the in-panel `askConfirm`, never a native `confirm()`. It must not touch `prefs`/styles (those live in `chrome.storage.local`).
- Style options are managed as one list in `prefs.focusPoints`: no separate UI distinction between built-in and user-created points.
- The style `Standard` is locked and must stay available; it creates a balanced summary and cannot be edited or deleted.
- Non-locked styles can be edited/deleted from the settings page. The editor opens as a focused modal on top of the settings view.
- The settings style list hides the locked `Standard` point; it remains available only in the main style dropdown.
- Settings include a reset action that restores the default styles.
- Default non-locked styles are currently `Zahlen & Fakten` and `Pro & Contra`; do not reintroduce `To-dos` or `Wissenschaftlich` without an explicit product decision.
- Summary rendering supports compact Markdown tables for focus modes such as `Zahlen & Fakten` and `Pro & Contra`. Built-in styles (`BUILTIN_FOCUS_IDS` = `standard`, `zahlen`, `procontra`) must NOT send `customFocus` to the backend — the server has dedicated, stronger table prompts in `prompts/summary/styles/`, and a non-empty `customFocus` would shadow them (that bug previously suppressed the tables).
- Copy success feedback is shown via the in-panel `.toast`, not by changing the icon button text.
- The old textual status line is intentionally removed. Loading state is shown inside the summary area via `.summary-loading`.
- Settings are a separate in-panel view, not a modal. Use `mainView` and `settingsPanel` to switch between the main screen and settings.
- Settings changes that affect the summary are saved immediately but should only trigger regeneration when leaving the settings view.
- The UI is multilingual (see "UI localization (i18n)"). Do NOT hardcode user-facing strings — add a key to `extension/i18n.js` and reference it via `t()` (JS) or a `data-i18n*` attribute (HTML).

## UI localization (i18n)

The interface is translatable at runtime, independent of the summary output language (`zielsprache`). All UI strings live centrally in `extension/i18n.js`.

- `extension/i18n.js` is a **pure data/logic module with no DOM access**, so it is loaded both in the side panel (`<script src="i18n.js">` before `sidepanel.js`) and in the service worker (`background.js` via `importScripts('i18n.js')`). It is a classic script (not an ES module) — its top-level `const`/`function` declarations are visible to `sidepanel.js`.
- `chrome.i18n`/`_locales` is deliberately NOT used: it binds the locale to the browser UI language and cannot be switched at runtime via a setting. The custom dictionary enables the in-app "Sprache der Oberfläche" picker.
- Initial languages: `de`, `en`, `es`, `fr`. Add a language by appending one entry to `UI_LANGUAGES` (with its autonym `name`) and one block to `MESSAGES` with the full key set. Missing keys fall back to `UI_FALLBACK_LANG` (`en`).
- The UI-language setting is `prefs.uiLang` (persisted in `chrome.storage.local`). Default `'auto'` resolves to the browser/OS language via `resolveUiLang()`, falling back to English. It is a separate setting from `zielsprache` and does NOT trigger summary regeneration on change (`applyUiLanguage()` only re-renders the UI).
- HTML: `data-i18n="key"` sets `textContent`; `data-i18n-title` / `data-i18n-aria-label` / `data-i18n-placeholder` set the respective attribute. `applyStaticI18n()` walks these.
- JS: use `t('key')`, or `t('key', { name })` for `{placeholder}` substitution. Always `escapeHtml`/`escapeAttr` translated values that are interpolated into HTML.
- Default style names/descriptions are translated keys (`focus.standard.*`, `focus.zahlen.*`, `focus.procontra.*`). The locked `standard` style is localized live via `focusName()`/`focusDesc()`; `zahlen`/`procontra` are localized only at seed time and on "Zurücksetzen" (editing them makes them user content). User-created styles are never translated.
- The `zielsprache` dropdown lists each language under its own autonym (static `<option>` labels); only its `auto` option ("Standard") is translated via `data-i18n`.
- The context menu title in `background.js` is localized and re-applied when `prefs.uiLang` changes (via `chrome.storage.onChanged`).
- `manifest.json` strings (name, description, command descriptions) are static and not part of the runtime switcher — they would require `_locales` (install-locale based) and are intentionally left in German.

## Custom focus points

Users can add, edit, and delete focus points in the settings panel. They are persisted in `chrome.storage.local` under `focusPoints` and shown in the focus dropdown.

For non-locked focus summaries, `extension/sidepanel.js` sends `customFocus` to `/api/summarize`; `server.js` folds it into the system prompt while preserving the base safety rule that source material is data, not instructions.

## Backend prompts

Backend prompts are Mustache templates in `prompts/` and are rendered by `server.js` on each request. Use triple braces (`{{{value}}}`) for prompt/source placeholders that must not be HTML-escaped.

Built-in summary styles live in `prompts/summary/styles/` and must match the built-in backend ids in `BUILTIN_FOCUS`.

Custom focus limits currently enforced in the client/server:

- name: 38 chars
- desc (optional short description shown in the style dropdown): 80 chars
- prompt: 1800 chars
- max stored custom focus points: 20

Focus points carry an optional `desc` field (client-only, persisted in `focusPoints`) that is shown under the name in the style dropdown; it is not sent to the backend.

## Model selection

Default models live near the top of `server.js` (NOT the README — the README is outdated). The server selects models based on content type:

| Content | Model env var | Default |
|---|---|---|
| Text (normal) | `OPENROUTER_MODEL` | `google/gemini-2.5-flash-lite` |
| Video | `OPENROUTER_VIDEO_MODEL` | `google/gemini-2.5-flash` |
| PDF | `OPENROUTER_PDF_MODEL` | `google/gemini-2.5-flash` |
| Long text (>50k chars) | `OPENROUTER_LONG_MODEL` | `google/gemini-2.5-pro` |
| Text + `Leichte Sprache` (`plain`) | `OPENROUTER_PLAIN_MODEL` | `google/gemini-2.5-flash` |

`Leichte Sprache` (the `plain` flag) lifts normal text from the lite model to `PLAIN_MODEL` because its grammar rules (no genitive, verbs over nouns, max sentence length, explaining hard words) need a stronger model. Long text (>50k) still wins and uses `LONG_MODEL` (pro is stronger anyway); video/PDF keep their own models.

## Summary length & token budget

`LENGTH` (`server.js`) defines `maxWords` AND `maxRows` per length (kurz/mittel/lang). `max_tokens` (the API safety ceiling, NOT the length target — that lives in the prompt) is computed in `buildMessages`:
- Table styles (`TABLE_FOCUS` = `zahlen`, `procontra`) base it on `maxRows` (`rows*80+256`), not words — Markdown tables have heavy syntax overhead that word count doesn't capture, so a word-based ceiling truncated tables mid-row.
- Custom-focus styles (which may also emit tables) use a generous word multiplier (5×).
- Plain text uses 2.5× words.

Table size is bounded by an explicit row cap, not the word count: the length-aware row limit is injected into `instruction.mustache` (`maxRows`) and reinforced in the style prompts. This keeps "Zahlen & Fakten" a *selective* summary (esp. on overview/landing pages with dozens of figures) rather than an exhaustive dump that overflows `max_tokens`. The `max_tokens` budget is sized above the row cap so a compliant table always fits.

## Conventions

- ES modules throughout (`"type": "module"`)
- German UI strings and code comments
- `@resvg/resvg-js` is devDependency only — used by `scripts/gen-icons.mjs`, not needed at runtime
