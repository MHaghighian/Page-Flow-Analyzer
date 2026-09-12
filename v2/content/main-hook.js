// Flowscope — MAIN-world hooks (document_start).
// Slice 3: passive network capture only. Wraps fetch + XMLHttpRequest, reads a
// CLONE of each response, and posts a compact record to the ISOLATED collector
// via window.postMessage. It never blocks or alters the page's own requests.

(() => {
  if (window.__FS_HOOKED__) return;
  window.__FS_HOOKED__ = true;

  const MAX_BODY = 32 * 1024;
  const MAX_HEADERS = 30;
  const nativePost = window.postMessage.bind(window);
  let seq = 0;

  function post(rec) {
    try {
      nativePost({ __fsnet: true, ...rec }, '*');
    } catch {}
  }

  function hostOf(u) {
    try {
      return new URL(u, location.href).host;
    } catch {
      return '';
    }
  }

  function classify(u) {
    const s = String(u || '');
    if (/analytics|sentry|clarity|webengage|gtm|google-analytics|googletagmanager|facebook\.com|hotjar|doubleclick|segment\.io|amplitude|mixpanel/i.test(s)) return 'telemetry';
    if (/\.(js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|ico|webp|avif|mp4|webm|map)(\?|$)/i.test(s)) return 'static';
    if (/oauth|\/auth|token|login|signin|sso|saml/i.test(s)) return 'auth';
    if (/\/api\/|graphql|\/rpc\b|\/v\d+\//i.test(s)) return 'api';
    return 'other';
  }

  function cap(s) {
    if (typeof s !== 'string') return s;
    return s.length <= MAX_BODY ? s : s.slice(0, MAX_BODY) + `…[+${s.length - MAX_BODY} bytes]`;
  }

  function textual(ct) {
    const s = String(ct || '').toLowerCase();
    if (!s) return true; // unknown — attempt, it's cheap
    if (/event-stream|octet-stream|image\/|video\/|audio\/|font\/|application\/pdf|application\/zip/.test(s)) return false;
    return /json|text|xml|html|javascript|urlencoded|graphql|csv|x-www-form/.test(s);
  }

  function bodyToString(body) {
    if (body == null) return undefined;
    if (typeof body === 'string') return cap(body);
    try {
      if (body instanceof URLSearchParams) return cap(body.toString());
    } catch {}
    const tag = body?.constructor?.name || typeof body;
    return `[${tag}]`;
  }

  function headersToObj(h) {
    const o = {};
    try {
      let n = 0;
      h.forEach((v, k) => { if (n++ < MAX_HEADERS) o[k] = v; });
    } catch {}
    return Object.keys(o).length ? o : undefined;
  }

  function parseRawHeaders(raw) {
    if (!raw) return undefined;
    const o = {};
    let n = 0;
    for (const line of String(raw).trim().split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0 && n++ < MAX_HEADERS) o[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return Object.keys(o).length ? o : undefined;
  }

  function normalizeHeaders(h) {
    if (!h) return undefined;
    const o = {};
    try {
      if (typeof Headers !== 'undefined' && h instanceof Headers) h.forEach((v, k) => (o[k] = v));
      else if (Array.isArray(h)) for (const [k, v] of h) o[k] = v;
      else if (typeof h === 'object') for (const k in h) o[k] = h[k];
    } catch {}
    const keys = Object.keys(o);
    if (!keys.length) return undefined;
    if (keys.length > MAX_HEADERS) {
      const trimmed = {};
      for (const k of keys.slice(0, MAX_HEADERS)) trimmed[k] = o[k];
      return trimmed;
    }
    return o;
  }

  // ---- fetch ----
  const rawFetch = window.fetch;
  if (typeof rawFetch === 'function') {
    window.fetch = function (input, init) {
      let url, method, reqHeaders;
      try {
        url = typeof input === 'string' ? input : input?.url || String(input);
        method = String(init?.method || input?.method || 'GET').toUpperCase();
        reqHeaders = normalizeHeaders(init?.headers || (input && input.headers));
      } catch {
        return rawFetch.apply(this, arguments);
      }
      const id = 'f' + ++seq + '-' + Date.now();
      const startedAt = Date.now();
      const category = classify(url);
      post({
        phase: 'request', id, api: 'fetch', method, url, host: hostOf(url),
        category, reqBody: bodyToString(init?.body), reqHeaders, startedAt,
      });
      scanTrace(url + ' ' + (bodyToString(init?.body) || ''), { channel: 'network.request', sink: 'fetch ' + hostOf(url) });
      scanCanary(url + ' ' + (bodyToString(init?.body) || ''), { channel: 'network.request', sink: 'fetch ' + hostOf(url) });

      let p;
      try {
        p = rawFetch.apply(this, arguments);
      } catch (e) {
        post({ phase: 'response', id, status: 0, ok: false, error: String(e), durationMs: Date.now() - startedAt });
        throw e;
      }

      p.then((res) => {
        const durationMs = Date.now() - startedAt;
        const contentType = safeHeader(res, 'content-type');
        let resHeaders;
        try { resHeaders = headersToObj(res.headers); } catch {}
        const base = { phase: 'response', id, status: res.status, ok: res.ok, contentType, resHeaders, durationMs };
        if (category !== 'static' && textual(contentType)) {
          res.clone().text().then(
            (t) => { post({ ...base, resBody: cap(t), resBytes: t.length }); addWatchAll(extractInteresting(t), 'network.response ' + hostOf(url)); scanCanary(t, { channel: 'network.response', sink: 'response ' + hostOf(url) }); storeApiResponse(t, url, hostOf(url)); },
            () => post(base)
          );
        } else {
          post(base);
          if (category !== 'static') storeApiResponse('', url, hostOf(url));
        }
      }, (err) => {
        post({ phase: 'response', id, status: 0, ok: false, error: String(err), durationMs: Date.now() - startedAt });
      });

      return p;
    };
  }

  function safeHeader(res, name) {
    try { return res.headers.get(name) || ''; } catch { return ''; }
  }

  // ---- XMLHttpRequest ----
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const rawOpen = XHR.prototype.open;
    const rawSend = XHR.prototype.send;
    const rawSetHeader = XHR.prototype.setRequestHeader;

    XHR.prototype.open = function (method, url) {
      try {
        this.__fs = {
          id: 'x' + ++seq + '-' + Date.now(),
          method: String(method || 'GET').toUpperCase(),
          url: String(url),
          headers: {},
          startedAt: 0,
        };
      } catch {}
      return rawOpen.apply(this, arguments);
    };

    XHR.prototype.setRequestHeader = function (k, v) {
      try {
        if (this.__fs && Object.keys(this.__fs.headers).length < MAX_HEADERS) this.__fs.headers[k] = v;
      } catch {}
      return rawSetHeader.apply(this, arguments);
    };

    XHR.prototype.send = function (body) {
      const meta = this.__fs;
      if (meta) {
        meta.startedAt = Date.now();
        const category = classify(meta.url);
        post({
          phase: 'request', id: meta.id, api: 'xhr', method: meta.method, url: meta.url,
          host: hostOf(meta.url), category,
          reqBody: bodyToString(body),
          reqHeaders: Object.keys(meta.headers).length ? meta.headers : undefined,
          startedAt: meta.startedAt,
        });
        scanTrace(meta.url + ' ' + (bodyToString(body) || ''), { channel: 'network.request', sink: 'xhr ' + hostOf(meta.url) });
        scanCanary(meta.url + ' ' + (bodyToString(body) || ''), { channel: 'network.request', sink: 'xhr ' + hostOf(meta.url) });
        this.addEventListener('loadend', () => {
          try {
            const durationMs = Date.now() - meta.startedAt;
            const status = this.status;
            let contentType = '';
            try { contentType = this.getResponseHeader('content-type') || ''; } catch {}
            let resHeaders;
            try { resHeaders = parseRawHeaders(this.getAllResponseHeaders()); } catch {}
            const base = { phase: 'response', id: meta.id, status, ok: status >= 200 && status < 300, contentType, resHeaders, durationMs };
            let resBody;
            if (category !== 'static' && textual(contentType)) {
              try {
                const rt = this.responseType;
                if (rt === '' || rt === 'text') resBody = cap(this.responseText);
                else if (rt === 'json') resBody = cap(JSON.stringify(this.response));
              } catch {}
              if (resBody !== undefined) { addWatchAll(extractInteresting(resBody), 'network.response ' + hostOf(meta.url)); scanCanary(resBody, { channel: 'network.response', sink: 'response ' + hostOf(meta.url) }); storeApiResponse(resBody, meta.url, hostOf(meta.url)); }
              else if (category !== 'static') storeApiResponse('', meta.url, hostOf(meta.url));
            }
            post(resBody !== undefined ? { ...base, resBody, resBytes: resBody.length } : base);
          } catch {}
        });
      }
      return rawSend.apply(this, arguments);
    };
  }

  // ---- messages: postMessage + WebSocket ----
  function emitMsg(rec) {
    try {
      nativePost({ __fsmsg: true, id: 'm' + ++seq + '-' + Date.now(), t: Date.now(), ...rec }, '*');
    } catch {}
  }

  function hay(v) {
    if (v == null) return String(v);
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch { return String(v); }
  }

  function frameData(data) {
    if (typeof data === 'string') return { data: cap(data), size: data.length };
    const tag = data?.constructor?.name || typeof data;
    let size = 0;
    try { size = data?.size ?? data?.byteLength ?? 0; } catch {}
    return { data: `[${tag}${size ? ' ' + size + ' bytes' : ''}]`, size };
  }

  // Outgoing postMessage (page -> window/self). nativePost was captured up top,
  // so our own bridge frames never go through this wrapper.
  const rawPostMessage = window.postMessage;
  if (typeof rawPostMessage === 'function') {
    window.postMessage = function (message, targetOrigin) {
      try {
        if (!(message && (message.__fsnet || message.__fsmsg))) {
          emitMsg({ kind: 'pm', dir: 'out', target: String(targetOrigin ?? ''), data: cap(hay(message)) });
          scanTrace(hay(message), { channel: 'postMessage.out', sink: 'postMessage ' + String(targetOrigin ?? '*') });
          scanCanary(hay(message), { channel: 'postMessage.out', sink: 'postMessage ' + String(targetOrigin ?? '*') });
        }
      } catch {}
      return rawPostMessage.apply(this, arguments);
    };
  }

  // Incoming postMessage — ignore our own bridge frames.
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && (d.__fsnet || d.__fsmsg || d.__fssink || d.__fstrace || d.__fsfinding || d.__fseffect || d.__fshunt || d.__fshl)) return;
    try {
      const text = hay(d);
      emitMsg({ kind: 'pm', dir: 'in', origin: e.origin || '', data: cap(text) });
      addWatchAll(extractInteresting(text), 'postMessage.in ' + (e.origin || ''));
      scanCanary(text, { channel: 'postMessage.in', sink: 'postMessage.in' });
    } catch {}
  }, true);

  // WebSocket
  const RawWS = window.WebSocket;
  if (typeof RawWS === 'function') {
    const WSHook = function (url, protocols) {
      const ws = protocols !== undefined ? new RawWS(url, protocols) : new RawWS(url);
      const id = 'ws' + ++seq;
      const u = String(url);
      emitMsg({ kind: 'ws', sub: 'open', id, url: u, protocols: protocols ? String(protocols) : undefined });
      try {
        ws.addEventListener('message', (ev) => emitMsg({ kind: 'ws', sub: 'frame', id, url: u, dir: 'in', ...frameData(ev.data) }));
        ws.addEventListener('close', (ev) => emitMsg({ kind: 'ws', sub: 'close', id, url: u, code: ev.code, reason: ev.reason || '' }));
        ws.addEventListener('error', () => emitMsg({ kind: 'ws', sub: 'error', id, url: u }));
      } catch {}
      try {
        const rawSend = ws.send;
        ws.send = function (data) {
          try { emitMsg({ kind: 'ws', sub: 'frame', id, url: u, dir: 'out', ...frameData(data) }); } catch {}
          return rawSend.apply(ws, arguments);
        };
      } catch {}
      return ws;
    };
    WSHook.prototype = RawWS.prototype;
    try {
      WSHook.CONNECTING = RawWS.CONNECTING; WSHook.OPEN = RawWS.OPEN;
      WSHook.CLOSING = RawWS.CLOSING; WSHook.CLOSED = RawWS.CLOSED;
    } catch {}
    window.WebSocket = WSHook;
  }

  // ---- DOM sinks (passive log of dangerous assignments/calls) ----
  let sinkBudget = 0;
  setInterval(() => { sinkBudget = 0; }, 1000);

  function stackTrim() {
    try { return String(new Error().stack || '').split('\n').slice(3, 11).join('\n'); }
    catch { return ''; }
  }

  function cssPath(el) {
    try {
      if (!el || el.nodeType !== 1) return '';
      const parts = [];
      let cur = el;
      while (cur && cur.nodeType === 1 && parts.length < 6) {
        let p = cur.nodeName.toLowerCase();
        if (cur.id) { parts.unshift(p + '#' + cur.id); break; }
        if (cur.className && typeof cur.className === 'string') {
          const c = cur.className.trim().split(/\s+/).slice(0, 2).join('.');
          if (c) p += '.' + c;
        }
        parts.unshift(p);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    } catch { return ''; }
  }

  function emitSink(sink, value, extra) {
    if (sinkBudget++ > 300) return;
    let v;
    if (typeof value === 'string') v = value;
    else v = hay(value);
    try {
      nativePost({
        __fssink: true, id: 's' + ++seq + '-' + Date.now(), t: Date.now(),
        sink, value: cap(v), stack: stackTrim(), ...extra,
      }, '*');
    } catch {}
    scanTrace(v, { channel: 'sink', sink });
    scanCanary(v, { channel: 'sink', sink, cssPath: extra && extra.cssPath });
  }

  function tryHook(fn) { try { fn(); } catch {} }

  function hookSetter(proto, prop, sinkName) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set) return;
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: d.enumerable,
      get: d.get,
      set(v) {
        emitSink(sinkName, v, { cssPath: cssPath(this) });
        return d.set.call(this, v);
      },
    });
  }

  tryHook(() => hookSetter(Element.prototype, 'innerHTML', 'Element.innerHTML'));
  tryHook(() => hookSetter(Element.prototype, 'outerHTML', 'Element.outerHTML'));

  tryHook(() => {
    const raw = Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML = function (pos, html) {
      emitSink('Element.insertAdjacentHTML', html, { cssPath: cssPath(this) });
      return raw.apply(this, arguments);
    };
  });

  tryHook(() => {
    const raw = document.write;
    document.write = function () {
      emitSink('document.write', Array.prototype.join.call(arguments, ''));
      return raw.apply(this, arguments);
    };
    const rawLn = document.writeln;
    document.writeln = function () {
      emitSink('document.writeln', Array.prototype.join.call(arguments, ''));
      return rawLn.apply(this, arguments);
    };
  });

  tryHook(() => {
    const raw = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      const n = String(name || '').toLowerCase();
      if (/^on/.test(n) || n === 'href' || n === 'src' || n === 'srcdoc' || n === 'action' || n === 'formaction' || n === 'data') {
        emitSink('setAttribute(' + n + ')', value, { cssPath: cssPath(this), attr: n });
      }
      return raw.apply(this, arguments);
    };
  });

  tryHook(() => {
    const raw = Location.prototype.assign;
    Location.prototype.assign = function (u) { emitSink('location.assign', u); return raw.call(this, u); };
  });
  tryHook(() => {
    const raw = Location.prototype.replace;
    Location.prototype.replace = function (u) { emitSink('location.replace', u); return raw.call(this, u); };
  });
  tryHook(() => hookSetter(Location.prototype, 'href', 'location.href'));

  tryHook(() => {
    const raw = window.open;
    window.open = function (u) { if (u != null) emitSink('window.open', u); return raw.apply(this, arguments); };
  });

  tryHook(() => {
    const raw = window.setTimeout;
    window.setTimeout = function (fn) { if (typeof fn === 'string') emitSink('setTimeout(string)', fn); return raw.apply(this, arguments); };
  });
  tryHook(() => {
    const raw = window.setInterval;
    window.setInterval = function (fn) { if (typeof fn === 'string') emitSink('setInterval(string)', fn); return raw.apply(this, arguments); };
  });

  // ---- source -> sink traces (passive string-match) ----
  const watch = new Map(); // value -> source label
  const seenTrace = new Set();

  // Only track values distinctive enough that a match means dataflow, not coincidence.
  function isTrackable(v) {
    if (typeof v !== 'string') return false;
    const s = v.trim();
    if (s.length < 8 || s.length > 2000) return false;
    if (/^(true|false|null|undefined|nan)$/i.test(s)) return false;
    if (/^-?\d+(\.\d+)?$/.test(s)) return false; // pure number
    if (new Set(s).size < 5) return false; // too repetitive (e.g. "aaaaaaaa")
    return true;
  }

  function addWatch(v, source) {
    if (!isTrackable(v)) return;
    if (watch.has(v)) return;
    if (watch.size > 80) watch.delete(watch.keys().next().value);
    watch.set(v, source);
  }
  function addWatchAll(vals, source) { for (const v of vals) addWatch(v, source); }

  function extractInteresting(text) {
    const s = String(text || '').slice(0, 20000);
    if (!s) return [];
    const out = [];
    try {
      for (const m of s.matchAll(/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g)) out.push(m[0]);
      for (const m of s.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi)) out.push(m[0]);
      for (const m of s.matchAll(/\b[A-Za-z0-9_-]{24,}\b/g)) out.push(m[0]);
    } catch {}
    return [...new Set(out)].slice(0, 20);
  }

  function seedFromEnv() {
    try {
      const u = new URL(location.href);
      u.searchParams.forEach((v, k) => addWatch(v, 'location.search:' + k));
    } catch {}
    try { if (location.hash) addWatch(location.hash.slice(1), 'location.hash'); } catch {}
    try { if (window.name) addWatch(window.name, 'window.name'); } catch {}
    try {
      for (const part of String(document.cookie || '').split(';')) {
        const i = part.indexOf('=');
        if (i > 0) addWatch(part.slice(i + 1).trim(), 'cookie:' + part.slice(0, i).trim());
      }
    } catch {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        addWatch(localStorage.getItem(k), 'localStorage:' + k);
      }
    } catch {}
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        addWatch(sessionStorage.getItem(k), 'sessionStorage:' + k);
      }
    } catch {}
  }

  function snippetAround(text, needle) {
    const i = text.indexOf(needle);
    if (i < 0) return '';
    return text.slice(Math.max(0, i - 24), i + needle.length + 24);
  }

  function scanTrace(text, ctx) {
    if (!watch.size || text == null) return;
    let s = typeof text === 'string' ? text : hay(text);
    if (!s) return;
    if (s.length > 20000) s = s.slice(0, 20000);
    for (const [val, source] of watch) {
      if (val.length < 4 || !s.includes(val)) continue;
      const key = source + '|' + ctx.channel + '|' + (ctx.sink || '') + '|' + val.slice(0, 32);
      if (seenTrace.has(key)) continue;
      if (seenTrace.size > 2000) seenTrace.clear();
      seenTrace.add(key);
      try {
        nativePost({
          __fstrace: true, id: 't' + ++seq + '-' + Date.now(), t: Date.now(),
          source, channel: ctx.channel, sink: ctx.sink || ctx.channel,
          value: cap(val), snippet: snippetAround(s, val),
        }, '*');
      } catch {}
    }
  }

  seedFromEnv();
  setInterval(seedFromEnv, 3000);

  // ---- Hunt: active canary poisoning (opt-in, off by default) ----
  let huntApplied = false;
  const canaries = new Map(); // token -> source id
  const canaryBySource = new Map();
  const seenFinding = new Set();

  function makeCanary(sourceId) {
    if (canaryBySource.has(sourceId)) return canaryBySource.get(sourceId);
    const tag = sourceId.replace(/[^a-z0-9]/gi, '').slice(0, 12);
    const tok = 'FScny' + tag + Math.random().toString(16).slice(2, 8);
    canaries.set(tok, sourceId);
    canaryBySource.set(sourceId, tok);
    return tok;
  }

  function attackClassFor(s) {
    s = String(s || '');
    if (/innerHTML|outerHTML|insertAdjacent|document\.write|srcdoc|setAttribute\(on/i.test(s)) return 'xss';
    if (/location|window\.open/i.test(s)) return 'redirect';
    if (/setAttribute\((href|src|action|formaction|data)\)/i.test(s)) return 'link';
    if (/fetch|xhr|network/i.test(s)) return 'request';
    if (/postMessage/i.test(s)) return 'postmessage';
    return 'other';
  }
  function sevFor(cls) {
    if (cls === 'xss') return 'high';
    if (cls === 'redirect') return 'medium';
    if (cls === 'link' || cls === 'request') return 'low';
    return 'info';
  }

  function scanCanary(text, ctx) {
    if (!huntApplied || text == null) return;
    let s = typeof text === 'string' ? text : hay(text);
    if (!s || s.indexOf('FScny') < 0) return;
    if (s.length > 80000) s = s.slice(0, 80000);
    const found = s.match(/FScny[A-Za-z0-9]+/g);
    if (!found) return;
    for (const tok of new Set(found)) {
      const source = canaries.get(tok) || 'unknown';
      const sink = ctx.sink || ctx.channel;
      const cls = attackClassFor(sink);
      const key = source + '|' + sink + '|' + cls;
      if (seenFinding.has(key)) continue;
      if (seenFinding.size > 2000) seenFinding.clear();
      seenFinding.add(key);
      try {
        nativePost({
          __fsfinding: true, id: 'F' + ++seq + '-' + Date.now(), t: Date.now(),
          source, sink, channel: ctx.channel, canary: tok,
          attackClass: cls, severity: sevFor(cls),
          snippet: snippetAround(s, tok), cssPath: ctx.cssPath || '',
          value: cap(s.slice(0, 800)), stack: ctx.channel === 'sink' ? stackTrim() : '',
        }, '*');
      } catch {}
    }
  }

  // location.* getters are non-configurable in modern browsers, so we can't intercept
  // them. Instead write the canary into the real, writable source values (no reload).
  function applyHunt() {
    if (huntApplied) return;
    huntApplied = true;
    try {
      const c = makeCanary('location.hash');
      const cur = location.hash || '';
      if (!cur.includes('FScny')) location.hash = cur + c;
    } catch {}
    try {
      const c = makeCanary('window.name');
      const cur = String(window.name || '');
      if (!cur.includes('FScny')) window.name = cur + c;
    } catch {}
    try {
      const c = makeCanary('location.search');
      const u = new URL(location.href);
      if (!u.search.includes('FScny')) {
        u.searchParams.append('fscy', c);
        history.replaceState(history.state, '', u.toString());
      }
    } catch {}
    try {
      const c = makeCanary('document.cookie');
      if (!String(document.cookie).includes('FScny')) document.cookie = 'fscy=' + c + '; path=/';
    } catch {}
  }

  // Enable signal from the ISOLATED collector (reads chrome.storage, forwards flag).
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__fshunt !== true) return;
    if (d.enabled) { try { applyHunt(); } catch {} }
  }, false);

  // Synchronous early-apply: the collector persists the flag in localStorage, which
  // we can read at document_start — so getters are poisoned BEFORE the page reads them.
  try { if (localStorage.getItem('__FS_HUNT__') === '1') applyHunt(); } catch {}

  // ---- Effects: DOM changes triggered by an AJAX/XHR response (time-window) ----
  // Every non-static response opens a short window. Any DOM mutation inside the
  // window is attributed to that response = full coverage. A string match against
  // the response body is recorded as a confidence flag, not a filter.
  const EFFECT_WINDOW_MS = 1800;
  const MAX_NODES = 60;
  const activeWindows = [];
  const effNodes = new Map(); // ref -> live DOM node, for highlight

  function extractApiStrings(text) {
    const s = String(text || '').slice(0, 24000);
    const out = [];
    const walk = (v, d) => {
      if (d > 6 || out.length > 60 || v == null) return;
      if (typeof v === 'string') { if (v.length >= 4 && v.length <= 200) out.push(v); return; }
      if (typeof v === 'number') { const n = String(v); if (n.length >= 4) out.push(n); return; }
      if (Array.isArray(v)) { v.slice(0, 60).forEach((x) => walk(x, d + 1)); return; }
      if (typeof v === 'object') Object.values(v).slice(0, 60).forEach((x) => walk(x, d + 1));
    };
    try { walk(JSON.parse(s), 0); }
    catch { for (const m of s.matchAll(/["']([^"']{4,200})["']/g)) { if (out.length > 60) break; out.push(m[1]); } }
    return [...new Set(out)].filter((s) => s.length >= 6).slice(0, 80);
  }

  // Called on every non-static response: opens an effect window.
  function storeApiResponse(body, url, host) {
    const w = {
      id: 'E' + ++seq + '-' + Date.now(), url, host,
      t: Date.now(), deadline: Date.now() + EFFECT_WINDOW_MS,
      strings: extractApiStrings(body), nodes: [], matches: 0, flushed: false,
    };
    activeWindows.push(w);
    while (activeWindows.length > 12) activeWindows.shift();
    setTimeout(() => flushWindow(w), EFFECT_WINDOW_MS + 20);
  }

  function pickWindow(now) {
    for (let i = activeWindows.length - 1; i >= 0; i--) {
      const w = activeWindows[i];
      if (!w.flushed && w.t <= now && now <= w.deadline) return w; // nearest preceding response
    }
    return null;
  }

  function addMutation(node, sinkType) {
    const w = pickWindow(Date.now());
    if (!w || w.nodes.length >= MAX_NODES) return;
    const el = node.nodeType === 1 ? node : node.parentElement;
    let text = node.nodeType === 3 ? (node.data || '') : (node.textContent || '');
    if (text.length > 200) text = text.slice(0, 200);
    const tag = node.nodeType === 1 ? node.nodeName.toLowerCase() : '#text';
    let match = false;
    if (text) for (const s of w.strings) { if (text.indexOf(s) >= 0) { match = true; break; } }
    if (match) w.matches++;
    // Stamp a stable ref so highlight works regardless of class/selector quirks.
    let ref = '';
    if (el) {
      ref = w.id + '_' + w.nodes.length;
      try { el.setAttribute('data-fsref', ref); } catch {}
      effNodes.set(ref, el);
      if (effNodes.size > 1200) effNodes.delete(effNodes.keys().next().value);
    }
    w.nodes.push({ tag, css: el ? cssPath(el) : '', ref, text, match, sink: sinkType });
  }

  function flushWindow(w) {
    if (w.flushed) return;
    w.flushed = true;
    const idx = activeWindows.indexOf(w);
    if (idx >= 0) activeWindows.splice(idx, 1);
    if (!w.nodes.length) return;
    try {
      nativePost({
        __fseffect: true, id: w.id, t: w.t, url: w.url, host: w.host,
        nodeCount: w.nodes.length, matchCount: w.matches, nodes: w.nodes,
      }, '*');
    } catch {}
  }

  function startEffects() {
    try {
      const obs = new MutationObserver((muts) => {
        if (!activeWindows.length) return; // no recent AJAX — ignore unrelated churn
        for (const m of muts) {
          if (m.type === 'childList') m.addedNodes.forEach((n) => { if (n.nodeType === 1 || n.nodeType === 3) addMutation(n, 'childList'); });
          else if (m.type === 'characterData') addMutation(m.target, 'characterData');
        }
      });
      obs.observe(document.documentElement || document, { childList: true, subtree: true, characterData: true });
    } catch {}
  }
  if (document.documentElement) startEffects();
  else document.addEventListener('DOMContentLoaded', startEffects);

  // Highlight request from the collector: look up the live node we captured.
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__fshl !== true) return;
    const el = effNodes.get(d.ref);
    if (el && document.contains(el)) {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const p = el.style.outline, po = el.style.outlineOffset;
        el.style.outline = '3px solid #5b9dff';
        el.style.outlineOffset = '2px';
        setTimeout(() => { el.style.outline = p; el.style.outlineOffset = po; }, 2200);
      } catch {}
    }
  }, false);
})();
