import React, { useEffect, useState, useSyncExternalStore } from 'react';

import { Block, Masthead, Option, PageHero, Pill, SettingsPage, Stat, Stats } from '../../settings/components/SettingsPage.jsx';
import { Field, InfoTip } from '../../../shared/components/form/FormFields.jsx';
import { GRAPH_LIMITS, LAYOUT_TYPES } from '../../graph/lib/graphSettings.js';
import {
  GRAPH_DEFAULT_LIMIT_MAX,
  getGraphDefaults,
  isBuiltinGraphDefaults,
  resetGraphDefaults,
  setGraphDefaults,
  subscribeGraphDefaults,
} from '../../graph/lib/graphDefaults.js';
import { OVERLAY_COMPONENTS, getOverlayPrefs, setOverlayPref, subscribeOverlayPrefs } from '../../graph/lib/overlayPrefs.js';

// Libraries ▸ Graph defaults (analyst request 2026-11-23): how a new Graph
// window starts. Scope: this device (kept in this browser). A Graph window
// follows these until it has settings of its own.

const LAYOUTS = {
  concentric: ['Concentric', 'Rings around the most connected entities.'],
  hierarchical: ['Hierarchical', `Levels, top down. Needs fewer than ${GRAPH_LIMITS.PHYSICS_AUTO_OFF_AT} shown nodes; layered is used above that.`],
  layered: ['Layered', 'Layers by distance from the start, for larger graphs.'],
  circle: ['Circle', 'Every entity on one circle.'],
  star: ['Star', 'One hub in the middle, the rest around it.'],
  radial: ['Radial', 'Rings by distance from the centre.'],
  grid: ['Grid', 'Rows and columns.'],
  spiral: ['Spiral', 'One line winding out from the centre.'],
  peacock: ['Peacock', 'Hubs with their leaves fanned around them.'],
  grouped: ['Grouped', 'Clusters by node type.'],
};
const LAYOUT_OPTIONS = LAYOUT_TYPES.map((id) => ({ id, label: LAYOUTS[id]?.[0] || id, hint: LAYOUTS[id]?.[1] || '' }));
const DIRECTIONS = [{ id: 'UD', label: 'Top to bottom' }, { id: 'LR', label: 'Left to right' }];
const LEVEL_ORDERS = [{ id: 'directed', label: 'Edge direction' }, { id: 'hubsize', label: 'Hub size' }];
const SORTS = [{ id: 'asc', label: 'First to last' }, { id: 'desc', label: 'Last to first' }];
const ICONS = {
  count: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
  sort: 'M3 6h18M6 12h12M10 18h4',
  bundle: 'M3 6c6 0 6 6 9 6s3-6 9-6M3 18c6 0 6-6 9-6s3 6 9 6',
};

