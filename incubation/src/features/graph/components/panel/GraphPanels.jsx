// Right workspace panel content for the active Graph window
// (graph-chart-plan §3.11): Info, Filter and the "This graph" settings.
// Production had these inside each Graph window (App.jsx
// WindowVerticalSplitPanels ~8042); behaviour is ported, the place changed.
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { useSession } from '../../../../shared/session/useSession.js';
import { useNotifications } from '../../../../shared/notifications/useNotifications.js';
import { getActiveDomainKey } from '../../../configuration/lib/configModel.js';
import { formatPropertyKeyLabel, formatPropertyValue } from '../../lib/graphFormat.js';
import { nodeInfoProperties } from '../../lib/graphModel.js';
import { DEFAULT_GRAPH_SETTINGS, GRAPH_LIMITS, LABEL_GROUPS, LAYOUT_TYPES, normalizeLimitRange } from '../../lib/graphSettings.js';
import { graphWindowName } from '../../lib/useActiveGraph.js';
import { describeGraphSession, getGraphSession, subscribeGraphSession } from '../../lib/graphStatus.js';

const formatCount = (value) => Number(value || 0).toLocaleString();

export function GraphPanelHeader({ windowItem }) {
  return (
    <p className="graph_panel_target" title="The graph these controls apply to">
      <span aria-hidden="true">●</span> {graphWindowName(windowItem)}
    </p>
  );
}

// Shown in the tabs while a Chart window is active (Chart is a later phase).
// A Chart or Table window is active (twins; analyst decision 2026-11-18):
// its options are in its own toolbar; the Graph window it follows has the
// graph's. kind: 'chart' | 'table'; graphTitle: the linked Graph window's.
export function CompanionPanelNote({ kind, graphTitle = '' }) {
  const name = kind === 'table' ? 'Table' : 'Chart';
  return (
    <p className="workspace_context_hint">
      {graphTitle ? `This ${name} window follows ${graphTitle}.` : `This ${name} window is not linked to a Graph window yet.`}
      {' '}Its options are in its own toolbar; select {graphTitle ? 'that Graph window' : 'a Graph window'} for the graph&apos;s settings.
    </p>
  );
}

/* ── Info ───────────────────────────────────────────────────────────── */

const describeSource = (metadata = {}) => {
  if (metadata.evidence?.traceId) {
    return [
      ['Source', 'Evidence report'],
      ['Trace id', metadata.evidence.traceId],
      ['Report', metadata.evidence.reportId],
      ['Reference', metadata.evidence.externalReferenceId],
    ];
  }
  if (metadata.graphLinkSource) {
    return [
      ['Source', 'Linked session'],
      ['Session', metadata.graphLinkSource],
      ['Action', metadata.graphLinkAction],
      ['Relationship', metadata.graphRelationship === '*' ? 'All' : metadata.graphRelationship],
    ];
  }
  return [['Source', 'Not linked']];
};

function KeyValueList({ rows, isCdr = false, label }) {
  return (
    <dl className="graph_panel_props" aria-label={label}>
      {rows.filter(([, value]) => value != null && value !== '').map(([key, value]) => (
        <div key={key}>
          <dt title={String(key)}>{formatPropertyKeyLabel(key, isCdr)}</dt>
          <dd title={formatPropertyValue(key, value, isCdr)}>{formatPropertyValue(key, value, isCdr)}</dd>
        </div>
      ))}
    </dl>
  );
}

// Production "graph info placeholder" (graph_info_placeholder.html fed by
// buildGraphInfoPayload): the linked session's live status.
function SessionCard({ sessionId }) {
  const subscribe = useCallback((listener) => subscribeGraphSession(sessionId, listener), [sessionId]);
  const entry = useSyncExternalStore(subscribe, () => getGraphSession(sessionId));
  const info = describeGraphSession(entry);
  const formatTotal = (value) => (value == null ? '' : formatCount(value));
  return (
    <section className="workspace_context_section" aria-label="Linked session">
      <h2>Session</h2>
      <KeyValueList
        label="Linked session"
        rows={[
          ['Status', info.status || 'Waiting for the session…'],
          ['Run', info.runId],
          ['Nodes available', formatTotal(info.totalNodes)],
          ['Relationships', formatTotal(info.totalRelationships)],
          ['Relationship types', info.relationshipLabels.join(', ')],
        ]}
      />
    </section>
  );
}

