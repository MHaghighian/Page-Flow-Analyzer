const SCRIPT_MAIN = 'pfa-main-hook';
const SCRIPT_ISOLATED = 'pfa-isolated';
const SCRIPT_HUNT = 'pfa-hunt-boot';

const tabState = new Map(); // tabId -> { events, meta, report }
const tabNav = new Map(); // tabId -> { url, gen }

/** @type {{ mode: 'tab'|'origin'|'all', tabId: number|null, origin: string|null }} */
let scopeCache = { mode: 'tab', tabId: null, origin: null };

function pageId(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}${u.search}`;
  } catch {
    return String(url || '').split('#')[0];
  }
}

function resetTabState(tabId, url = '') {
  const prev = tabNav.get(tabId);
  tabNav.set(tabId, { url: url || '', gen: (prev?.gen || 0) + 1 });
  tabState.set(tabId, {
    events: [],
    meta: { pageUrl: url || '', title: '', readyAt: 0 },
    report: null,
    updatedAt: Date.now(),
  });
}

function reportBelongsToTab(report, tabUrl) {
  if (!report?.pageUrl || !tabUrl) return false;
  return pageId(report.pageUrl) === pageId(tabUrl);
}

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
  // Service worker has no "current" window — last focused is the page the user is looking at.
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

function originOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

function isInjectableUrl(url) {
  return /^https?:/i.test(url || '');
}

function tabMatchesScope(tab, scope = scopeCache) {
  if (!tab?.id) return false;
  if (scope.mode === 'all') return isInjectableUrl(tab.url);
  if (scope.mode === 'tab') return tab.id === scope.tabId;
  if (scope.mode === 'origin') {
    const o = originOf(tab.url);
    return !!o && o === scope.origin;
  }
  return false;
}

async function sessionGet(defaults) {
  try {
    if (chrome.storage.session) return await chrome.storage.session.get(defaults);
  } catch {}
  return { ...defaults };
}

async function sessionSet(obj) {
  try {
    if (chrome.storage.session) await chrome.storage.session.set(obj);
  } catch {}
}

async function loadScope() {
  const local = await chrome.storage.local.get({ collectMode: 'tab', scopedOrigin: null });
  const session = await sessionGet({ scopedTabId: null });
  scopeCache = {
    mode: local.collectMode === 'origin' || local.collectMode === 'all' ? local.collectMode : 'tab',
    tabId: typeof session.scopedTabId === 'number' ? session.scopedTabId : null,
    origin: local.scopedOrigin || null,
  };
  return scopeCache;
}

function scopeLabel(scope = scopeCache) {
  if (scope.mode === 'all') return 'All http(s) tabs';
  if (scope.mode === 'origin') return scope.origin || 'No origin pinned — click This origin';
  if (scope.tabId != null) return `Tab ${scope.tabId}` + (scope.origin ? ` · ${scope.origin}` : '');
  return 'No tab pinned — click This tab';
}

async function saveScope(scope) {
  scopeCache = {
    mode: scope.mode,
    tabId: scope.tabId ?? null,
    origin: scope.origin ?? null,
  };
  await chrome.storage.local.set({
    collectMode: scopeCache.mode,
    scopedOrigin: scopeCache.origin,
  });
  await sessionSet({ scopedTabId: scopeCache.tabId });
  return scopeCache;
}

async function unregisterDynamicScripts() {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts();
    const ids = existing.map((s) => s.id).filter((id) => id === SCRIPT_MAIN || id === SCRIPT_ISOLATED || id === SCRIPT_HUNT);
    if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
  } catch {}
}

function originMatches(origin) {
  return [`${origin}/*`];
}

async function registerDynamicScripts(scope) {
  await unregisterDynamicScripts();
  if (scope.mode === 'tab') return;

  let matches;
  if (scope.mode === 'all') {
    matches = ['http://*/*', 'https://*/*'];
  } else if (scope.mode === 'origin' && scope.origin) {
    matches = originMatches(scope.origin);
  } else {
    return;
  }

  try {
    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_MAIN,
        js: ['content/xss-catalog.js', 'content/main-hook.js'],
        matches,
        runAt: 'document_start',
        world: 'MAIN',
        allFrames: true,
        persistAcrossSessions: true,
      },
      {
        id: SCRIPT_HUNT,
        js: ['content/hunt-boot.js'],
        matches,
        runAt: 'document_start',
        world: 'ISOLATED',
        allFrames: true,
        persistAcrossSessions: true,
      },
      {
        id: SCRIPT_ISOLATED,
        js: ['content/bom-collect.js', 'content/isolated.js'],
        matches,
        runAt: 'document_end',
        world: 'ISOLATED',
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
  } catch (e) {
    console.warn('PFA registerContentScripts', e);
  }
}

