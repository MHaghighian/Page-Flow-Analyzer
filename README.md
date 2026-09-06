# Page Flow Analyzer

Chrome MV3 extension that automatically tracks **SOURCE → TRANSIT → SINK** data flows on any page, with rich **DOM** and **BOM** inventories.

**Repository:** https://github.com/MHaghighian/Page-Flow-Analyzer

UI is English-only and lives in the **Chrome Side Panel** (resizable; does not cover the page).

**Version:** 3.3.0

---

## Features

- **Auto harvest** of interesting values (JWT, scoped tokens like `FD.…`, UUID, auth query params, storage keys, …)
- **SOURCE → SINK traces** for each watched value (which channel introduced it, which sink consumed it)
- **Network** hooks: `fetch` / XHR (request + response), WebSocket
- **Storage** hooks: `localStorage` / `sessionStorage`
- **Messaging**: `postMessage` in/out
- **DOM sinks** (sampled for performance): `innerHTML`, `setAttribute(href|src|on*)`, `document.write`, `location.assign/replace`
- **Full BOM dump** (MDN-oriented): complete `navigator` (including prototype-chain `rawDump`), `location`, `history`, `screen`, `visualViewport`, `window`, `document`, `performance`, storage, permissions, API presence
- **Rich DOM inventory**: counts, forms, iframes, scripts, styles, inputs, links, media, framework hints, dangerous handlers
- **Export JSON** for offline analysis
- Optional **Pick value** (page FAB or Side Panel button)

---

## Install

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this folder:
   ```
   page-flow-analyzer/
   ```
4. Open any site and **hard-refresh** (`Ctrl+Shift+R`) so content scripts inject
5. Click the extension icon → Side Panel opens  
   Drag the panel edge to resize

After every code change: **Reload** the extension, then hard-refresh the page.

---

## How to use

| Action | How |
|--------|-----|
| Open UI | Click extension icon (Side Panel) |
| See SOURCE→SINK | Tab **traces** |
| Host traffic map | Tab **flows** |
| Live events | **network** / **sources** / **sinks** / **storage** / **messages** |
| Browser environment | Tab **bom** (check `navigator` + `navigator.rawDump`) |
| Page structure | Tab **dom** |
| Manual watch | **Pick value** or green **PFA** button on page |
| Dump everything | **Export** |

Auto-refresh runs in the Side Panel. Prefer **Refresh** after heavy navigation.

---

## Source → Sink model

Inspired by:

- [PortSwigger – DOM XSS sources & sinks](https://portswigger.net/web-security/cross-site-scripting/dom-based)
- Taintaru-style runtime watches
- Super-app research (scoped tokens / SSO / Frame Bridge)

### Auto SOURCES

`location.href|search|hash`, `document.referrer`, `document.cookie`, `window.name`, storage reads, form inputs, network responses, `postMessage` in, WebSocket in.

### Auto SINKS

`fetch`/`XHR` requests, `storage.setItem`, `postMessage` out, WebSocket out, DOM HTML sinks (sampled), `setAttribute`, `location.assign` / `replace`.

### Traces tab

For each value:

- **chain** — ordered path of channels  
  e.g. `source.localStorage → network.request.url → sink.network.request`
- **pairs** — explicit `SOURCE chip → SINK chip` with details
- Colors: green = SOURCE, yellow = TRANSIT, blue = SINK

---

## Project layout

```
page-flow-analyzer/
├── manifest.json              # MV3 manifest
├── background.js              # Side panel + report relay
├── content/
│   ├── main-hook.js           # MAIN world hooks (document_start)
│   ├── bom-collect.js         # Full BOM / navigator collector
│   └── isolated.js            # Watches, traces, DOM inventory, FAB
├── ui/
│   ├── sidepanel.html|css|js  # Main UI (Side Panel)
│   └── popup.*                # Legacy helpers (optional)
├── icons/
└── README.md
```

---

## Permissions

| Permission | Why |
|------------|-----|
| `sidePanel` | Resizable browser UI |
| `tabs` / `activeTab` / `scripting` | Talk to the active page |
| `storage` | Extension state |
| `downloads` | Export JSON |
| `<all_urls>` | Analyze any site you open |

Hooks are rate-limited and DOM sink logging is sampled so SPAs (e.g. Angular) stay responsive.

---

## Tips

- If the Side Panel is empty: hard-refresh the tab, then **Refresh** in the panel.
- Sensitive storage keys are redacted in previews (`[redacted len=…]`).
- Only a small **PFA** FAB stays on the page; the big overlay panel was removed on purpose.
- Snapp example: open `app.snapp.taxi` while logged in and watch tokens travel under **traces** / **flows**.

---

## License

Internal / research tooling — use only on systems you are authorized to analyze.
