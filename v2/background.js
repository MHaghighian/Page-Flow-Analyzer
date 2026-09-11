// Flowscope — background service worker (skeleton).
// Scope-aware with live status. "This tab" follows the active tab; "This origin"
// tracks a fixed origin; "All" is every http(s) tab. Connection is resolved by
// pinging each in-scope tab on demand. Still no page instrumentation.

const LOCAL_DEFAULTS = { scopeMode: 'tab', huntEnabled: false };
const PING_TIMEOUT = 500;

function isHttp(url) {
  return /^https?:/i.test(url || '');
}

function originOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

async function loadLocal() {
  try {
    return await chrome.storage.local.get(LOCAL_DEFAULTS);
  } catch {
    return { ...LOCAL_DEFAULTS };
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

/** True only if the tab's content script actually answers right now. */
function pingTab(tabId) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const timer = setTimeout(() => finish(false), PING_TIMEOUT);
    try {
      chrome.tabs.sendMessage(tabId, { type: 'FS_PING' }, (res) => {
        void chrome.runtime.lastError;
        clearTimeout(timer);
        finish(!!(res && res.ok));
      });
    } catch {
      clearTimeout(timer);
      finish(false);
    }
  });
}

// Open the side panel when the toolbar icon is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});

// ---- messages ----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'FS_SET_SCOPE') {
    (async () => {
      try {
        sendResponse({ ok: true, ...(await setScope(msg.mode)) });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }

  if (msg?.type === 'FS_GET_STATE') {
    (async () => {
      sendResponse({ ok: true, ...(await describeScope()) });
    })();
    return true;
  }

  if (msg?.type === 'FS_GET_NETWORK') {
    (async () => {
      sendResponse({ ok: true, ...(await collectFromScope('FS_GET_NETWORK', 'exchanges')) });
    })();
    return true;
  }

  if (msg?.type === 'FS_GET_MESSAGES') {
    (async () => {
      sendResponse({ ok: true, ...(await collectFromScope('FS_GET_MESSAGES', 'messages')) });
    })();
    return true;
  }

  if (msg?.type === 'FS_GET_SINKS') {
    (async () => {
      sendResponse({ ok: true, ...(await collectFromScope('FS_GET_SINKS', 'sinks')) });
    })();
    return true;
  }

  if (msg?.type === 'FS_GET_TRACES') {
    (async () => {
      sendResponse({ ok: true, ...(await collectFromScope('FS_GET_TRACES', 'traces')) });
    })();
    return true;
  }

  if (msg?.type === 'FS_GET_FINDINGS') {
    (async () => {
      sendResponse({ ok: true, ...(await collectFromScope('FS_GET_FINDINGS', 'findings')) });
    })();
    return true;
  }

  if (msg?.type === 'FS_GET_INVENTORY') {
    (async () => {
      const inv = await gatherInventory();
      const st = await describeScope();
      sendResponse({ ok: !!inv, inventory: inv, mode: st.mode, label: st.label });
    })();
    return true;
  }

  if (msg?.type === 'FS_EXPORT') {
    (async () => {
      sendResponse({ ok: true, data: await buildExport() });
    })();
    return true;
  }

  if (msg?.type === 'FS_SET_HUNT') {
    (async () => {
      const enabled = !!msg.enabled;
      try { await chrome.storage.local.set({ huntEnabled: enabled }); } catch {}
      const st = await describeScope();
      await Promise.all(st.targets.map((t) => askTab(t.tabId, { type: 'FS_SET_HUNT', enabled })));
      sendResponse({ ok: true, huntEnabled: enabled });
    })();
    return true;
  }

  if (msg?.type === 'FS_CLEAR') {
    (async () => {
      const what = msg.what || 'all';
      const st = await describeScope();
      await Promise.all(st.targets.map((t) => askTab(t.tabId, { type: 'FS_CLEAR', what })));
      sendResponse({ ok: true });
    })();
    return true;
  }
});

