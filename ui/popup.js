const $ = (id) => document.getElementById(id);
let lastScope = null;

async function loadReport() {
  const res = await chrome.runtime.sendMessage({ type: 'PFA_TAB_SUMMARY' });
  lastScope = res?.scope || lastScope;
  $('btnHunt').classList.toggle('on', !!lastScope?.huntEnabled);
  $('scope').textContent = lastScope
    ? `Collect: ${lastScope.label}${lastScope.huntEnabled ? ' · Hunt on' : ''}`
    : 'Collect: —';
  if (!res?.ok) {
    $('status').className = 'card warn';
    $('status').textContent = (res?.error || 'Error') + (res?.hint ? ' — ' + res.hint : '');
    return null;
  }
  const r = res.report;
  const liveUrl = res.tabUrl || lastScope?.tabUrl || '';
  const liveTitle = lastScope?.tabTitle || '';
  if (!r) {
    $('pageMeta').textContent = [liveTitle, liveUrl].filter(Boolean).join(' | ') || lastScope?.label || '';
    $('status').className = 'card ok';
    $('status').textContent = 'Waiting for this page…';
    $('counts').innerHTML = Object.entries({ findings: 0, effects: 0, network: 0, traces: 0, sinks: 0 })
      .map(([k, v]) => `<div class="stat"><b>${v}</b>${k}</div>`).join('');
    return res;
  }
  $('pageMeta').textContent = [liveTitle || r.title, liveUrl || r.pageUrl].filter(Boolean).join(' | ');
  $('status').className = 'card ok';
  const cc = r?.classCounts || {};
  const classBits = Object.entries(cc).map(([k, v]) => `${v} ${k}`).join(' · ');
  const hunt = r?.hunt || {};
  const huntBit = lastScope?.huntEnabled && !hunt.applied ? 'hunt needs reload' : '';
  $('status').textContent = [classBits, huntBit].filter(Boolean).join(' · ')
    || ((r?.narrative || []).join(' '))
    || 'OK';
  const c = r?.counts || {};
  $('counts').innerHTML = Object.entries({
    findings: c.findings, effects: c.effects, network: c.exchanges || c.network,
    traces: c.tracedWithSink, sinks: c.sinks,
  }).map(([k, v]) => `<div class="stat"><b>${v ?? 0}</b>${k}</div>`).join('');
  return res;
}

$('btnPanel').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.windowId != null && chrome.sidePanel?.open) {
    try { await chrome.sidePanel.open({ windowId: tab.windowId }); return; } catch {}
  }
  try { await chrome.tabs.sendMessage(tab.id, { type: 'PFA_SHOW_PANEL' }); }
  catch { $('status').className = 'card warn'; $('status').textContent = 'Hard-refresh the page, then open the side panel.'; }
};
$('btnHunt').onclick = () => {
  const on = !lastScope?.huntEnabled;
  $('btnHunt').classList.toggle('on', on);
  if (lastScope) lastScope.huntEnabled = on;
  $('status').textContent = on ? 'Hunt on — hard-refresh so source getters wrap.' : 'Hunt off.';
  chrome.runtime.sendMessage({ type: 'PFA_SET_HUNT', enabled: on }).then((next) => {
    lastScope = next || lastScope;
    $('btnHunt').classList.toggle('on', !!lastScope?.huntEnabled);
  }).catch(() => {});
};
$('btnClear').onclick = async () => { await chrome.runtime.sendMessage({ type: 'PFA_CLEAR_ACTIVE' }); loadReport(); };
$('btnExport').onclick = async () => {
  const res = await loadReport();
  if (!res?.ok) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify({ at: new Date().toISOString(), ...res }, null, 2)], { type: 'application/json' }));
  await chrome.downloads.download({ url, filename: `dh-${Date.now()}.json`, saveAs: true });
};
loadReport();
setInterval(loadReport, 2000);
