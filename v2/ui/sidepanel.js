// Flowscope — side panel.
// Scope + live connection status (top card) and the Network capture (list).

const els = {
  seg: document.getElementById('scopeSeg'),
  dot: document.getElementById('statusDot'),
  label: document.getElementById('statusLabel'),
  chip: document.getElementById('scopeChip'),
  metaSingle: document.getElementById('metaSingle'),
  metaList: document.getElementById('metaList'),
  title: document.getElementById('metaTitle'),
  url: document.getElementById('metaUrl'),
  hint: document.getElementById('hint'),
  version: document.getElementById('version'),
  btnHunt: document.getElementById('btnHunt'),
  huntNote: document.getElementById('huntNote'),
  btnExport: document.getElementById('btnExport'),
  // content tabs
  tabbar: document.getElementById('tabbar'),
  viewNetwork: document.getElementById('viewNetwork'),
  viewMessages: document.getElementById('viewMessages'),
  viewSinks: document.getElementById('viewSinks'),
  viewTraces: document.getElementById('viewTraces'),
  viewFindings: document.getElementById('viewFindings'),
  viewInventory: document.getElementById('viewInventory'),
  invBody: document.getElementById('invBody'),
  invEmpty: document.getElementById('invEmpty'),
  btnRefreshInv: document.getElementById('btnRefreshInv'),
  // network
  netCount: document.getElementById('netCount'),
  hideNoise: document.getElementById('hideNoise'),
  btnRefresh: document.getElementById('btnRefresh'),
  btnClearNet: document.getElementById('btnClearNet'),
  netFilter: document.getElementById('netFilter'),
  netList: document.getElementById('netList'),
  netEmpty: document.getElementById('netEmpty'),
  // messages
  msgCount: document.getElementById('msgCount'),
  btnRefreshMsg: document.getElementById('btnRefreshMsg'),
  btnClearMsg: document.getElementById('btnClearMsg'),
  msgFilter: document.getElementById('msgFilter'),
  msgList: document.getElementById('msgList'),
  msgEmpty: document.getElementById('msgEmpty'),
  // sinks
  sinkCount: document.getElementById('sinkCount'),
  btnRefreshSink: document.getElementById('btnRefreshSink'),
  btnClearSink: document.getElementById('btnClearSink'),
  sinkFilter: document.getElementById('sinkFilter'),
  sinkList: document.getElementById('sinkList'),
  sinkEmpty: document.getElementById('sinkEmpty'),
  // traces
  traceCount: document.getElementById('traceCount'),
  btnRefreshTrace: document.getElementById('btnRefreshTrace'),
  btnClearTrace: document.getElementById('btnClearTrace'),
  traceFilter: document.getElementById('traceFilter'),
  traceList: document.getElementById('traceList'),
  traceEmpty: document.getElementById('traceEmpty'),
  // findings
  findCount: document.getElementById('findCount'),
  btnRefreshFind: document.getElementById('btnRefreshFind'),
  btnClearFind: document.getElementById('btnClearFind'),
  findFilter: document.getElementById('findFilter'),
  findList: document.getElementById('findList'),
  findEmpty: document.getElementById('findEmpty'),
};

const MAX_LIST = 8;
const POLL_MS = 2000;

function send(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (res) => {
        void chrome.runtime.lastError;
        resolve(res || null);
      });
    } catch {
      resolve(null);
    }
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
}

function setHint(text, isError = false) {
  els.hint.innerHTML = text;
  els.hint.classList.toggle('error', isError);
}

/* ---------------- scope + status ---------------- */

function paintSeg(mode) {
  for (const btn of els.seg.querySelectorAll('.seg-btn')) {
    btn.setAttribute('aria-selected', String(btn.dataset.mode === mode));
  }
}

function renderStatusList(targets) {
  if (!targets.length) {
    els.metaList.innerHTML = '<li class="targets-empty">No tabs in scope yet.</li>';
    return;
  }
  const shown = targets.slice(0, MAX_LIST);
  const rows = shown.map((t) => `
    <li class="target ${t.connected ? 'on' : ''}">
      <span class="tdot"></span>
      <span>
        <span class="thost">${esc(t.host || '—')}</span><br />
        <span class="ttitle">${esc(t.title || '(untitled)')}</span>
      </span>
    </li>`).join('');
  const more = targets.length > MAX_LIST
    ? `<li class="targets-more">+${targets.length - MAX_LIST} more</li>`
    : '';
  els.metaList.innerHTML = rows + more;
}

let multiTab = false;

