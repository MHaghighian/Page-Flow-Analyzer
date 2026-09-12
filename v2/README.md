# Flowscope

A Chrome MV3 extension for **client-side page analysis**, shown in the browser **side panel**. It is built for web security testing and recon: it maps what a page fetches, what it postMessages, which dangerous DOM sinks it touches, how data flows from sources into sinks, and which DOM changes an API response triggers.

Flowscope is **passive by default** — it observes and never modifies the page. An active, opt-in **Hunt** mode (canary taint tracking) can be turned on when you want confirmed source→sink proof; it is off by default.

> This is a clean-slate rewrite. It is a separate project and does not replace the older *Page Flow Analyzer* / *DOM Hacker* work.

---

## Features

- **Scope selector** — choose what to watch, following the active tab:
  - **This tab** — the tab you are looking at.
  - **This origin** — every open tab sharing the active tab's origin.
  - **All** — every open http(s) tab.
  - Live connection status per tab (resolved by pinging the content script on demand).
- **Network** — passive `fetch` / `XHR` capture: method, status, host, path, timing, request/response headers (collapsible), and bodies (textual, non-static, capped). Hide-noise toggle (static + telemetry), URL filter, pin-to-top, per-request detail.
- **Messages** — `postMessage` (in/out, with origin) and `WebSocket` (open, sent/received frames, close), grouped by connection, with full payload on expand.
- **Sinks** — dangerous DOM operations as they happen: `innerHTML` / `outerHTML` / `insertAdjacentHTML`, `document.write(ln)`, `setAttribute(on*|href|src|srcdoc|action|formaction|data)`, `location.assign|replace|href`, `window.open`, `setTimeout|setInterval(string)`. Each with value, element CSS path, and JS stack.
- **Traces** — passive source→sink correlation by string match. Sources harvested: URL params, hash, cookies, localStorage/sessionStorage, `window.name`, plus token-like values from responses and incoming postMessage. A trace means a source value reached a sink / request / message unmodified. High-entropy values only, to limit coincidental matches.
- **Findings** — Hunt results (opt-in). Confirmed source→sink flows with attack class and severity.
- **Effects** — DOM changes triggered by an AJAX/XHR response. Every non-static response opens a short time window; any DOM mutation inside it is attributed to that response (full coverage). A value match against the response body is a per-node confidence flag, not a filter. Includes a **Highlight on page** button that flashes the changed node.
- **Inventory** — DOM snapshot (element/form/iframe/script/link counts, inline `on*` handlers, meta tags, framework hints) and BOM snapshot (`navigator`, `location`, `screen`, feature detection, storage, cookies).
- **Export JSON** — two buttons:
  - **Export key** — security signal only: `findings`, `traces`, `effects`, `sinks`.
  - **Export all** — adds `network`, `messages`, `inventory`.
  - Intended to feed an external agentic pentest bot for analysis.

---

## Hunt mode (opt-in, active)

Passive Traces prove co-occurrence, not causation, so short or common values can match by chance. Hunt removes that ambiguity: it writes a unique canary token into the writable sources and reports when that exact token reaches a sink, request, message, or response.

- Poisoned sources: `location.hash`, `location.search`, `window.name`, `document.cookie` (getter interception is impossible in modern browsers — Location is non-configurable — so Flowscope writes the canary into the real value; no page reload).
- The canary is visible in the URL. This is expected.
- Enable → **hard-refresh** the in-scope tabs. The flag is persisted in `localStorage` so the canary is written at `document_start`, before the page reads the source.

> **Warning:** Hunt visibly modifies the URL (hash + search), `window.name`, and cookies, and can trigger `hashchange` / router logic. It is off by default. Use it only on systems you are authorized to test. Turn it off and hard-refresh to revert.

---

## Install (load unpacked)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `Flowscope/` folder
4. Click the Flowscope icon → the side panel opens
5. Open a normal `https://` page and **hard-refresh** (`Ctrl+Shift+R`) so the hooks inject at `document_start`

After any code change: **Reload** the extension on `chrome://extensions`, then hard-refresh the page.

---

## Architecture

```
Flowscope/
├── manifest.json
├── background.js          # service worker: scope resolution, message routing, fan-out, export
├── content/
│   ├── main-hook.js       # MAIN world, document_start: passive hooks (fetch/XHR/postMessage/
│   │                      #   WebSocket/DOM sinks), traces, Hunt canary, effects observer
│   └── collector.js       # ISOLATED world, document_start: buffers events, serves the panel,
│                          #   builds DOM/BOM inventory, highlights nodes
├── ui/
│   └── sidepanel.html|css|js
└── icons/
```

**Data path.** The MAIN-world hook wraps native APIs (passively — it calls through and reads only clones) and emits records over `window.postMessage` using a captured native reference, so it can never recurse on its own frames. The ISOLATED collector buffers those records and answers the side panel. The side panel talks only to the background worker, which resolves the current scope, fans requests out to the in-scope tabs, merges the results, and returns them. The panel polls every 2s while visible and reacts immediately to tab activation/navigation.

**Message prefix:** `FS_*` (runtime messages), `__fs*` markers on the in-page bridge.

---

## Limitations

- **Top frame only** — requests, messages, sinks, and effects in iframes are not captured yet.
- **Network capture is `fetch`/`XHR` only** — browser-initiated loads (the document, CSS, JS, images, fonts) do not appear; those are the DevTools layer. A `chrome.webRequest`-based full-capture layer is a possible future addition.
- **Traces are exact-substring** — encoded/transformed flows are missed; that is what Hunt is for.
- **Effects window is 1800ms** — renders that land after the window are missed (tunable).
- Capture starts at page load; requests before a hard-refresh are not seen.

---

## Permissions

| Permission | Why |
|------------|-----|
| `sidePanel` | The UI lives in the side panel |
| `storage` | Persist scope mode and the Hunt flag |
| `tabs` / `activeTab` / `scripting` | Resolve scope and reach content scripts |
| `<all_urls>` (host permission) | Analyze the sites you scope to |

---

## License

Internal / research tooling — use only on systems you are authorized to analyze.