export function GraphInfoPanel({ graph }) {
  const { configuration } = useSession();
  const isCdr = getActiveDomainKey(configuration) === 'cdr';
  const { windowItem, store, snapshot } = graph;
  const selection = snapshot.selection;
  const focusId = selection[selection.length - 1];
  const node = focusId ? store.getNode(focusId) : null;
  const properties = node ? Object.entries(nodeInfoProperties(node)) : [];

  return (
    <>
      <section className="workspace_context_section" aria-label="Graph source">
        <h2>Graph info</h2>
        <GraphPanelHeader windowItem={windowItem} />
        <KeyValueList label="Graph source" rows={describeSource(windowItem.metadata)} />
        <KeyValueList
          label="Graph size"
          rows={[
            ['Nodes', formatCount(snapshot.nodes)],
            ['Edges', formatCount(snapshot.edges)],
            ['Shown', `${formatCount(snapshot.viewStats.nodes)} nodes · ${formatCount(snapshot.viewStats.edges)} edges`],
            ['Edges without both ends', snapshot.danglingEdges ? formatCount(snapshot.danglingEdges) : ''],
          ]}
        />
      </section>
      {windowItem.metadata?.graphLinkSource ? <SessionCard sessionId={String(windowItem.metadata.graphLinkSource)} /> : null}
      <section className="workspace_context_section" aria-label="Node properties">
        <h2>Node properties</h2>
        {node ? (
          <>
            {selection.length > 1 ? <p className="workspace_context_hint">{selection.length} nodes selected; showing the last one.</p> : null}
            <KeyValueList label="Selected node" rows={properties} isCdr={isCdr} />
          </>
        ) : (
          <p className="workspace_context_hint">No information to show. Select a node in the graph.</p>
        )}
      </section>
    </>
  );
}

/* ── Filter (production graph search) ───────────────────────────────── */

