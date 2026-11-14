# Libraries window: plan

**Status:** agreed 2026-11-14 (rules move to Libraries; scopes as in §2). Phase L1 is implemented.
**Reference:** production has **no** Libraries window. Everything listed here that exists in production comes from its Configuration window (`src/App.jsx` ~2190-2240 rules UI, ~17491 upload, ~17594 remove, `checkIsBuiltinRule` ~1069) and is moved, not dropped.

---

## 1. Purpose and boundaries

| Window | Answers | Owns |
|---|---|---|
| **Libraries** | *What exists and is available* | Rule sets, graph rendering and layout engines, chart engine, icon sets, report templates |
| **Configuration** | *What this session/domain actively uses* | Active rule (picker only, linking to Libraries), connections, tools, column mapping, classified entities, detection sensitivity (thresholds), domain |
| **Settings** | *Account and people* | Users, service accounts, profile, vigilance |

Rules:
- **One place per feature.** A rule is uploaded and removed in Libraries only. Configuration selects which one is active.
- **"Adjusting the libraries the system uses" means choosing among what the app ships or what the backend stores.** No third-party code is ever loaded at runtime.
- **Every setting states its scope** (§2), and the scope shows as a badge on its card.

## 2. Scopes

| Scope | Stored in | Who changes it | Examples |
|---|---|---|---|
| **System** | Backend (session configuration today; see L-B2) | Needs `config:write` | Rule sets, report templates, icon sets, "GPU rendering allowed" policy |
| **Personal** | This user's preferences (L-B1); until then `localStorage` keyed by user | The user | Default layout, visible-node default, labels, physics, chart colour schema |
| **Device** | This browser (`localStorage`) | The user, on this machine | GPU (WebGL) graph rendering |

**Precedence:** System policy limits what is allowed. Personal picks within it. Device decides only what depends on the hardware.

Example: GPU rendering is used only if the system allows it, this device is capable (graph-chart-plan §3.9), **and** the user switched it on here.

## 3. Sections of the window

| Section | Scope | Content | Phase |
|---|---|---|---|
| **Rules** | System | Loaded rules with Built-in / Custom badges and the active one marked, with a filter; upload a rule (JSON + name, with the template link); remove a rule (confirm). Viewing needs `config:read`; changes need `config:write`. | **L1 (done)** |
| Rules: catalog per domain | System | What each rule does, per domain (`/api/v1/rules/catalog`). Its response shape is unverified, so it waits for L-B3. | L2 |
| **Graph rendering** | Device (+ System policy) | GPU switch, capability status (capable / not capable / unknown) with **Check again**, and why it is off (device, policy or not capable) | L2, with graph G1 |
| **Graph defaults** | Personal | Default layout, visible-node limit, labels / titles, physics, edge weight | L2, with G1–G2 |
| **Charts** | Personal | Default colour schema, full graph vs visible view for metrics | L3, with G5 |
| **Icon sets** | System | Built-in `graph_icons`, later uploaded sets | L3, with G3 |
| **Report templates** | System | Evidence report template (production layout); later variants | L3, with G4 |
| **About** | n/a | Bundled engines and versions (graph renderer, layout, chart, PDF) | L2 |

Entry points: the launcher's **Libraries**, the Source window's "Rules library" link (already there), and **Manage rules** next to the Configuration window's active-rule picker.

## 4. Implementation
- **`features/libraries/components/LibrariesWindowBody.jsx`:** the window shell, sections as tabs (remembered in window metadata, like Configuration).
- **`features/libraries/components/RulesLibraryPanel.jsx`:** the moved rules UI. It uses the same `/configuration` upload / `remove_rule` requests as production (`services/configurationApi.js` `uploadRule` / `removeRule`), so the backend is unchanged. After each change it updates the session configuration, so the Configuration picker and the Source "Rule to apply" list update at once.
- **`shared/libraries/librarySettings.js` (L2):** a registry `{ key, scope, default, permission, description }` plus a store per scope (`useSyncExternalStore`). Windows read settings through `useLibrarySetting(key)`, and the Graph window reads its renderer and defaults from here.
- **Sign-out** clears personal settings cached for the user (`clearWorkspaceSessionData`). Device settings stay.

## 5. Backend (no change needed for L1)
- **L-B1 (L2):** per-user preferences, e.g. `GET/PUT /api/v1/me/preferences` (JSON, size-capped), so personal settings follow the user across machines. Until it exists, they stay in this browser.
- **L-B2 (L2):** system policies inside the session configuration (`graph_gpu_allowed: true|false`, default true), saved like other configuration keys with `config:write`.
- **L-B3 (optional):** `/api/v1/rules/catalog?format=full` with each rule's definition (conditions, domain, built-in flag), so the Rules section can show what a rule does, not only its name.
- **L-B4 (L3):** storage for uploaded icon sets and report templates.

## 6. Phases
- **L1 (done):** the Libraries window with the Rules section. Rule upload and remove moved out of Configuration; the active-rule picker stays there with a **Manage rules** link.
- **L2:** settings registry and stores; Graph rendering (GPU), Graph defaults and About, delivered with graph phase G1.
- **L3:** Charts, Icon sets and Report templates, delivered with G3 / G4 / G5.
