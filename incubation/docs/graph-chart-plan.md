# Graph and Chart windows: implementation plan (no iframes)

**Status:** proposal for review. **Replaces** Phase 2 step 6 of `analysis-results-plan.md`.
**Reference:** the deployed production app, `src/App.jsx` (A:) and `public/temp_placeholders/` (graphs_basic.html = GB, graphs_adjuster.js = GA, charts_basic.html / charts_adjuster.js = CB/CA, graph_reports.* = GR). The full feature inventory, with line refs, was taken on 2026-11-14 and is summarised in §2. **Nothing production does may be dropped without a decision recorded in §9.**

---

## 1. Why not iframes

Production renders the graph inside same-origin iframes (about 11 700 lines of vanilla JS in GB/GA) and drives them over `postMessage`. That costs us:

| Problem | Where |
|---|---|
| State held three times (window state, parent maps, iframe globals); settings are a fragile 15-element positional array | A:11119, A:39, GA `window.currentSettings` |
| No message envelope: no ids, no correlation, outbound `targetOrigin "*"`, inbound origin `"null"` accepted | A:415-440, A:757-771 |
| Races patched with timers: `setTimeout(150)` for Source → Graph link, `setTimeout 0` for the evidence open, 30 s readiness wait, a 6 s evidence report "success" whatever happens | A:10087, A:14303, A:13627, A:18566 |
| The real graph frame and every hidden report frame run **without a sandbox**, because GA reads `window.parent.document` | A:8778, GA:3046 |
| Each chunk poll re-sends the **whole** accumulated graph by structured clone; the iframe de-duplicates with `JSON.stringify` per node | A:13828, GA:8364 |
| Unpinned CDN libraries (`unpkg.com/vis-network` latest, `jsdelivr echarts` latest) with a `document.write` fallback; cache-busting query hacks | GB:6-12, CB:7, A:8700 |
| Protocol drift: `all_property_keys` has no handler; `graph_physics {enabled:true}` is read as "off"; `graph_alerts` / `pinned_evidence_update` unhandled; a stray `alert("new:")` | A:14453, A:13766, GA:6120, A:14158 |
| Theme, CDR/NBE wording and design tokens re-implemented inside the frame; the theme editor cannot reach it | GB:1433-1559 |

**Decision:** the graph becomes ordinary React code in the app bundle. Heavy work (layouts, analytics) runs in **Web Workers**: no DOM, no `postMessage` to documents, typed messages, same origin. The renderer is a library component that draws into a `<canvas>` owned by the window.

---

## 2. Production inventory (what must exist)

### 2.1 Ways a graph opens (all kept)
1. **Launcher "New Graph"** (`graph:create`). Opens an empty graph showing the placeholder.
2. **Source window "Open Graph"** after a stream starts, then links it to the source session.
3. **Graph link form** to link or unlink a Source session: `POST /graph_link {id:"link"|"unlink", source_id, graph_window_id}`. Only allowed while that source is streaming (A:679, A:16607-16848).
4. **Tasks "Show graph"** (already in incubation; opens with `metadata {taskId, graphLinkSource, graphLinkAction}`).
5. **Reports "Show graph"**: `POST /get_graph {id:"evidence", trace_id, source_id, report_id?, external_reference_id?}`, using the evidence cache that already exists (`features/reports/lib/evidenceGraphs.js`).
6. **STR report socket event** `str_report_link_analysis`. This can wait for `notification {code:"str_report_prepare_receiver"}`, then links the analysis session and applies its `socket_emit` list (A:12188-12240, A:13340-13453). Only `str_report_*` and all-digit session ids are accepted.
7. **External header trigger** `postMessage {linkx_header_trigger: open_graph_window}`, accepted only from an origin allow-list (`VITE_HEADER_ALLOWED_ORIGINS`) (A:12812-12867).
8. **Hidden renderer for the evidence report PDF** (A:18596-18656). Production uses a hidden iframe; we replace it with an offscreen renderer (§3.6).

