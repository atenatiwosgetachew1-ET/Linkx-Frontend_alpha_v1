// Right workspace panel content for the active Graph window
// (graph-chart-plan §3.11): Info, Filter and the "This graph" settings.
// Production had these inside each Graph window (App.jsx
// WindowVerticalSplitPanels ~8042); behaviour is ported, the place changed.
import { parseAmount } from '../../../../shared/numbers/values.js';
import React, { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useSession } from '../../../../shared/session/useSession.js';
import { useNotifications } from '../../../../shared/notifications/useNotifications.js';
import StrokeIcon from '../../../../shared/icons/StrokeIcon.jsx';
import { PanelBlock, PanelField, PanelHint, PanelNote, PanelPage, PanelRows, PanelSwitch } from '../../../../workspace/components/right/PanelParts.jsx';
import { getActiveDomainKey } from '../../../configuration/lib/configModel.js';
import { Masthead, PageHero, Pill, Stat, Stats } from '../../../settings/components/SettingsPage.jsx';
import { formatPropertyKeyLabel, formatPropertyValue } from '../../lib/graphFormat.js';
import { nodeInfoProperties } from '../../lib/graphModel.js';
import { getGpuLimits, subscribeGpuBenchmark } from '../../lib/gpuBenchmark.js';
import { getGraphDefaults } from '../../lib/graphDefaults.js';
import { GRAPH_LIMITS, LABEL_GROUPS, LAYOUT_TYPES, normalizeLimitRange, viewKeyOf, visibleCapFor, warnAtFor } from '../../lib/graphSettings.js';
import { parseSearchExpression } from '../../lib/graphSearch.js';
import { propertyValues, rangeOfExpression, searchRangeOf } from '../../lib/searchRange.js';
import SearchRange from './SearchRange.jsx';
import { RENDERERS, resolveRenderer, subscribeRenderer } from '../../lib/rendererPreference.js';
import { graphWindowName } from '../../lib/useActiveGraph.js';
import { describeGraphSession, getGraphSession, subscribeGraphSession } from '../../lib/graphStatus.js';

const formatCount = (value) => Number(value || 0).toLocaleString();

// What the window's data is, in a word (the Graph window says the same).
export const graphStateOf = ({ status, nodes }) => {
  if (status.state === 'loading' || status.state === 'queued') return { label: 'Loading', tone: 'neutral' };
  if (status.state === 'error') return { label: 'Not loaded', tone: '' };
  if (!nodes) return { label: 'Empty', tone: 'neutral' };
  return status.partial ? { label: 'Incomplete', tone: '' } : { label: 'Ready', tone: 'active' };
};

const PANEL_ICONS = {
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-4M12 8h.01',
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
};

const CARD_ICONS = {
  source: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
  session: 'M22 12h-4l-3 9L9 3l-3 9H2',
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'm20 20-3.5-3.5'],
  properties: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
};

// Every graph tab's header: what it is, the graph it is about, its state.
export function GraphPanelHeader({ icon, eyebrow, windowItem, snapshot, meta, children }) {
  const state = graphStateOf(snapshot);
  const name = graphWindowName(windowItem);
  return (
    <Masthead>
      <PageHero
        eyebrow={eyebrow}
        title={name}
        titleHint={name}
        pill={<Pill tone={state.tone}>{state.label}</Pill>}
        meta={meta}
        media={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={PANEL_ICONS[icon]} /></svg>}
      />
      {children}
    </Masthead>
  );
}

// A Chart or Table window is active (twins; analyst decision 2026-11-18):
// its options are in its own toolbar; the Graph window it follows has the
// graph's. kind: 'chart' | 'table'; graphTitle: the linked Graph window's.
export function CompanionPanelNote({ kind, graphTitle = '' }) {
  const name = kind === 'table' ? 'Table' : 'Chart';
  return (
    <PanelNote>
      {graphTitle ? `This ${name} window follows ${graphTitle}.` : `This ${name} window is not linked to a Graph window yet.`}
      {' '}Its options are in its own toolbar; select {graphTitle ? 'that Graph window' : 'a Graph window'} for the graph&apos;s settings.
    </PanelNote>
  );
}

