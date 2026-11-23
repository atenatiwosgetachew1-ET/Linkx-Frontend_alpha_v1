import React, { useSyncExternalStore } from 'react';

import { Block, Masthead, Option, PageHero, Pill, SettingsPage, Stat, Stats } from '../../settings/components/SettingsPage.jsx';
import { Field } from '../../../shared/components/form/FormFields.jsx';
import { LINK_BUILT_INS, NODE_BUILT_INS, TABLE_SCOPES } from '../../table/lib/tableRows.js';
import {
  getTableDefaults,
  isBuiltinTableDefaults,
  resetTableDefaults,
  setTableDefaults,
  subscribeTableDefaults,
} from '../../table/lib/tableDefaults.js';

// Libraries ▸ Table defaults (analyst request 2026-11-23): how a new Table
// window starts. Scope: this device (kept in this browser). A Table window
// follows these until it has settings of its own.

const TABS = [
  { id: 'nodes', label: 'Nodes', hint: 'The graph’s entities as rows.' },
  { id: 'links', label: 'Links', hint: 'The graph’s links as rows.' },
];
const DIRECTIONS = [{ id: 'asc', label: 'Ascending' }, { id: 'desc', label: 'Descending' }];
const PRINT_ROWS = [
  { id: 'shown', label: 'As shown', hint: 'Filtered and sorted as in the window.' },
  { id: 'all', label: 'All in the scope', hint: 'Without the filter.' },
  { id: 'selected', label: 'Selected on the graph', hint: 'Only what is selected.' },
];
const PRINT_PAGES = [
  { id: 'auto', label: 'Auto', hint: 'Landscape once there are many columns.' },
  { id: 'portrait', label: 'Portrait', hint: 'A4 upright.' },
  { id: 'landscape', label: 'Landscape', hint: 'A4 on its side.' },
];
const SORT_ICON = 'M3 6h18M6 12h12M10 18h4';
const BUILT_INS = { nodes: NODE_BUILT_INS, links: LINK_BUILT_INS };

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

