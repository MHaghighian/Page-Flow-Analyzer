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
  const nativePostMessage = window.postMessage.bind(window);
  let seq = 0;
  let watchValues = [];
  const seenAuto = new Set();
  let emitBudget = 0;
  let collectEnabled = true;
  let huntEnabled = false;
  let huntApplied = false;
  const canaries = new Map();
  const canariesBySource = new Map();
  const locDesc = {
    href: Object.getOwnPropertyDescriptor(Location.prototype, 'href'),
    hash: Object.getOwnPropertyDescriptor(Location.prototype, 'hash'),
    search: Object.getOwnPropertyDescriptor(Location.prototype, 'search'),
    pathname: Object.getOwnPropertyDescriptor(Location.prototype, 'pathname'),
  };
  const rawReplaceState = (() => {
    try { return History.prototype.replaceState.bind(history); } catch { return null; }
  })();

  function nativeLocation(prop, fallback) {
    const desc = locDesc[prop];
    try {
      if (desc && desc.get) return desc.get.call(window.location);
    } catch {}
    try { return fallback(); } catch { return ''; }
  }
  const CAT = globalThis.__DH_CATALOG__ || {
    attackClassFor: () => 'other',
    rankFor: () => 90,
    severityFor: () => 'low',
    sourceCount: 0,
    sinkCount: 0,
  };
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
    if (!collectEnabled) return;
    const keep = payload?.kind === 'finding' || payload?.kind === 'sink' || payload?.kind === 'lifecycle';
    if (!keep && emitBudget++ > EMIT_BUDGET_PER_SEC) return;
    const msg = { source: SOURCE, seq: ++seq, t: Date.now(), ...payload };
    try { nativePostMessage(msg, '*'); } catch {}
    if (window !== window.top) {
      try { window.top.postMessage(msg, '*'); } catch {}
    }
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

  function hay(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch { return String(v); }
  }

  function cssPathLite(el) {
    try {
      if (!el || el.nodeType !== 1) return '';
      const parts = [];
      let cur = el;
      while (cur && cur.nodeType === 1 && parts.length < 6) {
        let p = cur.nodeName.toLowerCase();
        if (cur.id) { parts.unshift(p + '#' + cur.id); break; }
        parts.unshift(p);
        cur = cur.parentElement;
      }
      return parts.join('>');
    } catch { return ''; }
  }

  function makeCanary(sourceId) {
    if (canariesBySource.has(sourceId)) return canariesBySource.get(sourceId);
    const slug = String(sourceId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 18);
    let tok = null;
    try {
      const href = String(nativeLocation('href', () => location.href) || '');
      const m = href.match(new RegExp(`DhCnRy${slug}[0-9a-f]{0,12}`, 'i'));
      if (m) tok = m[0];
    } catch {}
    if (!tok) tok = 'DhCnRy' + slug + Math.random().toString(16).slice(2, 8);
    canaries.set(tok, sourceId);
    canariesBySource.set(sourceId, tok);
    return tok;
  }

  function sourceIdFromToken(tok) {
    if (canaries.has(tok)) return canaries.get(tok);
    const rest = String(tok).slice(6).replace(/[0-9a-f]{4,8}$/i, '');
    const aliases = {
      locationhash: 'location.hash',
      locationhref: 'location.href',
      locationsearch: 'location.search',
      locationpathname: 'location.pathname',
      windowname: 'window.name',
      documentcookie: 'document.cookie',
    };
    const id = aliases[rest.toLowerCase()] || rest || 'unknown';
    canaries.set(tok, id);
    if (!canariesBySource.has(id)) canariesBySource.set(id, tok);
    return id;
  }

  function contextAround(text, needle) {
    const i = text.indexOf(needle);
    if (i < 0) return { kind: 'unknown', snippet: text.slice(0, 180) };
    const before = text.slice(Math.max(0, i - 16), i);
    const after = text.slice(i + needle.length, i + needle.length + 16);
    let kind = 'text';
    if (/javascript:/i.test(before) || /^javascript:/i.test(text.trim())) kind = 'javascript-url';
    else if (/=\s*["']$/.test(before) || /["']$/.test(before)) kind = 'quoted-attr';
    else if (/<[^>]*$/.test(before)) kind = 'html-attr';
    else if (text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) kind = 'json';
    else if (/[`'"']$/.test(before)) kind = 'js-string';
    return { kind, snippet: (before + needle + after).slice(0, 220) };
  }

  function stackTrim() {
    try { return String(new Error().stack || '').split('\n').slice(3, 12).join('\n'); }
    catch { return ''; }
  }

  function scanCanary(sink, payload, provenance = {}, el = null) {
    let text;
    if (typeof payload === 'string') text = payload;
    else if (payload == null) return;
    else {
      try { text = JSON.stringify(payload); } catch { text = String(payload); }
    }
    if (!text || text.length < 8 || !text.includes('DhCnRy')) return;
    if (text.length > 80000) text = text.slice(0, 80000);
    const found = text.match(/DhCnRy[a-zA-Z0-9]+/g) || [];
    const seenTok = new Set();
    for (const tok of found) {
      if (seenTok.has(tok)) continue;
      seenTok.add(tok);
      const sourceId = sourceIdFromToken(tok);
      const enc = encodeURIComponent(tok);
      const rawHit = text.includes(tok);
      const encHit = text.includes(enc);
      const encoded = !rawHit && encHit;
      const ctx = contextAround(text, rawHit ? tok : enc);
      let sinkId = sink;
      if (/href|src|action/i.test(sinkId) && /^javascript:/i.test(text.trim())) sinkId = 'javascriptURL';
      const transforms = [];
      if (encoded) transforms.push('url-encoded');
      else transforms.push('raw');
      if (/%[0-9A-Fa-f]{2}/.test(text) && rawHit) transforms.push('decodeURIComponent?');
      if (ctx.kind === 'json') transforms.push('JSON.parse');
      emit({
        kind: 'finding',
        source: sourceId,
        sink: sinkId,
        canary: tok,
        encoded,
        transforms,
        context: ctx.kind,
        snippet: ctx.snippet,
        rank: CAT.rankFor(sinkId),
        attackClass: CAT.attackClassFor(sinkId),
        severity: CAT.severityFor(CAT.rankFor(sinkId), encoded),
        stack: stackTrim(),
        cssPath: el ? cssPathLite(el) : (provenance.cssPath || ''),
        provenance,
        payload: text.slice(0, 1500),
        pageUrl: location.href,
        t: Date.now(),
      });
    }
  }

  function extractApiStrings(text) {
    const out = [];
    const s = String(text || '').slice(0, 24000);
    const walk = (v, depth) => {
      if (depth > 6 || out.length > 40 || v == null) return;
      if (typeof v === 'string') {
        if (v.length >= 8 && v.length <= 400 && !/^(true|false|null)$/i.test(v)) out.push(v);
        return;
      }
      if (typeof v === 'number' && String(v).length >= 8) out.push(String(v));
      if (Array.isArray(v)) { v.slice(0, 40).forEach((x) => walk(x, depth + 1)); return; }
      if (typeof v === 'object') Object.values(v).slice(0, 50).forEach((x) => walk(x, depth + 1));
    };
    try { walk(JSON.parse(s), 0); } catch {
      for (const m of s.matchAll(/["']([^"']{8,220})["']/g)) {
        if (out.length > 40) break;
        out.push(m[1]);
      }
    }
    return [...new Set(out)].slice(0, 40);
  }

  function hasCanary(payload) {
    if (payload == null) return false;
    if (typeof payload === 'string') return payload.includes('DhCnRy');
    try { return JSON.stringify(payload).includes('DhCnRy'); } catch { return false; }
  }

  function emitSink(sinkType, payload, detail, opts = {}) {
    scanCanary(opts.sinkId || sinkType, payload, { detail, ...(opts.provenance || {}) }, opts.el || null);
    const canary = hasCanary(payload);
    const noisyDom = /^(dom\.innerHTML|dom\.outerHTML|dom\.setAttribute)/.test(String(sinkType));
    const long = String(payload ?? '').length > 400;
    if (!canary && noisyDom && long && Math.random() > 0.08) {
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
    if (d.cmd === 'setEnabled') {
      collectEnabled = !!d.enabled;
      emit({
        kind: 'lifecycle', phase: 'hook-ready', pageUrl: location.href,
        model: 'dom-hacker-v4', sourceCount: CAT.sourceCount, sinkCount: CAT.sinkCount,
        huntEnabled, huntApplied,
      });
      return;
    }
    if (d.cmd === 'setXssHunt') {
      huntEnabled = !!d.enabled;
      if (huntEnabled) {
        stampHashCanary();
        const later = () => { try { applyHunt(); } catch {} };
        if (typeof requestIdleCallback === 'function') requestIdleCallback(later, { timeout: 250 });
        else setTimeout(later, 0);
      }
      emit({ kind: 'lifecycle', phase: 'hunt', huntEnabled, huntApplied, pageUrl: location.href });
      return;
    }
    if (d.cmd === 'setWatches' && Array.isArray(d.values)) {
      watchValues = [...new Set([...(d.values || []), ...watchValues])]
        .filter((v) => typeof v === 'string' && v.length >= 6)
        .slice(-40);
    }
  });

  function harvestPageSources() {
    if (!collectEnabled) return;
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
      emitSink('network.request', `${method} ${url}\n${reqBodyStr || ''}`, { method, url }, { skipAuto: true, sinkId: 'fetch' });
      scanCanary('fetch', url, { url, method });
      scanCanary('fetch.body', reqBodyStr, { url, method });
      if (init.headers) scanCanary('fetch.headers', hay(init.headers), { url, method });
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
            extractedStrings: extractApiStrings(text),
            pageUrl: location.href, frame: window === window.top ? 'top' : 'iframe',
          });
          autoSource(interestingValues(responseBody), 'source.network.response', { method, url, status: res.status });
          scanWatches(responseBody, 'network.response.body', { method, url, status: res.status }, 'source');
          scanCanary('fetch.body', responseBody, { url, method });
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
    scanCanary('xhr.open', url, { url: String(url), method: String(method || 'GET') });
    return XO.call(this, method, url, ...rest);
  };
  try {
    const XH = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      scanCanary('xhr.setRequestHeader', `${name}: ${value}`, { name: String(name) });
      scanCanary('xhr.setRequestHeader.name', name);
      scanCanary('xhr.setRequestHeader.value', value);
      return XH.call(this, name, value);
    };
  } catch {}
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
        extractedStrings: extractApiStrings(this.responseText),
        pageUrl: location.href, frame: window === window.top ? 'top' : 'iframe',
      });
      autoSource(interestingValues(responseBody), 'source.network.response', { url: meta.url, status: this.status });
      scanWatches(responseBody, 'network.response.body', { url: meta.url, status: this.status }, 'source');
      scanCanary('xhr.send', responseBody, { url: meta.url });
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
      emitSink(`storage.${name}.set`, value, { key: String(key) }, { sinkId: name + '.setItem' });
      return rawSet(key, value);
    };
    storage.getItem = function (key) {
      const value = rawGet(key);
      // sample 1/20 gets; always note sensitive keys once via autoSource
      if (value != null && (++getCount % 20 === 0 || /token|auth|jwt|refresh|session/i.test(String(key)))) {
        emit({ kind: 'storage', phase: 'get', store: name, key: String(key), value: soft(value, 2000), pageUrl: location.href });
        autoSource(interestingValues(value), `source.${name}.get`, { key: String(key) });
      }
      if (huntEnabled && typeof value === 'string' && value.includes('DhCnRy')) {
        scanCanary(name, value, { key: String(key) });
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
          const tainted = s.includes('DhCnRy');
          const interesting = tainted || /script|javascript:|onerror|token|eyJ|<iframe|<b>|document\.write/i.test(s) || s.length < 800;
          if (interesting) emitSink(sinkType, s, { prop }, { skipAuto: true, maxPayload: 1500, el: this, sinkId: sinkType === 'dom.innerHTML' ? 'element.innerHTML' : 'element.outerHTML' });
          else {
            scanWatches(s, `sink.${sinkType}`, { prop }, 'sink');
            scanCanary(sinkType === 'dom.innerHTML' ? 'element.innerHTML' : 'element.outerHTML', s, {}, this);
          }
        } catch {}
        return desc.set.call(this, v);
      },
    });
  }
  hookPropSampled(Element.prototype, 'innerHTML', 'dom.innerHTML');
  hookPropSampled(Element.prototype, 'outerHTML', 'dom.outerHTML');

  const rawWrite = document.write.bind(document);
  document.write = function (...args) {
    emitSink('dom.document.write', args.join(''), {}, { sinkId: 'document.write', skipAuto: false });
    return rawWrite(...args);
  };
  try {
    const rawWriteln = document.writeln.bind(document);
    document.writeln = function (...args) {
      emitSink('dom.document.writeln', args.join(''), {}, { sinkId: 'document.writeln' });
      return rawWriteln(...args);
    };
  } catch {}

  const rawSA = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    const n = String(name);
    if (/^(href|src|action|formaction|xlink:href|srcdoc|data)$/i.test(n) || /^on/i.test(n)) {
      const sinkId = /^on/i.test(n) ? `element.setAttribute.${n.toLowerCase()}` : `element.setAttribute.${n.toLowerCase()}`;
      emitSink(`dom.setAttribute.${n}`, value, { tag: this.tagName }, {
        sample: !huntEnabled, skipAuto: true, maxPayload: 800, el: this, sinkId,
      });
    }
    return rawSA.call(this, name, value);
  };

  try {
    const loc = window.location;
    ['assign', 'replace'].forEach((fn) => {
      const raw = loc[fn].bind(loc);
      loc[fn] = function (url) {
        emitSink(`location.${fn}`, url, {}, { sinkId: `location.${fn}` });
        return raw(url);
      };
    });
  } catch {}

  const RawWS = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    const ws = protocols !== undefined ? new RawWS(url, protocols) : new RawWS(url);
    const id = `ws-${++seq}-${Date.now()}`;
    scanCanary('websocket', url, { url: String(url) });
    emitSink('websocket', url, { url: String(url) }, { skipAuto: true, sinkId: 'websocket', provenance: { url: String(url) } });
    emit({
      kind: 'websocket', phase: 'open-attempt', id, url: String(url), protocols: protocols || null,
      host: hostOf(url), pageUrl: location.href,
    });
    ws.addEventListener('message', (e) => {
      const data = typeof e.data === 'string' ? e.data : '[binary]';
      emit({ kind: 'websocket', phase: 'message', id, url: String(url), direction: 'in', data: soft(data, 12000) });
      autoSource(interestingValues(data), 'source.websocket.in', { url: String(url) });
      scanWatches(data, 'websocket.in', { url: String(url) }, 'source');
    });
    const rawSend = ws.send.bind(ws);
    ws.send = function (data) {
      const payload = typeof data === 'string' ? data : '[binary]';
      emit({ kind: 'websocket', phase: 'message', id, url: String(url), direction: 'out', data: soft(payload, 12000) });
      emitSink('websocket.out', payload, { url: String(url) }, { skipAuto: true, sinkId: 'websocket.send' });
      return rawSend(data);
    };
    return ws;
  };
  window.WebSocket.prototype = RawWS.prototype;
  Object.assign(window.WebSocket, RawWS);

  window.postMessage = function (message, targetOrigin, transfer) {
    try {
      if (!(message && typeof message === 'object' && (message.source === SOURCE || message.source === ISOLATED_SRC))) {
        emitSink('postMessage.out', message, { targetOrigin }, { maxPayload: 4000, sinkId: 'postMessage.out', provenance: { targetOrigin } });
      }
    } catch {}
    const origin = typeof targetOrigin === 'string'
      ? targetOrigin
      : (targetOrigin && typeof targetOrigin === 'object' && !Array.isArray(targetOrigin) && typeof targetOrigin.targetOrigin === 'string')
        ? targetOrigin.targetOrigin
        : '*';
    const xfer = Array.isArray(targetOrigin)
      ? targetOrigin
      : (targetOrigin && typeof targetOrigin === 'object' && targetOrigin.transfer) || transfer;
    try {
      return xfer !== undefined ? nativePostMessage(message, origin, xfer) : nativePostMessage(message, origin);
    } catch {
      try { return nativePostMessage(message, '*'); } catch { return undefined; }
    }
  };

  window.addEventListener('message', (e) => {
    if (e.data?.source === SOURCE || e.data?.source === ISOLATED_SRC) return;
    const data = soft(e.data, 12000);
    emit({ kind: 'postMessage', phase: 'received', origin: e.origin, dataType: typeof e.data, data, pageUrl: location.href });
    autoSource(interestingValues(data), 'source.postMessage', { origin: e.origin });
    scanWatches(data, 'postMessage.in', { origin: e.origin }, 'source');
    scanCanary('postMessage', data, { origin: e.origin });
  }, true);

  function poisonGet(obj, prop, sourceId, sinkOnSet) {
    try {
      let desc = Object.getOwnPropertyDescriptor(obj, prop);
      let target = obj;
      if (!desc) {
        const proto = Object.getPrototypeOf(obj);
        desc = proto && Object.getOwnPropertyDescriptor(proto, prop);
        target = proto || obj;
      }
      if (!desc || !desc.get || desc.__dh) return;
      const canary = makeCanary(sourceId);
      const next = {
        configurable: true,
        enumerable: desc.enumerable,
        get() {
          const v = desc.get.call(this);
          if (!huntEnabled || v == null) return v;
          if (typeof v === 'string') return v.includes(canary) ? v : v + canary;
          return v;
        },
      };
      if (desc.set) {
        next.set = function (x) {
          if (sinkOnSet) scanCanary(sinkOnSet, x, {}, this && this.nodeType === 1 ? this : null);
          return desc.set.call(this, x);
        };
      }
      Object.defineProperty(target, prop, next);
    } catch {}
  }

  function poisonLocationProp(prop, sourceId, sinkOnSet) {
    poisonGet(Location.prototype, prop, sourceId, sinkOnSet);
    const desc = locDesc[prop];
    if (!desc || !desc.get) return;
    const canary = makeCanary(sourceId);
    try {
      const next = {
        configurable: true,
        enumerable: true,
        get() {
          const v = desc.get.call(this);
          if (!huntEnabled || v == null) return v;
          const s = String(v);
          return s.includes(canary) ? s : s + canary;
        },
      };
      if (desc.set) {
        next.set = function (x) {
          if (sinkOnSet) scanCanary(sinkOnSet, x);
          return desc.set.call(this, x);
        };
      }
      Object.defineProperty(window.location, prop, next);
    } catch {}
  }

  let hashCanaryBound = false;
  function stampHashCanary() {
    if (!huntEnabled) return;
    const hash = String(nativeLocation('hash', () => window.location.hash) || '');
    if (/DhCnRylocationhash/i.test(hash)) {
      makeCanary('location.hash');
      return;
    }
    const c = makeCanary('location.hash');
    const path = String(nativeLocation('pathname', () => window.location.pathname) || '/');
    const search = String(nativeLocation('search', () => window.location.search) || '');
    const nextHash = (hash || '#') + c;
    try {
      if (rawReplaceState) rawReplaceState(history.state, '', path + search + nextHash);
      else if (locDesc.hash && locDesc.hash.set) locDesc.hash.set.call(window.location, nextHash);
    } catch {
      try { window.location.hash = nextHash; } catch {}
    }
  }

  function rescanDomForCanaries() {
    try {
      const root = document.body;
      if (!root) return;
      const html = root.innerHTML;
      if (typeof html !== 'string' || !html.includes('DhCnRy')) return;
      const els = root.querySelectorAll('[id]');
      for (let i = 0; i < els.length && i < 80; i++) {
        const s = els[i].innerHTML;
        if (typeof s === 'string' && s.includes('DhCnRy') && s.length < 8000) {
          scanCanary('element.innerHTML', s, { how: 'rescan' }, els[i]);
          return;
        }
      }
      scanCanary('element.innerHTML', html.slice(0, 8000), { how: 'rescan' }, root);
    } catch {}
  }

  function wrapFn(obj, name, sinkId, pick) {
    try {
      const raw = obj[name];
      if (typeof raw !== 'function' || raw.__dh) return;
      const wrapped = function (...args) {
        try {
          const payload = pick ? pick(args, this) : args[0];
          if (payload != null) {
            scanCanary(sinkId, payload, {}, this && this.nodeType === 1 ? this : null);
            if (hasCanary(payload)) {
              emitSink(sinkId, payload, {}, { skipAuto: true, maxPayload: 1200, el: this && this.nodeType === 1 ? this : null, sinkId });
            }
          }
        } catch {}
        return raw.apply(this, args);
      };
      wrapped.__dh = true;
      obj[name] = wrapped;
    } catch {}
  }

  function wrapJQuery() {
    const $ = window.jQuery || window.$;
    if (!$ || !$.fn || $.fn.__dhHunt) return;
    $.fn.__dhHunt = true;
    ['html', 'append', 'appendTo', 'after', 'insertAfter', 'before', 'insertBefore', 'prepend', 'prependTo',
      'replaceWith', 'replaceAll', 'wrap', 'wrapAll', 'wrapInner', 'add', 'has', 'parseHTML'].forEach((m) => {
      if (typeof $.fn[m] === 'function') wrapFn($.fn, m, 'jQuery.' + m);
    });
    if (typeof $.fn.attr === 'function') {
      const rawAttr = $.fn.attr;
      $.fn.attr = function (name, value) {
        if (arguments.length >= 2) {
          const n = String(name || '').toLowerCase();
          if (/^(href|src|data|action|formaction)$/.test(n) || /^on/.test(n)) {
            scanCanary('jQuery.attr.' + n, value);
          }
        }
        return rawAttr.apply(this, arguments);
      };
    }
    if (typeof $.fn.prop === 'function') {
      const rawProp = $.fn.prop;
      $.fn.prop = function (name, value) {
        if (arguments.length >= 2 && /innerHTML|outerHTML/i.test(String(name))) {
          scanCanary('jQuery.prop.' + name, value);
        }
        return rawProp.apply(this, arguments);
      };
    }
    if (typeof $ === 'function') {
      const raw$ = $;
      const wrapped$ = function (...args) {
        try { scanCanary('jQuery.$', args[0]); } catch {}
        return raw$.apply(this, args);
      };
      Object.assign(wrapped$, raw$);
      wrapped$.fn = raw$.fn;
      try { window.jQuery = wrapped$; if (window.$ === raw$) window.$ = wrapped$; } catch {}
    }
  }

  function applyHunt() {
    if (huntApplied) {
      huntEnabled = true;
      stampHashCanary();
      rescanDomForCanaries();
      return;
    }
    huntApplied = true;
    huntEnabled = true;
    try { poisonLocationProp('hash', 'location.hash'); } catch {}
    try { poisonGet(window, 'name', 'window.name', 'window.name'); } catch {}

    try {
      const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
      if (cookieDesc && cookieDesc.set) {
        Object.defineProperty(Document.prototype, 'cookie', {
          configurable: true, enumerable: cookieDesc.enumerable,
          get: cookieDesc.get,
          set(v) { scanCanary('document.cookie', v); return cookieDesc.set.call(this, v); },
        });
      }
    } catch {}
    try {
      const d = Object.getOwnPropertyDescriptor(Document.prototype, 'domain');
      if (d && d.set) {
        Object.defineProperty(Document.prototype, 'domain', {
          configurable: true, enumerable: d.enumerable, get: d.get,
          set(v) { scanCanary('document.domain', v); return d.set.call(this, v); },
        });
      }
    } catch {}
    try {
      const rawText = Response.prototype.text;
      Response.prototype.text = async function () {
        const t = await rawText.call(this);
        if (huntEnabled && typeof t === 'string' && t.includes('DhCnRy')) scanCanary('fetch.body', t, { url: this.url });
        return t;
      };
      const rawJson = Response.prototype.json;
      Response.prototype.json = async function () {
        return rawJson.call(this);
      };
    } catch {}
    wrapFn(Element.prototype, 'insertAdjacentHTML', 'element.insertAdjacentHTML', (a) => a[1]);
    wrapFn(window, 'open', 'window.open');
    wrapFn(window, 'eval', 'eval');
    try { if (typeof window.execScript === 'function') wrapFn(window, 'execScript', 'execScript'); } catch {}
    try {
      const d = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'cssText');
      if (d && d.set) {
        Object.defineProperty(CSSStyleDeclaration.prototype, 'cssText', {
          configurable: true, enumerable: d.enumerable, get: d.get,
          set(v) { scanCanary('element.style.cssText', v); return d.set.call(this, v); },
        });
      }
    } catch {}
    try {
      const d = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'href');
      if (d && d.set) {
        Object.defineProperty(HTMLAnchorElement.prototype, 'href', {
          configurable: true, enumerable: d.enumerable, get: d.get,
          set(v) { scanCanary('anchor.href', v, {}, this); return d.set.call(this, v); },
        });
      }
    } catch {}
    try {
      const d = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'action');
      if (d && d.set) {
        Object.defineProperty(HTMLFormElement.prototype, 'action', {
          configurable: true, enumerable: d.enumerable, get: d.get,
          set(v) { scanCanary('form.action', v, {}, this); return d.set.call(this, v); },
        });
      }
    } catch {}
    ['HTMLInputElement', 'HTMLButtonElement'].forEach((name) => {
      try {
        const proto = window[name] && window[name].prototype;
        const d = proto && Object.getOwnPropertyDescriptor(proto, 'formAction');
        if (!d || !d.set) return;
        Object.defineProperty(proto, 'formAction', {
          configurable: true, enumerable: d.enumerable, get: d.get,
          set(v) { scanCanary(name === 'HTMLInputElement' ? 'input.formaction' : 'button.formaction', v, {}, this); return d.set.call(this, v); },
        });
      } catch {}
    });
    try {
      if (typeof window.openDatabase === 'function') {
        const raw = window.openDatabase;
        window.openDatabase = function (...args) {
          const db = raw.apply(this, args);
          try {
            const tx = db.transaction;
            db.transaction = function (fn, ...rest) {
              return tx.call(this, function (t) {
                try {
                  const rawExec = t.executeSql.bind(t);
                  t.executeSql = function (sql, ...a) {
                    scanCanary('webdatabase.executeSql', sql);
                    return rawExec(sql, ...a);
                  };
                } catch {}
                return fn(t);
              }, ...rest);
            };
          } catch {}
          return db;
        };
      }
    } catch {}
    try {
      if (typeof window.BroadcastChannel === 'function') {
        const RawBC = window.BroadcastChannel;
        window.BroadcastChannel = function (name) {
          const ch = new RawBC(name);
          ch.addEventListener('message', (e) => {
            autoSource(interestingValues(hay(e.data)), 'source.broadcastChannel', { name });
          });
          const rawPost = ch.postMessage.bind(ch);
          ch.postMessage = function (data) {
            scanCanary('postMessage.out', data, { channel: name });
            return rawPost(data);
          };
          return ch;
        };
        window.BroadcastChannel.prototype = RawBC.prototype;
      }
    } catch {}
    try {
      if (typeof window.EventSource === 'function') {
        const RawES = window.EventSource;
        window.EventSource = function (url, config) {
          scanCanary('EventSource', url, { url: String(url) });
          return config !== undefined ? new RawES(url, config) : new RawES(url);
        };
        window.EventSource.prototype = RawES.prototype;
        Object.assign(window.EventSource, RawES);
      }
    } catch {}
    try {
      const RawFn = window.Function;
      window.Function = function (...args) {
        scanCanary('Function', args.join('\n'));
        return RawFn.apply(this, args);
      };
      window.Function.prototype = RawFn.prototype;
    } catch {}
    ['setTimeout', 'setInterval', 'setImmediate', 'msSetImmediate'].forEach((name) => {
      const raw = window[name];
      if (typeof raw !== 'function') return;
      window[name] = function (h, t, ...rest) {
        if (typeof h === 'string') scanCanary(name, h);
        return raw.call(this, h, t, ...rest);
      };
    });
    try {
      const rawParse = JSON.parse;
      JSON.parse = function (t, r) {
        scanCanary('JSON.parse', t);
        return rawParse.call(this, t, r);
      };
    } catch {}
    try {
      const rawRE = window.RegExp;
      window.RegExp = function (p, f) {
        scanCanary('RegExp', p);
        return f === undefined ? new rawRE(p) : new rawRE(p, f);
      };
      window.RegExp.prototype = rawRE.prototype;
    } catch {}
    try {
      const rawEval = document.evaluate;
      if (rawEval) {
        document.evaluate = function (...args) {
          scanCanary('document.evaluate', args[0]);
          return rawEval.apply(this, args);
        };
      }
    } catch {}
    try {
      const rawPS = history.pushState.bind(history);
      history.pushState = function (st, t, u) {
        scanCanary('history.pushState', u || st);
        return rawPS(st, t, u);
      };
      const rawRS = history.replaceState.bind(history);
      history.replaceState = function (st, t, u) {
        scanCanary('history.replaceState', u || st);
        return rawRS(st, t, u);
      };
    } catch {}
    try {
      poisonGet(History.prototype, 'state', 'history.state');
    } catch {}
    try {
      const proto = HTMLIFrameElement.prototype;
      const d = Object.getOwnPropertyDescriptor(proto, 'srcdoc');
      if (d && d.set) {
        Object.defineProperty(proto, 'srcdoc', {
          configurable: true, enumerable: d.enumerable, get: d.get,
          set(v) { scanCanary('iframe.srcdoc', v, {}, this); return d.set.call(this, v); },
        });
      }
    } catch {}
    try {
      const proto = HTMLIFrameElement.prototype;
      const d = Object.getOwnPropertyDescriptor(proto, 'src');
      if (d && d.set) {
        Object.defineProperty(proto, 'src', {
          configurable: true, enumerable: d.enumerable, get: d.get,
          set(v) { scanCanary('iframe.src', v, {}, this); return d.set.call(this, v); },
        });
      }
    } catch {}
    try {
      const proto = HTMLScriptElement.prototype;
      ['src', 'text', 'textContent', 'innerText'].forEach((p) => {
        const d = Object.getOwnPropertyDescriptor(proto, p) || Object.getOwnPropertyDescriptor(Node.prototype, p) || Object.getOwnPropertyDescriptor(Element.prototype, p);
        if (!d || !d.set) return;
        Object.defineProperty(proto, p, {
          configurable: true, enumerable: d.enumerable, get: d.get,
          set(v) { scanCanary('script.' + p, v, {}, this); return d.set.call(this, v); },
        });
      });
    } catch {}
    try {
      if (Element.prototype.setHTMLUnsafe) wrapFn(Element.prototype, 'setHTMLUnsafe', 'setHTMLUnsafe');
      if (Element.prototype.setHTML) wrapFn(Element.prototype, 'setHTML', 'setHTML');
    } catch {}
    try {
      const rawParse = DOMParser.prototype.parseFromString;
      DOMParser.prototype.parseFromString = function (str, type) {
        scanCanary('DOMParser.parseFromString', str);
        return rawParse.call(this, str, type);
      };
    } catch {}
    try {
      const rawFrag = Range.prototype.createContextualFragment;
      Range.prototype.createContextualFragment = function (s) {
        scanCanary('createContextualFragment', s);
        return rawFrag.call(this, s);
      };
    } catch {}
    wrapJQuery();
    setTimeout(wrapJQuery, 2000);
    stampHashCanary();
    if (!hashCanaryBound) {
      hashCanaryBound = true;
      window.addEventListener('hashchange', stampHashCanary);
    }
    rescanDomForCanaries();
    setTimeout(rescanDomForCanaries, 400);
    emit({
      kind: 'lifecycle', phase: 'hunt-applied', huntEnabled: true,
      sourceCount: CAT.sourceCount, sinkCount: CAT.sinkCount, pageUrl: location.href,
    });
  }

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

  setTimeout(harvestPageSources, 800);
  setTimeout(harvestPageSources, 3000);

  try {
    const href = String(nativeLocation('href', () => location.href) || '');
    if (sessionStorage.getItem('__DH_HUNT__') === '1' || href.includes('DhCnRy')) {
      huntEnabled = true;
      applyHunt();
    }
  } catch {}
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { if (huntEnabled) rescanDomForCanaries(); });
  }

  emit({
    kind: 'lifecycle', phase: 'hook-ready', pageUrl: location.href,
    model: 'dom-hacker-v4', sourceCount: CAT.sourceCount, sinkCount: CAT.sinkCount,
  });
})();
