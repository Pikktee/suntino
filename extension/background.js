// Klick auf das Icon öffnet das Side Panel (rechter Fensterbereich) statt eines Popups.
function setupPanel() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
function setupMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'suntino-selection',
      title: 'Markierten Text mit Suntino zusammenfassen',
      contexts: ['selection'],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => { setupPanel(); setupMenu(); });
chrome.runtime.onStartup?.addListener(() => { setupPanel(); setupMenu(); });

/* ---------- Kontextmenü: Auswahl zusammenfassen ---------- */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'suntino-selection' || !info.selectionText) return;
  await chrome.storage.session.set({
    pendingSelection: {
      text: info.selectionText,
      title: tab?.title || 'Markierter Text',
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