async function tabAlreadyHooked(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PFA_SCOPE_CHECK' });
    return !!res && res.ok !== false && !res.error;
  } catch {
    return false;
  }
}

async function injectIntoTab(tabId) {
  if (await tabAlreadyHooked(tabId)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content/xss-catalog.js', 'content/main-hook.js'],
      world: 'MAIN',
      injectImmediately: true,
    });
  } catch {}
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content/hunt-boot.js'],
      world: 'ISOLATED',
      injectImmediately: true,
    });
  } catch {}
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ['content/bom-collect.js', 'content/isolated.js'],
      world: 'ISOLATED',
    });
  } catch {}
}

async function matchingTabs(scope = scopeCache) {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((t) => tabMatchesScope(t, scope) && isInjectableUrl(t.url));
}

async function broadcastEnabled(enabled, tabIds = null) {
  const tabs = tabIds
    ? tabIds.map((id) => ({ id }))
    : await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    if (tab.id == null) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'PFA_SET_ENABLED', enabled: !!enabled });
    } catch {}
  }));
}

async function applyInstrumentation(scope) {
  const allTabs = await chrome.tabs.query({});
  await broadcastEnabled(false, allTabs.map((t) => t.id).filter((id) => id != null));
  await registerDynamicScripts(scope);
  const match = await matchingTabs(scope);
  for (const tab of match) {
    await injectIntoTab(tab.id);
  }
  await broadcastEnabled(true, match.map((t) => t.id));
}

/** "This tab" follows the focused page. Latest tabId wins so Hunt inject cannot drop a switch. */
let followGen = 0;
let followTail = Promise.resolve();

async function armHunt(tabId) {
  const hunt = await chrome.storage.local.get({ huntEnabled: false });
  if (!hunt.huntEnabled) return;
  try { await chrome.tabs.sendMessage(tabId, { type: 'PFA_SET_HUNT', enabled: true }); } catch {}
}

async function followToTabInner(tabId, gen) {
  if (gen !== followGen || tabId == null) return;
  const scope = await loadScope();
  if (scope.mode !== 'tab') return;
  if (gen !== followGen) return;
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return; }
  if (!isInjectableUrl(tab.url)) return;
  const origin = originOf(tab.url);
  const prev = scope.tabId;
  if (tab.id !== scope.tabId) {
    await saveScope({ mode: 'tab', tabId: tab.id, origin });
    if (prev != null && prev !== tab.id) await broadcastEnabled(false, [prev]);
  } else if (origin && origin !== scope.origin) {
    await saveScope({ ...scope, origin });
  }
  if (gen !== followGen) return;
  await injectIntoTab(tab.id);
  if (gen !== followGen) return;
  await broadcastEnabled(true, [tab.id]);
  await armHunt(tab.id);
}

function followToTab(tabId) {
  const gen = ++followGen;
  followTail = followTail.then(() => followToTabInner(tabId, gen)).catch(() => {});
  return followTail.then(async () => {
    while (followGen !== gen) {
      const seen = followGen;
      await followTail;
      if (seen === followGen) break;
    }
  });
}