// A tab whose window is not a graph.
export function NoGraphPanel({ title, icon, graph }) {
  return (
    <PanelPage label={title}>
      <Masthead>
        <PageHero
          eyebrow={title}
          title={graph.companion === 'table' ? 'Table window' : graph.companion === 'chart' ? 'Chart window' : 'No graph selected'}
          media={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={PANEL_ICONS[icon]} /></svg>}
        />
      </Masthead>
      <div className="config_card">
        {graph.companion
          ? <CompanionPanelNote kind={graph.companion} graphTitle={graphWindowName(graph.companionGraph)} />
          : <PanelNote>Select a Graph window.</PanelNote>}
      </div>
    </PanelPage>
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
  if (metadata.graphLinkSource && !metadata.graphTaskId) {
    return [
      ['Source', 'Linked session'],
      ['Session', metadata.graphLinkSource],
      ['Action', metadata.graphLinkAction],
      ['Relationship', metadata.graphRelationship === '*' ? 'All' : metadata.graphRelationship],
    ];
  }
  if (metadata.graphTaskId) return [['Source', 'Saved graph of a run'], ['Task', metadata.graphTaskId]];
  if (metadata.graphImported) return [['Source', 'Imported file'], ['File', metadata.graphImported]];
  if (metadata.graphBlank) return [['Source', 'New graph (made here)']];
  return [['Source', 'Not linked']];
};

// [key, value] rows as the domain reads them. Two keys may read the same once
// labelled, so rows are keyed by their own names.
function KeyValueList({ rows, isCdr = false, label }) {
  return (
    <PanelRows
      label={label}
      rows={rows.filter(([, value]) => value != null && value !== '').map(([key, value]) => [formatPropertyKeyLabel(key, isCdr), formatPropertyValue(key, value, isCdr), key])}
    />
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
    <PanelBlock title="Session" label="Linked session" icon={CARD_ICONS.session} collapsible>
      <div className="right_card_body">
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
      </div>
    </PanelBlock>
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

  const { status, viewStats } = snapshot;
  const linked = Boolean(windowItem.metadata?.graphLinkSource) && !windowItem.metadata?.graphTaskId && !windowItem.metadata?.evidence?.traceId;

  return (
    <PanelPage fill cards label="Info">
      <GraphPanelHeader icon="info" eyebrow="Graph info" windowItem={windowItem} snapshot={snapshot}>
        <Stats label="Graph size" columns={3}>
          <Stat label="Nodes" value={formatCount(snapshot.nodes)} note={`${formatCount(viewStats.nodes)} shown`} />
          <Stat label="Edges" value={formatCount(snapshot.edges)} note={`${formatCount(viewStats.edges)} shown`} />
          <Stat label="Selected" value={formatCount(selection.length)} note={selection.length === 1 ? 'node' : 'nodes'} />
        </Stats>
      </GraphPanelHeader>
      <PanelBlock title="Source" label="Graph source" icon={CARD_ICONS.source} collapsible startCollapsed>
        <div className="right_card_body">
          <KeyValueList
            label="Graph source"
            rows={[
              ...describeSource(windowItem.metadata),
              ['Edges without both ends', snapshot.danglingEdges ? formatCount(snapshot.danglingEdges) : ''],
            ]}
          />
          {status.state === 'ready' && status.partial ? <PanelHint warning>Part of this graph is missing. Load it again before relying on it.</PanelHint> : null}
          {status.state === 'ready' && !status.partial && status.midRun && linked ? <PanelHint warning>Loaded while its run was going. Reload it in the Graph window for the rest.</PanelHint> : null}
          {status.state === 'error' && status.message ? <PanelHint warning>{status.message}</PanelHint> : null}
        </div>
      </PanelBlock>
      {linked ? <SessionCard sessionId={String(windowItem.metadata.graphLinkSource)} /> : null}
      <PanelBlock title="Node properties" icon={CARD_ICONS.properties} collapsible grow>
        <div className="right_card_body">
          {node ? (
            <>
              {selection.length > 1 ? <PanelHint>{formatCount(selection.length)} nodes selected; showing the last one.</PanelHint> : null}
              <KeyValueList label="Selected node" rows={properties} isCdr={isCdr} />
            </>
          ) : (
            <PanelNote>No information to show. Select a node in the graph.</PanelNote>
          )}
        </div>
      </PanelBlock>
    </PanelPage>
  );
}

/* ── Filter (production graph search) ───────────────────────────────── */

const COMPARISONS = { '>': 'greater than', '>=': 'at least', '<': 'less than', '<=': 'at most', '=': 'equal to' };
// What will be looked for, in words (graphSearch.js).
const describeSearch = (expression, typed) => {
  if (expression.mode === 'range') return `Values from ${expression.min.toLocaleString()} to ${expression.max.toLocaleString()}`;
  if (expression.mode === 'compare') return `Values ${COMPARISONS[expression.op]} ${expression.target.toLocaleString()}`;
  if (expression.mode === 'number_exact') return `Values equal to ${typed}`;
  return `Values containing “${typed}”`;
};

export function GraphFilterPanel({ graph }) {
  const { notify } = useNotifications();
  const { windowItem, store, snapshot, settings, search, updateSearch } = graph;
  const [keyword, setKeyword] = useState(search.keyword);
  // Follow the window when the panel switches graphs.
  useEffect(() => setKeyword(search.keyword), [windowItem.id, search.keyword]);
  const keys = useMemo(() => (snapshot.nodes ? store.propertyKeys() : []), [store, snapshot.version, snapshot.nodes]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasData = snapshot.nodes > 0;
  const selectedKeys = new Set(search.keys);

  // The window's figures, once they are for the search set here.
  const { viewStats } = snapshot;
  const isCurrent = viewStats.viewKey === viewKeyOf(settings.limit, windowItem.metadata?.graphSearch);

  // A search that matches nothing says so (production "No Result Found!").
  const [pendingCheck, setPendingCheck] = useState(false);
  useEffect(() => {
    if (!pendingCheck || !isCurrent || !viewStats.searched) return;
    setPendingCheck(false);
    if (viewStats.matches === 0) notify({ title: 'Search', message: 'No result found.', level: 'info', source: windowItem.title });
  }, [pendingCheck, isCurrent, viewStats, notify, windowItem.title]);

  const run = (event) => {
    event.preventDefault();
    const next = keyword.trim();
    updateSearch({ ...search, keyword: next });
    setPendingCheck(Boolean(next));
  };

  const inputRef = useRef(null);
  const helpId = useId();
  const typed = keyword.trim();
  const expression = parseSearchExpression(typed);
  const isNumeric = expression.mode === 'compare' || expression.mode === 'range';
  const clear = () => {
    setKeyword('');
    updateSearch({ ...search, keyword: '' });
    inputRef.current?.focus();
  };
  // The range of the properties searched in, as the box says it.
  const range = useMemo(
    () => (search.keys.length ? searchRangeOf(propertyValues(store.graph(), search.keys)) : null),
    [store, search.keys, snapshot.dataVersion], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [rangeFrom, rangeTo] = range ? rangeOfExpression(expression, range.max) : [0, 0];
  const keywordRef = useRef(keyword);
  keywordRef.current = keyword;
  // From 0 to the largest is no limit at all: an empty search.
  const setRange = (from, to) => setKeyword(from <= 0 && to >= range.max ? '' : `${range.textOf(from)}-${range.textOf(to)}`);
  const commitRange = () => {
    const next = keywordRef.current.trim();
    if (next === search.keyword) return;
    updateSearch({ ...search, keyword: next });
    setPendingCheck(Boolean(next));
  };

  const toggleKey = (key) => {
    const next = selectedKeys.has(key) ? search.keys.filter((item) => item !== key) : [...search.keys, key];
    updateSearch({ ...search, keys: next });
  };

  const others = [
    viewStats.hiddenTypes && `Filter Elements hides ${viewStats.hiddenTypes}`,
    viewStats.hiddenNodes && `${formatCount(viewStats.hiddenNodes)} ${viewStats.hiddenNodes === 1 ? 'node is' : 'nodes are'} hidden`,
    viewStats.timeFiltered && 'the timeline shows one period',
  ].filter(Boolean);
  const searched = isCurrent && viewStats.searched;
  const matchShare = snapshot.nodes ? Math.min(100, (viewStats.matches / snapshot.nodes) * 100) : 0;

  return (
    <PanelPage fill cards label="Filter">
      <GraphPanelHeader icon="filter" eyebrow="Graph filter" windowItem={windowItem} snapshot={snapshot}>
        <Stats label="Filter figures" columns={3}>
          <Stat label="Nodes" value={formatCount(snapshot.nodes)} note="in the graph" />
          <Stat label="Matches" value={searched ? formatCount(viewStats.matches) : '–'} note={searched ? 'nodes' : 'no search'} empty={!searched} />
          <Stat label="Shown" value={formatCount(viewStats.nodes)} note={`${formatCount(viewStats.edges)} edges`} />
        </Stats>
      </GraphPanelHeader>

      <PanelBlock title="Search" label="Graph filters" icon={CARD_ICONS.search} collapsible>
        <form className="right_card_body" onSubmit={run} role="search">
          <div className={`right_search${hasData ? '' : ' is-disabled'}`}>
            <StrokeIcon className="right_search_icon" d={CARD_ICONS.search} />
            <input
              ref={inputRef}
              type="text"
              className="right_search_input"
              aria-label="Find nodes"
              value={keyword}
              placeholder={hasData ? 'Find nodes…' : 'Load a graph first'}
              disabled={!hasData}
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setKeyword(event.target.value)}
              aria-describedby={helpId}
            />
            {hasData && typed !== search.keyword && typed ? <kbd className="right_search_key" aria-hidden="true">Enter</kbd> : null}
            {hasData && (search.keyword || keyword) ? (
              <button type="button" className="right_search_clear linkx_tooltip_anchor" data-tooltip="Clear the search" aria-label="Clear" onClick={clear}>
                <StrokeIcon d={['m6 6 12 12', 'M18 6 6 18']} />
              </button>
            ) : null}
          </div>
          <p id={helpId} className={`right_search_reading${typed ? ' is-on' : ''}`}>{typed ? describeSearch(expression, typed) : 'Any text, a number, a comparison or a range.'}</p>
          <SearchRange
            range={range}
            from={rangeFrom}
            to={rangeTo}
            label={search.keys.length === 1 ? `Range of ${search.keys[0]}` : 'Range'}
            hint={!hasData ? 'Load a graph first.' : search.keys.length ? 'The chosen properties hold no amounts.' : 'Choose a number property under Search in.'}
            onChange={setRange}
            onCommit={commitRange}
          />
          <PanelSwitch
            label="Include linked nodes"
            hint={search.includeLinked && isNumeric ? 'Not used by comparisons and ranges.' : undefined}
            checked={search.includeLinked}
            disabled={!hasData}
            onChange={(includeLinked) => updateSearch({ ...search, includeLinked })}
          />
          <button type="submit" className="right_search_submit" disabled={!hasData}>
            <StrokeIcon d={CARD_ICONS.search} /> Search
          </button>
          {searched ? (
            <div className={`right_found${viewStats.matches ? '' : ' is-none'}`}>
              <p className="right_result" role="status">
                <strong>{formatCount(viewStats.matches)}</strong> {viewStats.matches === 1 ? 'match' : 'matches'} · showing <strong>{formatCount(viewStats.nodes)}</strong> {viewStats.nodes === 1 ? 'node' : 'nodes'} and <strong>{formatCount(viewStats.edges)}</strong> {viewStats.edges === 1 ? 'edge' : 'edges'}
              </p>
              {/* The share of the graph's nodes that match. */}
              <span className="right_found_bar" aria-hidden="true"><i style={{ width: `${matchShare}%` }} /></span>
            </div>
          ) : null}
          {others.length && hasData ? <PanelHint>Also applied in the window: {others.join('; ')}.</PanelHint> : null}
        </form>
      </PanelBlock>

      <PanelBlock
        title="Search in"
        icon={CARD_ICONS.properties}
        collapsible
        grow
        actions={selectedKeys.size ? <button type="button" className="settings_button is-compact" disabled={!hasData} onClick={() => updateSearch({ ...search, keys: [] })}>All properties</button> : null}
      >
        <div className="right_card_body" role="group" aria-label="Search in">
          <PanelHint>{keys.length === 0 ? 'All properties (no keys yet).' : selectedKeys.size ? `${formatCount(selectedKeys.size)} of ${formatCount(keys.length)} properties` : `All ${formatCount(keys.length)} properties`}</PanelHint>
          {keys.length ? (
            <div className="right_key_list">
              {keys.map((key) => (
                <PanelSwitch key={key} oneLine label={key} checked={selectedKeys.has(key)} disabled={!hasData} onChange={() => toggleKey(key)} />
              ))}
            </div>
          ) : null}
        </div>
      </PanelBlock>
    </PanelPage>
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
    <div className="config_card_grid">
      <PanelField label="From">
        <input className="settings_input" type="number" min={0} value={draft.min} disabled={disabled} onChange={(event) => setDraft((current) => ({ ...current, min: event.target.value }))} onBlur={commit} onKeyDown={onKeyDown} />
      </PanelField>
      <PanelField label="To">
        <input className="settings_input" type="number" min={1} value={draft.max} disabled={disabled} onChange={(event) => setDraft((current) => ({ ...current, max: event.target.value }))} onBlur={commit} onKeyDown={onKeyDown} />
      </PanelField>
    </div>
  );
}

export function GraphSettingsPanel({ graph }) {
  const { configuration } = useSession();
  const { windowItem, store, snapshot, settings, updateSettings } = graph;
  // The same limits the Graph window draws under.
  const renderer = useSyncExternalStore(subscribeRenderer, () => resolveRenderer(configuration));
  const gpuLimits = useSyncExternalStore(subscribeGpuBenchmark, getGpuLimits);
  const cap = visibleCapFor(renderer, gpuLimits);
  const warnAt = warnAtFor(renderer, gpuLimits);
  const keys = useMemo(() => (snapshot.nodes ? store.propertyKeys() : []), [store, snapshot.version, snapshot.nodes]); // eslint-disable-line react-hooks/exhaustive-deps
  // Link properties holding numbers (link aggregation's total).
  const edgeKeys = useMemo(() => {
    const found = new Set();
    store.graph().forEachEdge((key, attributes) => {
      Object.entries(attributes).forEach(([name, value]) => {
        if (name.startsWith('__') || ['from', 'to', 'id', 'width', 'color', 'dashes', 'smooth', 'arrows'].includes(name)) return;
        if (parseAmount(value) !== null) found.add(name);
      });
    });
    return [...found].sort();
  }, [store, snapshot.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasData = snapshot.nodes > 0;
  const patch = (next) => updateSettings({ ...settings, ...next });
  const count = settings.limit.max - settings.limit.min;
  const shownCount = snapshot.viewStats.nodes;
  // Expanded, hidden or added nodes keep the view at the size they were made on.
  const editedAt = store.editedCap(viewKeyOf(settings.limit, windowItem.metadata?.graphSearch));
  const heldAt = editedAt !== null && editedAt < Math.min(count, cap) ? editedAt : 0;

  return (
    <>
      <GraphPanelHeader
        icon="settings"
        eyebrow="Graph settings"
        windowItem={windowItem}
        snapshot={snapshot}
        meta={windowItem.metadata?.graphSettings ? 'This graph has its own settings' : 'As set in Libraries ▸ Graph defaults'}
      >
        <Stats label="Drawing figures" columns={3}>
          <Stat label="Shown" value={formatCount(shownCount)} note={`of ${formatCount(snapshot.nodes)} nodes`} />
          <Stat label="Limit" value={formatCount(cap)} note={renderer !== RENDERERS.WEBGL ? 'nodes at once' : gpuLimits.measured ? 'from benchmark' : 'until benchmarked'} />
          <Stat label="Drawn by" value={renderer === RENDERERS.WEBGL ? 'GPU' : 'Standard'} note="Libraries" text />
        </Stats>
      </GraphPanelHeader>

      <PanelBlock
        title="Drawing"
        actions={<button type="button" className="settings_button is-compact" title="Back to Libraries ▸ Graph defaults; this graph's own rules are cleared too" onClick={() => updateSettings(getGraphDefaults())}>Reset this graph</button>}
      >
        <div className="config_card">
          <PanelSwitch label="Performance mode" checked={settings.performance} onChange={(checked) => patch({ performance: checked })} />
          {settings.performance ? <PanelHint>Labels, titles, edge weights and physics are off while it is on.</PanelHint> : null}
        </div>
      </PanelBlock>

      <PanelBlock title="Nodes shown">
        <div className="config_card">
          <PanelField label="Order by">
            <select className="settings_input" value={settings.limit.key} disabled={!hasData} onChange={(event) => patch({ limit: { ...settings.limit, key: event.target.value } })}>
              <option value="">Arrival order</option>
              {keys.map((key) => <option key={key} value={key}>{key}</option>)}
            </select>
          </PanelField>
          {settings.limit.key ? (
            <>
              <PanelField label="Direction">
                <select className="settings_input" value={settings.limit.sort} onChange={(event) => patch({ limit: { ...settings.limit, sort: event.target.value } })}>
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </PanelField>
              <PanelHint>Nodes without “{settings.limit.key}” are left out while ordering by it.</PanelHint>
            </>
          ) : null}
          <RangeInputs limit={settings.limit} disabled={!hasData} onCommit={(range) => patch({ limit: { ...settings.limit, ...range } })} />
          {count > cap ? (
            <PanelHint warning>
              Limited to {formatCount(cap)}: {renderer !== RENDERERS.WEBGL ? 'the most standard drawing shows at once.' : gpuLimits.measured ? 'this computer’s GPU benchmark (Libraries ▸ Graph rendering).' : 'a temporary limit, until the GPU benchmark is run (Libraries ▸ Graph rendering).'}
            </PanelHint>
          ) : heldAt ? (
            <PanelHint warning>Kept at {formatCount(heldAt)}, where your changes were made. Change the range to start again with up to {formatCount(cap)}.</PanelHint>
          ) : shownCount > warnAt ? (
            <PanelHint warning>Showing more than {formatCount(warnAt)} nodes may be slow.</PanelHint>
          ) : null}
        </div>
      </PanelBlock>

      <PanelBlock title="Labels and cards">
        <div className="config_card">
          <PanelSwitch label="Show labels" checked={settings.showLabels && !settings.performance} disabled={settings.performance} onChange={(checked) => patch({ showLabels: checked })} />
          <PanelField label="Label by property">
            <select className="settings_input"
              value={settings.labels.byKey}
              disabled={!hasData || settings.performance}
              // Production turns labels on when a label key is chosen.
              onChange={(event) => patch({ labels: { ...settings.labels, byKey: event.target.value }, showLabels: event.target.value ? true : settings.showLabels })}
            >
              <option value="">Node label</option>
              {keys.map((key) => <option key={key} value={key}>{key}</option>)}
            </select>
          </PanelField>
          {settings.labels.byKey ? (
            <PanelField label="For nodes of type">
              <select className="settings_input" value={settings.labels.group || LABEL_GROUPS[0]} onChange={(event) => patch({ labels: { ...settings.labels, group: event.target.value } })}>
                {LABEL_GROUPS.map((group) => <option key={group} value={group}>{group}</option>)}
              </select>
            </PanelField>
          ) : null}

          <PanelSwitch label="Show titles on hover" checked={settings.showTitles && !settings.performance} disabled={settings.performance} onChange={(checked) => patch({ showTitles: checked })} />
          {/* What the card shows is set per domain (Configuration ▸ Rules ▸
            Profile mapping fields); here only whether this graph shows it. */}
          <PanelSwitch label="Show actor profile on node click" title="The card a node click shows; its details are set in Configuration ▸ Rules ▸ Profile mapping fields" checked={settings.actorProfile} onChange={(checked) => patch({ actorProfile: checked })} />
          <PanelSwitch label="Use domain formatting rules" title="The domain's formatting rules (Configuration ▸ Rules ▸ Formatting rules), below this graph's own" checked={settings.useDomainRules} onChange={(checked) => patch({ useDomainRules: checked })} />
        </div>
      </PanelBlock>

      <PanelBlock title="Edges">
        <div className="config_card">
          <PanelField label="Edge weight">
            <select className="settings_input" value={settings.performance ? '' : settings.edgeWeight} disabled={!hasData || settings.performance} onChange={(event) => patch({ edgeWeight: event.target.value })}>
              <option value="">Off</option>
              <option value="default">Default (edge weight)</option>
              {keys.map((key) => <option key={key} value={key}>By {key}</option>)}
            </select>
          </PanelField>

          {/* Link aggregation (G3.5 i2 #2; not in production): view only. */}
          <PanelSwitch label="Aggregate links" title="Links between the same two nodes drawn as one, with how many and a total; double-click one to expand it" checked={settings.linkAggregation.on} onChange={(checked) => patch({ linkAggregation: { ...settings.linkAggregation, on: checked } })} />
          {settings.linkAggregation.on ? (
            <>
              <PanelField label="Aggregate">
                <select className="settings_input" value={settings.linkAggregation.mode} onChange={(event) => patch({ linkAggregation: { ...settings.linkAggregation, mode: event.target.value } })}>
                  <option value="combined">Both directions together</option>
                  <option value="direction">Each direction apart</option>
                </select>
              </PanelField>
              <PanelField label="Total of">
                <select className="settings_input" value={settings.linkAggregation.totalKey} disabled={!hasData && !settings.linkAggregation.totalKey} onChange={(event) => patch({ linkAggregation: { ...settings.linkAggregation, totalKey: event.target.value } })}>
                  <option value="">No total (count only)</option>
                  {settings.linkAggregation.totalKey && !edgeKeys.includes(settings.linkAggregation.totalKey)
                    ? <option value={settings.linkAggregation.totalKey}>{settings.linkAggregation.totalKey} (not in this graph)</option>
                    : null}
                  {edgeKeys.map((key) => <option key={key} value={key}>{key}</option>)}
                </select>
              </PanelField>
              <PanelHint>Double-click an aggregated link (or right-click ▸ Expand Links) to show its links; again to merge them back.{settings.edgeBundling ? ' Edge bundling is not applied while links are aggregated.' : ''}</PanelHint>
            </>
          ) : null}
        </div>
      </PanelBlock>

      <PanelBlock title="Layout">
        <div className="config_card">
          <PanelField label="Layout">
            <select className="settings_input"
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
          </PanelField>
          {settings.layout.type === 'hierarchical' && shownCount >= GRAPH_LIMITS.PHYSICS_AUTO_OFF_AT ? (
            <PanelHint>Hierarchical needs fewer than {GRAPH_LIMITS.PHYSICS_AUTO_OFF_AT} shown nodes; layered is used instead.</PanelHint>
          ) : null}
          {settings.layout.type === 'hierarchical' || settings.layout.type === 'layered' ? (
            <PanelField label="Direction">
              <select className="settings_input" value={settings.layout.direction} onChange={(event) => patch({ layout: { ...settings.layout, direction: event.target.value } })}>
                <option value="UD">Top to bottom</option>
                <option value="LR">Left to right</option>
              </select>
            </PanelField>
          ) : null}
          {settings.layout.type === 'hierarchical' ? (
            <PanelField label="Order levels by">
              <select className="settings_input" value={settings.layout.sortMethod} onChange={(event) => patch({ layout: { ...settings.layout, sortMethod: event.target.value } })}>
                <option value="directed">Edge direction</option>
                <option value="hubsize">Hub size</option>
              </select>
            </PanelField>
          ) : null}
          {settings.layout.type === 'grouped' ? (
            <>
              <PanelField label="Group by">
                <select className="settings_input" value={settings.layout.layerMode === 'by_key' ? 'by_key' : 'node_identity'} onChange={(event) => patch({ layout: { ...settings.layout, layerMode: event.target.value } })}>
                  <option value="node_identity">Node type</option>
                  <option value="by_key">A property</option>
                </select>
              </PanelField>
              {settings.layout.layerMode === 'by_key' ? (
                <PanelField label="Group property">
                  <select className="settings_input" value={settings.layout.layerKey} disabled={!hasData} onChange={(event) => patch({ layout: { ...settings.layout, layerKey: event.target.value } })}>
                    <option value="">Choose a property</option>
                    {keys.map((key) => <option key={key} value={key}>{key}</option>)}
                  </select>
                </PanelField>
              ) : null}
            </>
          ) : null}
          {settings.layout.type === 'layered' ? (
            <>
              <PanelField label="Layers by">
                <select className="settings_input" value={settings.layout.layerMode} onChange={(event) => patch({ layout: { ...settings.layout, layerMode: event.target.value } })}>
                  <option value="hop_distance">Distance from the source</option>
                  <option value="node_identity">Node type</option>
                  <option value="by_key">A property</option>
                </select>
              </PanelField>
              {settings.layout.layerMode === 'by_key' ? (
                <PanelField label="Layer property">
                  <select className="settings_input" value={settings.layout.layerKey} disabled={!hasData} onChange={(event) => patch({ layout: { ...settings.layout, layerKey: event.target.value } })}>
                    <option value="">Choose a property</option>
                    {keys.map((key) => <option key={key} value={key}>{key}</option>)}
                  </select>
                </PanelField>
              ) : null}
            </>
          ) : null}
          <PanelSwitch label="Physics" checked={settings.physics && !settings.performance && shownCount < GRAPH_LIMITS.PHYSICS_AUTO_OFF_AT} disabled={settings.performance || shownCount >= GRAPH_LIMITS.PHYSICS_AUTO_OFF_AT} onChange={(checked) => patch({ physics: checked })} />
          {shownCount >= GRAPH_LIMITS.PHYSICS_AUTO_OFF_AT ? (
            <PanelHint>Physics stays off with {GRAPH_LIMITS.PHYSICS_AUTO_OFF_AT} or more shown nodes.</PanelHint>
          ) : null}
        </div>
      </PanelBlock>
    </>
  );
}