export function GraphFilterPanel({ graph }) {
  const { notify } = useNotifications();
  const { windowItem, store, snapshot, search, updateSearch } = graph;
  const [keyword, setKeyword] = useState(search.keyword);
  // Follow the window when the panel switches graphs.
  useEffect(() => setKeyword(search.keyword), [windowItem.id, search.keyword]);
  const keys = useMemo(() => (snapshot.nodes ? store.propertyKeys() : []), [store, snapshot.version, snapshot.nodes]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasData = snapshot.nodes > 0;
  const selectedKeys = new Set(search.keys);

  // A search whose results come back empty says so (production "No Result Found!").
  const [pendingCheck, setPendingCheck] = useState(false);
  useEffect(() => {
    if (!pendingCheck || !snapshot.viewStats.searched) return;
    setPendingCheck(false);
    if (snapshot.viewStats.nodes === 0) notify({ title: 'Search', message: 'No result found.', level: 'info', source: windowItem.title });
  }, [pendingCheck, snapshot.viewStats, notify, windowItem.title]);

  const run = (event) => {
    event.preventDefault();
    const next = keyword.trim();
    updateSearch({ ...search, keyword: next });
    setPendingCheck(Boolean(next));
  };

  const toggleKey = (key) => {
    const next = selectedKeys.has(key) ? search.keys.filter((item) => item !== key) : [...search.keys, key];
    updateSearch({ ...search, keys: next });
  };

  return (
    <section className="workspace_context_section" aria-label="Graph filters">
      <h2>Graph filters</h2>
      <GraphPanelHeader windowItem={windowItem} />
      <form className="workspace_context_form_stack" onSubmit={run} role="search">
        <label>
          <span>Search</span>
          <input
            type="text"
            value={keyword}
            placeholder={hasData ? 'Text, 42, >100, 10-20' : 'Load a graph first'}
            disabled={!hasData}
            maxLength={200}
            onChange={(event) => setKeyword(event.target.value)}
            aria-describedby="graph-search-help"
          />
        </label>
        <small id="graph-search-help" className="workspace_context_hint">
          Text matches any part of a value; numbers match exactly; use &gt;, &gt;=, &lt;, &lt;=, = or a range like 10-20.
        </small>
        <label className="workspace_context_switch">
          <input
            type="checkbox"
            checked={search.includeLinked}
            disabled={!hasData}
            onChange={(event) => updateSearch({ ...search, includeLinked: event.target.checked })}
          />
          <span>Include linked nodes</span>
        </label>
        <div className="graph_panel_actions">
          <button type="submit" disabled={!hasData}>Search</button>
          <button
            type="button"
            disabled={!hasData || (!search.keyword && !keyword)}
            onClick={() => {
              setKeyword('');
              updateSearch({ ...search, keyword: '' });
            }}
          >
            Clear
          </button>
        </div>
      </form>

      {snapshot.viewStats.searched ? (
        <p className="graph_panel_results" role="status">
          Nodes found: <strong>{formatCount(snapshot.viewStats.nodes)}</strong> · Edges found: <strong>{formatCount(snapshot.viewStats.edges)}</strong>
        </p>
      ) : null}

      <fieldset className="graph_panel_keys" disabled={!hasData}>
        <legend>Search in</legend>
        {keys.length === 0 ? <p className="workspace_context_hint">All properties (no keys yet).</p> : (
          <>
            <p className="workspace_context_hint">{selectedKeys.size ? `${selectedKeys.size} selected` : 'All properties'}</p>
            {keys.map((key) => (
              <label key={key} className="workspace_context_switch">
                <input type="checkbox" checked={selectedKeys.has(key)} onChange={() => toggleKey(key)} />
                <span>{key}</span>
              </label>
            ))}
            {selectedKeys.size ? <button type="button" className="graph_panel_link" onClick={() => updateSearch({ ...search, keys: [] })}>Reset keys</button> : null}
          </>
        )}
      </fieldset>
    </section>
  );
}

/* ── Settings: this graph ───────────────────────────────────────────── */

const LAYOUT_LABELS = {
  concentric: 'Concentric (default)',
  hierarchical: 'Hierarchical',
  layered: 'Layered',
  circle: 'Circle',
  star: 'Star',
  radial: 'Radial',
  grid: 'Grid',
  spiral: 'Spiral',
  // G3.5 i2 #6 (not in production).
  peacock: 'Peacock (hubs and their leaves)',
  grouped: 'Grouped (clusters by type or property)',
};

function RangeInputs({ limit, onCommit, disabled }) {
  const [draft, setDraft] = useState({ min: String(limit.min), max: String(limit.max) });
  useEffect(() => setDraft({ min: String(limit.min), max: String(limit.max) }), [limit.min, limit.max]);
  const commit = () => {
    const range = normalizeLimitRange({ min: draft.min, max: draft.max });
    setDraft({ min: String(range.min), max: String(range.max) });
    if (range.min !== limit.min || range.max !== limit.max) onCommit(range);
  };
  const onKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  };
  return (
    <div className="graph_panel_range">
      <label>
        <span>From</span>
        <input type="number" min={0} value={draft.min} disabled={disabled} onChange={(event) => setDraft((current) => ({ ...current, min: event.target.value }))} onBlur={commit} onKeyDown={onKeyDown} />
      </label>
      <label>
        <span>To</span>
        <input type="number" min={1} value={draft.max} disabled={disabled} onChange={(event) => setDraft((current) => ({ ...current, max: event.target.value }))} onBlur={commit} onKeyDown={onKeyDown} />
      </label>
    </div>
  );
}