// One tab's built-in columns (shown or not) and how its rows are sorted.
function TabColumns({ tab, title, defaults }) {
  const columns = BUILT_INS[tab];
  const hidden = defaults.hidden[tab];
  const shown = columns.length - hidden.length;
  const sort = defaults.sort[tab];
  const toggle = (key) => setTableDefaults({ hidden: { [tab]: hidden.includes(key) ? hidden.filter((item) => item !== key) : [...hidden, key] } });
  return (
    <>
      <p className="config_card_label">{title}<span className="libraries_metrics_count">{shown} of {columns.length} shown</span></p>
      <div className="libraries_choices" role="group" aria-label={`${title} columns`}>
        {columns.map((column) => {
          const on = !hidden.includes(column.key);
          return (
            <button
              key={column.key}
              type="button"
              aria-pressed={on}
              className={`libraries_choice${on ? ' is-on' : ''}`}
              // The last one shown cannot be hidden.
              disabled={on && shown === 1}
              title={on ? 'Shown: click to hide it by default' : 'Hidden: click to show it by default'}
              onClick={() => toggle(column.key)}
            >
              {column.label}
            </button>
          );
        })}
      </div>
      <div className="config_card_grid">
        <Field icon={SORT_ICON} label={`Sort ${title.toLowerCase()} by`}>
          <select
            className="settings_input"
            value={sort?.key || ''}
            onChange={(event) => setTableDefaults({ sort: { [tab]: event.target.value ? { key: event.target.value, dir: sort?.dir || 'asc' } : null } })}
          >
            <option value="">No sorting (the graph’s order)</option>
            {columns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
          </select>
        </Field>
        <div className="config_window_field">
          <span className="config_window_field_label">Direction</span>
          <Choice label={`${title} sort direction`} options={DIRECTIONS} value={sort?.dir || 'asc'} disabled={!sort} onChange={(dir) => setTableDefaults({ sort: { [tab]: { key: sort.key, dir } } })} />
        </div>
      </div>
    </>
  );
}

export default function TableDefaultsPanel() {
  const defaults = useSyncExternalStore(subscribeTableDefaults, getTableDefaults);
  const untouched = isBuiltinTableDefaults(defaults);
  const tab = TABS.find((entry) => entry.id === defaults.tab);
  const scope = TABLE_SCOPES.find((entry) => entry.id === defaults.scope);
  const total = NODE_BUILT_INS.length + LINK_BUILT_INS.length;
  const shown = total - defaults.hidden.nodes.length - defaults.hidden.links.length;
  const sortOfTab = defaults.sort[defaults.tab];
  const sortLabel = sortOfTab ? BUILT_INS[defaults.tab].find((column) => column.key === sortOfTab.key)?.label : '';

  return (
    <SettingsPage className="config_page libraries_page libraries_tables">
      <Masthead>
        <PageHero
          tone={untouched ? '' : 'active'}
          eyebrow="Table defaults"
          title="Table window defaults"
          pill={<Pill tone={untouched ? 'neutral' : 'active'}>{untouched ? 'Built-in defaults' : 'Customised'}</Pill>}
          meta="How a new Table window starts: the rows it opens on, its columns and their order, and how Print table begins."
          media={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 5h16v14H4zM4 10h16M4 15h16M10 5v14" />
            </svg>
          )}
        >
          <button type="button" className="settings_button" disabled={untouched} onClick={resetTableDefaults} title="Put every setting on this page back as it was built in">Reset to built-in</button>
        </PageHero>
        <Stats label="Table default figures" columns={4}>
          <Stat text icon="list" label="Opens on" value={tab?.label || '—'} note="first tab" />
          <Stat text icon="layers" label="Scope" value={scope?.label || '—'} note="which rows are listed" />
          <Stat lead icon="check" label="Built-in columns" value={shown.toLocaleString()} note={`of ${total} shown`} />
          <Stat text icon="bolt" label="Sorted by" value={sortLabel || 'Graph order'} note={sortOfTab ? (sortOfTab.dir === 'desc' ? 'descending' : 'ascending') : 'no sorting'} />
        </Stats>
      </Masthead>

      <p className="settings_hint">A Table window follows these until it has settings of its own (its first change); windows already set up keep what they have. Property columns come from each graph’s data and are shown or hidden in the window.</p>

      <Block title="Starting point" description="Which rows a new Table window lists first.">
        <div className="config_card">
          <div className="config_card_grid">
            <div className="config_window_field">
              <span className="config_window_field_label">Opens on</span>
              <Choice label="Opens on" options={TABS} value={defaults.tab} onChange={(value) => setTableDefaults({ tab: value })} />
              <small className="config_window_field_hint">{tab?.hint}</small>
            </div>
            <div className="config_window_field">
              <span className="config_window_field_label">Scope</span>
              <Choice label="Scope" options={TABLE_SCOPES} value={defaults.scope} onChange={(value) => setTableDefaults({ scope: value })} />
              <small className="config_window_field_hint">{scope?.hint}.</small>
            </div>
          </div>
        </div>
        <div className="settings_options libraries_gpu_option">
          <Option
            icon="motion"
            title="Follow selection"
            description="Scroll to what is selected on the graph."
            checked={defaults.follow}
            onChange={(follow) => setTableDefaults({ follow })}
          />
        </div>
      </Block>

      <Block title="Columns and order" description="The built-in columns each tab shows first, and how its rows are sorted.">
        <div className="config_card">
          <TabColumns tab="nodes" title="Nodes" defaults={defaults} />
          <TabColumns tab="links" title="Links" defaults={defaults} />
        </div>
      </Block>

      <Block title="Print table" description="How Export ▸ Print table… starts. Both can still be changed in the dialog.">
        <div className="config_card">
          <div className="config_card_grid">
            <div className="config_window_field">
              <span className="config_window_field_label">Rows</span>
              <Choice label="Rows to print" options={PRINT_ROWS} value={defaults.print.rows} onChange={(rows) => setTableDefaults({ print: { rows } })} />
              <small className="config_window_field_hint">{PRINT_ROWS.find((entry) => entry.id === defaults.print.rows)?.hint}</small>
            </div>
            <div className="config_window_field">
              <span className="config_window_field_label">Page</span>
              <Choice label="Page orientation" options={PRINT_PAGES} value={defaults.print.page} onChange={(page) => setTableDefaults({ print: { page } })} />
              <small className="config_window_field_hint">{PRINT_PAGES.find((entry) => entry.id === defaults.print.page)?.hint}</small>
            </div>
          </div>
        </div>
      </Block>
    </SettingsPage>
  );
}