### 2.2 Data
- **Fetch:** `POST /get_graph` with `{id:"relationship", source_id, relationship}` (relationship `[a-zA-Z0-9_.:-]` or `*`) or the evidence body above.
- **Queued jobs:** poll `GET {poll_url | /jobs/<id>}?include_chunks=1&after_event_id=N` every 1 s for up to 120 s. Each poll returns `results.chunks[] {event_id, nodes[], edges[]}`, the cursor `next_chunk_after_event_id`, and the totals `total_nodes / total_edges / chunk_count`.
- **Live status over the socket:** `graph_status_subscribe` / `_unsubscribe {session_id}`, then the `status` event `{type: session_status | metadata | relationships | error, data, session_id}`.
  - **Relationships** are the chips `{id, type, bgcolor, textcolor}`.
  - **Metadata and summary** feed the "session info" card shown while linked.
  - **Nodes and edges are never pushed.** The user picks a relationship (or `*`), which triggers a fetch.
- **Node and edge styling comes from the backend payload** (`color, shape, image, iconPath, node_identity`). Edge semantics come from `edge_semantic`, `financial_flow` and `directed_display`, and from rule labels (GB:1726-1755, GA:2899-2967).

### 2.3 Graph window UI (all kept)
- **Title bar:** custom title, maximise, close.
- **Sidebar:**
  - New (empty graph)
  - Link / unlink
  - Upload (.json / .html)
  - Save (disabled in production)
  - Snapshot (PNG)
  - Print
  - Reset
  - Export: HTML, JSON, Generate report
- **Canvas toolbar:** Undo, Fit, Redo.
- **Split panel** (draggable; top part 75 %, between 5 % and 90 %), with three tabs:
  - **Filters:**
    - keyword search, with the expression syntax: comparisons and ranges, e.g. `amount>1000`, `10..20`
    - "include linked nodes"
    - which property keys to search
    - result counts
  - **Infos:** properties of the selected node, with CDR-aware labels.
  - **Settings:**
    - performance mode
    - limit by key, sort direction, range `{min, max}` (default 25, maximum 100 000, warning above 300)
    - label group and label-by key
    - edge weight (off / default / by key)
    - titles, labels, physics
    - layout: concentric (default), hierarchical, layered, circle, star, radial, grid, spiral
    - direction UD / LR, sort directed / hubsize, layer mode, layer key
- **Bottom panel "Graph Relationships":** a `*` chip plus one coloured chip per relationship.
- **On the canvas:**
  - Click a node: adjust box with colour, size, shape, icon album or upload, label and note.
  - Click an edge: label, colour, style, width.
  - Double-click: expand a hidden neighbour; on an OLE node, open the attachment.
  - Right-click menu:
    - **Authoring:** add node, label, comment, text block, event frame, theme line, OLE object.
    - **Editing:** copy and paste (synced across tabs), link / unlink, group / ungroup, merge (with a property prompt), expand / collapse a neighbourhood.
    - **Analysis:**
      - shortest path / all paths (directed, weighted, theme-line options)
      - 5-degree traversal
      - cut points
      - communities
      - visualise by degree or property
    - **Views and evidence:**
      - saved views (30, scoped by graph fingerprint)
      - filter elements by annotation
      - pinned evidence (300)
    - **Alerts and display:**
      - alert scan, with configurable high-degree and heavy-edge rules
      - edge bundling
      - bring to front, delete
- **Overlays:**
  - Graph Alerts panel: draggable, with "name by" and rescan; opens on its own when something is flagged.
  - Semantic edge legend (CDR or NBE wording).
  - Progress overlay.
  - Undo history: 50 steps, for graphs up to 4 500 elements.

### 2.4 Chart window
- **Production state:** unreachable in production (launcher commented out at A:984). Its body never renders `charts_basic.html`.
- **What the code intends:**
  - It links to a Graph window by id and receives that graph's visible nodes and edges (`network_components`), plus selection updates.
  - It draws ECharts cards: bar, line, scatter, radar and dual-bar, each with a colour schema (10 schemas), maximise, close and a zoom slider.
  - Snapshot, print, reset.
- **Metrics offered:**
  - **Global:** Assortativity, Reciprocity, Global, Cohesion, Temporal.
  - **Node:** Degree, In/Out, Betweenness, Closeness, Eigenvector, Katz, PageRank, Clustering, Local Eccentricity, HITS, Constraint, Ego.
  - **Edge:** Edge Betweenness, Weight, Embeddedness, Similarity.
- **Computed for real:** only Degree, In/Out, Ego and the N / E / density part of Global.
- **Not real:** 32 values are `Math.random()`, and 5 metrics have no implementation at all (CA:149-257, 370-397).

### 2.5 Evidence report PDF
- **Trigger:** Reports "Download report".
- **Graph:** the evidence graph, keeping the top 100 nodes by degree, in a concentric layout with labels and no physics.
- **Report data** (`buildGraphReportData`):
  - counts, density and average degree
  - relationship-type counts
  - `node_identity` distribution
  - top 8 nodes by degree
  - report info
  - a snapshot