export function GraphSettingsPanel({ graph }) {
  const { windowItem, store, snapshot, settings, updateSettings } = graph;
  const keys = useMemo(() => (snapshot.nodes ? store.propertyKeys() : []), [store, snapshot.version, snapshot.nodes]); // eslint-disable-line react-hooks/exhaustive-deps
  // Link properties holding numbers (link aggregation's total).
  const edgeKeys = useMemo(() => {
    const found = new Set();
    store.graph().forEachEdge((key, attributes) => {
      Object.entries(attributes).forEach(([name, value]) => {
        if (name.startsWith('__') || ['from', 'to', 'id', 'width', 'color', 'dashes', 'smooth', 'arrows'].includes(name)) return;
        const numeric = typeof value === 'number'
          ? Number.isFinite(value)
          : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value.replace(/[,\s]/g, '')));
        if (numeric) found.add(name);
      });
    });
    return [...found].sort();
  }, [store, snapshot.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasData = snapshot.nodes > 0;
  const patch = (next) => updateSettings({ ...settings, ...next });
  const count = settings.limit.max - settings.limit.min;
  const shownCount = snapshot.viewStats.nodes;

  return (
    <section className="workspace_context_section" aria-label="This graph">
      <h2>This graph</h2>
      <GraphPanelHeader windowItem={windowItem} />
      <div className="workspace_context_form_stack">
        <label className="workspace_context_switch">
          <input type="checkbox" checked={settings.performance} onChange={(event) => patch({ performance: event.target.checked })} />
          <span>Performance mode</span>
        </label>
        {settings.performance ? <small className="workspace_context_hint">Labels, titles, edge weights and physics are off while it is on (production default for new graphs).</small> : null}

        <h3 className="graph_panel_subheading">Nodes shown</h3>
        <label>
          <span>Order by</span>
          <select value={settings.limit.key} disabled={!hasData} onChange={(event) => patch({ limit: { ...settings.limit, key: event.target.value } })}>
            <option value="">Arrival order</option>
            {keys.map((key) => <option key={key} value={key}>{key}</option>)}
          </select>
        </label>
        {settings.limit.key ? (
          <>
            <label>
              <span>Direction</span>
              <select value={settings.limit.sort} onChange={(event) => patch({ limit: { ...settings.limit, sort: event.target.value } })}>
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </label>
            <small className="workspace_context_hint">Nodes without “{settings.limit.key}” are left out while ordering by it.</small>
          </>
        ) : null}
        <RangeInputs limit={settings.limit} disabled={!hasData} onCommit={(range) => patch({ limit: { ...settings.limit, ...range } })} />
        {count > GRAPH_LIMITS.WARNING ? (
          <small className="graph_panel_warning" role="status">Showing more than {GRAPH_LIMITS.WARNING} nodes may be slow.</small>
        ) : null}

        <h3 className="graph_panel_subheading">Labels</h3>
        <label className="workspace_context_switch">
          <input type="checkbox" checked={settings.showLabels} disabled={settings.performance} onChange={(event) => patch({ showLabels: event.target.checked })} />
          <span>Show labels</span>
        </label>
        <label>
          <span>Label by property</span>
          <select
            value={settings.labels.byKey}
            disabled={!hasData || settings.performance}
            // Production turns labels on when a label key is chosen.
            onChange={(event) => patch({ labels: { ...settings.labels, byKey: event.target.value }, showLabels: event.target.value ? true : settings.showLabels })}
          >
            <option value="">Node label</option>
            {keys.map((key) => <option key={key} value={key}>{key}</option>)}
          </select>
        </label>
        {settings.labels.byKey ? (
          <label>
            <span>For nodes of type</span>
            <select value={settings.labels.group || LABEL_GROUPS[0]} onChange={(event) => patch({ labels: { ...settings.labels, group: event.target.value } })}>
              {LABEL_GROUPS.map((group) => <option key={group} value={group}>{group}</option>)}
            </select>
          </label>
        ) : null}

        <label className="workspace_context_switch">
          <input type="checkbox" checked={settings.showTitles} disabled={settings.performance} onChange={(event) => patch({ showTitles: event.target.checked })} />
          <span>Show titles on hover</span>
        </label>
        {/* What the card shows is set per domain (Configuration ▸ Rules ▸
            Profile mapping fields); here only whether this graph shows it. */}
        <label className="workspace_context_switch" title="The card a node click shows; its details are set in Configuration ▸ Rules ▸ Profile mapping fields">
          <input type="checkbox" checked={settings.actorProfile} onChange={(event) => patch({ actorProfile: event.target.checked })} />
          <span>Show actor profile on node click</span>
        </label>
        <label className="workspace_context_switch" title="The domain's formatting rules (Configuration ▸ Rules ▸ Formatting rules), below this graph's own">
          <input type="checkbox" checked={settings.useDomainRules} onChange={(event) => patch({ useDomainRules: event.target.checked })} />
          <span>Use domain formatting rules</span>
        </label>

        <h3 className="graph_panel_subheading">Edges</h3>
        <label>
          <span>Edge weight</span>
          <select value={settings.edgeWeight} disabled={!hasData || settings.performance} onChange={(event) => patch({ edgeWeight: event.target.value })}>
            <option value="">Off</option>
            <option value="default">Default (edge weight)</option>
            {keys.map((key) => <option key={key} value={key}>By {key}</option>)}
          </select>
        </label>

        {/* Link aggregation (G3.5 i2 #2; not in production): view only. */}
        <label className="workspace_context_switch" title="Links between the same two nodes drawn as one, with how many and a total; double-click one to expand it">
          <input type="checkbox" checked={settings.linkAggregation.on} onChange={(event) => patch({ linkAggregation: { ...settings.linkAggregation, on: event.target.checked } })} />
          <span>Aggregate links</span>
        </label>
        {settings.linkAggregation.on ? (
          <>
            <label>
              <span>Aggregate</span>
              <select value={settings.linkAggregation.mode} onChange={(event) => patch({ linkAggregation: { ...settings.linkAggregation, mode: event.target.value } })}>
                <option value="combined">Both directions together</option>
                <option value="direction">Each direction apart</option>
              </select>
            </label>
            <label>
              <span>Total of</span>
              <select value={settings.linkAggregation.totalKey} disabled={!hasData && !settings.linkAggregation.totalKey} onChange={(event) => patch({ linkAggregation: { ...settings.linkAggregation, totalKey: event.target.value } })}>
                <option value="">No total (count only)</option>
                {settings.linkAggregation.totalKey && !edgeKeys.includes(settings.linkAggregation.totalKey)
                  ? <option value={settings.linkAggregation.totalKey}>{settings.linkAggregation.totalKey} (not in this graph)</option>
                  : null}
                {edgeKeys.map((key) => <option key={key} value={key}>{key}</option>)}
              </select>
            </label>
            <small className="workspace_context_hint">Double-click an aggregated link (or right-click ▸ Expand Links) to show its links; again to merge them back.{settings.edgeBundling ? ' Edge bundling is not applied while links are aggregated.' : ''}</small>
          </>
        ) : null}

        <h3 className="graph_panel_subheading">Layout</h3>
        <label>
          <span>Layout</span>
          <select
            value={settings.layout.type}
            onChange={(event) => {
              const type = event.target.value;
              // Production: choosing hierarchical resets direction and sort.
              patch({ layout: { ...settings.layout, type, ...(type === 'hierarchical' ? { direction: 'UD', sortMethod: 'directed' } : {}) } });
            }}
          >
            {LAYOUT_TYPES.map((type) => (
              <option key={type} value={type} disabled={type === 'hierarchical' && shownCount >= GRAPH_LIMITS.PHYSICS_AUTO_OFF_AT}>
                {LAYOUT_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        {settings.layout.type === 'hierarchical' && shownCount >= GRAPH_LIMITS.PHYSICS_AUTO_OFF_AT ? (
          <small className="workspace_context_hint">Hierarchical needs fewer than {GRAPH_LIMITS.PHYSICS_AUTO_OFF_AT} shown nodes; layered is used instead.</small>
        ) : null}
        {settings.layout.type === 'hierarchical' || settings.layout.type === 'layered' ? (
          <label>
            <span>Direction</span>
            <select value={settings.layout.direction} onChange={(event) => patch({ layout: { ...settings.layout, direction: event.target.value } })}>
              <option value="UD">Top to bottom</option>
              <option value="LR">Left to right</option>
            </select>
          </label>
        ) : null}
        {settings.layout.type === 'hierarchical' ? (
          <label>
            <span>Order levels by</span>
            <select value={settings.layout.sortMethod} onChange={(event) => patch({ layout: { ...settings.layout, sortMethod: event.target.value } })}>
              <option value="directed">Edge direction</option>
              <option value="hubsize">Hub size</option>
            </select>
          </label>
        ) : null}
        {settings.layout.type === 'grouped' ? (
          <>
            <label>
              <span>Group by</span>
              <select value={settings.layout.layerMode === 'by_key' ? 'by_key' : 'node_identity'} onChange={(event) => patch({ layout: { ...settings.layout, layerMode: event.target.value } })}>
                <option value="node_identity">Node type</option>
                <option value="by_key">A property</option>
              </select>
            </label>
            {settings.layout.layerMode === 'by_key' ? (
              <label>
                <span>Group property</span>
                <select value={settings.layout.layerKey} disabled={!hasData} onChange={(event) => patch({ layout: { ...settings.layout, layerKey: event.target.value } })}>
                  <option value="">Choose a property</option>
                  {keys.map((key) => <option key={key} value={key}>{key}</option>)}
                </select>
              </label>
            ) : null}
          </>
        ) : null}
        {settings.layout.type === 'layered' ? (
          <>
            <label>
              <span>Layers by</span>
              <select value={settings.layout.layerMode} onChange={(event) => patch({ layout: { ...settings.layout, layerMode: event.target.value } })}>
                <option value="hop_distance">Distance from the source</option>
                <option value="node_identity">Node type</option>
                <option value="by_key">A property</option>
              </select>
            </label>
            {settings.layout.layerMode === 'by_key' ? (
              <label>
                <span>Layer property</span>
                <select value={settings.layout.layerKey} disabled={!hasData} onChange={(event) => patch({ layout: { ...settings.layout, layerKey: event.target.value } })}>
                  <option value="">Choose a property</option>
                  {keys.map((key) => <option key={key} value={key}>{key}</option>)}
                </select>
              </label>
            ) : null}
          </>
        ) : null}
        <label className="workspace_context_switch">
          <input
            type="checkbox"
            checked={settings.physics && !settings.performance && shownCount < GRAPH_LIMITS.PHYSICS_AUTO_OFF_AT}
            disabled={settings.performance || shownCount >= GRAPH_LIMITS.PHYSICS_AUTO_OFF_AT}
            onChange={(event) => patch({ physics: event.target.checked })}
          />
          <span>Physics</span>
        </label>
        {shownCount >= GRAPH_LIMITS.PHYSICS_AUTO_OFF_AT ? (
          <small className="workspace_context_hint">Physics stays off with {GRAPH_LIMITS.PHYSICS_AUTO_OFF_AT} or more shown nodes.</small>
        ) : null}

        <div className="graph_panel_actions">
          <button type="button" onClick={() => updateSettings(DEFAULT_GRAPH_SETTINGS)}>Reset this graph</button>
        </div>
      </div>
    </section>
  );
}
