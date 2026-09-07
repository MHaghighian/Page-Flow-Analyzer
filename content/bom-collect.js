/* Full BOM collector — MDN Navigator / Window / Screen / Location / History / Performance */
function pfaSafeCall(fn, fallback = null) {
  try { return fn(); } catch { return fallback; }
}

function pfaObjectTag(v) {
  try { return Object.prototype.toString.call(v); } catch { return ''; }
}

function pfaIsSwContainer(obj) {
  if (obj == null || typeof obj !== 'object') return false;
  return pfaObjectTag(obj) === '[object ServiceWorkerContainer]';
}

function pfaSkipProp(obj, key) {
  if (key === 'serviceWorker') return 'navigator.serviceWorker';
  if (key === 'ready') return 'getter.ready';
  if (key === 'then') return 'thenable';
  if (pfaIsSwContainer(obj)) return 'ServiceWorkerContainer';
  return null;
}

function pfaReadProp(obj, key) {
  const skip = pfaSkipProp(obj, key);
  if (skip) return { __skipped: skip };
  let value;
  try { value = obj[key]; }
  catch (e) { return { __error: String(e.message || e) }; }
  if (pfaIsSwContainer(value)) return { __skipped: 'ServiceWorkerContainer' };
  if (value != null && typeof value.then === 'function') {
    try { value.then(undefined, () => {}); } catch {}
    return { __type: 'Promise', name: key };
  }
  return { __ok: true, value };
}

