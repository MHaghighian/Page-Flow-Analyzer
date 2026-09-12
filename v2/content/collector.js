// Flowscope — content collector (ISOLATED world, document_start).
// Slice 3: buffers network exchanges emitted by the MAIN-world hook and hands
// them to the side panel on request. Also answers the health-check ping.

(() => {
  if (window.__FLOWSCOPE__) return;
  window.__FLOWSCOPE__ = true;

  const MAX_EXCHANGES = 400;
  const MAX_MESSAGES = 400;
  const MAX_SINKS = 400;
  const MAX_TRACES = 400;
  const MAX_FINDINGS = 400;
  const MAX_EFFECTS = 400;
  const order = []; // exchange ids, oldest first
  const byId = new Map(); // id -> exchange
  const msgs = []; // message records, oldest first
  const sinks = []; // sink records, oldest first
  const traces = []; // source->sink traces, oldest first
  const findings = []; // canary-confirmed findings, oldest first
  const effects = []; // API-response-into-DOM effects, oldest first

  function trim() {
    while (order.length > MAX_EXCHANGES) {
      const old = order.shift();
      byId.delete(old);
    }
  }

  // Receive records from the MAIN-world hook (same window, cross-world bridge).
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;

    if (d && d.__fsmsg === true) {
      const { __fsmsg, ...rec } = d;
      msgs.push(rec);
      if (msgs.length > MAX_MESSAGES) msgs.shift();
      return;
    }

    if (d && d.__fssink === true) {
      const { __fssink, ...rec } = d;
      sinks.push(rec);
      if (sinks.length > MAX_SINKS) sinks.shift();
      return;
    }

    if (d && d.__fstrace === true) {
      const { __fstrace, ...rec } = d;
      traces.push(rec);
      if (traces.length > MAX_TRACES) traces.shift();
      return;
    }

    if (d && d.__fsfinding === true) {
      const { __fsfinding, ...rec } = d;
      findings.push(rec);
      if (findings.length > MAX_FINDINGS) findings.shift();
      return;
    }

    if (d && d.__fseffect === true) {
      const { __fseffect, ...rec } = d;
      effects.push(rec);
      if (effects.length > MAX_EFFECTS) effects.shift();
      return;
    }

    if (d && (d.__fshunt === true || d.__fshl === true)) return; // our own signals to MAIN

    if (!d || d.__fsnet !== true) return;

    if (d.phase === 'request') {
      byId.set(d.id, {
        id: d.id, api: d.api, method: d.method, url: d.url, host: d.host,
        category: d.category, reqBody: d.reqBody, reqHeaders: d.reqHeaders,
        startedAt: d.startedAt,
        status: null, ok: null, contentType: null, resHeaders: null, resBody: null,
        resBytes: null, durationMs: null, error: null, pending: true,
      });
      order.push(d.id);
      trim();
    } else if (d.phase === 'response') {
      const ex = byId.get(d.id);
      if (ex) {
        ex.status = d.status;
        ex.ok = d.ok;
        ex.contentType = d.contentType || null;
        ex.resHeaders = d.resHeaders || null;
        ex.resBody = d.resBody ?? null;
        ex.resBytes = d.resBytes ?? null;
        ex.durationMs = d.durationMs ?? null;
        ex.error = d.error || null;
        ex.pending = false;
      }
    }
  });

  function snapshot(limit = 300) {
    const ids = order.slice(-limit);
    const out = [];
    for (let i = ids.length - 1; i >= 0; i--) {
      const ex = byId.get(ids[i]);
      if (ex) out.push(ex);
    }
    return out; // newest first
  }

  function messageSnapshot(limit = 300) {
    return msgs.slice(-limit).reverse(); // newest first
  }

  function sinkSnapshot(limit = 300) {
    return sinks.slice(-limit).reverse(); // newest first
  }

  function traceSnapshot(limit = 300) {
    return traces.slice(-limit).reverse(); // newest first
  }

  function findingSnapshot(limit = 300) {
    return findings.slice(-limit).reverse(); // newest first
  }

  function effectSnapshot(limit = 300) {
    return effects.slice(-limit).reverse(); // newest first
  }

  function highlight(sel) {
    try {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const prev = el.style.outline;
      const prevOff = el.style.outlineOffset;
      el.style.outline = '3px solid #5b9dff';
      el.style.outlineOffset = '2px';
      setTimeout(() => { el.style.outline = prev; el.style.outlineOffset = prevOff; }, 2200);
      return true;
    } catch { return false; }
  }

  function cssPathMini(el) {
    try {
      const parts = [];
      let cur = el;
      while (cur && cur.nodeType === 1 && parts.length < 5) {
        let p = cur.nodeName.toLowerCase();
        if (cur.id) { parts.unshift(p + '#' + cur.id); break; }
        parts.unshift(p);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    } catch { return ''; }
  }

  function domInventory() {
    const q = (s) => document.querySelectorAll(s);
    const scripts = [...q('script')];
    const ext = scripts.filter((s) => s.src).slice(0, 80).map((s) => s.src);
    const forms = [...q('form')].slice(0, 40).map((f) => ({
      action: f.getAttribute('action') || '',
      method: (f.getAttribute('method') || 'get').toUpperCase(),
      inputs: [...f.querySelectorAll('input,select,textarea')].slice(0, 30).map((i) => ({
        name: i.getAttribute('name') || i.id || '', type: i.getAttribute('type') || i.tagName.toLowerCase(),
      })),
    }));
    const iframes = [...q('iframe')].slice(0, 40).map((f) => ({
      src: f.getAttribute('src') || '', sandbox: f.getAttribute('sandbox') || undefined,
    }));
    const links = [...q('a[href]')].slice(0, 80).map((a) => a.getAttribute('href'));
    const handlers = [];
    const all = q('*');
    for (let i = 0; i < all.length && handlers.length < 80; i++) {
      const el = all[i];
      for (const at of el.attributes) {
        if (/^on/i.test(at.name)) {
          handlers.push({ tag: el.tagName.toLowerCase(), attr: at.name, css: cssPathMini(el), snippet: String(at.value).slice(0, 160) });
          break;
        }
      }
    }
    const meta = {};
    [...q('meta')].slice(0, 60).forEach((m) => {
      const k = m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv');
      if (k) meta[k] = String(m.getAttribute('content') || '').slice(0, 220);
    });
    const blob = ext.join(' ');
    const fw = [];
    if (q('[data-reactroot],#__next,#root').length || /react/i.test(blob)) fw.push('react');
    if (q('[ng-version],[ng-app],[data-ng-app]').length || /angular/i.test(blob)) fw.push('angular');
    if (q('[data-v-app]').length || /vue(\.|\/|@)/i.test(blob)) fw.push('vue');
    if (/jquery/i.test(blob)) fw.push('jquery');
    if (q('#__next').length || q('#__nuxt').length) fw.push('next/nuxt');
    return {
      url: location.href, title: document.title,
      counts: {
        elements: all.length, scripts: scripts.length, externalScripts: ext.length,
        iframes: iframes.length, forms: forms.length,
        inputs: q('input,select,textarea').length, links: q('a[href]').length,
        images: q('img').length, styles: q('link[rel="stylesheet"],style').length,
      },
      forms, externalScripts: ext, iframes, links, inlineHandlers: handlers, meta,
      frameworks: [...new Set(fw)],
    };
  }

  function bomInventory() {
    const nav = navigator;
    const dump = (store) => {
      const o = {};
      try { for (let i = 0; i < store.length; i++) { const k = store.key(i); o[k] = String(store.getItem(k) || '').slice(0, 500); } } catch {}
      return o;
    };
    const has = (fn) => { try { return !!fn(); } catch { return false; } };
    return {
      location: { href: location.href, origin: location.origin, protocol: location.protocol, host: location.host, pathname: location.pathname, search: location.search, hash: location.hash },
      navigator: {
        userAgent: nav.userAgent, platform: nav.platform, language: nav.language, languages: nav.languages,
        hardwareConcurrency: nav.hardwareConcurrency, deviceMemory: nav.deviceMemory,
        cookieEnabled: nav.cookieEnabled, doNotTrack: nav.doNotTrack, webdriver: nav.webdriver, maxTouchPoints: nav.maxTouchPoints,
      },
      screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight, colorDepth: screen.colorDepth },
      window: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      cookies: String(document.cookie || ''),
      localStorage: dump(localStorage),
      sessionStorage: dump(sessionStorage),
      features: {
        serviceWorker: !!nav.serviceWorker,
        webgl: has(() => document.createElement('canvas').getContext('webgl')),
        cryptoSubtle: !!(window.crypto && window.crypto.subtle),
        indexedDB: !!window.indexedDB,
        webRTC: !!window.RTCPeerConnection,
      },
    };
  }

  // Tell the MAIN-world hook whether Hunt is on. localStorage persists the flag so
  // MAIN can read it synchronously at document_start on the next load (poison early).
  function tellHunt(enabled) {
    try {
      if (enabled) localStorage.setItem('__FS_HUNT__', '1');
      else localStorage.removeItem('__FS_HUNT__');
    } catch {}
    try { window.postMessage({ __fshunt: true, enabled: !!enabled }, '*'); } catch {}
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'FS_PING') {
      sendResponse({ ok: true, url: location.href, title: document.title });
      return;
    }
    if (msg?.type === 'FS_GET_NETWORK') {
      sendResponse({ ok: true, exchanges: snapshot(msg.limit || 300) });
      return;
    }
    if (msg?.type === 'FS_GET_MESSAGES') {
      sendResponse({ ok: true, messages: messageSnapshot(msg.limit || 300) });
      return;
    }
    if (msg?.type === 'FS_GET_SINKS') {
      sendResponse({ ok: true, sinks: sinkSnapshot(msg.limit || 300) });
      return;
    }
    if (msg?.type === 'FS_GET_TRACES') {
      sendResponse({ ok: true, traces: traceSnapshot(msg.limit || 300) });
      return;
    }
    if (msg?.type === 'FS_GET_FINDINGS') {
      sendResponse({ ok: true, findings: findingSnapshot(msg.limit || 300) });
      return;
    }
    if (msg?.type === 'FS_GET_EFFECTS') {
      sendResponse({ ok: true, effects: effectSnapshot(msg.limit || 300) });
      return;
    }
    if (msg?.type === 'FS_GET_INVENTORY') {
      sendResponse({ ok: true, dom: domInventory(), bom: bomInventory() });
      return;
    }
    if (msg?.type === 'FS_HIGHLIGHT') {
      if (msg.ref) {
        // MAIN holds the live node (survives class/attr rewrites); ask it to highlight.
        try { window.postMessage({ __fshl: true, ref: msg.ref }, '*'); } catch {}
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: highlight(msg.cssPath) });
      }
      return;
    }
    if (msg?.type === 'FS_SET_HUNT') {
      tellHunt(msg.enabled);
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'FS_CLEAR') {
      const what = msg.what || 'all';
      if (what === 'network' || what === 'all') { order.length = 0; byId.clear(); }
      if (what === 'messages' || what === 'all') { msgs.length = 0; }
      if (what === 'sinks' || what === 'all') { sinks.length = 0; }
      if (what === 'traces' || what === 'all') { traces.length = 0; }
      if (what === 'findings' || what === 'all') { findings.length = 0; }
      if (what === 'effects' || what === 'all') { effects.length = 0; }
      sendResponse({ ok: true });
      return;
    }
  });

  // On load, sync the persisted flag to the current chrome.storage state.
  try {
    chrome.storage.local.get({ huntEnabled: false }, (r) => {
      void chrome.runtime.lastError;
      tellHunt(!!(r && r.huntEnabled));
    });
  } catch {}
})();