/** Send a message to a tab's content script, resolving null if it doesn't answer. */
function askTab(tabId, msg) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => finish(null), PING_TIMEOUT);
    try {
      chrome.tabs.sendMessage(tabId, msg, (res) => {
        void chrome.runtime.lastError;
        clearTimeout(timer);
        finish(res || null);
      });
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

/**
 * Gather + merge a per-tab record list (network exchanges or messages) from every
 * in-scope tab, tagging each row with its source tab and sorting newest first.
 */
async function collectFromScope(msgType, key) {
  const st = await describeScope();
  const active = await activeTab();
  const per = await Promise.all(
    st.targets.map((t) => askTab(t.tabId, { type: msgType }).then((res) => ({ t, res })))
  );
  let rows = [];
  for (const { t, res } of per) {
    if (res?.ok && Array.isArray(res[key])) {
      for (const row of res[key]) rows.push({ ...row, tabId: t.tabId, tabHost: t.host });
    }
  }
  const ts = (r) => r.startedAt || r.t || 0;
  rows.sort((a, b) => ts(b) - ts(a));
  rows = rows.slice(0, 300);
  return {
    [key]: rows,
    mode: st.mode,
    label: st.label,
    count: st.count,
    connectedCount: st.connectedCount,
    multiTab: st.mode !== 'tab',
    activeTabId: active?.id ?? null,
  };
}

/** Apply a scope-mode change coming from the side panel. */
async function setScope(mode) {
  if (!['tab', 'origin', 'all'].includes(mode)) mode = 'tab';
  // Every mode is derived live from the active tab, so nothing to capture here.
  try {
    await chrome.storage.local.set({ scopeMode: mode });
  } catch {}
  return describeScope();
}

/**
 * Resolve the current scope into a concrete set of in-scope tabs, with live connection state.
 * All three modes track the active tab: tab = it alone, origin = every tab sharing its origin,
 * all = every http(s) tab.
 */
async function describeScope() {
  const { scopeMode, huntEnabled } = await loadLocal();
  const active = await activeTab();

  let targets = [];
  let origin = null;

  if (scopeMode === 'tab') {
    if (active?.id != null && isHttp(active.url)) targets = [active];
  } else {
    let allTabs = [];
    try {
      allTabs = await chrome.tabs.query({});
    } catch {}
    const httpTabs = allTabs.filter((t) => t.id != null && isHttp(t.url));
    if (scopeMode === 'all') {
      targets = httpTabs;
    } else {
      // origin: follow the active tab's origin
      origin = originOf(active?.url);
      targets = origin ? httpTabs.filter((t) => originOf(t.url) === origin) : [];
    }
  }

  // Live check: a tab counts as connected only if its content script answers now.
  const conns = await Promise.all(targets.map((t) => pingTab(t.id)));

  const items = targets.map((t, i) => ({
    tabId: t.id,
    url: t.url || '',
    title: t.title || '',
    host: hostOf(t.url),
    connected: conns[i],
  }));

  const label =
    scopeMode === 'all'
      ? 'All http(s) tabs'
      : scopeMode === 'origin'
        ? origin || 'No http(s) tab'
        : items[0]?.host || 'No http(s) tab';

  return {
    mode: scopeMode,
    origin,
    label,
    huntEnabled: !!huntEnabled,
    count: items.length,
    connectedCount: items.filter((i) => i.connected).length,
    targets: items,
    primary: items[0] || null,
  };
}

/** Inventory (DOM + BOM) from the primary in-scope tab. */
async function gatherInventory() {
  const st = await describeScope();
  const t = st.primary;
  if (!t) return null;
  const res = await askTab(t.tabId, { type: 'FS_GET_INVENTORY' });
  return res?.ok ? { tabHost: t.host, url: t.url, dom: res.dom, bom: res.bom } : null;
}

/** Bundle everything for the pentest bot: one JSON object. */
async function buildExport() {
  const [network, messages, sinks, traces, findings] = await Promise.all([
    collectFromScope('FS_GET_NETWORK', 'exchanges'),
    collectFromScope('FS_GET_MESSAGES', 'messages'),
    collectFromScope('FS_GET_SINKS', 'sinks'),
    collectFromScope('FS_GET_TRACES', 'traces'),
    collectFromScope('FS_GET_FINDINGS', 'findings'),
  ]);
  const inventory = await gatherInventory();
  const st = await describeScope();
  return {
    meta: {
      tool: 'Flowscope',
      version: chrome.runtime.getManifest().version,
      schema: 1,
      generatedAt: new Date().toISOString(),
      scope: { mode: st.mode, label: st.label, origin: st.origin },
      huntEnabled: st.huntEnabled,
      tabs: st.targets.map((t) => ({ host: t.host, url: t.url, connected: t.connected })),
    },
    network: network.exchanges,
    messages: messages.messages,
    sinks: sinks.sinks,
    traces: traces.traces,
    findings: findings.findings,
    inventory,
  };
}