async function setScopeFromMessage(msg) {
  const prev = await loadScope();
  let mode = msg.mode || prev.mode;
  if (mode !== 'tab' && mode !== 'origin' && mode !== 'all') mode = 'tab';

  let tab = null;
  if (msg.tabId != null) {
    try { tab = await chrome.tabs.get(msg.tabId); } catch {}
  }
  if (!tab && (msg.useActive !== false || mode === 'tab' || mode === 'origin')) {
    tab = await activeTab();
  }

  const next = {
    mode,
    tabId: mode === 'tab' ? (tab?.id ?? prev.tabId) : null,
    origin: mode === 'origin'
      ? (originOf(tab?.url) || prev.origin)
      : (mode === 'tab' ? originOf(tab?.url) : null),
  };

  await saveScope(next);
  await applyInstrumentation(next);
  return describeScope(next, tab);
}

async function describeScope(scope = scopeCache, tabHint = null) {
  let pinnedTab = tabHint && tabHint.id === scope.tabId ? tabHint : null;
  if (!pinnedTab && scope.mode === 'tab' && scope.tabId != null) {
    try { pinnedTab = await chrome.tabs.get(scope.tabId); } catch { pinnedTab = null; }
  }
  const pinnedAlive = scope.mode !== 'tab' || !!pinnedTab;
  let tab = pinnedTab || tabHint || await activeTab();
  const match = await matchingTabs(scope);
  const hunt = await chrome.storage.local.get({ huntEnabled: false });
  return {
    mode: scope.mode,
    tabId: scope.tabId,
    origin: scope.origin,
    huntEnabled: !!hunt.huntEnabled,
    label: scopeLabel(scope),
    tabUrl: (scope.mode === 'tab' ? pinnedTab?.url : tab?.url) || '',
    tabTitle: (scope.mode === 'tab' ? pinnedTab?.title : tab?.title) || '',
    matchingTabs: match.length,
    pinnedAlive,
    hint: scope.mode === 'tab' && !scope.tabId
      ? 'Click This tab to pin the current tab, then hard-refresh it.'
      : scope.mode === 'origin' && !scope.origin
        ? 'Open a http(s) page, then click This origin.'
        : 'Hard-refresh in-scope tabs so hooks catch early fetch() / XHR. Hunt needs a reload after you turn it on.',
  };
}

function mergeFlows(flows) {
  const map = {};
  for (const f of flows) {
    const key = `${f.from}=>${f.to}|${f.category || ''}`;
    if (!map[key]) map[key] = { ...f, count: 0, samples: [] };
    map[key].count += f.count || 0;
    map[key].samples = [...(map[key].samples || []), ...(f.samples || [])].slice(0, 8);
  }
  return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 40);
}

function mergeReports(entries, meta) {
  const reports = entries.map((e) => e.report).filter(Boolean);
  if (!reports.length) return null;
  const primary = reports[0];
  const concat = (key, cap) => reports.flatMap((r) => r[key] || []).slice(-cap);
  const counts = {};
  for (const r of reports) {
    for (const [k, v] of Object.entries(r.counts || {})) {
      counts[k] = (counts[k] || 0) + (typeof v === 'number' ? v : 0);
    }
  }
  return {
    ...primary,
    pageUrl: meta.pageUrl || primary.pageUrl,
    title: meta.title || primary.title,
    counts,
    traces: reports.flatMap((r) => r.traces || []).slice(0, 80),
    watches: reports.flatMap((r) => r.watches || []).slice(0, 80),
    flows: mergeFlows(reports.flatMap((r) => r.flows || [])),
    network: concat('network', 200),
    sinks: concat('sinks', 200),
    autoSources: concat('autoSources', 200),
    storage: concat('storage', 120),
    postMessages: concat('postMessages', 100),
    websockets: concat('websockets', 100),
    inputs: concat('inputs', 100),
    findings: concat('findings', 200).sort((a, b) => (a.rank || 90) - (b.rank || 90)),
    effects: concat('effects', 80),
    networkExchanges: concat('networkExchanges', 120),
    wsExchanges: concat('wsExchanges', 80),
    hunt: primary.hunt,
    classCounts: reports.reduce((acc, r) => {
      for (const [k, v] of Object.entries(r.classCounts || {})) acc[k] = (acc[k] || 0) + v;
      return acc;
    }, {}),
    narrative: [
      `${meta.scopeNote || ''} ${counts.watches || 0} watched · ${counts.tracedWithSink || 0} mapped · ${entries.length} tab(s).`.trim(),
    ],
    scope: meta.scope,
  };
}

