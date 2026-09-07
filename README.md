# DOM Hacker

Chrome MV3 extension for **client-side taint hunting**: poison sources with canaries, wrap sinks, and classify hits (`xss`, `redirect`, `cookie`, `websocket`, …). Also pairs **HTTP** and **WebSocket** traffic and correlates **API → DOM** effects.

**Repository:** https://github.com/MHaghighian/Page-Flow-Analyzer

Work lives in the **Chrome Side Panel**. The popup is a thin status + Hunt toggle.

Internal message types still use the `PFA_*` prefix from the Page Flow Analyzer cutover.

---

## Features

- **Collect scope**: **This tab**, **This origin**, or **All** http(s) pages
- **Hunt** (off by default; hard-refresh after enabling): poisons catalog sources with per-source canaries (`DhCnRy…`) and wraps catalog sinks
- **Findings**: SOURCE → SINK with context, encoding, provenance, stack, cssPath, attack class, severity
- **Effects**: fetch/XHR responses linked to MutationObserver nodes (time window + string match)
- **Network**: one row per HTTP exchange (request + response); hide static/telemetry by default
- **Messages**: postMessage (origin on every row) and WebSocket frames grouped by connection URL
- **Token traces**: JWT/UUID/auth harvest (unchanged)
- **DOM / BOM** inventories
- Per-tab **search** (`/` to focus, Esc to clear)
- On-page **DH** FAB for optional Pick

---

## Install

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this folder
4. Click the extension icon → Side Panel opens
5. Pin **This tab** (or origin / all), then hard-refresh (`Ctrl+Shift+R`)

After every code change: **Reload** the extension, then hard-refresh the page.

---

## How to use

| Action | How |
|--------|-----|
| Open UI | Click extension icon (Side Panel) |
| Collect this tab | **This tab** |
| Hunt DOM taint | **Hunt**, then hard-refresh |
| Canary hits | Tab **findings** (filter by class chips) |
| API rendered into DOM | Tab **effects** → highlight / open in network |
| Packed HTTP | Tab **network** |
| postMessage + WS | Tab **messages** |
| Token SOURCE→SINK | Tab **traces** |

Empty findings with Hunt off is expected. Hunt on but not reloaded shows a banner.

---

## Taint model

Every finding is `source → sink` with a canary. Attack class is derived from the sink (PortSwigger DOM-based classes). Hunt does **not** rewrite the URL bar — getter poisoning is the canary.

Catalog: `content/xss-catalog.js` (DOM Invader ranks + PortSwigger lists). jQuery hooks apply only if `$` / `jQuery` exists.

Out of scope for this phase: auto-exploit, postMessage origin-spoof PoCs, prototype pollution, DOM clobbering, CSP / Trusted Types / service-worker takeover, WS protocol fuzzing.

---

## Project layout

```
Page-Flow-Analyzer/
├── manifest.json
├── background.js              # Scope, inject, hunt flag, highlight relay
├── content/
│   ├── xss-catalog.js         # Sources, sinks, ranks, attackClass
│   ├── main-hook.js           # MAIN world hooks (document_start)
│   ├── hunt-boot.js           # Isolated: tell MAIN hunt flag early
│   ├── bom-collect.js
│   └── isolated.js            # Findings, effects, pairing, FAB
├── ui/
│   ├── fonts/                 # Inter + JetBrains Mono (bundled)
│   ├── sidepanel.html|css|js
│   └── popup.*
├── icons/
└── README.md
```

---

## Permissions

| Permission | Why |
|------------|-----|
| `sidePanel` | Resizable browser UI |
| `tabs` / `activeTab` / `scripting` | Inject hooks into in-scope pages |
| `webNavigation` | Re-attach when a pinned tab navigates |
| `storage` | Collect scope + Hunt flag |
| `downloads` | Export JSON |
| `<all_urls>` | Analyze sites you explicitly scope to |

---

## Tips

- If the Side Panel is empty: pin a collect scope, hard-refresh, then **Refresh**.
- Hunt is invasive (canaries on getters / storage / responses). Use only on systems you are authorized to analyze.
- Default collect scope is **This tab**.

---

## License

Internal / research tooling — use only on systems you are authorized to analyze.