function pfaCreateBomCollector({ soft, storageDump, state, watchMap }) {
  function serializeValue(v, depth = 1, seen = null) {
    const bag = seen || new WeakSet();
    if (v == null) return v;
    const t = typeof v;
    if (t === 'string') return soft(v, 2000);
    if (t === 'number' || t === 'boolean') return v;
    if (t === 'bigint') return `${v}n`;
    if (t === 'symbol') return String(v);
    if (t === 'function') {
      let name = '(anonymous)';
      let length = 0;
      let native = false;
      try { name = v.name || name; } catch {}
      try { length = v.length; } catch {}
      try { native = /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(v)); } catch {}
      return { __type: 'function', name, length, native };
    }
    if (t !== 'object') return soft(String(v), 200);
    if (pfaIsSwContainer(v)) return { __type: 'ServiceWorkerContainer', __skipped: 'not readable in content scripts' };
    if (v === window) return { __ref: 'window' };
    if (v === document) return { __ref: 'document' };
    if (v === location) return { __ref: 'location' };
    if (v === navigator) return { __ref: 'navigator' };
    if (typeof v.then === 'function') {
      try { v.then(undefined, () => {}); } catch {}
      return { __type: 'Promise' };
    }
    if (bag.has(v)) return { __ref: 'circular' };
    try { bag.add(v); } catch {}

    if (Array.isArray(v)) return v.slice(0, 80).map((x) => serializeValue(x, depth - 1, bag));
    if (typeof Node !== 'undefined' && v instanceof Node) {
      return {
        __type: 'Node',
        nodeName: v.nodeName,
        nodeType: v.nodeType,
        id: v.id || undefined,
        src: v.src ? soft(v.src, 160) : undefined,
      };
    }
    if (depth <= 0) {
      return { __type: pfaObjectTag(v).slice(8, -1) || v.constructor?.name || 'Object' };
    }
    if (ArrayBuffer.isView?.(v) || v instanceof ArrayBuffer) {
      return { __type: v.constructor?.name || 'ArrayBuffer', byteLength: v.byteLength || v.buffer?.byteLength };
    }

    const out = { __type: v.constructor?.name || 'Object' };
    const keys = new Set();
    try { Object.getOwnPropertyNames(v).forEach((k) => keys.add(k)); } catch {}
    try { for (const k in v) keys.add(k); } catch {}
    let n = 0;
    for (const k of [...keys].sort()) {
      if (n++ > 120) { out.__truncatedKeys = true; break; }
      const got = pfaReadProp(v, k);
      if (!got.__ok) {
        out[k] = got;
        continue;
      }
      try { out[k] = serializeValue(got.value, depth - 1, bag); }
      catch (e) { out[k] = { __error: String(e.message || e) }; }
    }
    return out;
  }

  function dumpBomObject(obj, label, { depth = 2, maxKeys = 250 } = {}) {
    if (obj == null) return { __missing: true, label };
    const out = {
      __label: label,
      __type: obj.constructor?.name || typeof obj,
      properties: {},
      propertyNames: [],
      methods: [],
      presence: {},
    };
    const keys = new Set();
    let proto = obj;
    let level = 0;
    while (proto && proto !== Object.prototype && level < 6) {
      try { Object.getOwnPropertyNames(proto).forEach((k) => keys.add(k)); } catch {}
      try { for (const k in proto) keys.add(k); } catch {}
      proto = Object.getPrototypeOf(proto);
      level++;
    }
    out.propertyNames = [...keys].sort();
    let n = 0;
    for (const key of out.propertyNames) {
      if (key === 'constructor') continue;
      if (n++ >= maxKeys) { out.__truncated = true; break; }
      const got = pfaReadProp(obj, key);
      if (!got.__ok) {
        out.presence[key] = !got.__error;
        out.properties[key] = got;
        continue;
      }
      const value = got.value;
      out.presence[key] = value !== undefined;
      if (typeof value === 'function') {
        out.methods.push(key);
        out.properties[key] = serializeValue(value, 0);
      } else {
        out.properties[key] = serializeValue(value, depth);
      }
    }
    return out;
  }

  async function enrichNavigator(nav) {
    const enriched = {
      userAgent: nav.userAgent,
      appCodeName: nav.appCodeName,
      appName: nav.appName,
      appVersion: nav.appVersion,
      product: nav.product,
      productSub: nav.productSub,
      vendor: nav.vendor,
      vendorSub: nav.vendorSub,
      platform: nav.platform,
      language: nav.language,
      languages: pfaSafeCall(() => [...(nav.languages || [])], []),
      onLine: nav.onLine,
      cookieEnabled: nav.cookieEnabled,
      doNotTrack: nav.doNotTrack,
      hardwareConcurrency: nav.hardwareConcurrency,
      deviceMemory: nav.deviceMemory,
      maxTouchPoints: nav.maxTouchPoints,
      pdfViewerEnabled: nav.pdfViewerEnabled,
      webdriver: nav.webdriver,
      buildID: nav.buildID,
      oscpu: nav.oscpu,
      globalPrivacyControl: nav.globalPrivacyControl,
      standalone: nav.standalone,
      plugins: pfaSafeCall(() => [...(nav.plugins || [])].map((p) => ({
        name: p.name, filename: p.filename, description: p.description, length: p.length,
      })), []),
      mimeTypes: pfaSafeCall(() => [...(nav.mimeTypes || [])].map((m) => ({
        type: m.type, description: m.description, suffixes: m.suffixes,
      })), []),
      javaEnabled: pfaSafeCall(() => nav.javaEnabled?.(), null),
      apiObjects: {
        bluetooth: !!nav.bluetooth, clipboard: !!nav.clipboard, contacts: !!nav.contacts,
        credentials: !!nav.credentials, geolocation: !!nav.geolocation, gpu: !!nav.gpu,
        hid: !!nav.hid, ink: !!nav.ink, keyboard: !!nav.keyboard, locks: !!nav.locks,
        login: !!nav.login, mediaCapabilities: !!nav.mediaCapabilities,
        mediaDevices: !!nav.mediaDevices, mediaSession: !!nav.mediaSession,
        permissions: !!nav.permissions, preferences: !!nav.preferences,
        presentation: !!nav.presentation, scheduling: !!nav.scheduling,
        serial: !!nav.serial, serviceWorker: 'serviceWorker' in nav, storage: !!nav.storage,
        usb: !!nav.usb, userActivation: !!nav.userActivation, userAgentData: !!nav.userAgentData,
        virtualKeyboard: !!nav.virtualKeyboard, wakeLock: !!nav.wakeLock,
        windowControlsOverlay: !!nav.windowControlsOverlay, xr: !!nav.xr,
        connection: !!(nav.connection || nav.mozConnection || nav.webkitConnection),
        devicePosture: !!nav.devicePosture, audioSession: !!nav.audioSession,
      },
      methodsAvailable: {
        canShare: typeof nav.canShare === 'function',
        share: typeof nav.share === 'function',
        vibrate: typeof nav.vibrate === 'function',
        getBattery: typeof nav.getBattery === 'function',
        getGamepads: typeof nav.getGamepads === 'function',
        requestMIDIAccess: typeof nav.requestMIDIAccess === 'function',
        requestMediaKeySystemAccess: typeof nav.requestMediaKeySystemAccess === 'function',
        sendBeacon: typeof nav.sendBeacon === 'function',
        registerProtocolHandler: typeof nav.registerProtocolHandler === 'function',
        unregisterProtocolHandler: typeof nav.unregisterProtocolHandler === 'function',
        setAppBadge: typeof nav.setAppBadge === 'function',
        clearAppBadge: typeof nav.clearAppBadge === 'function',
        getInstalledRelatedApps: typeof nav.getInstalledRelatedApps === 'function',
      },
    };

    try {
      const c = nav.connection || nav.mozConnection || nav.webkitConnection;
      if (c) enriched.connection = dumpBomObject(c, 'NetworkInformation', { depth: 1, maxKeys: 40 }).properties;
    } catch {}

    try {
      if (nav.userAgentData) {
        enriched.userAgentData = {
          brands: nav.userAgentData.brands,
          mobile: nav.userAgentData.mobile,
          platform: nav.userAgentData.platform,
        };
        if (nav.userAgentData.getHighEntropyValues) {
          enriched.userAgentData.highEntropy = await nav.userAgentData.getHighEntropyValues([
            'architecture', 'bitness', 'model', 'platformVersion', 'fullVersionList', 'wow64', 'formFactors',
          ]);
        }
      }
    } catch (e) { enriched.userAgentDataError = String(e); }

    try {
      if (nav.userActivation) {
        enriched.userActivation = {
          hasBeenActive: nav.userActivation.hasBeenActive,
          isActive: nav.userActivation.isActive,
        };
      }
    } catch {}

    try {
      if (nav.devicePosture) enriched.devicePosture = { type: nav.devicePosture.type };
    } catch {}

    try {
      if (nav.mediaDevices?.enumerateDevices) {
        const devices = await nav.mediaDevices.enumerateDevices();
        enriched.mediaDevices = {
          count: devices.length,
          supportedConstraints: pfaSafeCall(() => nav.mediaDevices.getSupportedConstraints?.(), null),
          devices: devices.map((d) => ({
            kind: d.kind,
            deviceId: soft(d.deviceId, 40),
            groupId: soft(d.groupId, 40),
            label: soft(d.label, 80),
          })),
        };
      }
    } catch (e) { enriched.mediaDevicesError = String(e); }

    try {
      if (nav.storage) {
        enriched.storageManager = {
          estimate: await nav.storage.estimate?.(),
          persisted: await nav.storage.persisted?.(),
        };
      }
    } catch {}

    try {
      if (nav.getBattery) {
        const b = await nav.getBattery();
        enriched.battery = {
          charging: b.charging, chargingTime: b.chargingTime,
          dischargingTime: b.dischargingTime, level: b.level,
        };
      }
    } catch {}

    try {
      if (nav.getGamepads) {
        enriched.gamepads = [...(nav.getGamepads() || [])].filter(Boolean).map((g) => ({
          id: g.id, index: g.index, connected: g.connected, mapping: g.mapping,
          axes: g.axes?.length, buttons: g.buttons?.length,
        }));
      }
    } catch {}

    try {
      if (nav.locks?.query) enriched.locksQuery = await nav.locks.query();
    } catch {}

    try {
      if (nav.windowControlsOverlay) {
        enriched.windowControlsOverlay = {
          visible: nav.windowControlsOverlay.visible,
          titlebarAreaRect: pfaSafeCall(() => {
            const r = nav.windowControlsOverlay.getTitlebarAreaRect?.();
            return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
          }, null),
        };
      }
    } catch {}

    // Complete prototype-chain dump (every Navigator property MDN lists + engine extras)
    enriched.rawDump = dumpBomObject(nav, 'Navigator', { depth: 1, maxKeys: 300 });
    enriched.propertyCount = enriched.rawDump.propertyNames?.length || 0;
    enriched.methodCount = enriched.rawDump.methods?.length || 0;
    return enriched;
  }

  async function bomSnapshot() {
    const nav = navigator;

    let cookieEntries = [];
    try {
      cookieEntries = document.cookie.split(';').map((c) => {
        const i = c.indexOf('=');
        const name = (i >= 0 ? c.slice(0, i) : c).trim();
        const value = (i >= 0 ? c.slice(i + 1) : '').trim();
        return {
          name,
          len: value.length,
          preview: /token|auth|session|jwt/i.test(name) ? `[redacted len=${value.length}]` : soft(decodeURIComponent(value), 200),
        };
      }).filter((c) => c.name);
    } catch {}

    let cookieStoreEntries = null;
    try {
      if (window.cookieStore?.getAll) {
        cookieStoreEntries = (await cookieStore.getAll()).map((c) => ({
          name: c.name, domain: c.domain, path: c.path, expires: c.expires,
          sameSite: c.sameSite, secure: c.secure, partitioned: c.partitioned,
          valueLen: (c.value || '').length,
          valuePreview: /token|auth|session|jwt/i.test(c.name) ? '[redacted]' : soft(c.value, 160),
        }));
      }
    } catch {}

    const resources = (performance.getEntriesByType?.('resource') || []).map((r) => ({
      name: soft(r.name, 240),
      entryType: r.entryType,
      initiatorType: r.initiatorType,
      transferSize: r.transferSize,
      encodedBodySize: r.encodedBodySize,
      decodedBodySize: r.decodedBodySize,
      duration: Math.round(r.duration),
      startTime: Math.round(r.startTime),
      fetchStart: Math.round(r.fetchStart || 0),
      responseEnd: Math.round(r.responseEnd || 0),
      nextHopProtocol: r.nextHopProtocol,
      renderBlockingStatus: r.renderBlockingStatus,
      serverTiming: (r.serverTiming || []).map((s) => ({
        name: s.name, duration: s.duration, description: s.description,
      })),
    }));
    const byType = {};
    for (const r of resources) byType[r.initiatorType || 'other'] = (byType[r.initiatorType || 'other'] || 0) + 1;

    const navTiming = performance.getEntriesByType?.('navigation')?.[0];
    const paints = (performance.getEntriesByType?.('paint') || []).map((p) => ({
      name: p.name, startTime: Math.round(p.startTime),
    }));
    const marks = (performance.getEntriesByType?.('mark') || []).slice(-60).map((m) => ({
      name: m.name, startTime: Math.round(m.startTime),
    }));
    const measures = (performance.getEntriesByType?.('measure') || []).slice(-60).map((m) => ({
      name: m.name, duration: Math.round(m.duration), startTime: Math.round(m.startTime),
    }));

    let memory = null;
    try {
      if (performance.memory) {
        memory = {
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          usedJSHeapSize: performance.memory.usedJSHeapSize,
        };
      }
    } catch {}

    let indexedDBDatabases = [];
    try {
      if (indexedDB.databases) {
        indexedDBDatabases = (await indexedDB.databases())?.map((d) => ({ name: d.name, version: d.version })) || [];
      }
    } catch (e) { indexedDBDatabases = [{ error: String(e) }]; }

    let cacheNames = [];
    try { if (self.caches?.keys) cacheNames = await caches.keys(); } catch {}

    let serviceWorkers = [];
    if ('serviceWorker' in navigator) {
      serviceWorkers = [{ __skipped: 'ServiceWorkerContainer is not readable from a content script' }];
    }

    const permissionNames = [
      'notifications', 'geolocation', 'camera', 'microphone', 'clipboard-read', 'clipboard-write',
      'push', 'midi', 'payment-handler', 'idle-detection', 'periodic-background-sync',
      'background-sync', 'background-fetch', 'display-capture', 'window-management',
      'storage-access', 'top-level-storage-access', 'gyroscope', 'accelerometer',
      'magnetometer', 'ambient-light-sensor',
    ];
    const permissions = {};
    for (const name of permissionNames) {
      try {
        // eslint-disable-next-line no-await-in-loop
        permissions[name] = (await navigator.permissions.query({ name })).state;
      } catch { permissions[name] = 'unsupported'; }
    }

    const frames = [];
    try {
      for (let i = 0; i < window.frames.length; i++) {
        const f = window.frames[i];
        let frameInfo = { index: i, accessible: false };
        try {
          frameInfo = {
            index: i, accessible: true,
            href: soft(f.location.href, 200), origin: f.location.origin,
            title: soft(f.document?.title, 80), name: f.name || null,
          };
        } catch {
          try {
            const el = document.querySelectorAll('iframe')[i];
            frameInfo.src = soft(el?.src, 200);
            frameInfo.name = el?.name || null;
            frameInfo.sandbox = el?.sandbox?.toString() || null;
          } catch {}
        }
        frames.push(frameInfo);
      }
    } catch {}

    const windowApiNames = [
      'fetch', 'WebSocket', 'Worker', 'SharedWorker', 'BroadcastChannel', 'MessageChannel',
      'AbortController', 'Proxy', 'Reflect', 'requestIdleCallback', 'requestAnimationFrame',
      'matchMedia', 'getComputedStyle', 'getSelection', 'structuredClone', 'reportError',
      'queueMicrotask', 'caches', 'cookieStore', 'indexedDB', 'localStorage', 'sessionStorage',
      'crypto', 'trustedTypes', 'Notification', 'PaymentRequest', 'RTCPeerConnection',
      'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'PerformanceObserver',
      'ReportingObserver', 'CSS', 'customElements', 'speechSynthesis', 'SharedArrayBuffer',
      'Atomics', 'WebAssembly', 'OffscreenCanvas', 'createImageBitmap',
      'showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker', 'EyeDropper',
      'BarcodeDetector', 'scheduler',
    ];
    const apis = {};
    for (const name of windowApiNames) {
      try {
        const v = window[name];
        apis[name] = v == null ? false : typeof v === 'function' ? 'function' : typeof v;
      } catch { apis[name] = 'error'; }
    }
    apis.serviceWorker = 'serviceWorker' in navigator;
    apis.bluetooth = !!navigator.bluetooth;
    apis.usb = !!navigator.usb;
    apis.serial = !!navigator.serial;
    apis.hid = !!navigator.hid;
    apis.wakeLock = !!navigator.wakeLock;
    apis.webdriver = !!navigator.webdriver;
    apis.cryptoSubtle = !!crypto?.subtle;

    let storageEstimate = null;
    try { if (navigator.storage?.estimate) storageEstimate = await navigator.storage.estimate(); } catch {}

    const navigatorFull = await enrichNavigator(nav);
    const vv = window.visualViewport;

    const windowScalars = {};
    const windowKeys = [
      'name', 'closed', 'isSecureContext', 'crossOriginIsolated', 'origin', 'originAgentCluster',
      'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'screenX', 'screenY', 'screenLeft', 'screenTop',
      'scrollX', 'scrollY', 'pageXOffset', 'pageYOffset', 'devicePixelRatio', 'length', 'status',
      'opener', 'frameElement', 'parent', 'top', 'frames',
    ];
    for (const k of windowKeys) {
      try {
        const v = window[k];
        if (v === window || v === window.self) windowScalars[k] = { __ref: 'window' };
        else if (k === 'parent') windowScalars[k] = { __ref: window.parent === window ? 'window' : 'parent' };
        else if (k === 'top') windowScalars[k] = { __ref: window.top === window ? 'window' : 'top' };
        else if (k === 'frames') windowScalars[k] = { length: window.frames.length };
        else if (k === 'opener') windowScalars[k] = !!window.opener;
        else if (k === 'frameElement') {
          windowScalars[k] = window.frameElement ? {
            tag: window.frameElement.tagName, id: window.frameElement.id || null, src: soft(window.frameElement.src, 160),
          } : null;
        } else windowScalars[k] = serializeValue(v, 0);
      } catch (e) { windowScalars[k] = { __error: String(e.message || e) }; }
    }

    return {
      capturedAt: new Date().toISOString(),
      model: {
        refs: [
          'https://developer.mozilla.org/en-US/docs/Web/API/Navigator',
          'https://developer.mozilla.org/en-US/docs/Web/API/Window',
          'https://developer.mozilla.org/en-US/docs/Web/API/Screen',
          'https://developer.mozilla.org/en-US/docs/Web/API/Location',
          'https://developer.mozilla.org/en-US/docs/Web/API/History',
          'https://developer.mozilla.org/en-US/docs/Web/API/Performance_API',
          'BOM roots: window, navigator, screen, location, history, document, performance, visualViewport, storage',
        ],
      },
      navigator: navigatorFull,
      location: {
        href: location.href, origin: location.origin, protocol: location.protocol,
        host: location.host, hostname: location.hostname, port: location.port,
        pathname: location.pathname, search: location.search, hash: location.hash,
        username: location.username || null, password: location.password ? '[set]' : null,
        ancestorOrigins: pfaSafeCall(() => [...(location.ancestorOrigins || [])], []),
        rawDump: dumpBomObject(location, 'Location', { depth: 1, maxKeys: 40 }),
      },
      history: {
        length: history.length,
        stateType: typeof history.state,
        statePreview: soft(pfaSafeCall(() => JSON.stringify(history.state), String(history.state)), 600),
        scrollRestoration: history.scrollRestoration,
        rawDump: dumpBomObject(history, 'History', { depth: 1, maxKeys: 30 }),
      },
      screen: {
        width: screen.width, height: screen.height,
        availWidth: screen.availWidth, availHeight: screen.availHeight,
        availLeft: screen.availLeft, availTop: screen.availTop,
        colorDepth: screen.colorDepth, pixelDepth: screen.pixelDepth,
        isExtended: screen.isExtended,
        orientation: screen.orientation ? { type: screen.orientation.type, angle: screen.orientation.angle } : null,
        rawDump: dumpBomObject(screen, 'Screen', { depth: 2, maxKeys: 40 }),
      },
      visualViewport: vv ? {
        width: vv.width, height: vv.height, offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop,
        pageLeft: vv.pageLeft, pageTop: vv.pageTop, scale: vv.scale,
        rawDump: dumpBomObject(vv, 'VisualViewport', { depth: 1, maxKeys: 30 }),
      } : null,
      window: {
        ...windowScalars,
        parentIsSelf: window.parent === window,
        topIsSelf: window.top === window,
        framesLength: window.frames?.length ?? 0,
      },
      frames,
      document: {
        title: document.title, referrer: document.referrer, readyState: document.readyState,
        characterSet: document.characterSet, charset: document.charset, inputEncoding: document.inputEncoding,
        contentType: document.contentType, compatMode: document.compatMode, designMode: document.designMode,
        dir: document.dir, hidden: document.hidden, visibilityState: document.visibilityState,
        lastModified: document.lastModified, URL: document.URL, documentURI: document.documentURI,
        baseURI: document.baseURI, domain: document.domain,
        fullscreenEnabled: document.fullscreenEnabled, fullscreenElement: !!document.fullscreenElement,
        pictureInPictureEnabled: document.pictureInPictureEnabled,
        wasDiscarded: document.wasDiscarded, prerendering: document.prerendering,
        doctype: document.doctype ? {
          name: document.doctype.name, publicId: document.doctype.publicId, systemId: document.doctype.systemId,
        } : null,
        cookieLength: pfaSafeCall(() => document.cookie.length, -1),
        cookies: cookieEntries,
        cookieStore: cookieStoreEntries,
        hasFocus: document.hasFocus?.() ?? null,
        currentScript: document.currentScript?.src || null,
        activeElement: document.activeElement ? {
          tag: document.activeElement.tagName,
          id: document.activeElement.id || null,
          name: document.activeElement.name || null,
        } : null,
        scrollingElement: document.scrollingElement?.tagName || null,
        adoptedStyleSheetsCount: document.adoptedStyleSheets?.length ?? null,
        fontsStatus: pfaSafeCall(() => document.fonts?.status, null),
        fontsSize: pfaSafeCall(() => document.fonts?.size, null),
      },
      performance: {
        timeOrigin: performance.timeOrigin,
        now: Math.round(performance.now()),
        memory,
        navigation: navTiming ? {
          name: soft(navTiming.name, 200), type: navTiming.type, redirectCount: navTiming.redirectCount,
          transferSize: navTiming.transferSize, encodedBodySize: navTiming.encodedBodySize,
          decodedBodySize: navTiming.decodedBodySize,
          startTime: Math.round(navTiming.startTime),
          unloadEventStart: Math.round(navTiming.unloadEventStart || 0),
          unloadEventEnd: Math.round(navTiming.unloadEventEnd || 0),
          redirectStart: Math.round(navTiming.redirectStart || 0),
          redirectEnd: Math.round(navTiming.redirectEnd || 0),
          fetchStart: Math.round(navTiming.fetchStart || 0),
          domainLookupStart: Math.round(navTiming.domainLookupStart || 0),
          domainLookupEnd: Math.round(navTiming.domainLookupEnd || 0),
          connectStart: Math.round(navTiming.connectStart || 0),
          connectEnd: Math.round(navTiming.connectEnd || 0),
          secureConnectionStart: Math.round(navTiming.secureConnectionStart || 0),
          requestStart: Math.round(navTiming.requestStart || 0),
          responseStart: Math.round(navTiming.responseStart || 0),
          responseEnd: Math.round(navTiming.responseEnd || 0),
          domInteractive: Math.round(navTiming.domInteractive || 0),
          domContentLoadedEventStart: Math.round(navTiming.domContentLoadedEventStart || 0),
          domContentLoadedEventEnd: Math.round(navTiming.domContentLoadedEventEnd || 0),
          domComplete: Math.round(navTiming.domComplete || 0),
          loadEventStart: Math.round(navTiming.loadEventStart || 0),
          loadEventEnd: Math.round(navTiming.loadEventEnd || 0),
          duration: Math.round(navTiming.duration || 0),
          nextHopProtocol: navTiming.nextHopProtocol,
          deliveryType: navTiming.deliveryType,
          activationStart: navTiming.activationStart,
        } : null,
        paints, marks, measures,
        resourceCount: resources.length,
        resourcesByInitiator: byType,
        recentResources: resources.slice(-150),
        rawDump: dumpBomObject(performance, 'Performance', { depth: 1, maxKeys: 60 }),
      },
      timezone: {
        ...Intl.DateTimeFormat().resolvedOptions(),
        timeZoneOffsetMin: new Date().getTimezoneOffset(),
        dateString: new Date().toString(),
      },
      matchMedia: {
        'prefers-color-scheme: dark': pfaSafeCall(() => matchMedia('(prefers-color-scheme: dark)').matches, null),
        'prefers-color-scheme: light': pfaSafeCall(() => matchMedia('(prefers-color-scheme: light)').matches, null),
        'prefers-reduced-motion: reduce': pfaSafeCall(() => matchMedia('(prefers-reduced-motion: reduce)').matches, null),
        'prefers-contrast: more': pfaSafeCall(() => matchMedia('(prefers-contrast: more)').matches, null),
        'hover: hover': pfaSafeCall(() => matchMedia('(hover: hover)').matches, null),
        'pointer: fine': pfaSafeCall(() => matchMedia('(pointer: fine)').matches, null),
        'pointer: coarse': pfaSafeCall(() => matchMedia('(pointer: coarse)').matches, null),
        'display-mode: standalone': pfaSafeCall(() => matchMedia('(display-mode: standalone)').matches, null),
        'display-mode: browser': pfaSafeCall(() => matchMedia('(display-mode: browser)').matches, null),
        'any-hover: hover': pfaSafeCall(() => matchMedia('(any-hover: hover)').matches, null),
        'any-pointer: fine': pfaSafeCall(() => matchMedia('(any-pointer: fine)').matches, null),
        'prefers-reduced-data: reduce': pfaSafeCall(() => matchMedia('(prefers-reduced-data: reduce)').matches, null),
      },
      storage: {
        localStorage: storageDump(localStorage),
        sessionStorage: storageDump(sessionStorage),
        indexedDBDatabases,
        cacheNames,
        estimate: storageEstimate,
      },
      localStorage: storageDump(localStorage),
      sessionStorage: storageDump(sessionStorage),
      serviceWorkers,
      permissions,
      apis,
      console: {
        levels: ['log', 'info', 'warn', 'error', 'debug', 'table', 'dir', 'trace']
          .reduce((acc, k) => { acc[k] = typeof console[k] === 'function'; return acc; }, {}),
      },
      runtime: {
        hooked: !!window.__PFA_HOOKED__,
        watches: watchMap.size,
        networkEvents: state.network.length,
        sinkEvents: state.sinks.length,
        autoSources: state.autoSources.length,
        watchHits: state.watchHits.length,
        postMessages: state.postMessages.length,
        websockets: state.websockets.length,
        startedAt: state.startedAt,
        uptimeMs: Date.now() - state.startedAt,
        navigatorPropertyCount: navigatorFull.propertyCount,
        navigatorMethodCount: navigatorFull.methodCount,
      },
    };
  }

  return { bomSnapshot, dumpBomObject };
}
