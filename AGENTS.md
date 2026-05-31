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
```

The extension extracts page text by injecting `pageExtractor()` into the active tab via `chrome.scripting.executeScript`. For YouTube/PDF URLs, it sends only the URL to the backend (no text extraction). Selections from the context menu are routed via `chrome.storage.session`.

## Side panel UX

- The Chrome Side Panel already shows the extension title, so `sidepanel.html` should not add a second visible "Suntino" app header.
- Focus and length controls are compact `<select>` controls near the source card; avoid showing all modes as large cards in the main view.
- Summary actions (`copy`, Markdown download, TTS) live as icon-only buttons above the summary in `summaryTools`.
- Q&A is a persistent bottom input (`qa-dock`) with placeholder "Rückfrage zur Seite stellen..."; it is disabled until a summary is loaded. Avoid adding a separate "Rückfrage stellen" button.
- Focus options are managed as one list in `prefs.focusPoints`: no separate UI distinction between built-in and user-created points.
- The focus point `Standard` is locked and must stay available; it creates a balanced summary and cannot be edited or deleted.
- Non-locked focus points can be edited/deleted from the settings page. The editor opens as a focused modal on top of the settings view.
- Settings include a focus reset action that restores the default focus points.
- The old textual status line is intentionally removed. Loading state is shown inside the summary area via `.summary-loading`.
- Settings are a separate in-panel view, not a modal. Use `mainView` and `settingsPanel` to switch between the main screen and settings.
- Settings changes that affect the summary are saved immediately but should only trigger regeneration when leaving the settings view.
- Keep German UI strings.

## Custom focus points

Users can add, edit, and delete focus points in the settings panel. They are persisted in `chrome.storage.local` under `focusPoints` and shown in the focus dropdown.

For non-locked focus summaries, `extension/sidepanel.js` sends `customFocus` to `/api/summarize`; `server.js` folds it into the system prompt while preserving the base safety rule that source material is data, not instructions.

Custom focus limits currently enforced in the client/server:

- name: 38 chars
- prompt: 1800 chars
- max stored custom focus points: 20

## Model selection

Default models live in `server.js:12-15` (NOT the README — the README is outdated). The server selects models based on content type:

| Content | Model env var | Default |
|---|---|---|
| Text (normal) | `OPENROUTER_MODEL` | `google/gemini-2.5-flash-lite` |
| Video | `OPENROUTER_VIDEO_MODEL` | `google/gemini-2.5-flash` |
| PDF | `OPENROUTER_PDF_MODEL` | `google/gemini-2.5-flash` |
| Long text (>50k chars) | `OPENROUTER_LONG_MODEL` | `google/gemini-2.5-pro` |

## Conventions

- ES modules throughout (`"type": "module"`)
- German UI strings and code comments
- `@resvg/resvg-js` is devDependency only — used by `scripts/gen-icons.mjs`, not needed at runtime
