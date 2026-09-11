# Flowscope

A Chrome MV3 extension for **client-side page analysis**, shown in the browser **side panel**.

Flowscope is being built **incrementally**, one small shippable slice at a time.
It is **passive by default** — it observes; it does not modify the page. An active,
opt-in **Hunt** mode (canary taint hunting) is planned for a later slice and will always
be off by default.

> Separate, clean-slate project. It does not replace the older *Page Flow Analyzer* /
> *DOM Hacker* work, which stays as reference.

## Status — Slice 1: skeleton

Plumbing only, **no page instrumentation yet**:

- Toolbar icon opens the side panel.
- A content script announces its presence on http(s) pages.
- The side panel can **pin** the active tab and shows its title / URL and a
  **connection** status (connected / pinned-waiting / not pinned).

## Install (load unpacked)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this folder (`Flowscope/`)
4. Click the Flowscope icon → the side panel opens
5. Open a normal `https://` page, click **Pin this tab**, then hard-refresh (`Ctrl+Shift+R`)

After any code change: **Reload** the extension on `chrome://extensions`, then hard-refresh the page.

## Layout

```
Flowscope/
├── manifest.json
├── background.js          # service worker: pin + connection state, message routing
├── content/
│   └── collector.js       # announces presence; no hooks yet
├── ui/
│   ├── sidepanel.html|css|js
└── icons/
```

## Roadmap

1. **Skeleton** ✅ (this)
2. Scope: this tab / origin / all
3. Network (fetch / XHR request + response)
4. Messages (postMessage + WebSocket)
5. Storage + auto-harvest of interesting values
6. Source → sink traces
7. DOM inventory
8. BOM inventory
9. API → DOM effects
10. Polish: export, search, highlight, on-page pick
11. **Hunt** (opt-in, off by default): canaries, sink wrapping, findings