- **Template sections:**
  - Summary
  - Evidence Information
  - Graph Snapshot
  - Key Findings
  - Relationship Breakdown
  - Entity Distribution
  - Priority Entities
  - Investigation Summary
  - Investigator Remark and signature
- **File:** single A4 page, `LinkxInvestigation_report_<ts>.pdf`.

---

## 3. Target architecture

```
features/graph/
  lib/graphStore.js        one store per Graph window id (module Map, like streamLogs.js):
                           graphology instance = the FULL graph; visible-view selector;
                           undo/redo; subscribe/getSnapshot for useSyncExternalStore
  lib/graphSettings.js     typed settings object + defaults + prod 15-array import/export
  lib/graphStyle.js        backend payload + edge semantics + highlights -> render attributes,
                           colours from theme tokens (no hard-coded palette)
  lib/graphQuery.js        search expressions, limit/sort/range window, label-by, weights
  services/graphFetch.js   /get_graph + chunked job polling (extends services/graphApi.js):
                           APPENDS only new chunks, edge identity keeps parallel edges
  services/graphStatus.js  ref-counted graph_status_subscribe per session, `status` events,
                           relationships/metadata per session (survives window unmounts)
  workers/layout.worker.js     ForceAtlas2 / concentric / circle / grid / spiral / star /
                               radial; hierarchical & layered via ELK (elkjs)
  workers/analytics.worker.js  paths, traversal, cut points, communities (Louvain),
                               alert rules, all chart metrics
  components/GraphWindowBody.jsx   window shell, split panel, tabs, relationships bar
  components/GraphCanvas.jsx       renderer wrapper (only file that knows the library)
  components/GraphContextMenu.jsx, NodeEditor.jsx, EdgeEditor.jsx, AlertsPanel.jsx …
features/chart/
  components/ChartWindowBody.jsx   ECharts cards (tree-shaken echarts/core), linked graph
  lib/chartMetrics.js              metric requests -> analytics worker
features/reports/lib/evidenceReport.js   evidence PDF without any DOM frame (§3.6)
```

### 3.1 One source of truth
- **The store holds the full graph:** each Graph window's store keeps a **graphology** graph with every fetched node and edge (production's `FULL_GRAPH`). The renderer gets the **visible view** (limit, sort, range, filters, expansions), computed by a pure selector. Production keeps the same split (`VISIBLE_STATE`), but in globals.
- **Window metadata keeps only small serialisable state:** settings, selected tab, link (`graphLinkSource`, `taskId`, `evidence.traceId`), custom title. The graph data lives in the store, like stream logs, so switching docked tabs never refetches or re-lays out.
- **Settings become a typed object**, e.g. `{limit:{key, sort, min, max}, labels:{show, group, byKey}, edges:{weight}, physics, layout:{type, direction, sortMethod, layerMode, layerKey}, performance}`. Importers and exporters map production's 15-element array, so old JSON exports and saved views still load.

### 3.2 Renderer: decided by a spike (G0), recommended **Cytoscape.js (canvas by default, WebGL opt-in) + graphology**

> **Product rule (2026-11-14):** GPU (WebGL) rendering is **off by default**. Many analysts' machines have little or no dedicated GPU memory. The default renderer must therefore be the CPU **canvas** path. WebGL is an opt-in, offered to users whose device can use it (§3.9), and switched in the **Libraries window** (§3.10).
>
> This favours a library that has **both** modes behind one styling model. Cytoscape.js draws on canvas and has a WebGL rendering mode (experimental since 3.31; the spike must confirm it is usable), so switching is a setting, not a second renderer. sigma.js is WebGL-only: choosing it would mean writing and maintaining a separate canvas renderer for the default path. sigma therefore drops to the alternative, used only if Cytoscape's WebGL mode fails the spike.

| | sigma.js 3 + graphology | Cytoscape.js | vis-network (production) |
|---|---|---|---|
| Rendering | **WebGL** (tens of thousands of visible nodes) | Canvas (WebGL renderer experimental) | Canvas; physics on the main thread |
| Data model | graphology, which is also the algorithms library (paths, metrics, communities, layouts in workers) | Its own model plus built-in algorithms | Its own DataSet; algorithms hand-written in GA |
| Styling gaps | Dashed edges and node icons need sigma programs or plugins (to verify in the spike) | Dashed edges, shapes, images and compound nodes built in | All built in |
| Annotations (comment boxes, frames, theme lines) | HTML overlay layer anchored to graph coordinates | Same, or the cytoscape-node-html-label plugin | Drawn inside the iframe |

