const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TABS = ['traces', 'overview', 'flows', 'network', 'sources', 'sinks', 'storage', 'messages', 'dom', 'bom'];
let activeTab = 'traces';
let lastReport = null;

const tabBar = $('tabs');
TABS.forEach((t) => {
  const b = document.createElement('button');
  b.textContent = t;
  b.dataset.tab = t;
  b.onclick = () => { activeTab = t; render(); };
  tabBar.appendChild(b);
});

async function load(heavy = false) {
  $('status').textContent = 'Loading…';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'PFA_TAB_SUMMARY', heavy });
    if (!res?.ok) {
      $('status').textContent = (res?.error || 'Error') + (res?.hint ? ' — ' + res.hint : '');
      return null;
    }
    lastReport = res.report || res.cachedReport || null;
    $('pageMeta').textContent = `${lastReport?.title || ''} | ${lastReport?.pageUrl || res.tabUrl || ''}`;
    $('status').textContent = (lastReport?.narrative || []).join(' ') || 'OK';
    render();
    return res;
  } catch (e) {
    $('status').textContent = String(e);
    return null;
  }
}

function render() {
  [...tabBar.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b.dataset.tab === activeTab));
  const r = lastReport;
  const body = $('body');
  if (!r) {
    body.innerHTML = '<div class="empty">No data yet. Open a tab, hard-refresh, then Refresh here.</div>';
    return;
  }
  const c = r.counts || {};

  if (activeTab === 'traces') {
    const traces = r.traces || [];
    body.innerHTML = `
      <div class="card">
        <h3>SOURCE → SINK traces (${traces.length}) · mapped ${c.tracedWithSink || 0}</h3>
        <p class="empty">Each value shows where it entered (SOURCE) and where it was consumed (SINK).</p>
        ${traces.length ? traces.map((t) => `
          <div class="row ${t.hasSink ? 'PAIR' : 'SOURCE'}">
            <div class="val">${esc(t.value)}</div>
            <div>
              <span class="badge">${esc(t.originType)}</span>
              <span class="badge">${t.hasSink ? 'mapped' : 'source only'}</span>
              <span class="badge">hits ${t.hitCount}</span>
            </div>
            <div class="chain">${esc(t.chain || '(no path yet)')}</div>
            ${(t.pairs || []).slice(0, 12).map((p) => `
              <div class="pair-line">
                <span class="from-chip">${esc(p.from)}</span>
                <span class="arrow">→</span>
                <span class="to-chip">${esc(p.to)}</span>
                ${p.via?.length ? `<span class="badge">via ${esc(p.via.join(', '))}</span>` : ''}
                <span class="badge">×${p.hits}</span>
              </div>
              <div><code>from: ${esc(p.fromDetail)}</code></div>
              <div><code>to: ${esc(p.toDetail)}</code></div>
            `).join('') || '<div class="empty">Seen as source; waiting for sink hit…</div>'}
            <div style="margin-top:8px;color:var(--muted)">Sources</div>
            ${(t.sources || []).map((s) => `<div class="row SOURCE"><span class="badge">SOURCE</span><b>${esc(s.channel)}</b> ×${s.count}<div><code>${esc(s.detail)}</code></div></div>`).join('')}
            <div style="margin-top:8px;color:var(--muted)">Sinks</div>
            ${(t.sinks || []).map((s) => `<div class="row SINK"><span class="badge">SINK</span><b>${esc(s.channel)}</b> ×${s.count}<div><code>${esc(s.detail)}</code></div></div>`).join('') || '<div class="empty">—</div>'}
          </div>
        `).join('') : '<div class="empty">Auto-harvesting… interact with the page or wait for tokens.</div>'}
      </div>`;
  } else if (activeTab === 'overview') {
    body.innerHTML = `
      <div class="card"><h3>Counters</h3>
        <div class="grid">
          ${Object.entries(c).map(([k, v]) => `<div class="stat"><em>${v ?? 0}</em>${esc(k)}</div>`).join('')}
        </div>
      </div>
      <div class="card"><h3>How to read traces</h3>
        <code>Green = SOURCE (where value appeared)
Blue = SINK (where value was used)
Yellow = TRANSIT (seen in URL / in-flight)
Purple pairs = explicit SOURCE → SINK for the same value</code>
      </div>`;
  } else if (activeTab === 'flows') {
    const flows = r.flows || [];
    body.innerHTML = `<div class="card"><h3>Host flows (${flows.length})</h3>
      ${flows.map((f) => `
        <div class="row TRANSIT"><b>${esc(f.from)}</b> → <b>${esc(f.to)}</b>
          <span class="badge">${esc(f.category)}</span> ×${f.count}
          ${(f.samples || []).slice(0, 4).map((s) => `<div><code>${esc(s.method)} ${esc(s.status || '')} ${esc(s.url)}</code></div>`).join('')}
        </div>`).join('') || '<div class="empty">—</div>'}
    </div>`;
  } else if (activeTab === 'network') {
    body.innerHTML = `<div class="card"><h3>Network</h3>
      ${(r.network || []).slice().reverse().slice(0, 80).map((n) => `
        <div class="row ${n.phase === 'request' ? 'SINK' : 'SOURCE'}">
          <span class="badge">${esc(n.phase)}</span><span class="badge">${esc(n.category)}</span>
          <div><code>${esc(n.method)} ${esc(n.status || '')} ${esc(n.url)}</code></div>
          ${n.requestBody ? `<div><code>req: ${esc(String(n.requestBody).slice(0, 400))}</code></div>` : ''}
          ${n.responseBody ? `<div><code>res: ${esc(String(n.responseBody).slice(0, 400))}</code></div>` : ''}
        </div>`).join('') || '<div class="empty">—</div>'}
    </div>`;
  } else if (activeTab === 'sources') {
    body.innerHTML = `<div class="card"><h3>Auto sources</h3>
      ${(r.autoSources || []).slice().reverse().slice(0, 100).map((s) => `
        <div class="row SOURCE"><span class="badge">${esc(s.originType)}</span>
          <div class="val">${esc(String(s.value || '').slice(0, 220))}</div>
          <code>${esc(typeof s.detail === 'string' ? s.detail : JSON.stringify(s.detail))}</code>
        </div>`).join('') || '<div class="empty">—</div>'}
    </div>`;
  } else if (activeTab === 'sinks') {
    body.innerHTML = `<div class="card"><h3>Sinks</h3>
      ${(r.sinks || []).slice().reverse().slice(0, 100).map((s) => `
        <div class="row SINK"><span class="badge">${esc(s.sinkType)}</span>
          <code>${esc(String(s.payload || '').slice(0, 400))}</code>
        </div>`).join('') || '<div class="empty">—</div>'}
    </div>`;
  } else if (activeTab === 'storage') {
    body.innerHTML = `<div class="card"><h3>Storage events</h3>
      ${(r.storage || []).slice().reverse().slice(0, 80).map((s) => `
        <div class="row ${s.phase === 'set' ? 'SINK' : 'SOURCE'}">
          <span class="badge">${esc(s.phase)}</span><span class="badge">${esc(s.store)}</span>
          <div class="val">${esc(s.key)}</div>
          <code>${esc(String(s.value || '').slice(0, 300))}</code>
        </div>`).join('') || '<div class="empty">—</div>'}
      </div>
      <div class="card"><h3>BOM storage snapshot</h3>
        <code>${esc(JSON.stringify({ local: r.bom?.localStorage, session: r.bom?.sessionStorage }, null, 2))}</code>
      </div>`;
  } else if (activeTab === 'messages') {
    body.innerHTML = `<div class="card"><h3>postMessage</h3>
      ${(r.postMessages || []).slice().reverse().slice(0, 60).map((m) => `
        <div class="row SOURCE"><span class="badge">${esc(m.origin || '')}</span>
          <code>${esc(String(m.data || '').slice(0, 400))}</code></div>`).join('') || '<div class="empty">—</div>'}
      </div>
      <div class="card"><h3>WebSocket</h3>
      ${(r.websockets || []).slice().reverse().slice(0, 60).map((m) => `
        <div class="row"><code>${esc(m.direction || m.phase)} ${esc(String(m.data || m.url || '').slice(0, 300))}</code></div>`).join('') || '<div class="empty">—</div>'}
      </div>`;
  } else if (activeTab === 'dom') {
    if (!r.dom) {
      body.innerHTML = '<div class="empty">Loading full DOM inventory…</div>';
      load(true);
      return;
    }
    const d = r.dom;
    body.innerHTML = `
      <div class="card"><h3>Counts</h3><code>${esc(JSON.stringify(d.counts, null, 2))}</code></div>
      <div class="card"><h3>Top tags</h3><code>${esc(JSON.stringify(d.topTags, null, 2))}</code></div>
      <div class="card"><h3>Root / framework</h3>
        <code>${esc(JSON.stringify({ root: d.root, frameworkHints: d.frameworkHints, landmarks: d.landmarks }, null, 2))}</code></div>
      <div class="card"><h3>Head</h3><code>${esc(JSON.stringify(d.head, null, 2))}</code></div>
      <div class="card"><h3>Forms (${(d.forms || []).length})</h3><code>${esc(JSON.stringify(d.forms, null, 2))}</code></div>
      <div class="card"><h3>Iframes (${(d.iframes || []).length})</h3><code>${esc(JSON.stringify(d.iframes, null, 2))}</code></div>
      <div class="card"><h3>Scripts (${(d.scripts || []).length})</h3><code>${esc(JSON.stringify(d.scripts, null, 2))}</code></div>
      <div class="card"><h3>Styles</h3><code>${esc(JSON.stringify(d.styles, null, 2))}</code></div>
      <div class="card"><h3>Inputs (${(d.inputs || []).length})</h3><code>${esc(JSON.stringify(d.inputs, null, 2))}</code></div>
      <div class="card"><h3>Links</h3><code>${esc(JSON.stringify(d.links, null, 2))}</code></div>
      <div class="card"><h3>Media</h3><code>${esc(JSON.stringify(d.media, null, 2))}</code></div>
      <div class="card"><h3>data-* / framework attrs</h3><code>${esc(JSON.stringify(d.dataAttrsSample, null, 2))}</code></div>
      <div class="card"><h3>Dangerous sinks in DOM</h3><code>${esc(JSON.stringify(d.dangerous, null, 2))}</code></div>`;
  } else if (activeTab === 'bom') {
    if (!r.bom) {
      body.innerHTML = '<div class="empty">Loading full BOM…</div>';
      load(true);
      return;
    }
    const b = r.bom;
    const resourceList = b.performance?.recentResources || [];
    const nav = b.navigator || {};
    body.innerHTML = `
      <div class="card"><h3>BOM model refs</h3><code>${esc(JSON.stringify(b.model, null, 2))}</code></div>
      <div class="card"><h3>navigator summary (${nav.propertyCount || 0} props · ${nav.methodCount || 0} methods)</h3>
        <code>${esc(JSON.stringify({
          userAgent: nav.userAgent,
          platform: nav.platform,
          language: nav.language,
          languages: nav.languages,
          onLine: nav.onLine,
          cookieEnabled: nav.cookieEnabled,
          hardwareConcurrency: nav.hardwareConcurrency,
          deviceMemory: nav.deviceMemory,
          maxTouchPoints: nav.maxTouchPoints,
          webdriver: nav.webdriver,
          pdfViewerEnabled: nav.pdfViewerEnabled,
          vendor: nav.vendor,
          appName: nav.appName,
          appVersion: nav.appVersion,
          product: nav.product,
          userAgentData: nav.userAgentData,
          connection: nav.connection,
          userActivation: nav.userActivation,
          battery: nav.battery,
          mediaDevices: nav.mediaDevices,
          storageManager: nav.storageManager,
          apiObjects: nav.apiObjects,
          methodsAvailable: nav.methodsAvailable,
          plugins: nav.plugins,
          mimeTypes: nav.mimeTypes,
        }, null, 2))}</code></div>
      <div class="card"><h3>navigator.rawDump (ALL properties from prototype chain)</h3>
        <code>${esc(JSON.stringify(nav.rawDump, null, 2))}</code></div>
      <div class="card"><h3>capturedAt / runtime</h3>
        <code>${esc(JSON.stringify({ capturedAt: b.capturedAt, runtime: b.runtime }, null, 2))}</code></div>
      <div class="card"><h3>location</h3><code>${esc(JSON.stringify(b.location, null, 2))}</code></div>
      <div class="card"><h3>document (+ cookies / cookieStore)</h3><code>${esc(JSON.stringify(b.document, null, 2))}</code></div>
      <div class="card"><h3>screen / visualViewport / window</h3>
        <code>${esc(JSON.stringify({ screen: b.screen, visualViewport: b.visualViewport, window: b.window }, null, 2))}</code></div>
      <div class="card"><h3>frames (${(b.frames || []).length})</h3><code>${esc(JSON.stringify(b.frames, null, 2))}</code></div>
      <div class="card"><h3>history</h3><code>${esc(JSON.stringify(b.history, null, 2))}</code></div>
      <div class="card"><h3>performance summary</h3>
        <code>${esc(JSON.stringify({
          timeOrigin: b.performance?.timeOrigin,
          now: b.performance?.now,
          memory: b.performance?.memory,
          navigation: b.performance?.navigation,
          paints: b.performance?.paints,
          marks: b.performance?.marks,
          measures: b.performance?.measures,
          resourceCount: b.performance?.resourceCount,
          resourcesByInitiator: b.performance?.resourcesByInitiator,
        }, null, 2))}</code></div>
      <div class="card"><h3>resources (${resourceList.length})</h3>
        ${resourceList.slice().reverse().slice(0, 150).map((x) => `
          <div class="row"><code>${esc(x.initiatorType)} ${esc(x.duration)}ms ${esc(x.transferSize)}B ${esc(x.nextHopProtocol || '')} ${esc(x.name)}</code></div>
        `).join('') || '<div class="empty">—</div>'}
      </div>
      <div class="card"><h3>timezone / matchMedia</h3>
        <code>${esc(JSON.stringify({ timezone: b.timezone, matchMedia: b.matchMedia }, null, 2))}</code></div>
      <div class="card"><h3>storage (local / session / IDB / caches)</h3>
        <code>${esc(JSON.stringify(b.storage || { localStorage: b.localStorage, sessionStorage: b.sessionStorage }, null, 2))}</code></div>
      <div class="card"><h3>serviceWorkers</h3><code>${esc(JSON.stringify(b.serviceWorkers, null, 2))}</code></div>
      <div class="card"><h3>permissions</h3><code>${esc(JSON.stringify(b.permissions, null, 2))}</code></div>
      <div class="card"><h3>API presence</h3><code>${esc(JSON.stringify(b.apis, null, 2))}</code></div>`;
  }
}

$('btnRefresh').onclick = () => load(true);
$('btnClear').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'PFA_CLEAR_ACTIVE' });
  await load(false);
};
$('btnExport').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'PFA_EXPORT_ACTIVE' });
  // also download from panel using last report
  if (lastReport) {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ at: new Date().toISOString(), report: lastReport }, null, 2)], { type: 'application/json' }));
    await chrome.downloads.download({ url, filename: `pfa-sidepanel-${Date.now()}.json`, saveAs: true });
  }
};
$('btnPick').onclick = async () => {
  const res = await chrome.runtime.sendMessage({ type: 'PFA_PICK_ACTIVE' });
  $('btnPick').classList.toggle('on', !!res?.pickMode);
  $('status').textContent = res?.pickMode ? 'Pick mode ON — click a value on the page.' : 'Pick mode off.';
};

load(true);
setInterval(() => load(true), 4000);