function renderStatus(state) {
  const mode = state?.mode || 'tab';
  multiTab = mode !== 'tab';
  paintSeg(mode);

  if (state?.label) {
    els.chip.textContent = state.label;
    els.chip.hidden = false;
  } else {
    els.chip.hidden = true;
  }

  if (mode === 'tab') {
    els.metaSingle.hidden = false;
    els.metaList.hidden = true;
    const t = state?.primary || null;
    if (!t) {
      els.dot.dataset.state = 'idle';
      els.label.textContent = 'No http(s) tab';
      els.title.textContent = '—';
      els.url.textContent = '—';
    } else {
      els.dot.dataset.state = t.connected ? 'connected' : 'pinned';
      els.label.textContent = t.connected ? 'Connected' : 'Waiting…';
      els.title.textContent = t.title || '(untitled)';
      els.url.textContent = t.url || '—';
    }
  } else {
    els.metaSingle.hidden = true;
    els.metaList.hidden = false;
    const count = state?.count || 0;
    const conn = state?.connectedCount || 0;
    els.dot.dataset.state = conn > 0 ? 'connected' : count > 0 ? 'pinned' : 'idle';
    els.label.textContent = count > 0 ? `${conn}/${count} connected` : 'No tabs in scope';
    renderStatusList(state?.targets || []);
  }

  if (typeof state?.huntEnabled === 'boolean') paintHunt(state.huntEnabled);
  setHint(hintFor(state), false);
}

let huntOn = false;
function paintHunt(on) {
  huntOn = !!on;
  els.btnHunt.textContent = 'Hunt: ' + (on ? 'on' : 'off');
  els.btnHunt.setAttribute('aria-pressed', String(!!on));
  els.huntNote.textContent = on
    ? 'ON — writes canary to hash/search/name/cookie. Hard-refresh tabs.'
    : 'Active canary taint. Off by default.';
  els.huntNote.classList.toggle('on', !!on);
}
els.btnHunt.addEventListener('click', async () => {
  const res = await send({ type: 'FS_SET_HUNT', enabled: !huntOn });
  if (res?.ok) paintHunt(res.huntEnabled);
});

function hintFor(state) {
  const mode = state?.mode || 'tab';
  const count = state?.count || 0;
  const conn = state?.connectedCount || 0;
  if (mode === 'tab') {
    if (!state?.primary) return 'Switch to an http(s) tab — <strong>This tab</strong> follows whatever you focus.';
    return state.primary.connected
      ? 'Following the active tab. Flowscope is connected.'
      : 'Following the active tab. Hard-refresh it (Ctrl+Shift+R) so it connects.';
  }
  if (mode === 'origin') {
    if (!count) return 'Focus an http(s) tab — <strong>This origin</strong> follows the current origin.';
    return conn < count
      ? `${count} tab(s) on this origin. Hard-refresh any that aren't green.`
      : `Following the active tab's origin — ${count} tab(s).`;
  }
  if (!count) return 'No http(s) tabs are open.';
  return conn < count
    ? `${count} http(s) tab(s). Hard-refresh any that aren't green.`
    : `Watching all ${count} http(s) tab(s).`;
}

let statusInFlight = false;
async function refreshStatus() {
  if (statusInFlight) return;
  statusInFlight = true;
  try {
    renderStatus(await send({ type: 'FS_GET_STATE' }));
  } finally {
    statusInFlight = false;
  }
}

/* ---------------- network ---------------- */

const NOISE = new Set(['static', 'telemetry']);
let openId = null;      // the single open (non-pinned) row
const pinned = [];      // ids pinned to the top (multiple, always open)
let rawExchanges = [];
let activeTabId = null; // which browser tab is currently focused
let lastNetKey = '';

function isOpen(id) {
  return openId === id; // pin controls position only, not open state
}

function pathOf(u) {
  try {
    const url = new URL(u);
    return (url.pathname || '/') + (url.search || '');
  } catch {
    return String(u || '');
  }
}

function statusClass(ex) {
  if (ex.error) return 's-err';
  if (ex.status == null) return '';
  return 's-' + Math.floor(ex.status / 100) + 'xx';
}

function kv(k, v) {
  return `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`;
}

function detailHtml(ex) {
  const dur = ex.durationMs != null ? `  ·  ${ex.durationMs}ms` : '';
  const statusText = ex.error ? `error: ${ex.error}` : `${ex.status ?? '—'}${dur}`;
  const rows = [
    kv('URL', ex.url),
    kv('Status', statusText),
    kv('Type', ex.contentType || '—'),
    kv('Category', ex.category || 'other'),
  ];
  if (multiTab && ex.tabHost) rows.push(kv('Tab', ex.tabHost));
  let h = `<dl class="kv">${rows.join('')}</dl>`;
  h += headerBlock('Request headers', ex.reqHeaders);
  h += headerBlock('Response headers', ex.resHeaders);
  if (ex.reqBody) h += `<h4>Request body</h4><pre>${esc(ex.reqBody)}</pre>`;
  if (ex.resBody != null) h += `<h4>Response body</h4><pre>${esc(ex.resBody)}</pre>`;
  else if (!ex.pending) h += `<h4>Response body</h4><pre>(not captured — binary, static, or empty)</pre>`;
  return h;
}