// A choice among a few: pills, one filled.
function Choice({ label, options, value, onChange, disabled = false }) {
  return (
    <div className="libraries_choices" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          className={`libraries_choice${option.id === value ? ' is-on' : ''}`}
          title={option.hint}
          disabled={disabled}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// A whole number typed freely, kept on blur or Enter.
function NumberInput({ value, min, max, onCommit, ...rest }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const number = Math.floor(Number(draft));
    if (Number.isFinite(number)) onCommit(Math.max(min, Math.min(max, number)));
    else setDraft(String(value));
  };
  return (
    <input
      {...rest}
      type="number"
      className="settings_input"
      min={min}
      max={max}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
    />
  );
}

export default function GraphDefaultsPanel() {
  const defaults = useSyncExternalStore(subscribeGraphDefaults, getGraphDefaults);
  const overlays = useSyncExternalStore(subscribeOverlayPrefs, getOverlayPrefs);
  const untouched = isBuiltinGraphDefaults(defaults);
  const fast = defaults.performance;
  const layout = LAYOUT_OPTIONS.find((entry) => entry.id === defaults.layout.type);
  const shownOverlays = OVERLAY_COMPONENTS.filter((component) => overlays[component.key]).length;
  const drawn = fast ? [] : [defaults.showLabels && 'labels', defaults.showTitles && 'titles', defaults.edgeWeight && 'link weights'].filter(Boolean);
  const overPhysics = defaults.limit.max >= GRAPH_LIMITS.PHYSICS_AUTO_OFF_AT;

  return (
    <SettingsPage className="config_page libraries_page libraries_graphs">
      <Masthead>
        <PageHero
          tone={untouched ? '' : 'active'}
          eyebrow="Graph defaults"
          title="Graph window defaults"
          pill={<Pill tone={untouched ? 'neutral' : 'active'}>{untouched ? 'Built-in defaults' : 'Customised'}</Pill>}
          meta="How a new Graph window starts: how much it shows first, how it is laid out, what it draws, and which helpers are on."
          media={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v6M8.6 7.5l6.8 9" />
            </svg>
          )}
        >
          <button type="button" className="settings_button" disabled={untouched} onClick={resetGraphDefaults} title="Put every graph setting on this page back as it was built in (the on-graph components are not changed)">Reset to built-in</button>
        </PageHero>
        <Stats label="Graph default figures" columns={4}>
          <Stat lead icon="list" label="Shown first" value={defaults.limit.max.toLocaleString()} note="nodes" />
          <Stat text icon="layers" label="Layout" value={layout?.label || '—'} note={defaults.layout.type === 'hierarchical' || defaults.layout.type === 'layered' ? (defaults.layout.direction === 'LR' ? 'left to right' : 'top to bottom') : 'starting layout'} />
          <Stat text icon="bolt" label="Performance mode" value={fast ? 'On' : 'Off'} note={fast ? 'labels, weights and physics off' : (drawn.length ? `draws ${drawn.join(', ')}` : 'nothing extra drawn')} />
          <Stat icon="check" label="On-graph components" value={shownOverlays.toLocaleString()} note={`of ${OVERLAY_COMPONENTS.length} shown`} />
        </Stats>
      </Masthead>

      <p className="settings_hint">A Graph window follows these until it has settings of its own (its first change); windows already set up keep what they have. What depends on the data (a label's property, link aggregation, formatting rules) is set in each graph.</p>

      <Block title="First view" description="How much of a graph is drawn when it opens, and how it is arranged.">
        <div className="config_card">
          <div className="config_card_grid">
            <Field icon={ICONS.count} label={<>Nodes shown first<InfoTip text={`How many nodes a graph draws when it is fetched. Range 1 to ${GRAPH_DEFAULT_LIMIT_MAX.toLocaleString()} · Default ${GRAPH_LIMITS.DEFAULT_VISIBLE} · Above ${GRAPH_LIMITS.WARNING} the Graph window warns that it may slow down.`} /></>}>
              <NumberInput aria-label="Nodes shown first" value={defaults.limit.max} min={1} max={GRAPH_DEFAULT_LIMIT_MAX} onCommit={(max) => setGraphDefaults({ limit: { max } })} />
            </Field>
            <div className="config_window_field">
              <span className="config_window_field_label">Order of the nodes<InfoTip text="Which end of the graph's own order the first nodes are taken from." /></span>
              <Choice label="Order of the nodes" options={SORTS} value={defaults.limit.sort} onChange={(sort) => setGraphDefaults({ limit: { sort } })} />
            </div>
          </div>
          {defaults.limit.max > GRAPH_LIMITS.WARNING ? <p className="settings_hint" role="status">More than {GRAPH_LIMITS.WARNING} nodes at once can make standard drawing slow.</p> : null}
          <p className="config_card_label">Layout</p>
          <Choice label="Layout" options={LAYOUT_OPTIONS} value={defaults.layout.type} onChange={(type) => setGraphDefaults({ layout: { type, ...(type === 'hierarchical' ? { direction: 'UD', sortMethod: 'directed' } : {}) } })} />
          <small className="config_window_field_hint">{layout?.hint}</small>
          {defaults.layout.type === 'hierarchical' || defaults.layout.type === 'layered' ? (
            <div className="config_card_grid">
              <div className="config_window_field">
                <span className="config_window_field_label">Direction</span>
                <Choice label="Direction" options={DIRECTIONS} value={defaults.layout.direction} onChange={(direction) => setGraphDefaults({ layout: { direction } })} />
              </div>
              {defaults.layout.type === 'hierarchical' ? (
                <div className="config_window_field">
                  <span className="config_window_field_label">Order levels by</span>
                  <Choice label="Order levels by" options={LEVEL_ORDERS} value={defaults.layout.sortMethod} onChange={(sortMethod) => setGraphDefaults({ layout: { sortMethod } })} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Block>

      <Block title="Drawing" description="What a new graph draws. Performance mode keeps large graphs quick by leaving the rest off.">
        <div className="settings_options">
          <Option icon="motion" title="Performance mode" description="Labels, titles, link weights and physics stay off while it is on." checked={defaults.performance} onChange={(performance) => setGraphDefaults({ performance })} />
          <Option icon="edit" title="Show labels" description="The name beside each node." checked={!fast && defaults.showLabels} disabled={fast} onChange={(showLabels) => setGraphDefaults({ showLabels })} />
          <Option icon="layout" title="Show titles" description="The title over each link." checked={!fast && defaults.showTitles} disabled={fast} onChange={(showTitles) => setGraphDefaults({ showTitles })} />
          <Option icon="link" title="Show link weights" description="Each link's weight, drawn on it." checked={!fast && defaults.edgeWeight === 'default'} disabled={fast} onChange={(on) => setGraphDefaults({ edgeWeight: on ? 'default' : '' })} />
          <Option icon="glass" title="Physics" description={overPhysics ? `Nodes settle by themselves. Off anyway from ${GRAPH_LIMITS.PHYSICS_AUTO_OFF_AT} shown nodes.` : 'Nodes settle by themselves after a layout.'} checked={!fast && defaults.physics} disabled={fast} onChange={(physics) => setGraphDefaults({ physics })} />
        </div>
      </Block>

      <Block title="Helpers" description="What a new graph has turned on.">
        <div className="settings_options">
          <Option icon="bell" title="Alert rules" description="Scan the graph for alerts as it loads." checked={defaults.alertRules} onChange={(alertRules) => setGraphDefaults({ alertRules })} />
          <Option icon="user" title="Actor profile card" description="Open the profile card when a node is clicked." checked={defaults.actorProfile} onChange={(actorProfile) => setGraphDefaults({ actorProfile })} />
          <Option icon="globe" title="Domain formatting rules" description="Apply the domain's rules (Configuration ▸ Rules) under the graph's own." checked={defaults.useDomainRules} onChange={(useDomainRules) => setGraphDefaults({ useDomainRules })} />
          <Option icon="link" title="Edge bundling" description="Draw links between the same pair as one bundle." checked={defaults.edgeBundling} onChange={(edgeBundling) => setGraphDefaults({ edgeBundling })} />
        </div>
        {defaults.edgeBundling ? (
          <div className="config_card">
            <div className="config_card_grid">
              <Field icon={ICONS.bundle} label={<>Smallest bundle<InfoTip text="How many links a pair needs before they are bundled. Range 2 to 50 · Default 2" /></>}>
                <NumberInput aria-label="Smallest bundle" value={defaults.edgeBundleMin} min={2} max={50} onCommit={(edgeBundleMin) => setGraphDefaults({ edgeBundleMin })} />
              </Field>
            </div>
          </div>
        ) : null}
      </Block>

      <Block title="On-graph components" description="The cards and marks drawn over a graph. These apply at once to every Graph window on this device, open ones too.">
        <div className="settings_options" role="group" aria-label="On-graph components">
          {OVERLAY_COMPONENTS.map((component) => (
            <Option key={component.key} title={component.label} description={`${component.hint}.`} checked={overlays[component.key]} onChange={(on) => setOverlayPref(component.key, on)} />
          ))}
        </div>
      </Block>
    </SettingsPage>
  );
}
