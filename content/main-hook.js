(() => {
  if (window.__PFA_HOOKED__) return;
  window.__PFA_HOOKED__ = true;

  /**
   * Lightweight auto SOURCE→SINK hooks.
   * Critical: emit MUST use native postMessage (never the hooked wrapper),
   * otherwise the page deadlocks in infinite recursion.
   */
  const SOURCE = 'pfa-main-hook';
  const ISOLATED_SRC = 'pfa-isolated';
  const MAX_BODY = 48 * 1024;
  const nativePostMessage = Function.prototype.call.bind(window.postMessage);
  let seq = 0;
  let watchValues = [];
  const seenAuto = new Set();
  let emitBudget = 0;
  const EMIT_BUDGET_PER_SEC = 400;
  setInterval(() => { emitBudget = 0; }, 1000);

  function soft(v, n = MAX_BODY) {
    if (v == null) return v;
    let s;
    if (typeof v === 'string') s = v;
    else {
      try { s = JSON.stringify(v); } catch { s = String(v); }
    }
    if (typeof s !== 'string') s = String(s);
    return s.length <= n ? s : s.slice(0, n) + `…[truncated ${s.length}]`;
  }

  function emit(payload) {
    if (emitBudget++ > EMIT_BUDGET_PER_SEC) return;
    try {
      nativePostMessage(window, { source: SOURCE, seq: ++seq, t: Date.now(), ...payload }, '*');
    } catch {}
  }

  function hostOf(u) {
    try { return new URL(u, location.href).host; } catch { return ''; }
  }

  function classify(u) {
    const s = String(u || '');
    if (/oauth|auth|token|login|mutotp/i.test(s)) return 'auth';
    if (/analytics|sentry|clarity|webengage|gtm|facebook|hotjar/i.test(s)) return 'telemetry';
    if (/\.(js|css|woff2?|png|jpg|jpeg|gif|svg|ico|webp|map)(\?|$)/i.test(s)) return 'static';
    if (/api|graphql|rpc/i.test(s)) return 'api';
    return 'other';
  }

  function interestingValues(text) {
    const out = [];
    const s = String(text || '').slice(0, 20000);
    if (!s) return out;
    try {
      for (const m of s.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) out.push(m[0]);
      for (const m of s.matchAll(/\b[A-Z]{2}\.[A-Za-z0-9_-]{6,}:[A-Za-z0-9_-]{16,}\b/g)) out.push(m[0]);
      for (const m of s.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi)) out.push(m[0]);
      for (const m of s.matchAll(/\b(?:accessToken|refreshToken|token|authorization)=([A-Za-z0-9._~+/-]{16,})/gi)) out.push(m[1]);
    } catch {}
    try {
      const u = new URL(s, location.href);
      u.searchParams.forEach((v, k) => {
        if (!v || v.length < 6 || v.length > 800) return;
        if (/token|id|code|key|auth|ref|session|jwt/i.test(k)) out.push(v);
      });
    } catch {}
    return [...new Set(out)].slice(0, 20);
  }

  function autoSource(values, originType, detail) {
    for (const v of values) {
      if (!v || v.length < 6 || v.length > 2000) continue;
      // skip noisy short opaque blobs from 32+ catch-all (removed)
      const key = originType + '|' + v.slice(0, 96);
      if (seenAuto.has(key)) continue;
      if (seenAuto.size > 500) seenAuto.clear();
      seenAuto.add(key);
      emit({
        kind: 'auto-source',
        value: v.slice(0, 4000),
        valueLen: v.length,
        originType,
        detail: soft(detail, 300),
        pageUrl: location.href,
      });
      if (!watchValues.includes(v)) watchValues.push(v);
    }
    if (watchValues.length > 40) watchValues = watchValues.slice(-40);
  }

  function scanWatches(haystack, channel, detail, roleHint) {
    if (!watchValues.length || haystack == null) return;
    const text = typeof haystack === 'string' ? haystack.slice(0, 20000) : soft(haystack, 20000);
    for (const val of watchValues) {
      if (!val || val.length < 6) continue;
      if (text.includes(val)) {
        emit({
          kind: 'watch-hit',
          value: val.slice(0, 4000),
          valueLen: val.length,
          channel,
          role: roleHint || undefined,
          detail: soft(detail, 400),
          pageUrl: location.href,
          frame: window === window.top ? 'top' : 'iframe',
        });
      }
    }
  }

  function emitSink(sinkType, payload, detail, opts = {}) {
    // Dom sinks: sample only (avoid freezing Angular/React renders)
    if (opts.sample && Math.random() > 0.05) {
      scanWatches(payload, `sink.${sinkType}`, detail, 'sink');
      return;
    }
    emit({
      kind: 'sink',
      sinkType,
      payload: soft(payload, opts.maxPayload || 4000),
      detail: soft(detail, 300),
      pageUrl: location.href,
    });
    scanWatches(payload, `sink.${sinkType}`, detail, 'sink');
    if (!opts.skipAuto) autoSource(interestingValues(payload), `sink-echo:${sinkType}`, detail);
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.source !== ISOLATED_SRC) return;
    if (d.cmd === 'setWatches' && Array.isArray(d.values)) {
      watchValues = [...new Set([...(d.values || []), ...watchValues])]
        .filter((v) => typeof v === 'string' && v.length >= 6)
        .slice(-40);
    }
  });

  function harvestPageSources() {
    autoSource(interestingValues(location.href), 'source.location.href', location.href);
    autoSource(interestingValues(location.search), 'source.location.search', location.search);
    autoSource(interestingValues(location.hash), 'source.location.hash', location.hash);
    autoSource(interestingValues(document.referrer), 'source.document.referrer', document.referrer);
    try { autoSource(interestingValues(document.cookie), 'source.document.cookie', 'cookie'); } catch {}
    try { if (window.name) autoSource(interestingValues(window.name), 'source.window.name', window.name); } catch {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k);
        autoSource(interestingValues(v), 'source.localStorage', k);
        if (/token|auth|jwt|session|refresh/i.test(k || '') && v && v.length >= 6) {
          autoSource([v], 'source.localStorage.key', k);
        }
        emit({
          kind: 'storage', phase: 'read-snapshot', store: 'localStorage', key: k,
          value: /token|auth|secret|password|refresh/i.test(k || '') ? `[redacted len=${(v || '').length}]` : soft(v, 2000),
          pageUrl: location.href,
        });
      }
    } catch {}
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        const v = sessionStorage.getItem(k);
        autoSource(interestingValues(v), 'source.sessionStorage', k);
      }
    } catch {}
  }

  // ---- fetch (async body read; skip static assets) ----
  const rawFetch = window.fetch.bind(window);
  window.fetch = async function (input, init = {}) {
    const started = Date.now();
    const url = typeof input === 'string' ? input : input?.url || String(input);
    const method = (init.method || input?.method || 'GET').toUpperCase();
    const cat = classify(url);
    let reqBody = init.body;
    if (reqBody && typeof reqBody !== 'string') {
      try { reqBody = soft(reqBody, 8000); } catch { reqBody = '[unreadable]'; }
    }
    const id = `fetch-${++seq}-${started}`;
    const reqBodyStr = soft(reqBody, 8000);
    emit({
      kind: 'network', phase: 'request', id, api: 'fetch', method, url,
      host: hostOf(url), category: cat, requestBody: reqBodyStr,
      pageUrl: location.href, frame: window === window.top ? 'top' : 'iframe',
    });
    if (cat !== 'static') {
      emitSink('network.request', `${method} ${url}\n${reqBodyStr || ''}`, { method, url }, { skipAuto: true });
      scanWatches(url, 'network.request.url', { method, url }, 'transit');
      scanWatches(reqBodyStr, 'network.request.body', { method, url }, 'sink');
    }

    const res = await rawFetch(input, init);
    if (cat === 'static' || cat === 'telemetry') {
      emit({
        kind: 'network', phase: 'response', id, api: 'fetch', method, url,
        host: hostOf(url), category: cat, status: res.status, ok: res.ok,
        durationMs: Date.now() - started, responseBody: '[skipped]',
        pageUrl: location.href, frame: window === window.top ? 'top' : 'iframe',
      });
      return res;
    }

    // Non-blocking body capture
    try {
      const clone = res.clone();
      const ct = (clone.headers.get('content-type') || '').toLowerCase();
      if (/json|text|xml|javascript|csv/.test(ct)) {
        clone.text().then((text) => {
          const responseBody = soft(text, MAX_BODY);
          emit({
            kind: 'network', phase: 'response', id, api: 'fetch', method, url,
            host: hostOf(url), category: cat, status: res.status, ok: res.ok,
            durationMs: Date.now() - started, responseBody,
            pageUrl: location.href, frame: window === window.top ? 'top' : 'iframe',
          });
          autoSource(interestingValues(responseBody), 'source.network.response', { method, url, status: res.status });
          scanWatches(responseBody, 'network.response.body', { method, url, status: res.status }, 'source');
        }).catch(() => {});
      } else {
        emit({
          kind: 'network', phase: 'response', id, api: 'fetch', method, url,
          host: hostOf(url), category: cat, status: res.status, ok: res.ok,
          durationMs: Date.now() - started, responseBody: `[binary ${ct || 'unknown'}]`,
          pageUrl: location.href, frame: window === window.top ? 'top' : 'iframe',
        });
      }
    } catch {}
    return res;
  };

  // ---- XHR ----
  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__pfa = { method: String(method || 'GET').toUpperCase(), url: String(url) };
    return XO.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const meta = this.__pfa || { method: 'GET', url: '' };
    meta.started = Date.now();
    const id = `xhr-${++seq}-${meta.started}`;
    const cat = classify(meta.url);
    const reqBodyStr = soft(body, 8000);
    emit({
      kind: 'network', phase: 'request', id, api: 'xhr', method: meta.method, url: meta.url,
      host: hostOf(meta.url), category: cat, requestBody: reqBodyStr,
      pageUrl: location.href, frame: window === window.top ? 'top' : 'iframe',
    });
    if (cat !== 'static') {
      emitSink('network.request', `${meta.method} ${meta.url}\n${reqBodyStr || ''}`, meta, { skipAuto: true });
    }
    this.addEventListener('loadend', () => {
      if (cat === 'static' || cat === 'telemetry') {
        emit({
          kind: 'network', phase: 'response', id, api: 'xhr',
          method: meta.method, url: meta.url, host: hostOf(meta.url), category: cat,
          status: this.status, ok: this.status >= 200 && this.status < 400,
          durationMs: Date.now() - meta.started, responseBody: '[skipped]',
          pageUrl: location.href, frame: window === window.top ? 'top' : 'iframe',
        });
        return;
      }
      const responseBody = soft(this.responseText, MAX_BODY);
      emit({
        kind: 'network', phase: this.status ? 'response' : 'error', id, api: 'xhr',
        method: meta.method, url: meta.url, host: hostOf(meta.url), category: cat,
        status: this.status, ok: this.status >= 200 && this.status < 400,
        durationMs: Date.now() - meta.started, responseBody,
        pageUrl: location.href, frame: window === window.top ? 'top' : 'iframe',
      });
      autoSource(interestingValues(responseBody), 'source.network.response', { url: meta.url, status: this.status });
      scanWatches(responseBody, 'network.response.body', { url: meta.url, status: this.status }, 'source');
    });
    return XS.call(this, body);
  };

  // ---- Storage (set only for sinks; get is sampled to avoid SPA thrash) ----
  function hookStorage(storage, name) {
    const rawSet = storage.setItem.bind(storage);
    const rawGet = storage.getItem.bind(storage);
    let getCount = 0;
    storage.setItem = function (key, value) {
      emit({ kind: 'storage', phase: 'set', store: name, key: String(key), value: soft(value, 3000), pageUrl: location.href });
      emitSink(`storage.${name}.set`, value, { key: String(key) });
      return rawSet(key, value);
    };
    storage.getItem = function (key) {
      const value = rawGet(key);
      // sample 1/20 gets; always note sensitive keys once via autoSource
      if (value != null && (++getCount % 20 === 0 || /token|auth|jwt|refresh|session/i.test(String(key)))) {
        emit({ kind: 'storage', phase: 'get', store: name, key: String(key), value: soft(value, 2000), pageUrl: location.href });
        autoSource(interestingValues(value), `source.${name}.get`, { key: String(key) });
      }
      return value;
    };
  }
  try { hookStorage(localStorage, 'localStorage'); } catch {}
  try { hookStorage(sessionStorage, 'sessionStorage'); } catch {}

  // ---- DOM sinks: SAMPLE only (full hook freezes Angular) ----
  function hookPropSampled(proto, prop, sinkType) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || !desc.set) return;
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set(v) {
        try {
          const s = typeof v === 'string' ? v : String(v);
          // only log if looks interesting or watch hit likely
          const interesting = /script|javascript:|onerror|token|eyJ|<iframe/i.test(s) || s.length < 200;
          if (interesting) emitSink(sinkType, s, { prop }, { sample: s.length > 500, maxPayload: 1500, skipAuto: true });
          else scanWatches(s, `sink.${sinkType}`, { prop }, 'sink');
        } catch {}
        return desc.set.call(this, v);
      },
    });
  }
  hookPropSampled(Element.prototype, 'innerHTML', 'dom.innerHTML');
  hookPropSampled(Element.prototype, 'outerHTML', 'dom.outerHTML');

  const rawWrite = document.write.bind(document);
  document.write = function (...args) {
    emitSink('dom.document.write', args.join(''), {});
    return rawWrite(...args);
  };

  // Do NOT replace window.eval — breaks many bundles / CSP / source maps.

  const rawSA = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    const n = String(name);
    if (/^(href|src|action|formaction|xlink:href)$/i.test(n) || /^on/i.test(n)) {
      emitSink(`dom.setAttribute.${n}`, value, { tag: this.tagName }, { sample: true, skipAuto: true, maxPayload: 800 });
    }
    return rawSA.call(this, name, value);
  };

  // ---- location sinks ----
  try {
    const loc = window.location;
    ['assign', 'replace'].forEach((fn) => {
      const raw = loc[fn].bind(loc);
      loc[fn] = function (url) {
        emitSink(`location.${fn}`, url, {});
        return raw(url);
      };
    });
  } catch {}

  // ---- WebSocket ----
  const RawWS = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    const ws = protocols !== undefined ? new RawWS(url, protocols) : new RawWS(url);
    const id = `ws-${Date.now()}`;
    emit({ kind: 'websocket', phase: 'open-attempt', id, url: String(url), host: hostOf(url), pageUrl: location.href });
    ws.addEventListener('message', (e) => {
      const data = soft(typeof e.data === 'string' ? e.data : '[binary]', 12000);
      emit({ kind: 'websocket', phase: 'message', id, url: String(url), direction: 'in', data });
      autoSource(interestingValues(data), 'source.websocket.in', { url: String(url) });
      scanWatches(data, 'websocket.in', { url: String(url) }, 'source');
    });
    const rawSend = ws.send.bind(ws);
    ws.send = function (data) {
      const payload = soft(typeof data === 'string' ? data : '[binary]', 12000);
      emit({ kind: 'websocket', phase: 'message', id, url: String(url), direction: 'out', data: payload });
      emitSink('websocket.out', payload, { url: String(url) }, { skipAuto: true });
      return rawSend(data);
    };
    return ws;
  };
  window.WebSocket.prototype = RawWS.prototype;
  Object.assign(window.WebSocket, RawWS);

  // ---- postMessage (use native for our own emits; never recurse) ----
  window.postMessage = function (message, targetOrigin, transfer) {
    try {
      if (!(message && typeof message === 'object' && (message.source === SOURCE || message.source === ISOLATED_SRC))) {
        emitSink('postMessage.out', message, { targetOrigin }, { maxPayload: 4000 });
      }
    } catch {}
    return nativePostMessage(window, message, targetOrigin, transfer);
  };

  window.addEventListener('message', (e) => {
    if (e.data?.source === SOURCE || e.data?.source === ISOLATED_SRC) return;
    const data = soft(e.data, 12000);
    emit({ kind: 'postMessage', phase: 'received', origin: e.origin, dataType: typeof e.data, data, pageUrl: location.href });
    autoSource(interestingValues(data), 'source.postMessage', { origin: e.origin });
    scanWatches(data, 'postMessage.in', { origin: e.origin }, 'source');
  }, true);

  // ---- inputs ----
  function bindInputs(root) {
    root.querySelectorAll?.('input,textarea,select')?.forEach((el) => {
      if (el.__pfaBound) return;
      el.__pfaBound = true;
      let last = el.value;
      const fire = (reason) => {
        const v = el.value;
        if (v === last) return;
        last = v;
        emit({
          kind: 'input', phase: reason, tag: el.tagName, name: el.name || null, id: el.id || null,
          type: el.type || null, value: soft(v, 4000), pageUrl: location.href,
        });
        if (v && v.length >= 4) autoSource([v, ...interestingValues(v)], 'source.input', { name: el.name, id: el.id, reason });
      };
      ['change', 'blur'].forEach((ev) => el.addEventListener(ev, () => fire(ev), true));
    });
  }
  let bindScheduled = false;
  function scheduleBind() {
    if (bindScheduled) return;
    bindScheduled = true;
    setTimeout(() => { bindScheduled = false; bindInputs(document); }, 500);
  }
  if (document.documentElement) {
    bindInputs(document);
    new MutationObserver(scheduleBind).observe(document.documentElement, { childList: true, subtree: true });
  }

  // harvest after page settles (don't block first paint)
  setTimeout(harvestPageSources, 800);
  setTimeout(harvestPageSources, 3000);

  emit({ kind: 'lifecycle', phase: 'hook-ready', pageUrl: location.href, model: 'auto-source-sink-v3.1-safe' });
})();
