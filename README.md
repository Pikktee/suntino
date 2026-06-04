<img src="extension/icons/logo.png" alt="Suntino" width="420" />

# Suntino

Suntino ist ein schlankes Chrome-Plugin, das den Text der aktuellen Website an einen Backend-Service schickt
und strukturiert zusammenfassen lässt. Es läuft im **Seitenfenster** (Side Panel) und startet
beim Öffnen **sofort** die Zusammenfassung. Optionen direkt im Panel: **Länge** (Kurz / Mittel / Lang)
und **Leichte Sprache** — jederzeit änderbar (erzeugt sofort neu) und dauerhaft gespeichert.

## Aufbau

- `server.js` — Backend-Service (Express + OpenRouter via OpenAI-SDK). Baut den Prompt aus den
  Optionen, streamt die Zusammenfassung zurück. Keine eigene Oberfläche.
- `extension/` — das Chrome-Plugin (Manifest V3): `sidepanel.html`, `sidepanel.css`,
  `sidepanel.js`, `background.js`, `manifest.json`.

## Starten

1. **Backend** (nutzt OpenRouter)
   ```
   npm install
   cp .env.example .env      # OPENROUTER_API_KEY eintragen (https://openrouter.ai/keys)
   npm start                 # läuft auf http://localhost:3000
   ```
2. **Plugin laden**
   - Chrome → `chrome://extensions` öffnen
   - „Entwicklermodus" aktivieren (oben rechts)
   - „Entpackt laden" → Ordner `extension/` wählen
3. Auf einer beliebigen Artikel-Seite das Plugin-Icon anklicken → das Seitenfenster öffnet sich
   rechts und fasst die Seite **automatisch** zusammen. Beim Tab-Wechsel folgt es der aktiven Seite.

In `.env` lässt sich mit `OPENROUTER_MODEL` das Modell umstellen.
Standard ist `google/gemini-2.0-flash-001` (günstig, großer Kontext, stark beim Verdichten);
Alternativen siehe `.env.example`.

## Branding / Icons

Icon und Logo liegen als Quell-SVG in `extension/icons/` (`icon.svg`, `logo.svg`) — Maskottchen
„Suntino", eine freundliche Seite mit verdichteten Textzeilen und warmem KI-Funken.
Die Chrome-PNGs (16/32/48/128) werden daraus generiert:

```
npm run icons
```

## 5 Erweiterungsideen

Siehe [IDEAS.md](IDEAS.md).
