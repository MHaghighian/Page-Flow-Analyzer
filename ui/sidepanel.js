const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TABS = ['findings', 'effects', 'network', 'messages', 'traces', 'sources', 'sinks', 'storage', 'dom', 'bom', 'overview'];
let activeTab = 'findings';
let lastReport = null;
let lastScope = null;
let lastPageId = '';
let classFilter = '';
let hideNoise = true;
const queries = Object.fromEntries(TABS.map((t) => [t, '']));

const tabBar = $('tabs');
TABS.forEach((t) => {
  const b = document.createElement('button');
  b.textContent = t;
  b.dataset.tab = t;
  b.onclick = () => {
    activeTab = t;
    $('search').value = queries[t] || '';
    $('search').placeholder = `Filter ${t}…`;
    render();
  };
  tabBar.appendChild(b);
});

function hay(v) {
  try { return JSON.stringify(v).toLowerCase(); } catch { return String(v || '').toLowerCase(); }
}
function q() { return (queries[activeTab] || '').trim().toLowerCase(); }
function matches(item) {
  const s = q();
  if (!s) return true;
  return hay(item).includes(s);
}
function copyBtn(text) {
  const v = String(text ?? '');
  if (!v) return '';
  return `<button type="button" class="copy" data-copy="${encodeURIComponent(v.slice(0, 8000))}">copy</button>`;
}
function hlBtn(path) {
  if (!path) return '';
  return `<button type="button" class="copy" data-hl="${encodeURIComponent(path)}">highlight</button>`;
}
function scClass(status) {
  const n = Number(status);
  if (n >= 500) return 'sc-5';
  if (n >= 400) return 'sc-4';
  if (n >= 300) return 'sc-3';
  if (n >= 200) return 'sc-2';
  return '';
}
let openNetId = '';
const openRows = Object.fromEntries(TABS.map((t) => [t, new Set()]));
const openDetails = { dom: new Set(), bom: new Set() };

function rowKey(parts) {
  return String(parts.filter((p) => p != null && p !== '').join('|') || Math.random());
}
function rowOpen(key) {
  return openRows[activeTab]?.has(key) ? ' open' : '';
}

function statusLine(res) {
  if (!lastReport) {
    if (!res?.ok && res?.error) return (res.error || 'Error') + (res?.hint ? ' — ' + res.hint : '');
    return 'Waiting for this page…';
  }
  const cc = lastReport?.classCounts || {};
  const classBits = Object.entries(cc).map(([k, v]) => `${v} ${k}`).join(' · ');
  const hunt = lastReport?.hunt || {};
  const huntBit = lastScope?.huntEnabled && !hunt.applied ? 'hunt needs reload' : '';
  return [classBits, huntBit].filter(Boolean).join(' · ')
    || (lastReport?.narrative || []).join(' ')
    || 'OK';
}

