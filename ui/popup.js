const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

async function loadReport() {
  const res = await chrome.runtime.sendMessage({ type: 'PFA_TAB_SUMMARY' });
  if (!res?.ok) {
    $('status').className = 'card warn';
    $('status').textContent = (res?.error || 'Error') + (res?.hint ? ' — ' + res.hint : '');
    return null;
  }
  const r = res.report;
  $('pageMeta').textContent = `${r?.title || ''} | ${r?.pageUrl || res.tabUrl || ''}`;
  $('status').className = 'card ok';
  $('status').textContent = (r?.narrative || []).join(' ');
  const c = r?.counts || {};
  $('counts').innerHTML = Object.entries({
    network: c.network, sources: c.autoSources, sinks: c.sinks,
    watches: c.watches, hits: c.watchHits, DOM: c.mutations,
  }).map(([k, v]) => `<div class="stat"><b>${v ?? 0}</b>${k}</div>`).join('');

  $('watches').innerHTML = (r?.watches || []).slice(0, 10).map((w) => `
    <div class="row"><code>${esc((w.value || '').slice(0, 100))}</code>
      ${(w.paths || []).slice(0, 6).map((p) => `<div><span class="badge">${esc(p.role)}</span>${esc(p.channel)} ×${p.count}</div>`).join('')}
    </div>`).join('') || '<div class="row">Harvesting automatically…</div>';

  $('flows').innerHTML = (r?.flows || []).slice(0, 12).map((f) =>
    `<div class="row">${esc(f.from)} → <b>${esc(f.to)}</b> <span class="badge">${f.count}</span></div>`
  ).join('') || '<div class="row">—</div>';
  return res;
}

$('btnPanel').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { await chrome.tabs.sendMessage(tab.id, { type: 'PFA_SHOW_PANEL' }); }
  catch { $('status').className = 'card warn'; $('status').textContent = 'Content script missing — hard refresh the page.'; }
};
$('btnClear').onclick = async () => { await chrome.runtime.sendMessage({ type: 'PFA_CLEAR_ACTIVE' }); loadReport(); };
$('btnExport').onclick = async () => {
  const res = await loadReport();
  if (!res?.ok) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify({ at: new Date().toISOString(), ...res }, null, 2)], { type: 'application/json' }));
  await chrome.downloads.download({ url, filename: `pfa-${Date.now()}.json`, saveAs: true });
};
loadReport();
setInterval(loadReport, 1000);