- **Recommendation:** graphology as the model, whichever renderer wins; Cytoscape for drawing (canvas default, WebGL opt-in). The same graph instance then serves rendering, analytics workers (serialised with `graph.export()`), charts and the PDF.
- **Why not sigma first:** sigma is WebGL-only. The default path must be canvas, so sigma would need a second, canvas renderer.
- **Fallback:** if Cytoscape's WebGL mode is not usable, keep Cytoscape canvas as the default and add sigma.js as the opt-in GPU renderer, behind the same `GraphCanvas` adapter (`GraphCanvas.jsx` is the only file that knows the library).
- **Spike acceptance**, on the target hardware **including a typical analyst PC with integrated graphics or none**:
  1. Canvas mode, which is the default: 1 000 visible nodes pan and zoom smoothly, and 300 nodes with physics stay usable. That is production's practical ceiling, and canvas mode must at least match it.
  2. WebGL mode on a capable device: 5 000 visible nodes and 15 000 edges pan and zoom at ≥ 50 fps.
  3. Dashed, dotted and arrowed edges, node icons and shapes all render, identically in both modes.
  4. A layout of 5 000 nodes runs in a worker without freezing the UI.
  5. Hit-testing for click, hover and box-select.
  6. A PNG export at 2×.
  7. Switching modes while a graph is open keeps positions, selection and the view.