function pageId(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}${u.search}`;
  } catch {
    return String(url || '').split('#')[0];
  }
}

function paintScope(scope) {
  if (!scope) return;
  lastScope = scope;
  [...$('scopeSeg').querySelectorAll('button')].forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === scope.mode);
  });
  $('btnHunt').classList.toggle('on', !!scope.huntEnabled);
  const bits = [scope.label];
  if (scope.mode === 'tab' && scope.tabUrl) bits.push(scope.tabUrl);
  if (scope.mode !== 'tab' && typeof scope.matchingTabs === 'number') {
    bits.push(`${scope.matchingTabs} tab${scope.matchingTabs === 1 ? '' : 's'}`);
  }
  if (scope.huntEnabled) bits.push('Hunt on');
  $('scopeMeta').textContent = bits.filter(Boolean).join(' · ');
}

function livePageLabel(focused, res) {
  const title = focused?.title || res?.scope?.tabTitle || '';
  const url = focused?.url || res?.tabUrl || res?.scope?.tabUrl || '';
  if (title && url) return `${title} | ${url}`;
  return url || title || 'No tab in this window';
}

function viewingOtherTab(focused, res) {
  const pinnedId = res?.scope?.tabId;
  if (res?.scope?.mode !== 'tab' || focused?.id == null || pinnedId == null) return '';
  if (focused.id === pinnedId) return '';
  let host = focused.url || 'this page';
  try { host = new URL(focused.url).host; } catch {}
  return `Viewing ${host} — collect is still Tab ${pinnedId}. Click This tab to pin this page.`;
}

async function focusedPageInThisWindow() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function ensurePinned() {
  const scope = await chrome.runtime.sendMessage({ type: 'PFA_GET_SCOPE' });
  paintScope(scope);
  if (scope?.mode === 'tab' && scope.tabId == null) {
    const next = await chrome.runtime.sendMessage({ type: 'PFA_SET_SCOPE', mode: 'tab', useActive: true });
    paintScope(next);
    return next;
  }
  return scope;
}

async function load(heavy = false) {
  try {
    const focused = await focusedPageInThisWindow();
    $('pageMeta').textContent = livePageLabel(focused, { tabUrl: focused?.url, scope: { tabTitle: focused?.title } });
    const res = await chrome.runtime.sendMessage({
      type: 'PFA_TAB_SUMMARY',
      heavy,
      followTabId: focused?.id,
    });
    if (res?.scope) paintScope(res.scope);
    const collectUrl = res?.tabUrl || res?.scope?.tabUrl || focused?.url || '';
    const pid = pageId(collectUrl);
    if (pid && pid !== lastPageId) {
      lastPageId = pid;
      lastReport = null;
      Object.values(openRows).forEach((s) => s.clear());
      Object.values(openDetails).forEach((s) => s.clear());
    }
    const incoming = res?.report || null;
    const cached = res?.cachedReport || null;
    const pick = (incoming && pid && pageId(incoming.pageUrl) === pid)
      ? incoming
      : (cached && pid && pageId(cached.pageUrl) === pid ? cached : null);
    lastReport = pick;
    $('pageMeta').textContent = livePageLabel(focused, res);
    const mismatch = viewingOtherTab(focused, res);
    $('status').textContent = mismatch || statusLine(res);
    render();
    return res;
  } catch (e) {
    $('status').textContent = String(e);
    return null;
  }
}

function setMatch(shown, total) {
  $('matchCount').textContent = q() ? `${shown} of ${total}` : (total ? String(total) : '');
}

function empty(msg) {
  return `<div class="empty">${esc(msg)}</div>`;
}

function renderFindings() {
  const r = lastReport;
  const hunt = r?.hunt || {};
  const all = r?.findings || [];
  const classes = r?.classCounts || {};
  let list = all.filter((f) => !classFilter || f.attackClass === classFilter).filter(matches);
  setMatch(list.length, all.length);
  const chips = ['', ...Object.keys(classes).sort()].map((c) => {
    const label = c ? `${c} ${classes[c]}` : `all ${all.length}`;
    return `<button type="button" class="chip ${classFilter === c ? 'active' : ''}" data-class="${esc(c)}">${esc(label)}</button>`;
  }).join('');
  let banner = '';
  if (!hunt.enabled) banner = `<div class="banner">Hunt is off. Turn Hunt on, then hard-refresh so source getters wrap.</div>`;
  else if (!hunt.applied) banner = `<div class="banner">Hunt on — hard-refresh this page so canaries attach at document_start.</div>`;
  if (!all.length) {
    return `${banner}<div class="card"><h3>Findings</h3>
      <p class="meta">Scanning ${hunt.sourceCount || 0} sources / ${hunt.sinkCount || 0} sinks</p>
      ${empty(hunt.enabled
        ? 'A finding is a Hunt canary that reached a wrapped sink (innerHTML, eval, location, …). Interact or hard-refresh if the page already rendered.'
        : 'Findings are Hunt canary → sink hits. Turn Hunt on, then hard-refresh.')}
    </div>`;
  }
  return `${banner}<div class="card"><h3>Findings · ${hunt.sourceCount || 0} sources / ${hunt.sinkCount || 0} sinks</h3>
    <div class="chips" id="classChips">${chips}</div>
    ${list.map((f) => {
      const key = rowKey(['f', f.source, f.sink, f.canary]);
      return `
      <div class="row ${esc(f.severity || f.attackClass || '')}${rowOpen(key)}" data-row="${esc(key)}">
        <div class="title-line" data-toggle="1">
          <span class="badge">${esc(f.attackClass)}</span>
          <span class="badge">${esc(f.severity)}</span>
          <b>${esc(f.sink)}</b>
          <span class="meta">← ${esc(f.source)}</span>
          ${copyBtn(f.canary)}
        </div>
        <div class="meta">${esc(f.context)} ${(f.transforms || []).join(' · ')} ${esc(f.provenance?.origin || f.provenance?.url || f.provenance?.targetOrigin || '')}</div>
        <div class="nested">
          <div class="val">${esc(f.snippet || f.payload || '')} ${copyBtn(f.payload)}</div>
          ${f.cssPath ? `<div class="meta">${esc(f.cssPath)} ${hlBtn(f.cssPath)} ${copyBtn(f.cssPath)}</div>` : ''}
          ${f.stack ? `<pre>${esc(f.stack)}</pre>${copyBtn(f.stack)}` : ''}
        </div>
      </div>`;
    }).join('') || empty('No rows match this filter.')}
  </div>`;
}

function renderEffects() {
  const all = lastReport?.effects || [];
  const list = all.filter(matches);
  setMatch(list.length, all.length);
  if (!all.length) return `<div class="card"><h3>API → DOM</h3>${empty('Use the page so an API can render into the DOM.')}</div>`;
  return `<div class="card"><h3>API → DOM</h3>
    ${list.map((e) => {
      const key = rowKey(['e', e.id, e.url]);
      return `
      <div class="row SOURCE${rowOpen(key)}" data-row="${esc(key)}">
        <div class="title-line" data-toggle="1">
          <span class="badge">${esc(e.how)}</span>
          <b>${esc(e.method)}</b>
          <span class="badge ${scClass(e.status)}">${e.status ?? ''}</span>
          ${copyBtn(e.url)}
          ${e.id ? `<button type="button" class="copy" data-open-net="${esc(e.id)}">network</button>` : ''}
        </div>
        <div class="meta">${esc(e.url)} · ${(e.nodes || []).length} nodes</div>
        <div class="nested">
          ${(e.nodes || []).map((n) => `
            <div class="meta"><code>${esc(n.tag)} ${esc(n.cssPath)}</code>
              ${hlBtn(n.cssPath)}
              ${copyBtn(n.preview)}
            </div>
            <div>${esc(n.preview)}</div>
          `).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderNetwork() {
  let all = lastReport?.networkExchanges || [];
  if (hideNoise) all = all.filter((n) => n.category !== 'static' && n.category !== 'telemetry');
  const list = all.filter(matches);
  setMatch(list.length, all.length);
  return `<div class="card"><h3>HTTP exchanges
      <label class="noise-toggle"><input type="checkbox" id="hideNoise" ${hideNoise ? 'checked' : ''}/> hide static/telemetry</label>
    </h3>
    ${list.map((n) => {
      const key = rowKey(['n', n.id]);
      if (openNetId && n.id === openNetId) openRows.network.add(key);
      return `
      <div class="row ${n.phase === 'failed' ? 'failed' : n.phase === 'pending' ? 'pending' : 'SOURCE'}${openNetId && n.id === openNetId ? ' flash' : ''}${rowOpen(key)}" data-row="${esc(key)}" data-net-id="${esc(n.id || '')}">
        <div class="title-line" data-toggle="1">
          <span class="badge">${esc(n.api)}</span>
          <b>${esc(n.method)}</b>
          <span class="badge ${scClass(n.status)}">${n.status ?? n.phase}</span>
          <span class="badge">${n.durationMs != null ? n.durationMs + 'ms' : ''}</span>
          ${copyBtn(n.url)}
        </div>
        <div class="meta">${esc(n.host)} · ${esc(n.category)} · ${esc(n.url)}</div>
        <div class="nested">
          ${n.requestBody ? `<div><code>req: ${esc(String(n.requestBody).slice(0, 800))}</code> ${copyBtn(n.requestBody)}</div>` : ''}
          ${n.responseBody ? `<div><code>res: ${esc(String(n.responseBody).slice(0, 800))}</code> ${copyBtn(n.responseBody)}</div>` : ''}
        </div>
      </div>`;
    }).join('') || empty('No HTTP yet. Interact with the page.')}
  </div>`;
}

function renderMessages() {
  const pms = (lastReport?.postMessages || []).filter(matches);
  const ws = (lastReport?.wsExchanges || []).filter(matches);
  setMatch(pms.length + ws.length, (lastReport?.postMessages || []).length + (lastReport?.wsExchanges || []).length);
  return `<div class="card"><h3>postMessage</h3>
    ${pms.slice().reverse().slice(0, 80).map((m) => `
      <div class="row SOURCE">
        <div class="title-line">${esc(m.origin || '')} ${copyBtn(m.data)}</div>
        <code>${esc(String(m.data || '').slice(0, 500))}</code>
      </div>`).join('') || empty('No postMessage.')}
  </div>
  <div class="card"><h3>WebSocket</h3>
    ${ws.map((w) => {
      const key = rowKey(['ws', w.id, w.url]);
      return `
      <div class="row${rowOpen(key)}" data-row="${esc(key)}">
        <div class="title-line" data-toggle="1"><b>${esc(w.url)}</b> <span class="badge">${(w.frames || []).length} frames</span> ${copyBtn(w.url)}</div>
        <div class="nested">
          ${(w.frames || []).slice(-40).map((f) => `<div class="meta">${esc(f.direction)} <code>${esc(String(f.data || '').slice(0, 300))}</code></div>`).join('')}
        </div>
      </div>`;
    }).join('') || empty('No WebSockets.')}
  </div>`;
}

function renderTraces() {
  const traces = (lastReport?.traces || []).filter(matches);
  setMatch(traces.length, (lastReport?.traces || []).length);
  return `<div class="card"><h3>Token traces</h3>
    ${traces.map((t) => `
      <div class="row ${t.hasSink ? 'PAIR' : 'SOURCE'}">
        <div class="val">${esc(t.value)} ${copyBtn(t.value)}</div>
        <div class="chain">${esc(t.chain || '(no path yet)')}</div>
        ${(t.pairs || []).slice(0, 8).map((p) => `
          <div class="pair-line"><span class="from-chip">${esc(p.from)}</span> → <span class="to-chip">${esc(p.to)}</span></div>
        `).join('')}
      </div>`).join('') || empty('Token watches harvest JWTs/UUIDs automatically.')}
  </div>`;
}

function renderList(title, items, cls, fmt) {
  const all = items || [];
  const list = all.filter(matches);
  setMatch(list.length, all.length);
  return `<div class="card"><h3>${esc(title)}</h3>
    ${list.slice().reverse().slice(0, 100).map(fmt).join('') || empty('—')}
  </div>`;
}

function renderDomBom(kind) {
  const data = lastReport?.[kind];
  if (!data) {
    setMatch(0, 0);
    load(true);
    return empty(`Loading ${kind}…`);
  }
  const entries = Object.entries(data).filter(([k, v]) => matches({ k, v }));
  setMatch(entries.length, Object.keys(data).length);
  return entries.map(([k, v]) => `
    <details class="card" data-section="${esc(k)}" ${openDetails[kind]?.has(k) ? 'open' : ''}><summary>${esc(k)}</summary>
      <div class="inner"><code>${esc(typeof v === 'string' ? v : JSON.stringify(v, null, 2)).slice(0, 8000)}</code></div>
    </details>`).join('') || empty('No matching sections.');
}

function renderOverview() {
  const c = lastReport?.counts || {};
  const hunt = lastReport?.hunt || {};
  setMatch(1, 1);
  return `<div class="card"><h3>Counters</h3>
    <div class="grid">${Object.entries(c).map(([k, v]) => `<div class="stat"><em>${esc(v)}</em>${esc(k)}</div>`).join('')}</div>
  </div>
  <div class="card"><h3>Hunt</h3>
    <p class="meta">${hunt.enabled ? (hunt.applied ? 'Hooks applied' : 'On — hard-refresh required') : 'Off'} · ${hunt.sourceCount || 0} sources / ${hunt.sinkCount || 0} sinks</p>
  </div>`;
}

function render() {
  [...tabBar.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b.dataset.tab === activeTab));
  const body = $('body');
  const y = body.scrollTop;
  if (!lastReport && activeTab !== 'overview') {
    body.innerHTML = empty('No data yet. Pin This tab / This origin / All, then hard-refresh.');
    setMatch(0, 0);
    return;
  }
  if (activeTab === 'findings') body.innerHTML = renderFindings();
  else if (activeTab === 'effects') body.innerHTML = renderEffects();
  else if (activeTab === 'network') body.innerHTML = renderNetwork();
  else if (activeTab === 'messages') body.innerHTML = renderMessages();
  else if (activeTab === 'traces') body.innerHTML = renderTraces();
  else if (activeTab === 'sources') {
    body.innerHTML = renderList('Auto sources', lastReport.autoSources, 'SOURCE', (s) =>
      `<div class="row SOURCE"><span class="badge">${esc(s.originType)}</span><div class="val">${esc(String(s.value || '').slice(0, 220))}</div></div>`);
  } else if (activeTab === 'sinks') {
    body.innerHTML = renderList('Sinks', lastReport.sinks, 'SINK', (s) =>
      `<div class="row SINK"><span class="badge">${esc(s.sinkType)}</span><code>${esc(String(s.payload || '').slice(0, 400))}</code></div>`);
  } else if (activeTab === 'storage') {
    body.innerHTML = renderList('Storage', lastReport.storage, 'SINK', (s) =>
      `<div class="row"><span class="badge">${esc(s.phase)}</span> ${esc(s.key)} <code>${esc(String(s.value || '').slice(0, 200))}</code></div>`);
  } else if (activeTab === 'dom') body.innerHTML = renderDomBom('dom');
  else if (activeTab === 'bom') body.innerHTML = renderDomBom('bom');
  else body.innerHTML = renderOverview();
  body.scrollTop = y;
}

$('body').addEventListener('click', async (e) => {
  const chip = e.target.closest('[data-class]');
  if (chip) { classFilter = chip.dataset.class; render(); return; }
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    try {
      await navigator.clipboard.writeText(decodeURIComponent(copy.dataset.copy));
      copy.textContent = 'copied';
      setTimeout(() => { copy.textContent = 'copy'; }, 800);
    } catch {}
    return;
  }
  const hl = e.target.closest('[data-hl]');
  if (hl) {
    try {
      await chrome.runtime.sendMessage({ type: 'PFA_HIGHLIGHT', cssPath: decodeURIComponent(hl.dataset.hl) });
    } catch {}
    return;
  }
  const net = e.target.closest('[data-open-net]');
  if (net) {
    openNetId = net.dataset.openNet;
    activeTab = 'network';
    $('search').value = queries.network || '';
    $('search').placeholder = 'Filter network…';
    render();
    return;
  }
  const tog = e.target.closest('[data-toggle]');
  if (tog) {
    const row = tog.closest('.row');
    if (!row) return;
    row.classList.toggle('open');
    const key = row.dataset.row;
    if (!key) return;
    const set = openRows[activeTab];
    if (row.classList.contains('open')) set.add(key);
    else set.delete(key);
  }
});
$('body').addEventListener('toggle', (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.dataset.section) return;
  const set = openDetails[activeTab];
  if (!set) return;
  if (d.open) set.add(d.dataset.section);
  else set.delete(d.dataset.section);
}, true);
$('body').addEventListener('change', (e) => {
  if (e.target.id === 'hideNoise') { hideNoise = e.target.checked; render(); }
});

$('search').addEventListener('input', () => {
  queries[activeTab] = $('search').value;
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== $('search') && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    $('search').focus();
  }
  if (e.key === 'Escape') {
    queries[activeTab] = '';
    $('search').value = '';
    $('search').blur();
    render();
  }
});

$('scopeSeg').onclick = async (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  const next = await chrome.runtime.sendMessage({ type: 'PFA_SET_SCOPE', mode: btn.dataset.mode, useActive: true });
  paintScope(next);
  await load(true);
};
$('btnHunt').onclick = () => {
  const on = !lastScope?.huntEnabled;
  $('btnHunt').classList.toggle('on', on);
  if (lastScope) lastScope.huntEnabled = on;
  $('status').textContent = on ? 'Hunt on — hard-refresh the page so source getters wrap.' : 'Hunt off.';
  chrome.runtime.sendMessage({ type: 'PFA_SET_HUNT', enabled: on }).then((next) => {
    if (lastScope) lastScope.huntEnabled = next?.huntEnabled ?? on;
    paintScope(lastScope);
  }).catch(() => {});
};
$('btnRefresh').onclick = () => load(true);
$('btnClear').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'PFA_CLEAR_ACTIVE' });
  await load(false);
};
$('btnExport').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'PFA_EXPORT_ACTIVE' });
  if (lastReport) {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ at: new Date().toISOString(), scope: lastScope, report: lastReport }, null, 2)], { type: 'application/json' }));
    await chrome.downloads.download({ url, filename: `dh-sidepanel-${Date.now()}.json`, saveAs: true });
  }
};
$('btnPick').onclick = async () => {
  const res = await chrome.runtime.sendMessage({ type: 'PFA_PICK_ACTIVE' });
  $('btnPick').classList.toggle('on', !!res?.pickMode);
  $('status').textContent = res?.pickMode ? 'Pick mode ON — click a value on the page.' : (res?.error || 'Pick mode off.');
};

ensurePinned().then(() => load(true));
setInterval(() => load(false), 4000);

let panelWindowId = null;
chrome.windows.getCurrent().then((w) => { panelWindowId = w?.id ?? null; }).catch(() => {});

let loadSoonTimer = null;
function loadSoon() {
  clearTimeout(loadSoonTimer);
  loadSoonTimer = setTimeout(() => load(false), 60);
}

chrome.tabs.onActivated.addListener((info) => {
  if (panelWindowId != null && info.windowId !== panelWindowId) return;
  loadSoon();
});
chrome.tabs.onUpdated.addListener((id, info, tab) => {
  if (!info.url && !info.title) return;
  if (panelWindowId != null && tab.windowId !== panelWindowId) return;
  if (tab.active) loadSoon();
});
$('search').placeholder = 'Filter findings…';
