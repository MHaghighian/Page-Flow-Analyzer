(() => {
  try {
    globalThis.__DH_EARLY__ = globalThis.__DH_EARLY__ || [];
    const on = (e) => {
      if (e.data?.source === 'pfa-main-hook') globalThis.__DH_EARLY__.push(e.data);
    };
    globalThis.__DH_EARLY_ON__ = on;
    window.addEventListener('message', on);
    chrome.storage.local.get({ huntEnabled: false }, (r) => {
      try {
        if (r.huntEnabled) sessionStorage.setItem('__DH_HUNT__', '1');
        else sessionStorage.removeItem('__DH_HUNT__');
      } catch {}
      try {
        window.postMessage({
          source: 'pfa-isolated',
          cmd: 'setXssHunt',
          enabled: !!r.huntEnabled,
        }, '*');
      } catch {}
    });
  } catch {}
})();