async function reportFromTab(tab, heavy) {
  const gen = tabNav.get(tab.id)?.gen;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, {
      type: 'PFA_GET_REPORT',
      heavy: !!heavy,
    });
    let live = tab;
    try { live = await chrome.tabs.get(tab.id); } catch {}
    if (tabNav.get(tab.id)?.gen !== gen) {
      const latest = tabState.get(tab.id)?.report || null;
      return { ok: !!latest, tabId: tab.id, tabUrl: live?.url || tab.url, report: latest };
    }
    const report = res?.report && reportBelongsToTab(res.report, live.url) ? res.report : null;
    if (report) ensureTab(tab.id).report = report;
    else if (tabState.get(tab.id)?.report && !reportBelongsToTab(tabState.get(tab.id).report, live.url)) {
      ensureTab(tab.id).report = null;
    }
    return {
      ok: true,
      tabId: tab.id,
      tabUrl: live.url,
      report,
    };
  } catch (e) {
    let live = tab;
    try { live = await chrome.tabs.get(tab.id); } catch {}
    const cached = tabState.get(tab.id)?.report;
    const report = cached && reportBelongsToTab(cached, live?.url) ? cached : null;
    return {
      ok: !!report,
      error: report ? undefined : String(e),
      tabId: tab.id,
      tabUrl: live?.url || tab.url,
      report,
    };
  }
}

async function collectScopedSummary(heavy, followTabId = null) {
  if (followTabId != null) await followToTab(followTabId);
  const scope = await loadScope();
  const desc = await describeScope(scope);
  const match = await matchingTabs(scope);
  const active = await activeTab();

  if (scope.mode === 'tab') {
    let tab = null;
    if (scope.tabId != null) {
      try { tab = await chrome.tabs.get(scope.tabId); } catch { tab = null; }
    }
    if (!tab) {
      return {
        ok: false,
        error: 'No tab pinned',
        hint: desc.hint,
        scope: desc,
        report: null,
      };
    }
    if (!isInjectableUrl(tab.url)) {
      return {
        ok: false,
        error: 'Pinned tab is not http(s)',
        hint: 'Pin a normal website tab.',
        scope: desc,
        tabId: tab.id,
        tabUrl: tab.url,
        report: null,
      };
    }
    const one = await reportFromTab(tab, heavy);
    return {
      ...one,
      ok: one.ok || !!one.report,
      hint: one.ok ? desc.hint : (one.error ? 'Hard-refresh the pinned tab so content scripts load.' : desc.hint),
      scope: desc,
      cachedReport: tabState.get(tab.id)?.report || null,
      backgroundEventCount: tabState.get(tab.id)?.events?.length || 0,
    };
  }

  if (!match.length) {
    return {
      ok: false,
      error: scope.mode === 'origin' ? `No open tabs for ${scope.origin || 'this origin'}` : 'No http(s) tabs',
      hint: desc.hint,
      scope: desc,
      report: null,
    };
  }

  if (scope.mode === 'all') {
    const tab = (active && isInjectableUrl(active.url) && tabMatchesScope(active, scope))
      ? active
      : match[0];
    const one = await reportFromTab(tab, heavy);
    return {
      ...one,
      ok: one.ok || !!one.report,
      hint: one.ok ? desc.hint : (one.error ? 'Hard-refresh this tab so content scripts load.' : desc.hint),
      scope: desc,
      cachedReport: tabState.get(tab.id)?.report || null,
      backgroundEventCount: match.reduce((n, t) => n + (tabState.get(t.id)?.events?.length || 0), 0),
    };
  }

  const ordered = [...match].sort((a, b) => {
    if (a.id === active?.id) return -1;
    if (b.id === active?.id) return 1;
    return 0;
  });

  const entries = [];
  for (const tab of ordered) {
    const one = await reportFromTab(tab, heavy && tab.id === ordered[0].id);
    if (one.report) entries.push(one);
  }

  const merged = mergeReports(entries, {
    pageUrl: scope.mode === 'origin' ? (scope.origin + '/') : (active?.url || ordered[0].url),
    title: scope.mode === 'origin'
      ? `${scope.origin} (${entries.length} tab${entries.length === 1 ? '' : 's'})`
      : `All sites (${entries.length} tab${entries.length === 1 ? '' : 's'})`,
    scopeNote: desc.label + '.',
    scope: desc,
  });

  const primary = ordered[0];
  return {
    ok: !!merged,
    tabId: primary?.id,
    tabUrl: primary?.url,
    report: merged,
    cachedReport: merged,
    backgroundEventCount: match.reduce((n, t) => n + (tabState.get(t.id)?.events?.length || 0), 0),
    scope: desc,
    hint: desc.hint,
  };
}