function headerBlock(title, obj) {
  if (!obj) return '';
  const txt = Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `<details class="hdr"><summary>${esc(title)} (${Object.keys(obj).length})</summary><pre>${esc(txt)}</pre></details>`;
}

function rowHtml(ex) {
  const open = isOpen(ex.id);
  const isPinned = pinned.includes(ex.id);
  const fromActive = multiTab && ex.tabId != null && ex.tabId === activeTabId;
  const statusLabel = ex.error ? 'ERR' : (ex.status ?? '…');
  const tabBadge = multiTab && ex.tabHost
    ? `<span class="net-tab ${fromActive ? 'active' : ''}" title="From tab: ${esc(ex.tabHost)}">${esc(ex.tabHost)}</span>`
    : '';
  return `<li class="net-row ${ex.pending ? 'pending' : ''} ${open ? 'open' : ''} ${isPinned ? 'pinned' : ''} ${fromActive ? 'from-active' : ''}" data-id="${esc(ex.id)}">
    <div class="net-summary">
      <span class="method m-${esc(ex.method)}">${esc(ex.method)}</span>
      <span class="status ${statusClass(ex)}">${esc(statusLabel)}</span>
      <span class="net-target">
        <span class="net-host">${esc(ex.host || '')}</span>
        <span class="net-path">${esc(pathOf(ex.url))}</span>
        ${tabBadge}
      </span>
      <span class="net-dur">${ex.durationMs != null ? ex.durationMs + 'ms' : ''}</span>
      <button class="net-pin ${isPinned ? 'on' : ''}" data-pin="1" title="${isPinned ? 'Unpin' : 'Pin to top'}">${isPinned ? '★' : '☆'}</button>
    </div>
    ${open ? `<div class="net-detail">${detailHtml(ex)}</div>` : ''}
  </li>`;
}

