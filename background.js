const tabState = new Map(); // tabId -> { events, meta, report }

function ensureTab(tabId) {
  if (!tabState.has(tabId)) {
    tabState.set(tabId, {
      events: [],
      meta: { pageUrl: '', title: '', readyAt: 0 },
      report: null,
      updatedAt: Date.now(),
    });
  }
  return tabState.get(tabId);
}

function pushEvent(tabId, event) {
  const s = ensureTab(tabId);
  s.events.push(event);
  if (s.events.length > 3000) s.events.splice(0, s.events.length - 3000);
  s.updatedAt = Date.now();
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (msg?.type === 'PFA_READY' && tabId != null) {
    const s = ensureTab(tabId);
    s.meta = { pageUrl: msg.pageUrl, title: msg.title, readyAt: Date.now() };
    sendResponse({ ok: true });
    return true;
  }

  if (msg?.type === 'PFA_EVENT' && tabId != null) {
    pushEvent(tabId, msg.event);
    sendResponse({ ok: true });
    return true;
  }

  if (msg?.type === 'PFA_REPORT_PUSH' && tabId != null) {
    const s = ensureTab(tabId);
    s.report = msg.report;
    s.updatedAt = Date.now();
    sendResponse({ ok: true });
    return true;
  }

  if (msg?.type === 'PFA_OPEN_SIDE_PANEL') {
    (async () => {
      const tab = sender.tab || await activeTab();
      if (tab?.windowId != null && chrome.sidePanel?.open) {
        try { await chrome.sidePanel.open({ windowId: tab.windowId }); } catch {}
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg?.type === 'PFA_TAB_SUMMARY') {
    (async () => {
      const tab = await activeTab();
      if (!tab?.id) {
        sendResponse({ ok: false, error: 'no-tab' });
        return;
      }
      const bg = tabState.get(tab.id);
      try {
        const res = await chrome.tabs.sendMessage(tab.id, {
          type: 'PFA_GET_REPORT',
          heavy: !!msg.heavy,
        });
        if (res?.report) {
          ensureTab(tab.id).report = res.report;
        }
        sendResponse({
          ok: true,
          tabId: tab.id,
          tabUrl: tab.url,
          report: res?.report || bg?.report || null,
          cachedReport: bg?.report || null,
          backgroundEventCount: bg?.events?.length || 0,
        });
      } catch (e) {
        sendResponse({
          ok: !!bg?.report,
          error: bg?.report ? undefined : String(e),
          hint: bg?.report ? undefined : 'Hard-refresh the page so content scripts load.',
          tabId: tab.id,
          tabUrl: tab.url,
          report: bg?.report || null,
          cachedReport: bg?.report || null,
        });
      }
    })();
    return true;
  }

  if (msg?.type === 'PFA_CLEAR_ACTIVE') {
    (async () => {
      const tab = await activeTab();
      if (tab?.id) {
        tabState.set(tab.id, { events: [], meta: {}, report: null, updatedAt: Date.now() });
        try { await chrome.tabs.sendMessage(tab.id, { type: 'PFA_CLEAR' }); } catch {}
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg?.type === 'PFA_PICK_ACTIVE') {
    (async () => {
      const tab = await activeTab();
      if (!tab?.id) {
        sendResponse({ ok: false });
        return;
      }
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { type: 'PFA_TOGGLE_PICK' });
        sendResponse({ ok: true, pickMode: res?.pickMode });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === 'PFA_EXPORT_ACTIVE') {
    (async () => {
      const tab = await activeTab();
      if (tab?.id) {
        try { await chrome.tabs.sendMessage(tab.id, { type: 'PFA_EXPORT' }); } catch {}
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => tabState.delete(tabId));