async function forEachScopedTab(fn) {
  const scope = await loadScope();
  const tabs = await matchingTabs(scope);
  for (const tab of tabs) {
    try { await fn(tab); } catch {}
  }
  return tabs;
}

async function init() {
  await loadScope();
  await registerDynamicScripts(scopeCache);
}

init().catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
  applyInstrumentation(scopeCache).catch(() => {});
});

chrome.runtime.onStartup?.addListener?.(() => {
  loadScope().then(applyInstrumentation).catch(() => {});
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  resetTabState(details.tabId, details.url);
  if (!isInjectableUrl(details.url)) return;
  loadScope().then(async (scope) => {
    const tabLike = { id: details.tabId, url: details.url };
    if (!tabMatchesScope(tabLike, scope)) return;
    if (scope.mode === 'tab') {
      const origin = originOf(details.url);
      if (origin && origin !== scope.origin) {
        await saveScope({ ...scope, origin });
      }
      await injectIntoTab(details.tabId);
      await broadcastEnabled(true, [details.tabId]);
    }
  }).catch(() => {});
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  const prev = tabNav.get(details.tabId);
  if (prev && pageId(prev.url) === pageId(details.url)) return;
  resetTabState(details.tabId, details.url);
  chrome.tabs.sendMessage(details.tabId, { type: 'PFA_PAGE_RESET', url: details.url }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (msg?.type === 'PFA_SCOPE_CHECK') {
    (async () => {
      const scope = await loadScope();
      const enabled = tabMatchesScope(sender.tab, scope);
      sendResponse({ ok: true, enabled, scope: await describeScope(scope, sender.tab) });
    })();
    return true;
  }

  if (msg?.type === 'PFA_GET_SCOPE') {
    (async () => {
      const scope = await loadScope();
      sendResponse({ ok: true, ...(await describeScope(scope)) });
    })();
    return true;
  }

  if (msg?.type === 'PFA_SET_HUNT') {
    const enabled = !!msg.enabled;
    chrome.storage.local.set({ huntEnabled: enabled }).catch(() => {});
    const scope = scopeCache;
    sendResponse({
      ok: true,
      huntEnabled: enabled,
      mode: scope.mode,
      tabId: scope.tabId,
      origin: scope.origin,
      label: scopeLabel(scope),
      tabUrl: '',
      tabTitle: '',
      matchingTabs: 0,
    });
    (async () => {
      await loadScope();
      let ids = [];
      if (scopeCache.mode === 'tab' && scopeCache.tabId != null) ids = [scopeCache.tabId];
      else ids = (await matchingTabs(scopeCache)).map((t) => t.id);
      await Promise.all(ids.map((id) =>
        chrome.tabs.sendMessage(id, { type: 'PFA_SET_HUNT', enabled }).catch(() => {})
      ));
    })();
    return;
  }

  if (msg?.type === 'PFA_HIGHLIGHT') {
    (async () => {
      const scope = await loadScope();
      let tab = null;
      if (scope.mode === 'tab' && scope.tabId != null) {
        try { tab = await chrome.tabs.get(scope.tabId); } catch {}
      } else {
        tab = await activeTab();
      }
      if (tab?.id && msg.cssPath) {
        try { await chrome.tabs.sendMessage(tab.id, { type: 'PFA_HIGHLIGHT', cssPath: msg.cssPath }); } catch {}
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg?.type === 'PFA_SET_SCOPE') {
    (async () => {
      try {
        const desc = await setScopeFromMessage(msg);
        sendResponse({ ok: true, ...desc });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === 'PFA_READY' && tabId != null) {
    (async () => {
      const scope = await loadScope();
      if (!tabMatchesScope(sender.tab, scope)) {
        sendResponse({ ok: false, skipped: true });
        return;
      }
      if (msg.pageUrl && sender.tab?.url && !reportBelongsToTab({ pageUrl: msg.pageUrl }, sender.tab.url)) {
        sendResponse({ ok: false, skipped: true });
        return;
      }
      const s = ensureTab(tabId);
      s.meta = { pageUrl: msg.pageUrl, title: msg.title, readyAt: Date.now() };
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg?.type === 'PFA_EVENT' && tabId != null) {
    const scope = scopeCache;
    if (!tabMatchesScope(sender.tab, scope)) {
      sendResponse({ ok: false, skipped: true });
      return;
    }
    if (msg.event?.pageUrl && sender.tab?.url && !reportBelongsToTab({ pageUrl: msg.event.pageUrl }, sender.tab.url)) {
      sendResponse({ ok: false, skipped: true });
      return;
    }
    pushEvent(tabId, msg.event);
    sendResponse({ ok: true });
    return;
  }

  if (msg?.type === 'PFA_REPORT_PUSH' && tabId != null) {
    const scope = scopeCache;
    if (!tabMatchesScope(sender.tab, scope)) {
      sendResponse({ ok: false, skipped: true });
      return;
    }
    if (msg.report && sender.tab?.url && !reportBelongsToTab(msg.report, sender.tab.url)) {
      sendResponse({ ok: false, skipped: true });
      return;
    }
    const s = ensureTab(tabId);
    s.report = msg.report;
    s.updatedAt = Date.now();
    sendResponse({ ok: true });
    return;
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
      try {
        const res = await collectScopedSummary(!!msg.heavy, msg.followTabId ?? null);
        sendResponse(res);
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === 'PFA_CLEAR_ACTIVE') {
    (async () => {
      const tabs = await forEachScopedTab(async (tab) => {
        tabState.set(tab.id, { events: [], meta: {}, report: null, updatedAt: Date.now() });
        await chrome.tabs.sendMessage(tab.id, { type: 'PFA_CLEAR' });
      });
      sendResponse({ ok: true, cleared: tabs.length });
    })();
    return true;
  }

  if (msg?.type === 'PFA_PICK_ACTIVE') {
    (async () => {
      const scope = await loadScope();
      const active = await activeTab();
      let target = null;
      if (scope.mode === 'tab' && scope.tabId != null) {
        try { target = await chrome.tabs.get(scope.tabId); } catch {}
      } else if (active && tabMatchesScope(active, scope)) {
        target = active;
      } else {
        const match = await matchingTabs(scope);
        target = match[0] || null;
      }
      if (!target?.id) {
        sendResponse({ ok: false, error: 'No in-scope tab' });
        return;
      }
      try {
        const res = await chrome.tabs.sendMessage(target.id, { type: 'PFA_TOGGLE_PICK' });
        sendResponse({ ok: true, pickMode: res?.pickMode, tabId: target.id });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === 'PFA_EXPORT_ACTIVE') {
    (async () => {
      const tabs = await forEachScopedTab(async (tab) => {
        await chrome.tabs.sendMessage(tab.id, { type: 'PFA_EXPORT' });
      });
      sendResponse({ ok: true, exported: tabs.length });
    })();
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
  tabNav.delete(tabId);
  if (scopeCache.mode === 'tab' && scopeCache.tabId === tabId) {
    saveScope({ mode: 'tab', tabId: null, origin: null }).catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  followToTab(tabId).catch(() => {});
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId }).then(([tab]) => {
    if (tab?.id) return followToTab(tab.id);
  }).catch(() => {});
});
