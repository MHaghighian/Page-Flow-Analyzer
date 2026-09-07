(() => {
  if (window.__PFA_ISOLATED__) return;
  window.__PFA_ISOLATED__ = true;

  const SOURCE = 'pfa-main-hook';
  const ISOLATED_SRC = 'pfa-isolated';
  const MAX = { network: 2500, mutations: 1200, hits: 3000, sinks: 1500, sources: 800 };

  const state = {
    startedAt: Date.now(),
    network: [],
    mutations: [],
    postMessages: [],
    websockets: [],
    storage: [],
    inputs: [],
    sinks: [],
    autoSources: [],
    watchHits: [],
    findings: [],
    effects: [],
  };
  const recentApis = [];
  let huntEnabled = false;
  let huntApplied = false;
  let catalogMeta = { sourceCount: 0, sinkCount: 0 };

  /** @type {Map<string, any>} */
  const watchMap = new Map();
  let pickMode = false;
  let highlightEl = null;
  let fab = null;
  let collectEnabled = false;
  let booted = false;
  let pushTimer = null;
  let pushTimeout = null;
  let bgFlush = null;
  let syncTimer = null;

  function runtimeAlive() {
    try { return Boolean(chrome.runtime?.id); } catch { return false; }
  }

  function stopBackgroundWork() {
    collectEnabled = false;
    if (pushTimer) { clearInterval(pushTimer); pushTimer = null; }
    if (pushTimeout) { clearTimeout(pushTimeout); pushTimeout = null; }
    if (bgFlush) { clearTimeout(bgFlush); bgFlush = null; }
    if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
  }

  function killIfDead() {
    if (runtimeAlive()) return false;
    stopBackgroundWork();
    return true;
  }

  window.addEventListener('unhandledrejection', (e) => {
    const msg = String(e.reason?.message || e.reason || '');
    if (
      msg.includes('ServiceWorkerContainer')
      || msg.includes("'ready' is only supported in pages")
      || msg.includes('Extension context invalidated')
    ) {
      e.preventDefault();
    }
    if (msg.includes('Extension context invalidated')) stopBackgroundWork();
  });

  function push(arr, item, max) {
    arr.push(item);
    if (arr.length > max) arr.splice(0, arr.length - max);
  }

  function soft(v, n = 240) {
    const s = String(v ?? '');
    return s.length <= n ? s : `${s.slice(0, n)}…(+${s.length - n})`;
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 7) {
      let part = cur.nodeName.toLowerCase();
      if (cur.id) { parts.unshift(part + '#' + cur.id); break; }
      const parent = cur.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter((c) => c.nodeName === cur.nodeName);
        if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join('>');
  }

  function roleOf(channel, hint) {
    if (hint) {
      const h = String(hint).toUpperCase();
      if (h === 'SOURCE' || h === 'SINK' || h === 'TRANSIT') return h;
    }
    const c = String(channel || '');
    if (/^source\.|network\.response|websocket\.in|postMessage\.in|^input|auto-source|storage\..*\.get|watch\.added|manual\.pick/i.test(c)) return 'SOURCE';
    if (/^sink\.|network\.request|storage\..*\.set|websocket\.out|postMessage\.out|dom\.|js\.eval|location\.|dom\.appear/i.test(c)) return 'SINK';
    return 'TRANSIT';
  }

  function ensureWatch(value, originType, detail, sourceMeta) {
    const v = String(value ?? '');
    if (v.length < 6 || v.length > 4000) return null;
    let w = watchMap.get(v);
    if (!w) {
      w = {
        id: `w${watchMap.size + 1}`,
        value: v,
        label: soft(v, 64),
        originType: originType || 'manual',
        source: sourceMeta || { type: originType, detail },
        history: [],
        paths: new Map(),
        createdAt: Date.now(),
      };
      watchMap.set(v, w);
      if (watchMap.size > 50) {
        const first = watchMap.keys().next().value;
        watchMap.delete(first);
      }
      syncWatches();
      hit(w, originType || 'watch.added', detail || '', 'SOURCE');
    }
    return w;
  }

  function hit(w, channel, detail, roleHint) {
    const role = roleOf(channel, roleHint);
    const entry = { t: Date.now(), channel, detail: soft(detail, 500), role, pageUrl: location.href };
    w.history.unshift(entry);
    if (w.history.length > 200) w.history.length = 200;
    const key = `${role}|${channel}|${soft(detail, 100)}`;
    const prev = w.paths.get(key);
    if (prev) prev.count++;
    else w.paths.set(key, { key, role, channel, detail: soft(detail, 300), count: 1, firstSeen: entry.t });
  }

  function tellMainHunt(enabled) {
    try {
      if (enabled) sessionStorage.setItem('__DH_HUNT__', '1');
      else sessionStorage.removeItem('__DH_HUNT__');
    } catch {}
    try {
      window.postMessage({ source: ISOLATED_SRC, cmd: 'setXssHunt', enabled: !!enabled }, '*');
    } catch {}
  }

  function tellMainEnabled(enabled) {
    try {
      window.postMessage({ source: ISOLATED_SRC, cmd: 'setEnabled', enabled: !!enabled }, '*');
    } catch {}
  }

  function syncWatches() {
    if (!collectEnabled) return;
    if (syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      try {
        window.postMessage({ source: ISOLATED_SRC, cmd: 'setWatches', values: [...watchMap.keys()] }, '*');
      } catch {}
    }, 200);
  }

  function pingBg(payload) {
    if (killIfDead()) return;
    try {
      chrome.runtime.sendMessage(payload, () => {
        const err = chrome.runtime.lastError?.message || '';
        if (err.includes('Extension context invalidated')) stopBackgroundWork();
      });
    } catch {
      stopBackgroundWork();
    }
  }

  let bgQueue = [];
  function queueBg(event) {
    if (killIfDead() || !collectEnabled) return;
    bgQueue.push(event);
    if (bgQueue.length > 200) bgQueue.splice(0, bgQueue.length - 200);
    if (bgFlush) return;
    bgFlush = setTimeout(() => {
      bgFlush = null;
      const batch = bgQueue.splice(0, 40);
      for (const ev of batch) pingBg({ type: 'PFA_EVENT', event: ev });
    }, 300);
  }

  const pendingEvents = [];

  function applyLifecycle(rest) {
    if (rest.phase === 'hunt-applied' || rest.phase === 'hunt' || rest.phase === 'hook-ready') {
      if (rest.phase === 'hunt-applied') huntApplied = true;
      if (typeof rest.huntApplied === 'boolean') huntApplied = rest.huntApplied;
      if (typeof rest.huntEnabled === 'boolean') huntEnabled = rest.huntEnabled;
    }
    if (rest.sourceCount) catalogMeta = { sourceCount: rest.sourceCount, sinkCount: rest.sinkCount || catalogMeta.sinkCount };
  }

  function ingest(rest) {
    if (rest.kind === 'network') push(state.network, rest, MAX.network);
    else if (rest.kind === 'postMessage') push(state.postMessages, rest, 400);
    else if (rest.kind === 'websocket') push(state.websockets, rest, 400);
    else if (rest.kind === 'storage') push(state.storage, rest, 500);
    else if (rest.kind === 'input') {
      push(state.inputs, rest, 500);
      if (rest.value && String(rest.value).length >= 6) {
        ensureWatch(rest.value, 'source.input', `${rest.tag} ${rest.name || rest.id || ''}`, {
          type: 'input', name: rest.name, id: rest.id,
        });
      }
    } else if (rest.kind === 'sink') push(state.sinks, rest, MAX.sinks);
    else if (rest.kind === 'auto-source') {
      push(state.autoSources, rest, MAX.sources);
      ensureWatch(rest.value, rest.originType, rest.detail, { type: rest.originType, detail: rest.detail });
    } else if (rest.kind === 'watch-hit') {
      push(state.watchHits, rest, MAX.hits);
      const w = watchMap.get(rest.value);
      if (w) hit(w, rest.channel, rest.detail, rest.role ? String(rest.role).toUpperCase() : undefined);
    } else if (rest.kind === 'finding') {
      const key = `${rest.source}|${rest.sink}|${rest.canary}|${rest.encoded}`;
      if (!state.findings.some((f) => `${f.source}|${f.sink}|${f.canary}|${f.encoded}` === key)) {
        push(state.findings, rest, 400);
      }
    } else if (rest.kind === 'lifecycle') {
      applyLifecycle(rest);
    }
    if (rest.kind === 'network' && rest.phase === 'response') noteApiResponse(rest);
    queueBg(rest);
  }

  function onEvent(rest) {
    if (!collectEnabled) {
      if (rest.kind === 'lifecycle') applyLifecycle(rest);
      pendingEvents.push(rest);
      if (pendingEvents.length > 500) pendingEvents.splice(0, pendingEvents.length - 500);
      return;
    }
    ingest(rest);
  }

  function flushPending() {
    try {
      if (globalThis.__DH_EARLY_ON__) {
        window.removeEventListener('message', globalThis.__DH_EARLY_ON__);
        globalThis.__DH_EARLY_ON__ = null;
      }
    } catch {}
    const early = (globalThis.__DH_EARLY__ || []).splice(0);
    for (const ev of early) {
      if (!ev || ev.source !== SOURCE) continue;
      const { source, ...rest } = ev;
      ingest(rest);
    }
    const batch = pendingEvents.splice(0);
    for (const rest of batch) ingest(rest);
  }

  window.addEventListener('message', (e) => {
    if (!e.data || e.data.source !== SOURCE) return;
    const { source, ...rest } = e.data;
    onEvent(rest);
  });
  try {
    if (globalThis.__DH_EARLY_ON__) {
      window.removeEventListener('message', globalThis.__DH_EARLY_ON__);
      globalThis.__DH_EARLY_ON__ = null;
    }
  } catch {}

  let mutBudget = 0;
  setInterval(() => { mutBudget = 0; }, 1000);
  const mo = new MutationObserver((list) => {
    if (!collectEnabled) return;
    if (mutBudget > 40 && !recentApis.length) return;
    for (const m of list) {
      if (m.target?.closest?.('#pfa-fab,#pfa-pick-mask,.pfa-hl')) continue;
      mutBudget++;
      const added = [...m.addedNodes].filter((n) => n.nodeType === 1);
      const rec = {
        type: m.type,
        target: m.target?.nodeName,
        addedCount: m.addedNodes.length,
        removedCount: m.removedNodes.length,
        attr: m.attributeName || null,
        t: Date.now(),
      };
      if (state.mutations.length < MAX.mutations) state.mutations.push(rec);

      const nodes = [];
      if (m.type === 'childList') {
        for (const n of added) {
          nodes.push({
            cssPath: soft(cssPath(n), 160),
            tag: n.nodeName,
            preview: soft((n.textContent || '').replace(/\s+/g, ' ').trim(), 180),
            html: soft(n.outerHTML, 220),
          });
        }
      } else if (m.type === 'attributes' && m.target?.nodeType === 1) {
        nodes.push({
          cssPath: soft(cssPath(m.target), 160),
          tag: m.target.nodeName,
          preview: `${m.attributeName}=${soft(m.target.getAttribute(m.attributeName), 80)}`,
          html: '',
        });
      } else if (m.type === 'characterData' && m.target?.parentElement) {
        nodes.push({
          cssPath: soft(cssPath(m.target.parentElement), 160),
          tag: m.target.parentElement.nodeName,
          preview: soft(m.target.textContent, 180),
          html: '',
        });
      }

      if (nodes.length) linkDomEffect(nodes, rec.t, m.type);

      if (!watchMap.size) continue;
      for (const n of added) {
        const text = (n.textContent || '').slice(0, 1500);
        if (text.length < 6) continue;
        for (const [val, w] of watchMap) {
          if (val.length >= 6 && text.includes(val)) hit(w, 'dom.appear', soft(cssPath(n), 120), 'SINK');
        }
      }
    }
  });
  if (document.documentElement) {
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'src', 'value', 'action'], characterData: true });
  }

  function noteApiResponse(n) {
    if (n.category === 'static' || n.category === 'telemetry') return;
    const strings = n.extractedStrings || [];
    recentApis.unshift({
      id: n.id, url: n.url, method: n.method, t: n.t || Date.now(),
      host: n.host, status: n.status, strings, category: n.category,
    });
    if (recentApis.length > 40) recentApis.length = 40;
  }

  function linkDomEffect(nodes, t, mutType) {
    const windowMs = 2000;
    const live = recentApis.filter((a) => t - a.t < windowMs);
    if (!live.length) return;
    let best = live[0];
    let how = 'time';
    const blob = nodes.map((n) => `${n.preview} ${n.html}`).join('\n');
    for (const api of live) {
      if ((api.strings || []).some((s) => s.length >= 8 && blob.includes(s))) {
        best = api;
        how = 'content';
        break;
      }
    }
    if (how === 'time' && mutType === 'attributes') return;
    const effect = {
      id: best.id,
      method: best.method,
      url: best.url,
      status: best.status,
      how,
      t,
      nodes: nodes.slice(0, 12),
    };
    const prev = state.effects.find((e) => e.id === best.id);
    if (prev) {
      prev.nodes = [...prev.nodes, ...effect.nodes].slice(0, 40);
      prev.t = t;
      if (how === 'content') prev.how = 'content';
    } else {
      push(state.effects, effect, 200);
    }
  }

  function storageDump(store) {
    const out = [];
    try {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        const v = store.getItem(k) ?? '';
        const sensitive = /token|auth|secret|password|refresh|jwt|session|otp|cookie/i.test(k || '');
        out.push({
          key: k,
          len: v.length,
          sensitive,
          preview: sensitive ? `[redacted len=${v.length}]` : soft(v, 1200),
          looksJson: /^\s*[\{\[]/.test(v),
          looksJwt: /^eyJ/.test(v),
        });
      }
    } catch (e) {
      return [{ error: String(e) }];
    }
    return out.sort((a, b) => (b.sensitive - a.sensitive) || (b.len - a.len));
  }

  function safeCall(fn, fallback = null) {
    try { return fn(); } catch { return fallback; }
  }

  const { bomSnapshot } = pfaCreateBomCollector({ soft, storageDump, state, watchMap });


  function domInventory() {
    const q = (sel) => {
      try { return [...document.querySelectorAll(sel)]; } catch { return []; }
    };
    const attrsOfInterest = (el, limit = 40) => {
      const keep = {};
      let n = 0;
      for (const a of el.attributes || []) {
        if (n >= limit) break;
        if (/^(id|name|class|type|role|href|src|action|method|value|placeholder|autocomplete|for|aria-|data-|ng-|v-|\[|\\*|on)/i.test(a.name)
          || a.name.startsWith('data-') || a.name.startsWith('aria-') || a.name.startsWith('ng-')) {
          keep[a.name] = soft(a.value, 160);
          n++;
        }
      }
      return keep;
    };

    const all = document.getElementsByTagName('*');
    let shadowHosts = 0;
    let customElements = 0;
    const tagHistogram = {};
    const maxScan = Math.min(all.length, 8000);
    for (let i = 0; i < maxScan; i++) {
      const el = all[i];
      const tag = el.tagName;
      tagHistogram[tag] = (tagHistogram[tag] || 0) + 1;
      if (el.shadowRoot) shadowHosts++;
      if (tag.includes('-')) customElements++;
    }
    const topTags = Object.entries(tagHistogram)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([tag, count]) => ({ tag, count }));

    const htmlEl = document.documentElement;
    const bodyEl = document.body;

    return {
      capturedAt: new Date().toISOString(),
      counts: {
        elements: all.length,
        scannedForHistogram: maxScan,
        scripts: q('script').length,
        inlineScripts: q('script:not([src])').length,
        externalScripts: q('script[src]').length,
        stylesheets: q('link[rel~="stylesheet"]').length,
        styleTags: q('style').length,
        iframes: q('iframe').length,
        forms: q('form').length,
        inputs: q('input,textarea,select').length,
        buttons: q('button,[role="button"]').length,
        links: q('a[href]').length,
        images: q('img').length,
        pictures: q('picture').length,
        videos: q('video').length,
        audios: q('audio').length,
        canvases: q('canvas').length,
        svgs: q('svg').length,
        templates: q('template').length,
        slots: q('slot').length,
        dialogs: q('dialog').length,
        shadowHosts,
        customElements,
        commentsApprox: safeCall(() => {
          const it = document.createNodeIterator(document, NodeFilter.SHOW_COMMENT);
          let n = 0; while (it.nextNode() && n < 500) n++; return n;
        }, 0),
        eventHandlersInline: q('[onclick],[onchange],[onsubmit],[onload],[onerror],[onmouseover]').length,
        javascriptHrefs: q('a[href^="javascript:"]').length,
      },
      topTags,
      root: {
        htmlLang: htmlEl?.lang || null,
        htmlAttrs: htmlEl ? attrsOfInterest(htmlEl) : null,
        bodyAttrs: bodyEl ? attrsOfInterest(bodyEl) : null,
        bodyClass: soft(bodyEl?.className, 200),
        bodyId: bodyEl?.id || null,
      },
      head: {
        title: document.title,
        base: document.querySelector('base')?.href || null,
        meta: q('meta').slice(0, 80).map((m) => ({
          name: m.name || null,
          property: m.getAttribute('property'),
          httpEquiv: m.httpEquiv || null,
          charset: m.getAttribute('charset'),
          content: soft(m.content, 200),
        })),
        links: q('link').slice(0, 80).map((l) => ({
          rel: l.rel, as: l.as || null, type: l.type || null,
          href: soft(l.href, 200), crossOrigin: l.crossOrigin || null,
        })),
      },
      frameworkHints: {
        angular: !!document.querySelector('[ng-version],app-root'),
        ngVersion: document.querySelector('[ng-version]')?.getAttribute('ng-version') || null,
        react: !!document.querySelector('[data-reactroot],#root') || typeof window.React !== 'undefined',
        vue: !!document.querySelector('[data-v-]') || typeof window.__VUE__ !== 'undefined',
        next: !!document.querySelector('#__NEXT_DATA__'),
        nuxt: !!document.querySelector('#__NUXT__'),
      },
      forms: q('form').slice(0, 60).map((f) => ({
        id: f.id || null, name: f.name || null, action: f.action || null, method: f.method || null,
        attrs: attrsOfInterest(f),
        fields: [...f.elements].slice(0, 80).map((el) => ({
          tag: el.tagName, type: el.type || null, name: el.name || null, id: el.id || null,
          autocomplete: el.autocomplete || null, required: !!el.required,
          valuePreview: soft(el.value, 120),
          attrs: attrsOfInterest(el, 20),
        })),
      })),
      iframes: q('iframe').slice(0, 50).map((f) => ({
        name: f.name || null, id: f.id || null,
        src: soft(f.src, 260),
        srcdoc: f.srcdoc ? soft(f.srcdoc, 240) : null,
        sandbox: f.sandbox?.toString() || null,
        allow: f.allow || null,
        loading: f.loading || null,
        referrerPolicy: f.referrerPolicy || null,
        attrs: attrsOfInterest(f),
      })),
      scripts: q('script').slice(0, 100).map((s) => ({
        src: s.src ? soft(s.src, 240) : null,
        type: s.type || null,
        async: !!s.async,
        defer: !!s.defer,
        nomodule: !!s.noModule,
        crossOrigin: s.crossOrigin || null,
        integrity: soft(s.integrity, 80),
        inlineLen: s.src ? 0 : (s.textContent || '').length,
        inlinePreview: s.src ? null : soft((s.textContent || '').trim(), 220),
      })),
      styles: {
        stylesheets: q('link[rel~="stylesheet"]').slice(0, 60).map((l) => soft(l.href, 200)),
        inlineStyleTags: q('style').slice(0, 30).map((s) => ({
          len: (s.textContent || '').length,
          preview: soft((s.textContent || '').trim(), 160),
        })),
      },
      inputs: q('input,textarea,select').slice(0, 120).map((el) => ({
        tag: el.tagName, type: el.type || null, name: el.name || null, id: el.id || null,
        path: soft(cssPath(el), 140),
        autocomplete: el.autocomplete || null,
        valuePreview: soft(el.value, 120),
        attrs: attrsOfInterest(el, 15),
      })),
      links: {
        external: q('a[href^="http"]').slice(0, 80).map((a) => ({
          text: soft(a.innerText, 60), href: soft(a.href, 200), rel: a.rel || null, target: a.target || null,
        })),
        internal: q('a[href^="/"],a[href^="#"]').slice(0, 60).map((a) => ({
          text: soft(a.innerText, 60), href: soft(a.getAttribute('href'), 160),
        })),
      },
      media: {
        images: q('img').slice(0, 60).map((img) => ({
          src: soft(img.currentSrc || img.src, 180), alt: soft(img.alt, 60),
          width: img.naturalWidth || img.width, height: img.naturalHeight || img.height,
        })),
        videos: q('video').slice(0, 20).map((v) => ({ src: soft(v.currentSrc || v.src, 180), poster: soft(v.poster, 120) })),
        audios: q('audio').slice(0, 20).map((a) => ({ src: soft(a.currentSrc || a.src, 180) })),
        canvases: q('canvas').slice(0, 20).map((c) => ({ width: c.width, height: c.height, id: c.id || null })),
      },
      dataAttrsSample: q('[data-token],[data-auth],[data-id],[data-user],[data-testid],[ng-version],app-root').slice(0, 60).map((el) => ({
        path: soft(cssPath(el), 120),
        tag: el.tagName,
        attrs: attrsOfInterest(el),
      })),
      dangerous: {
        inlineHandlers: q('[onclick],[onchange],[onsubmit],[onload],[onerror]').slice(0, 40).map((el) => ({
          path: soft(cssPath(el), 120),
          attrs: attrsOfInterest(el, 10),
        })),
        javascriptHrefs: q('a[href^="javascript:"]').slice(0, 30).map((a) => ({
          href: soft(a.getAttribute('href'), 160), path: soft(cssPath(a), 100),
        })),
      },
      landmarks: {
        headers: q('header,[role="banner"]').length,
        navs: q('nav,[role="navigation"]').length,
        mains: q('main,[role="main"]').length,
        footers: q('footer,[role="contentinfo"]').length,
        asides: q('aside,[role="complementary"]').length,
      },
    };
  }

  function hostFlows() {
    const edges = {};
    for (const n of state.network) {
      const from = (() => { try { return 'page:' + new URL(n.pageUrl || location.href).host; } catch { return 'page'; } })();
      const to = n.host || 'unknown';
      const key = `${from}=>${to}|${n.category || ''}`;
      edges[key] = edges[key] || { from, to, category: n.category, count: 0, samples: [] };
      edges[key].count++;
      if (edges[key].samples.length < 8) {
        edges[key].samples.push({
          method: n.method, status: n.status, phase: n.phase, url: soft(n.url, 180),
          bodyPreview: soft(n.requestBody || n.responseBody, 160),
        });
      }
    }
    return Object.values(edges).sort((a, b) => b.count - a.count);
  }

  function watchesList() {
    return [...watchMap.values()].sort((a, b) => b.history.length - a.history.length);
  }

  /** Explicit SOURCE → SINK mappings for each watched value */
  function buildTraces() {
    return watchesList().map((w) => {
      const paths = [...w.paths.values()];
      const sources = paths.filter((p) => p.role === 'SOURCE').sort((a, b) => b.count - a.count);
      const transits = paths.filter((p) => p.role === 'TRANSIT').sort((a, b) => b.count - a.count);
      const sinks = paths.filter((p) => p.role === 'SINK').sort((a, b) => b.count - a.count);

      const primarySource = sources[0] || {
        channel: w.originType,
        detail: soft(typeof w.source?.detail === 'string' ? w.source.detail : JSON.stringify(w.source || {}), 120),
        count: 1,
      };

      // Pair each source with each sink (cartesian of top items) for clarity
      const pairs = [];
      const srcList = sources.length ? sources.slice(0, 6) : [primarySource];
      const sinkList = sinks.slice(0, 8);
      if (sinkList.length) {
        for (const s of srcList) {
          for (const k of sinkList) {
            pairs.push({
              from: s.channel,
              fromDetail: soft(s.detail, 160),
              to: k.channel,
              toDetail: soft(k.detail, 160),
              via: transits.slice(0, 3).map((t) => t.channel),
              hits: Math.min(s.count || 1, k.count || 1),
              label: `${s.channel}  →  ${k.channel}`,
            });
          }
        }
      }

      const chainParts = [
        primarySource.channel,
        ...transits.slice(0, 2).map((t) => t.channel),
        ...sinks.slice(0, 3).map((k) => k.channel),
      ];
      const chain = [...new Set(chainParts)].join('  →  ');

      return {
        id: w.id,
        value: soft(w.value, 200),
        valueFullLen: w.value.length,
        originType: w.originType,
        chain,
        hasSink: sinks.length > 0,
        sources: srcList.map((s) => ({ channel: s.channel, detail: soft(s.detail, 200), count: s.count })),
        transits: transits.slice(0, 8).map((t) => ({ channel: t.channel, detail: soft(t.detail, 200), count: t.count })),
        sinks: sinkList.map((k) => ({ channel: k.channel, detail: soft(k.detail, 200), count: k.count })),
        pairs: pairs.slice(0, 24),
        recent: w.history.slice(0, 15).map((h) => ({
          role: h.role, channel: h.channel, detail: soft(h.detail, 160), t: h.t,
        })),
        hitCount: w.history.length,
      };
    });
  }

  function pairNetwork() {
    const map = new Map();
    for (const n of state.network) {
      if (!n.id) continue;
      const row = map.get(n.id) || {
        id: n.id, api: n.api, method: n.method, url: n.url, host: n.host, category: n.category,
        frame: n.frame, t: n.t, requestBody: '', responseBody: '', status: null, ok: null,
        durationMs: null, phase: 'pending', extractedStrings: [],
      };
      if (n.phase === 'request') {
        row.requestBody = n.requestBody || row.requestBody;
        row.method = n.method || row.method;
        row.url = n.url || row.url;
        row.t = n.t || row.t;
      } else {
        row.status = n.status;
        row.ok = n.ok;
        row.durationMs = n.durationMs;
        row.responseBody = n.responseBody || row.responseBody;
        row.extractedStrings = n.extractedStrings || row.extractedStrings;
        row.phase = n.phase === 'error' || n.ok === false ? 'failed' : 'done';
      }
      map.set(n.id, row);
    }
    return [...map.values()].sort((a, b) => (b.t || 0) - (a.t || 0));
  }

  function pairWs() {
    const map = new Map();
    for (const w of state.websockets) {
      if (!w.id) continue;
      const row = map.get(w.id) || { id: w.id, url: w.url, host: w.host, frames: [], t: w.t };
      if (w.phase === 'open-attempt') {
        row.url = w.url;
        row.host = w.host;
        row.protocols = w.protocols;
      } else {
        row.frames.push({ direction: w.direction, data: w.data, t: w.t });
        if (row.frames.length > 80) row.frames.splice(0, row.frames.length - 80);
      }
      map.set(w.id, row);
    }
    return [...map.values()];
  }

  let lastHeavyAt = 0;
  let lastBom = null;
  let lastDom = null;

  async function buildReport(includeHeavy = false) {
    const traces = buildTraces();
    const mapped = traces.filter((t) => t.hasSink).length;
    const findings = [...state.findings].sort((a, b) => (a.rank || 90) - (b.rank || 90));
    const classCounts = {};
    for (const f of findings) classCounts[f.attackClass || 'other'] = (classCounts[f.attackClass || 'other'] || 0) + 1;
    const networkExchanges = pairNetwork();
    const wsExchanges = pairWs();
    let bom = lastBom;
    let dom = lastDom;
    if (includeHeavy && Date.now() - lastHeavyAt > 15000) {
      try { lastBom = await bomSnapshot(); } catch (e) { lastBom = { error: String(e) }; }
      try { lastDom = domInventory(); } catch (e) { lastDom = { error: String(e) }; }
      lastHeavyAt = Date.now();
      bom = lastBom;
      dom = lastDom;
    }
    const classBits = Object.entries(classCounts).map(([k, v]) => `${v} ${k}`).join(' · ');
    return {
      pageUrl: location.href,
      title: document.title,
      hunt: { enabled: huntEnabled, applied: huntApplied, ...catalogMeta },
      counts: {
        network: state.network.length,
        exchanges: networkExchanges.length,
        mutations: state.mutations.length,
        autoSources: state.autoSources.length,
        sinks: state.sinks.length,
        watches: watchMap.size,
        watchHits: state.watchHits.length,
        inputs: state.inputs.length,
        storage: state.storage.length,
        tracedWithSink: mapped,
        findings: findings.length,
        effects: state.effects.length,
        bomSections: bom ? Object.keys(bom).length : 0,
        domElements: dom?.counts?.elements || 0,
      },
      classCounts,
      traces,
      findings: findings.slice(0, 200),
      effects: state.effects.slice(-80).reverse(),
      networkExchanges: networkExchanges.slice(0, 120),
      wsExchanges,
      watches: watchesList().map((w) => ({
        value: soft(w.value, 120),
        originType: w.originType,
        paths: [...w.paths.values()].slice(0, 30),
        hits: w.history.length,
      })),
      flows: hostFlows().slice(0, 40),
      network: state.network.slice(-120),
      sinks: state.sinks.slice(-120),
      autoSources: state.autoSources.slice(-120),
      storage: state.storage.slice(-80),
      postMessages: state.postMessages.slice(-60),
      websockets: state.websockets.slice(-60),
      inputs: state.inputs.slice(-60),
      bom,
      dom,
      narrative: [
        classBits ? `Findings: ${classBits}.` : (huntEnabled ? (huntApplied ? 'Hunt on — no canary hits yet.' : 'Hunt on — hard-refresh so sources wrap.') : 'Hunt off.'),
        `${watchMap.size} token watches · ${state.effects.length} API→DOM effects · ${networkExchanges.length} HTTP exchanges.`,
      ],
    };
  }

  function clearAll() {
    watchMap.clear();
    Object.keys(state).forEach((k) => { if (Array.isArray(state[k])) state[k] = []; });
    recentApis.length = 0;
    pendingEvents.length = 0;
    lastHeavyAt = 0;
    lastBom = null;
    lastDom = null;
    state.startedAt = Date.now();
    syncWatches();
  }

  function exportJson() {
    buildReport(true).then((report) => {
      const payload = {
        exportedAt: new Date().toISOString(),
        model: {
          refs: [
            'https://portswigger.net/web-security/cross-site-scripting/dom-based',
            'Taintaru-style runtime source/sink instrumentation',
          ],
        },
        ...report,
        mutations: state.mutations.slice(-150),
        watchHits: state.watchHits.slice(-300),
      };
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      a.download = `dh-full-${Date.now()}.json`;
      a.click();
    });
  }

  // Tiny FAB only for optional Pick — does not cover the page
  function ensureHighlightStyle() {
    if (document.getElementById('pfa-hl-style')) return;
    const st = document.createElement('style');
    st.id = 'pfa-hl-style';
    st.textContent = `#pfa-fab{all:initial;position:fixed;bottom:16px;right:16px;z-index:2147483646;width:44px;height:44px;
        border-radius:22px;background:#00c878;color:#062816;font:700 11px/44px Inter,Segoe UI,sans-serif;text-align:center;
        cursor:pointer;border:0}
      #pfa-fab.on{background:#5b9dff;color:#fff}
      #pfa-pick-mask{position:fixed;inset:0;z-index:2147483645;cursor:crosshair;background:transparent}
      .pfa-hl{outline:3px solid #00c878!important;outline-offset:2px!important;background:rgba(0,200,120,.12)!important}`;
    (document.head || document.documentElement).appendChild(st);
  }

  function ensureFab() {
    if (!collectEnabled) return null;
    ensureHighlightStyle();
    if (fab && document.contains(fab)) return fab;
    fab = document.createElement('button');
    fab.id = 'pfa-fab';
    fab.type = 'button';
    fab.title = 'DOM Hacker: Pick value';
    fab.textContent = 'DH';
    fab.onclick = (e) => { e.preventDefault(); e.stopPropagation(); togglePick(); };
    document.documentElement.appendChild(fab);
    return fab;
  }

  function togglePick(force) {
    if (!collectEnabled) return false;
    pickMode = typeof force === 'boolean' ? force : !pickMode;
    ensureFab();
    fab.classList.toggle('on', pickMode);
    let mask = document.getElementById('pfa-pick-mask');
    if (pickMode) {
      if (!mask) {
        mask = document.createElement('div');
        mask.id = 'pfa-pick-mask';
        document.documentElement.appendChild(mask);
        mask.onmousemove = (e) => {
          const el = document.elementsFromPoint(e.clientX, e.clientY)
            .find((x) => x.id !== 'pfa-pick-mask' && x.id !== 'pfa-fab');
          if (highlightEl) highlightEl.classList.remove('pfa-hl');
          highlightEl = el;
          el?.classList.add('pfa-hl');
        };
        mask.onclick = (e) => {
          e.preventDefault(); e.stopPropagation();
          const el = document.elementsFromPoint(e.clientX, e.clientY)
            .find((x) => x.id !== 'pfa-pick-mask' && x.id !== 'pfa-fab');
          let value = '';
          if (el && 'value' in el) value = el.value;
          else value = (el?.innerText || el?.getAttribute?.('href') || el?.getAttribute?.('src') || '').trim();
          if (value) ensureWatch(value.slice(0, 4000), 'manual.pick', cssPath(el), { type: 'pick', path: cssPath(el) });
          togglePick(false);
        };
      }
    } else {
      mask?.remove();
      highlightEl?.classList.remove('pfa-hl');
    }
    return pickMode;
  }

  try {
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (killIfDead()) return;
    if (msg?.type === 'PFA_GET_REPORT') {
      buildReport(msg.heavy === true).then((report) => {
        if (killIfDead()) return;
        try { sendResponse({ ok: true, report }); } catch {}
      }).catch((e) => {
        try { sendResponse({ ok: false, error: String(e) }); } catch {}
      });
      return true;
    }
    if (msg?.type === 'PFA_CLEAR') {
      clearAll();
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === 'PFA_PAGE_RESET') {
      clearAll();
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === 'PFA_TOGGLE_PICK') {
      sendResponse({ ok: true, pickMode: togglePick(msg.force) });
      return true;
    }
    if (msg?.type === 'PFA_EXPORT') {
      exportJson();
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === 'PFA_SHOW_PANEL') {
      pingBg({ type: 'PFA_OPEN_SIDE_PANEL' });
      sendResponse({ ok: true, note: 'use Chrome side panel' });
      return true;
    }
    if (msg?.type === 'PFA_SET_ENABLED') {
      setCollectEnabled(!!msg.enabled);
      sendResponse({ ok: true, enabled: collectEnabled });
      return true;
    }
    if (msg?.type === 'PFA_SET_HUNT') {
      huntEnabled = !!msg.enabled;
      tellMainHunt(huntEnabled);
      sendResponse({ ok: true, huntEnabled, huntApplied });
      return true;
    }
    if (msg?.type === 'PFA_HIGHLIGHT') {
      highlightPath(msg.cssPath);
      sendResponse({ ok: true });
      return true;
    }
  });
  } catch {}

  function highlightPath(path) {
    try {
      ensureHighlightStyle();
      document.querySelectorAll('.pfa-hl').forEach((el) => el.classList.remove('pfa-hl'));
      if (!path) return;
      const el = document.querySelector(path);
      if (!el) return;
      el.classList.add('pfa-hl');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => el.classList.remove('pfa-hl'), 2500);
    } catch {}
  }

  function stopPush() {
    if (pushTimer) { clearInterval(pushTimer); pushTimer = null; }
    if (pushTimeout) { clearTimeout(pushTimeout); pushTimeout = null; }
  }

  function startPush() {
    stopPush();
    const push = () => {
      if (killIfDead() || !collectEnabled) return;
      buildReport(false).then((report) => {
        pingBg({ type: 'PFA_REPORT_PUSH', report });
      }).catch(() => {});
    };
    pushTimeout = setTimeout(push, 2000);
    pushTimer = setInterval(push, 4000);
  }

  function setCollectEnabled(on) {
    collectEnabled = !!on;
    tellMainEnabled(collectEnabled);
    if (collectEnabled) {
      flushPending();
      try {
        chrome.storage.local.get({ huntEnabled: false }, (r) => {
          if (chrome.runtime.lastError || killIfDead()) return;
          huntEnabled = !!r.huntEnabled;
          tellMainHunt(huntEnabled);
        });
      } catch { tellMainHunt(huntEnabled); }
    }
    if (!collectEnabled) {
      pickMode = false;
      document.getElementById('pfa-pick-mask')?.remove();
      highlightEl?.classList.remove('pfa-hl');
      highlightEl = null;
      fab?.remove();
      fab = null;
      stopPush();
      return;
    }
    boot();
  }

  function boot() {
    if (!collectEnabled) return;
    if (booted) {
      ensureFab();
      startPush();
      return;
    }
    booted = true;
    setTimeout(() => { if (collectEnabled) ensureFab(); }, 1500);
    syncWatches();
    pingBg({ type: 'PFA_READY', pageUrl: location.href, title: document.title });
    startPush();
  }

  function startIfInScope() {
    const tryCheck = (attempt) => {
      if (killIfDead()) return;
      try {
        chrome.runtime.sendMessage({ type: 'PFA_SCOPE_CHECK' }, (res) => {
          const err = chrome.runtime.lastError?.message || '';
          if (err.includes('Extension context invalidated')) {
            stopBackgroundWork();
            return;
          }
          if (err) {
            if (attempt < 5) setTimeout(() => tryCheck(attempt + 1), 200 * (attempt + 1));
            else setCollectEnabled(false);
            return;
          }
          setCollectEnabled(!!res?.enabled);
        });
      } catch {
        stopBackgroundWork();
      }
    };
    tryCheck(0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startIfInScope);
  else startIfInScope();
})();