function filteredExchanges() {
  const hideNoise = els.hideNoise.checked;
  const q = els.netFilter.value.trim().toLowerCase();
  return rawExchanges.filter((ex) => {
    if (hideNoise && NOISE.has(ex.category)) return false;
    if (q && !String(ex.url || '').toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderNetwork(force = false) {
  const byIdMap = new Map(rawExchanges.map((e) => [e.id, e]));
  const pinnedRows = pinned.map((id) => byIdMap.get(id)).filter(Boolean);
  const rest = filteredExchanges().filter((e) => !pinned.includes(e.id));
  const all = [...pinnedRows, ...rest];

  const key =
    els.hideNoise.checked + '|' + els.netFilter.value.trim() + '|' +
    pinned.join(',') + '|' + openId + '|' + activeTabId + '|' +
    all.map((e) => e.id + ':' + (e.pending ? 'p' : e.status)).join(',');
  if (!force && key === lastNetKey) return;
  lastNetKey = key;

  els.netCount.textContent = String(all.length);

  if (!all.length) {
    els.netList.innerHTML = '';
    els.netEmpty.hidden = false;
    els.netEmpty.textContent = rawExchanges.length
      ? 'No requests match the current filter.'
      : 'No requests captured yet. Reload the page (with the panel open) so the hooks load early.';
    return;
  }
  els.netEmpty.hidden = true;

  const scroll = els.netList.scrollTop;
  let html = pinnedRows.map(rowHtml).join('');
  if (pinnedRows.length && rest.length) html += '<li class="net-divider"></li>';
  html += rest.map(rowHtml).join('');
  els.netList.innerHTML = html;
  els.netList.scrollTop = scroll;
}

let netInFlight = false;
async function refreshNetwork() {
  if (netInFlight) return;
  netInFlight = true;
  try {
    const res = await send({ type: 'FS_GET_NETWORK' });
    rawExchanges = res?.exchanges || [];
    activeTabId = res?.activeTabId ?? null;
    renderNetwork(false);
  } finally {
    netInFlight = false;
  }
}

els.netList.addEventListener('click', (e) => {
  const row = e.target.closest('.net-row');
  if (!row) return;
  const id = row.dataset.id;

  // Pin/unpin: pin only moves the row to the top; it doesn't change open state.
  if (e.target.closest('.net-pin')) {
    const i = pinned.indexOf(id);
    if (i >= 0) pinned.splice(i, 1);
    else pinned.push(id);
    renderNetwork(true);
    return;
  }

  // Don't collapse while the user interacts with the detail (e.g. <details>) or selects text.
  if (e.target.closest('.net-detail')) return;
  if (window.getSelection && String(window.getSelection()).length) return;

  // Accordion: only one row open at a time (pinned or not).
  openId = openId === id ? null : id;
  renderNetwork(true);
});

els.hideNoise.addEventListener('change', () => renderNetwork(true));
let filterDeb = null;
els.netFilter.addEventListener('input', () => {
  clearTimeout(filterDeb);
  filterDeb = setTimeout(() => renderNetwork(true), 150);
});
els.btnClearNet.addEventListener('click', async () => {
  await send({ type: 'FS_CLEAR', what: 'network' });
  openId = null;
  pinned.length = 0;
  rawExchanges = [];
  renderNetwork(true);
  refreshNetwork();
});
els.btnRefresh.addEventListener('click', () => { refreshStatus(); refreshNetwork(); });

/* ---------------- messages ---------------- */

let rawMessages = [];
let openMid = null;
let lastMsgKey = '';

function wsHost(u) {
  try {
    const url = new URL(u);
    return url.host + (url.pathname && url.pathname !== '/' ? url.pathname : '');
  } catch {
    return String(u || '');
  }
}

function msgMeta(m) {
  if (m.kind === 'pm') {
    return m.dir === 'out'
      ? { cls: 'pm-out', label: 'PM ▸', origin: m.target || '*', preview: m.data }
      : { cls: 'pm-in', label: 'PM ◂', origin: m.origin || '', preview: m.data };
  }
  const host = wsHost(m.url);
  if (m.sub === 'open') return { cls: 'ws-ctl', label: 'WS ○', origin: host, preview: 'opened' + (m.protocols ? ' · ' + m.protocols : '') };
  if (m.sub === 'close') return { cls: 'ws-ctl', label: 'WS ✕', origin: host, preview: 'closed' + (m.code != null ? ' · ' + m.code : '') + (m.reason ? ' ' + m.reason : '') };
  if (m.sub === 'error') return { cls: 'ws-err', label: 'WS !', origin: host, preview: 'error' };
  return m.dir === 'out'
    ? { cls: 'ws-out', label: 'WS ▸', origin: host, preview: m.data }
    : { cls: 'ws-in', label: 'WS ◂', origin: host, preview: m.data };
}

function fmtTime(t) {
  try { return new Date(t).toLocaleTimeString(); } catch { return ''; }
}

function msgDetailHtml(m) {
  const rows = [];
  if (m.kind === 'pm') {
    rows.push(kv('Type', 'postMessage'));
    rows.push(kv('Direction', m.dir === 'out' ? 'outgoing' : 'incoming'));
    rows.push(kv(m.dir === 'out' ? 'Target origin' : 'Origin', m.dir === 'out' ? (m.target || '*') : (m.origin || '')));
  } else {
    rows.push(kv('Type', 'WebSocket'));
    rows.push(kv('Event', m.sub));
    if (m.dir) rows.push(kv('Direction', m.dir === 'out' ? 'sent' : 'received'));
    rows.push(kv('URL', m.url || ''));
    if (m.protocols) rows.push(kv('Protocols', m.protocols));
    if (m.code != null) rows.push(kv('Close', m.code + (m.reason ? ' ' + m.reason : '')));
  }
  if (m.size != null) rows.push(kv('Size', m.size + ' bytes'));
  if (multiTab && m.tabHost) rows.push(kv('Tab', m.tabHost));
  rows.push(kv('Time', fmtTime(m.t)));
  let h = `<dl class="kv">${rows.join('')}</dl>`;
  if (m.data != null && m.data !== '') h += `<h4>Data</h4><pre>${esc(m.data)}</pre>`;
  return h;
}

function msgRowHtml(m) {
  const meta = msgMeta(m);
  const open = openMid === m.id;
  const preview = String(meta.preview || '').replace(/\s+/g, ' ').slice(0, 140);
  return `<li class="net-row ${open ? 'open' : ''}" data-mid="${esc(m.id)}">
    <div class="msg-summary">
      <span class="msg-badge ${meta.cls}">${esc(meta.label)}</span>
      <span class="msg-target">
        <span class="msg-origin">${esc(meta.origin || '—')}</span>
        <span class="msg-preview">${esc(preview)}</span>
      </span>
      <span class="net-dur">${esc(fmtTime(m.t))}</span>
    </div>
    ${open ? `<div class="net-detail">${msgDetailHtml(m)}</div>` : ''}
  </li>`;
}

function filteredMessages() {
  const q = els.msgFilter.value.trim().toLowerCase();
  if (!q) return rawMessages;
  return rawMessages.filter((m) =>
    `${m.data || ''} ${m.origin || ''} ${m.target || ''} ${m.url || ''}`.toLowerCase().includes(q)
  );
}

function renderMessages(force = false) {
  const list = filteredMessages();
  const key = els.msgFilter.value.trim() + '|' + openMid + '|' +
    list.map((m) => m.id).join(',');
  if (!force && key === lastMsgKey) return;
  lastMsgKey = key;

  els.msgCount.textContent = String(list.length);
  if (!list.length) {
    els.msgList.innerHTML = '';
    els.msgEmpty.hidden = false;
    els.msgEmpty.textContent = rawMessages.length
      ? 'No messages match the current filter.'
      : 'No messages captured yet. Reload the page (with the panel open) so the hooks load early.';
    return;
  }
  els.msgEmpty.hidden = true;
  const scroll = els.msgList.scrollTop;
  els.msgList.innerHTML = list.map(msgRowHtml).join('');
  els.msgList.scrollTop = scroll;
}

let msgInFlight = false;
async function refreshMessages() {
  if (msgInFlight) return;
  msgInFlight = true;
  try {
    const res = await send({ type: 'FS_GET_MESSAGES' });
    rawMessages = res?.messages || [];
    renderMessages(false);
  } finally {
    msgInFlight = false;
  }
}

els.msgList.addEventListener('click', (e) => {
  const row = e.target.closest('.net-row');
  if (!row) return;
  if (e.target.closest('.net-detail')) return;
  if (window.getSelection && String(window.getSelection()).length) return;
  const id = row.dataset.mid;
  openMid = openMid === id ? null : id;
  renderMessages(true);
});

let msgFilterDeb = null;
els.msgFilter.addEventListener('input', () => {
  clearTimeout(msgFilterDeb);
  msgFilterDeb = setTimeout(() => renderMessages(true), 150);
});
els.btnClearMsg.addEventListener('click', async () => {
  await send({ type: 'FS_CLEAR', what: 'messages' });
  openMid = null;
  rawMessages = [];
  renderMessages(true);
  refreshMessages();
});
els.btnRefreshMsg.addEventListener('click', () => { refreshStatus(); refreshMessages(); });

/* ---------------- sinks ---------------- */

let rawSinks = [];
let openSid = null;
let lastSinkKey = '';

function sinkClass(name) {
  if (/location|window\.open/i.test(name)) return 'redirect';
  if (/setAttribute\((href|src|action|formaction|data)\)/i.test(name)) return 'link';
  return ''; // xss-ish default (danger red)
}

function sinkDetailHtml(s) {
  const rows = [kv('Sink', s.sink)];
  if (s.attr) rows.push(kv('Attribute', s.attr));
  if (s.cssPath) rows.push(kv('Element', s.cssPath));
  if (multiTab && s.tabHost) rows.push(kv('Tab', s.tabHost));
  rows.push(kv('Time', fmtTime(s.t)));
  let h = `<dl class="kv">${rows.join('')}</dl>`;
  if (s.value != null && s.value !== '') h += `<h4>Value</h4><pre>${esc(s.value)}</pre>`;
  if (s.stack) h += `<details class="hdr"><summary>Stack</summary><pre>${esc(s.stack)}</pre></details>`;
  return h;
}

function sinkRowHtml(s) {
  const open = openSid === s.id;
  const val = String(s.value || '').replace(/\s+/g, ' ').slice(0, 160);
  return `<li class="net-row ${open ? 'open' : ''}" data-sid="${esc(s.id)}">
    <div class="sink-summary">
      <span class="sink-target">
        <span class="sink-name ${sinkClass(s.sink)}">${esc(s.sink)}</span>
        <span class="sink-val">${esc(val)}</span>
      </span>
      <span class="net-dur">${esc(fmtTime(s.t))}</span>
    </div>
    ${open ? `<div class="net-detail">${sinkDetailHtml(s)}</div>` : ''}
  </li>`;
}

function filteredSinks() {
  const q = els.sinkFilter.value.trim().toLowerCase();
  if (!q) return rawSinks;
  return rawSinks.filter((s) => `${s.sink || ''} ${s.value || ''} ${s.cssPath || ''}`.toLowerCase().includes(q));
}

function renderSinks(force = false) {
  const list = filteredSinks();
  const key = els.sinkFilter.value.trim() + '|' + openSid + '|' + list.map((s) => s.id).join(',');
  if (!force && key === lastSinkKey) return;
  lastSinkKey = key;

  els.sinkCount.textContent = String(list.length);
  if (!list.length) {
    els.sinkList.innerHTML = '';
    els.sinkEmpty.hidden = false;
    els.sinkEmpty.textContent = rawSinks.length
      ? 'No sinks match the current filter.'
      : 'No sink calls captured yet. Reload the page (with the panel open) so the hooks load early.';
    return;
  }
  els.sinkEmpty.hidden = true;
  const scroll = els.sinkList.scrollTop;
  els.sinkList.innerHTML = list.map(sinkRowHtml).join('');
  els.sinkList.scrollTop = scroll;
}

let sinkInFlight = false;
async function refreshSinks() {
  if (sinkInFlight) return;
  sinkInFlight = true;
  try {
    const res = await send({ type: 'FS_GET_SINKS' });
    rawSinks = res?.sinks || [];
    renderSinks(false);
  } finally {
    sinkInFlight = false;
  }
}

els.sinkList.addEventListener('click', (e) => {
  const row = e.target.closest('.net-row');
  if (!row) return;
  if (e.target.closest('.net-detail')) return;
  if (window.getSelection && String(window.getSelection()).length) return;
  const id = row.dataset.sid;
  openSid = openSid === id ? null : id;
  renderSinks(true);
});

let sinkFilterDeb = null;
els.sinkFilter.addEventListener('input', () => {
  clearTimeout(sinkFilterDeb);
  sinkFilterDeb = setTimeout(() => renderSinks(true), 150);
});
els.btnClearSink.addEventListener('click', async () => {
  await send({ type: 'FS_CLEAR', what: 'sinks' });
  openSid = null;
  rawSinks = [];
  renderSinks(true);
  refreshSinks();
});
els.btnRefreshSink.addEventListener('click', () => { refreshStatus(); refreshSinks(); });

/* ---------------- traces ---------------- */

let rawTraces = [];
let openTid = null;
let lastTraceKey = '';

function traceDetailHtml(tr) {
  const rows = [
    kv('Source', tr.source),
    kv('Sink', tr.sink),
    kv('Channel', tr.channel),
  ];
  if (multiTab && tr.tabHost) rows.push(kv('Tab', tr.tabHost));
  rows.push(kv('Time', fmtTime(tr.t)));
  let h = `<dl class="kv">${rows.join('')}</dl>`;
  h += `<h4>Matched value</h4><pre>${esc(tr.value || '')}</pre>`;
  if (tr.snippet) h += `<h4>Context</h4><pre>${esc(tr.snippet)}</pre>`;
  return h;
}

function traceRowHtml(tr) {
  const open = openTid === tr.id;
  const val = String(tr.value || '').replace(/\s+/g, ' ').slice(0, 120);
  return `<li class="net-row ${open ? 'open' : ''}" data-tid="${esc(tr.id)}">
    <div class="trace-summary">
      <div class="trace-flow">
        <span class="trace-src">${esc(tr.source || '')}</span>
        <span class="trace-arrow">→</span>
        <span class="trace-sink">${esc(tr.sink || '')}</span>
      </div>
      <span class="trace-val">${esc(val)}</span>
    </div>
    ${open ? `<div class="net-detail">${traceDetailHtml(tr)}</div>` : ''}
  </li>`;
}

function filteredTraces() {
  const q = els.traceFilter.value.trim().toLowerCase();
  if (!q) return rawTraces;
  return rawTraces.filter((tr) => `${tr.source || ''} ${tr.sink || ''} ${tr.value || ''}`.toLowerCase().includes(q));
}

function renderTraces(force = false) {
  const list = filteredTraces();
  const key = els.traceFilter.value.trim() + '|' + openTid + '|' + list.map((t) => t.id).join(',');
  if (!force && key === lastTraceKey) return;
  lastTraceKey = key;

  els.traceCount.textContent = String(list.length);
  if (!list.length) {
    els.traceList.innerHTML = '';
    els.traceEmpty.hidden = false;
    els.traceEmpty.textContent = rawTraces.length
      ? 'No traces match the current filter.'
      : 'No source→sink traces yet. Reload with a token in the URL/hash, or interact so a source value reaches a sink.';
    return;
  }
  els.traceEmpty.hidden = true;
  const scroll = els.traceList.scrollTop;
  els.traceList.innerHTML = list.map(traceRowHtml).join('');
  els.traceList.scrollTop = scroll;
}

let traceInFlight = false;
async function refreshTraces() {
  if (traceInFlight) return;
  traceInFlight = true;
  try {
    const res = await send({ type: 'FS_GET_TRACES' });
    rawTraces = res?.traces || [];
    renderTraces(false);
  } finally {
    traceInFlight = false;
  }
}

els.traceList.addEventListener('click', (e) => {
  const row = e.target.closest('.net-row');
  if (!row) return;
  if (e.target.closest('.net-detail')) return;
  if (window.getSelection && String(window.getSelection()).length) return;
  const id = row.dataset.tid;
  openTid = openTid === id ? null : id;
  renderTraces(true);
});

let traceFilterDeb = null;
els.traceFilter.addEventListener('input', () => {
  clearTimeout(traceFilterDeb);
  traceFilterDeb = setTimeout(() => renderTraces(true), 150);
});
els.btnClearTrace.addEventListener('click', async () => {
  await send({ type: 'FS_CLEAR', what: 'traces' });
  openTid = null;
  rawTraces = [];
  renderTraces(true);
  refreshTraces();
});
els.btnRefreshTrace.addEventListener('click', () => { refreshStatus(); refreshTraces(); });

/* ---------------- findings (Hunt) ---------------- */

let rawFindings = [];
let openFid = null;
let lastFindKey = '';

function findDetailHtml(f) {
  const rows = [
    kv('Source', f.source),
    kv('Sink', f.sink),
    kv('Channel', f.channel),
    kv('Attack class', f.attackClass),
    kv('Severity', f.severity),
    kv('Canary', f.canary),
  ];
  if (f.cssPath) rows.push(kv('Element', f.cssPath));
  if (multiTab && f.tabHost) rows.push(kv('Tab', f.tabHost));
  rows.push(kv('Time', fmtTime(f.t)));
  let h = `<dl class="kv">${rows.join('')}</dl>`;
  if (f.snippet) h += `<h4>Context</h4><pre>${esc(f.snippet)}</pre>`;
  if (f.value) h += `<h4>Value</h4><pre>${esc(f.value)}</pre>`;
  if (f.stack) h += `<details class="hdr"><summary>Stack</summary><pre>${esc(f.stack)}</pre></details>`;
  return h;
}

function findRowHtml(f) {
  const open = openFid === f.id;
  return `<li class="net-row ${open ? 'open' : ''}" data-fid="${esc(f.id)}">
    <div class="find-summary">
      <span class="sev ${esc(f.severity || 'info')}">${esc(f.severity || '')}</span>
      <span class="find-target">
        <span class="find-flow">
          <span class="find-src">${esc(f.source || '')}</span>
          <span class="find-arrow">→</span>
          <span class="find-sink">${esc(f.sink || '')}</span>
        </span>
        <span class="find-class">${esc(f.attackClass || '')}</span>
      </span>
      <span class="net-dur">${esc(fmtTime(f.t))}</span>
    </div>
    ${open ? `<div class="net-detail">${findDetailHtml(f)}</div>` : ''}
  </li>`;
}

function filteredFindings() {
  const q = els.findFilter.value.trim().toLowerCase();
  if (!q) return rawFindings;
  return rawFindings.filter((f) => `${f.source || ''} ${f.sink || ''} ${f.attackClass || ''}`.toLowerCase().includes(q));
}

function renderFindings(force = false) {
  const list = filteredFindings();
  const key = els.findFilter.value.trim() + '|' + openFid + '|' + list.map((f) => f.id).join(',');
  if (!force && key === lastFindKey) return;
  lastFindKey = key;

  els.findCount.textContent = String(list.length);
  if (!list.length) {
    els.findList.innerHTML = '';
    els.findEmpty.hidden = false;
    return;
  }
  els.findEmpty.hidden = true;
  const scroll = els.findList.scrollTop;
  els.findList.innerHTML = list.map(findRowHtml).join('');
  els.findList.scrollTop = scroll;
}

let findInFlight = false;
async function refreshFindings() {
  if (findInFlight) return;
  findInFlight = true;
  try {
    const res = await send({ type: 'FS_GET_FINDINGS' });
    rawFindings = res?.findings || [];
    renderFindings(false);
  } finally {
    findInFlight = false;
  }
}

els.findList.addEventListener('click', (e) => {
  const row = e.target.closest('.net-row');
  if (!row) return;
  if (e.target.closest('.net-detail')) return;
  if (window.getSelection && String(window.getSelection()).length) return;
  const id = row.dataset.fid;
  openFid = openFid === id ? null : id;
  renderFindings(true);
});

let findFilterDeb = null;
els.findFilter.addEventListener('input', () => {
  clearTimeout(findFilterDeb);
  findFilterDeb = setTimeout(() => renderFindings(true), 150);
});
els.btnClearFind.addEventListener('click', async () => {
  await send({ type: 'FS_CLEAR', what: 'findings' });
  openFid = null;
  rawFindings = [];
  renderFindings(true);
  refreshFindings();
});
els.btnRefreshFind.addEventListener('click', () => { refreshStatus(); refreshFindings(); });

/* ---------------- inventory ---------------- */

function invPre(obj) { return `<pre>${esc(JSON.stringify(obj, null, 2))}</pre>`; }
function invSub(title, node) {
  return `<details class="inv-sec"><summary>${esc(title)}</summary><div class="inv-inner">${node}</div></details>`;
}

let lastInvKey = '';
function invRender(inv, force = false) {
  if (!inv || !inv.dom) {
    if (!force && lastInvKey === 'empty') return;
    lastInvKey = 'empty';
    els.invBody.innerHTML = '';
    els.invEmpty.hidden = false;
    return;
  }
  // Skip rebuild when nothing changed, so open <details> aren't reset by the poll.
  const key = inv.url + '|' + JSON.stringify(inv.dom.counts) + '|' +
    Object.keys(inv.bom?.localStorage || {}).length + '|' + Object.keys(inv.bom?.sessionStorage || {}).length;
  if (!force && key === lastInvKey) return;
  lastInvKey = key;

  els.invEmpty.hidden = true;
  const dom = inv.dom, bom = inv.bom || {};

  const chips = Object.entries(dom.counts || {}).map(([k, v]) => `<span class="chip">${esc(k)} <b>${v}</b></span>`).join('');
  let domInner = `<div class="chips">${chips}</div>`;
  if (dom.frameworks?.length) domInner += `<div class="chips">${dom.frameworks.map((f) => `<span class="chip fw-tag">${esc(f)}</span>`).join('')}</div>`;
  domInner += invSub(`Forms (${dom.forms?.length || 0})`, invPre(dom.forms || []));
  domInner += invSub(`Iframes (${dom.iframes?.length || 0})`, invPre(dom.iframes || []));
  domInner += invSub(`Inline handlers (${dom.inlineHandlers?.length || 0})`, invPre(dom.inlineHandlers || []));
  domInner += invSub(`External scripts (${dom.externalScripts?.length || 0})`, invPre(dom.externalScripts || []));
  domInner += invSub(`Links (${dom.links?.length || 0})`, invPre(dom.links || []));
  domInner += invSub('Meta', invPre(dom.meta || {}));

  let bomInner = '';
  bomInner += invSub('Location', invPre(bom.location || {}));
  bomInner += invSub('Navigator', invPre(bom.navigator || {}));
  bomInner += invSub('Screen / Window', invPre({ screen: bom.screen, window: bom.window }));
  bomInner += invSub('Features', invPre(bom.features || {}));
  bomInner += invSub(`localStorage (${Object.keys(bom.localStorage || {}).length})`, invPre(bom.localStorage || {}));
  bomInner += invSub(`sessionStorage (${Object.keys(bom.sessionStorage || {}).length})`, invPre(bom.sessionStorage || {}));
  bomInner += invSub('Cookies', invPre(bom.cookies || ''));

  els.invBody.innerHTML =
    `<details class="inv-sec" open><summary>DOM</summary><div class="inv-inner">${domInner}</div></details>` +
    `<details class="inv-sec"><summary>BOM</summary><div class="inv-inner">${bomInner}</div></details>`;
}

let invInFlight = false;
async function refreshInventory(force = false) {
  if (invInFlight) return;
  invInFlight = true;
  try {
    const res = await send({ type: 'FS_GET_INVENTORY' });
    invRender(res?.ok ? res.inventory : null, force);
  } finally {
    invInFlight = false;
  }
}
els.btnRefreshInv.addEventListener('click', () => refreshInventory(true));

/* ---------------- export ---------------- */

els.btnExport.addEventListener('click', async () => {
  els.btnExport.disabled = true;
  try {
    const res = await send({ type: 'FS_EXPORT' });
    if (!res?.ok || !res.data) { setHint('Export failed.', true); return; }
    const host = res.data?.inventory?.tabHost || res.data?.meta?.scope?.label || 'page';
    const name = 'flowscope-' + String(host).replace(/[^a-z0-9.-]/gi, '_') + '-' + Date.now() + '.json';
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setHint('Exported ' + name);
  } finally {
    els.btnExport.disabled = false;
  }
});

/* ---------------- content tabs ---------------- */

let activeView = 'network';
function setView(v) {
  activeView = v;
  els.viewNetwork.hidden = v !== 'network';
  els.viewMessages.hidden = v !== 'messages';
  els.viewSinks.hidden = v !== 'sinks';
  els.viewTraces.hidden = v !== 'traces';
  els.viewFindings.hidden = v !== 'findings';
  els.viewInventory.hidden = v !== 'inventory';
  for (const b of els.tabbar.querySelectorAll('.tab-btn')) {
    b.setAttribute('aria-selected', String(b.dataset.view === v));
  }
  if (v === 'inventory') refreshInventory();
}
els.tabbar.addEventListener('click', (e) => {
  const b = e.target.closest('.tab-btn');
  if (b) setView(b.dataset.view);
});

/* ---------------- scope control + polling ---------------- */

async function chooseMode(mode) {
  const res = await send({ type: 'FS_SET_SCOPE', mode });
  if (!res?.ok) {
    await refreshStatus();
    setHint(res?.error || 'Could not set that scope.', true);
    return;
  }
  renderStatus(res);
  refreshNetwork();
  refreshMessages();
  refreshSinks();
  refreshTraces();
  refreshFindings();
  if (activeView === 'inventory') refreshInventory();
}

els.seg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (btn) chooseMode(btn.dataset.mode);
});

function tick() {
  refreshStatus(); refreshNetwork(); refreshMessages(); refreshSinks(); refreshTraces(); refreshFindings();
  // inventory is not polled — it rebuilds fully and would reset open <details>; refresh on demand only
}

let pollTimer = null;
function startPolling() {
  stopPolling();
  if (document.visibilityState === 'visible') pollTimer = setInterval(tick, POLL_MS);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { tick(); startPolling(); }
  else stopPolling();
});

let debounce = null;
function scheduleTick() {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    tick();
    if (activeView === 'inventory') refreshInventory(); // keyed: rebuilds only if primary tab changed
  }, 120);
}
try {
  chrome.tabs.onActivated.addListener(scheduleTick);
  chrome.tabs.onUpdated.addListener((_id, info) => {
    if (info.url || info.status === 'complete') scheduleTick();
  });
  chrome.tabs.onRemoved.addListener(scheduleTick);
  chrome.windows.onFocusChanged.addListener((w) => {
    if (w !== chrome.windows.WINDOW_ID_NONE) scheduleTick();
  });
} catch {}

try {
  els.version.textContent = 'v' + chrome.runtime.getManifest().version;
} catch {}

tick();
startPolling();
