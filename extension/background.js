// Zentralen i18n-Katalog laden (reines Daten-/Logikmodul, kein DOM).
importScripts('i18n.js');

// Aktive UI-Sprache aus den gespeicherten Einstellungen übernehmen.
async function syncMenuLang() {
  try {
    const { uiLang } = await chrome.storage.local.get('uiLang');
    return setActiveUiLang(resolveUiLang(uiLang));
  } catch {
    return setActiveUiLang(resolveUiLang('auto'));
  }
}

// Klick auf das Icon öffnet das Side Panel (rechter Fensterbereich) statt eines Popups.
function setupPanel() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
async function setupMenu() {
  await syncMenuLang();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'suntino-selection',
      title: t('contextMenu.summarizeSelection'),
      contexts: ['selection'],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => { setupPanel(); setupMenu(); });
chrome.runtime.onStartup?.addListener(() => { setupPanel(); setupMenu(); });

// Kontextmenü-Beschriftung aktualisieren, wenn die UI-Sprache wechselt.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.uiLang) setupMenu();
});

/* ---------- Kontextmenü: Auswahl zusammenfassen ---------- */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'suntino-selection' || !info.selectionText) return;
  await syncMenuLang();
  await chrome.storage.session.set({
    pendingSelection: {
      text: info.selectionText,
      title: tab?.title || t('source.selectedText'),
      url: info.pageUrl || tab?.url || '',
      ts: Date.now(),
    },
  });
  if (tab?.windowId != null) {
    try { await chrome.sidePanel.open({ windowId: tab.windowId }); } catch {}
  }
  // Panel ggf. erst im Aufbau → kurz verzögert benachrichtigen.
  setTimeout(() => chrome.runtime.sendMessage({ type: 'suntino:selection' }).catch(() => {}), 350);
});

/* ---------- Tastenkürzel (Namen müssen zu manifest.json passen) ---------- */
chrome.commands?.onCommand.addListener((command) => {
  if (command === 'regenerate') {
    chrome.runtime.sendMessage({ type: 'suntino:regenerate' }).catch(() => {});
  } else if (command === 'toggle_tts') {
    chrome.runtime.sendMessage({ type: 'suntino:toggle-tts' }).catch(() => {});
  }
});