### 3.3 Layouts and physics
- **Where layouts run:** all layouts run in `layout.worker.js` and return positions. The canvas animates to them, keeping existing coordinates (production's diff rendering).
- **Engines:**
  - Force: ForceAtlas2 (graphology-layout-forceatlas2 worker), stopped or resumed by the Physics setting.
  - Hierarchical and layered: ELK (elkjs, in its own worker), with direction UD/LR, sort directed/hubsize, and layer mode hop / node_identity / key.
  - Concentric, circle, grid, spiral, star and radial: small pure functions.
- **Thresholds:** production's 300-node rule (physics off, hierarchical → layered) becomes a performance **policy** in one module (`graphSettings.js`), applied the same way everywhere. The threshold is set from the spike's numbers.

### 3.4 Live data
- **Status per session:** `graphStatus.js` subscribes once per session (reference-counted across Graph windows) and keeps relationships and metadata per session. This replaces A:12419-12716 and its copies.
  - The session info card and the relationship chips read it.
  - Source terminate and close mark the session terminated, as `clearLinkedGraphStatusForSession` does.
- **Fetching:** `graphFetch.js` cancels the previous request per window. It merges only the **new** chunks of each poll into graphology (no full re-send, no `JSON.stringify` comparisons), throttles render updates to animation frames, and shows production's progress `{current, total, status}`.
- **Edge identity:** the backend `id` when there is one, else `from|to|type|n`. Parallel edges are kept (production collapses them to `${from}_${to}`).
- **Faithful by default:** relationships drive fetches, as in production. If the backend later pushes chunks over the socket (§8, optional B-G3), the same merge path takes them.

### 3.5 Linking and selection between windows
- **Source ↔ Graph** link and unlink use `/graph_link`, called from the Graph link form or from Source "Open graph". The links are kept in workspace metadata (`graphLinkSource`), with no timers.
- **Graph ↔ Chart:** an in-app selection bus, `graphSelection.js` (subscribe per graph window id), replaces `network_components` and `entity_selection` postMessages. A chart reads the linked graph's store directly, and can analyse the **full** graph or the **visible** view (production only had the visible view).
- **Clipboard:**
  - Within the app, an in-memory clipboard.
  - Across tabs, a `BroadcastChannel('linkx-graph-clipboard')` (production synced through localStorage across frames).
  - Never `"*"`.

### 3.6 Evidence report without a hidden frame
- **Steps:**
  1. Build the report data from graphology: top 100 by degree, density, relationship counts, identity distribution, top 8.
  2. Lay it out (concentric) in the worker.
  3. Draw the snapshot with an **offscreen renderer instance**: a detached container at 2×, or `OffscreenCanvas` if the renderer supports it. Then destroy it.
  4. Compose the A4 PDF with **jsPDF**, which is already a dependency (production's manual fallback layout, GA:7853-8180, plus the GR template sections), without html2canvas.
  5. Resolve when the file is built. No 6 s guess.
- **Reports:** "Download report" calls this and stops being disabled.
- **Export → Generate report** from a Graph window uses the same function on the current view.

### 3.7 Security and robustness
- **No frames:** no iframes, no `postMessage` to documents, no `"*"`.
- **Header trigger:** keeps its origin allow-list and an explicit command whitelist.
- **Icon uploads:** raster images become data URLs. SVG is sanitised (no scripts or external refs) or rasterised.
- **Imports:**
  - JSON is validated against a schema and capped in size.
  - Production HTML exports are parsed by extracting their data, **never executed**.
- **Libraries:** installed from npm with pinned versions and bundled. No CDN.
- **Assets:** `graph_icons/` moves into `incubation/public/graph_icons/`. It currently exists only in the deployed build folders.

### 3.8 Theme
- The canvas reads colours from theme tokens (`--graph-*` in `tokens.css`, a "Graph Window" category in `themeCategories.js`), so `theme:check` covers it, as for Tasks and Reports. Dark mode needs no colour rewriting.
- CDR or NBE wording (legend, edge tooltips) comes from the active domain, as in Reports.

### 3.9 GPU capability: detect, suggest, never force
- **Detection (`shared/device/gpuCapability.js`, run once per browser and cached):**
  - A WebGL2 context, falling back to WebGL1, created with `failIfMajorPerformanceCaveat: true`. If it fails, the browser would fall back to software rendering, so the device does **not qualify**.
  - The renderer string (`WEBGL_debug_renderer_info` where allowed). SwiftShader, llvmpipe or "Software" means software rendering, so it does not qualify.
  - `MAX_TEXTURE_SIZE` and `navigator.deviceMemory` (where exposed) as coarse floors.
  - A short draw benchmark (under 200 ms, off-screen) to confirm.
  - Browsers do **not** expose GPU memory, so the result is "capable / not capable / unknown", never a memory figure.
- **Telling the user:**
  - Once the device qualifies, a one-time notice: *"This device can draw large graphs faster with the GPU. Turn it on in Libraries → Graph rendering."* Its actions are Open Libraries and Not now. It does not come back after being dismissed.
  - The suggestion is repeated only when a graph goes above the canvas comfort threshold set in G0.
- **Safety:**
  - If the WebGL context is lost or fails to start, the window switches back to canvas on its own, keeps the view, says so, and marks the device "not capable" for this browser.
- **Where the setting lives:**
  - It is **per device** (stored in this browser), not per account, because GPU capability belongs to the machine.
  - An administrator can disable GPU rendering for everyone; the per-device switch then shows why it is off.

### 3.10 Libraries window
The setting from §3.9, the graph defaults and the chart settings live in the **Libraries window**, not in each Graph window. Scopes: GPU rendering is per **device**; graph and chart defaults are **personal**; an admin "GPU allowed" policy is **system**. See `docs/libraries-plan.md` (agreed 2026-11-14).

---

## 4. Not to port (production bugs; listed so nobody "restores" them)
- **Physics:** `graph_physics {enabled:true}`, which turns physics off (A:13766 vs GA:6120).
- **Dead calls:** `all_property_keys` with no handler (keys now come from the store), and the stray `alert("new:")` (A:14158).
- **Unlink id:** the unlink form sends `source_id` undefined (`graphLinkId` never set, A:10214).
- **Parallel edges:** collapsed to one (GA:8377). Chunk edges were appended without de-duplication (A:3156).
- **Charts:** random values and the 5 empty metrics. They are replaced by real computations, or by an explicit "not available" with a reason.
- **Timers:** the 6 s fake success of the report; all `setTimeout` race patches.
- **Debounce:** the 300 ms settings debounce keyed by menu id, which drops fast consecutive changes (A:14311).
- **Dead code:** `GRAPH_STATUS_REFRESH_INTERVAL_MS`, `auto_relationships`, `activechart`.

---

## 5. Phases

| Phase | Scope | Done when |
|---|---|---|
| **G0 Spike** (≈3 days) | sigma vs Cytoscape against the §3.2 acceptance criteria; ELK and ForceAtlas2 in workers; measure 1k / 5k / 20k | A short written result; renderer chosen; thresholds set |
| **G1 Foundation** | `graphStore`, typed settings, canvas renderer (default), GPU capability detection and notice, a WebGL switch read from the Libraries setting (with a temporary local toggle until the Libraries window exists), `graphFetch` (chunks, cancel, progress), `graphStatus` socket service, Graph window shell (split panel, three tabs, relationships bar, session info card), canvas with select / hover / fit / zoom / undo-redo, limit / sort / range, performance policy, theme tokens. Entry points: launcher, Tasks, Reports evidence, Source "Open graph" and the link / unlink form. Permissions `graph:create`, `graph:read`, `graph:link` | Every way of opening from §2.1 (1–5) works; a 20k-node evidence graph opens; switching docked tabs keeps the view |
| **G2 Analysis** | Search expressions and linked nodes, property keys, label-by, edge weights, all layouts and options, expand / collapse, shortest and all paths, traversal, cut points, communities, visualise by degree / property, alert rules and the Alerts panel, pinned evidence, saved views, semantic legend | Feature-for-feature with §2.3 analysis items, with tests on known graphs |
| **G3 Authoring** | Node and edge editors, icon album and upload, context menu authoring (labels, comments, text blocks, event frames, theme lines, OLE objects), group / ungroup, merge, copy / paste (BroadcastChannel), delete, bring to front | Feature-for-feature with §2.3 authoring items |
| **G4 Export and reports** | PNG, print, JSON export / import (production formats), production HTML import, Generate report, evidence report PDF, Reports "Download report" enabled | Same PDF sections as production; downloads complete or fail visibly |
| **G5 Chart window** | ECharts (pinned, tree-shaken), linking to a graph, selection bus, all chart types and schemas, every metric computed in the worker, snapshot / print / reset; launcher entry (decision §9-1) | No random values; metrics checked against reference values |
| **G6 STR and external** | `str_report_link_analysis` (prepare-receiver wait, `socket_emit` replay, session id rule), header trigger with allow-list; later replaced by the Phase 4 alert-task flow in `analysis-results-plan.md` | The STR event opens and binds a graph exactly once |

G1 unblocks Reports (graph view), Tasks (Show graph) and Phase 3/4 of `analysis-results-plan.md`. G4 unblocks Reports "Download report".

---

## 6. Performance budgets (checked in G0 and kept as tests)
- **Open:** first paint of a fetched graph within 300 ms of data for 1 000 visible nodes. Chunks merge without dropping frames, and the UI never blocks for more than 50 ms (long-task observer in dev).
- **Interaction:** canvas (default) is smooth at 1 000 visible nodes on an analyst PC with integrated graphics. WebGL (opt-in) pans and zooms at ≥ 50 fps at 5 000 visible nodes.
- **Layout:** a 5 000-node layout runs in the worker, and the UI stays interactive.
- **Memory:** a closed Graph window frees its store, workers and socket subscriptions. Sign-out clears every store (added to `clearWorkspaceSessionData`).

## 7. Tests
- **Unit:**
  - chunk merge, including parallel edges and de-duplication
  - settings import from production arrays
  - search expressions
  - limit and sort window
  - edge semantics to style
  - alert rules
  - every chart metric against small graphs with known answers
  - report data
- **Component:** window shell, tabs, relationship chips, link / unlink, open from Tasks / Reports / Source, persistence across docked tab switches.
- **Worker:** layout and analytics message contracts.
- **Report:** the PDF contains every §2.5 section (text extraction).

## 8. Backend (optional improvements; production flow unchanged)
These are **not required**: the plan works with today's endpoints. They are listed only so the backend team can decide.
- **B-G1:** a stable `id` on every edge, so parallel edges are unambiguous.
- **B-G2:** `get_graph` relationship results with `total_nodes` / `total_edges` up front, for progress.
- **B-G3 (later):** push new chunks for a linked running session over the socket (`graph_chunk`), instead of a fetch per relationship click. The frontend merge path already supports it.

## 9. Decisions needed (product)
1. **Chart window launcher:** production hides it. Do we expose it once metrics are real (G5)?
2. **HTML export:** production's HTML export embeds vis-network. Options: (a) keep importing old HTML exports and export JSON plus PDF only; (b) also export a standalone, read-only HTML viewer. Recommended: (a) first.
3. **Save (graph persistence):** disabled in production. It stays disabled until the backend offers storage (ties to H-2/H-6).
4. **Visible-node default** (25) and the warning threshold (300): keep the default and set the threshold from the G0 numbers (canvas mode).
5. ~~Libraries window~~: agreed 2026-11-14; see `docs/libraries-plan.md`.
