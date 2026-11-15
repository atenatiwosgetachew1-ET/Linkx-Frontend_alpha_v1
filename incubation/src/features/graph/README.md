# Graph Feature

Graph windows, graph linking, relationship fetching and graph status subscriptions, without iframes (docs/graph-chart-plan.md).

- `lib/graphStore.js`: one store per Graph window (full graph in graphology, visible view, positions, selection, status).
- `lib/graphSettings.js`, `graphModel.js`, `graphElements.js`, `graphSearch.js`, `graphFormat.js`, `layouts.js`: production rules ported as pure functions.
- `lib/graphFetchRunner.js` + `services/graphApi.js`: `/get_graph` with chunked job polling.
- `lib/graphStatus.js`: `graph_status_subscribe` / `status` socket service (reference-counted per session).
- `lib/graphLinkFlow.js`: `/graph_link` link / unlink.
- `components/GraphCanvas.jsx`: the only file that knows the renderer (Cytoscape; canvas by default, WebGL opt-in).
- `components/panel/`: Info / Filter / Settings content for the right workspace panel.
