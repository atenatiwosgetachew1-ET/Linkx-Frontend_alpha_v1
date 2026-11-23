import React, { useSyncExternalStore } from 'react';

import { Block, Masthead, Option, PageHero, Pill, SettingsPage, Stat, Stats } from '../../settings/components/SettingsPage.jsx';
import { Field } from '../../../shared/components/form/FormFields.jsx';
import { TABLE_SCOPES } from '../../table/lib/tableRows.js';
import { COLOR_SCHEMAS, SCHEMA_NAMES } from '../../chart/lib/chartColors.js';
import { CHART_METRICS, METRIC_GROUPS, isMetricAvailable } from '../../chart/lib/chartMetrics.js';
import {
  builtinAutoMetrics,
  getChartDefaults,
  isBuiltinChartDefaults,
  resetChartDefaults,
  setChartDefaults,
  subscribeChartDefaults,
} from '../../chart/lib/chartDefaults.js';

// Libraries ▸ Charts (analyst request 2026-11-23): how a new Chart window
// starts. Scope: this device (kept in this browser). A Chart window follows
// these until it has settings of its own.

const MODES = [
  { id: 'auto', label: 'Automatic', hint: 'The starting charts come up by themselves once the window is linked to a graph.' },
  { id: 'manual', label: 'Manual', hint: 'The board starts empty; charts are added in the window (New chart).' },
];
const SCHEMA_ICON = 'M12 22a10 10 0 1 1 10-10c0 2.2-1.8 3.5-4 3.5h-1.8a1.7 1.7 0 0 0-1.2 2.9c.6.6.4 1.6-.3 2.1-.8.9-1.7 1.5-2.7 1.5zM7.5 10.5h.01M12 7.5h.01M16.5 10.5h.01';
// A schema from one end to the other, as a strip.
const schemaStrip = (name) => `linear-gradient(to right, ${[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => COLOR_SCHEMAS[name](t)).join(', ')})`;

// A choice among a few: pills, one filled.
function Choice({ label, options, value, onChange }) {
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
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default function ChartDefaultsPanel() {
  const defaults = useSyncExternalStore(subscribeChartDefaults, getChartDefaults);
  const auto = defaults.mode === 'auto';
  const chosen = new Set(defaults.autoMetrics);
  const available = CHART_METRICS.filter(isMetricAvailable);
  const scope = TABLE_SCOPES.find((entry) => entry.id === defaults.scope);
  const mode = MODES.find((entry) => entry.id === defaults.mode);
  const untouched = isBuiltinChartDefaults(defaults);

  const toggleMetric = (id) => setChartDefaults({ autoMetrics: chosen.has(id) ? defaults.autoMetrics.filter((item) => item !== id) : [...defaults.autoMetrics, id] });
  const groupIds = (groupId) => available.filter((metric) => metric.group === groupId).map((metric) => metric.id);
  const setGroup = (groupId, on) => {
    const ids = groupIds(groupId);
    setChartDefaults({ autoMetrics: on ? [...new Set([...defaults.autoMetrics, ...ids])] : defaults.autoMetrics.filter((id) => !ids.includes(id)) });
  };

  return (
    <SettingsPage className="config_page libraries_page libraries_charts">
      <Masthead>
        <PageHero
          tone={untouched ? '' : 'active'}
          eyebrow="Chart defaults"
          title="Chart window defaults"
          pill={<Pill tone={untouched ? 'neutral' : 'active'}>{untouched ? 'Built-in defaults' : 'Customised'}</Pill>}
          meta="How a new Chart window starts: what it measures, which charts come up by themselves, and how they are coloured."
          media={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18M7 16v-5M11.5 16V8M16 16v-3M20.5 16V6" />
            </svg>
          )}
        >
          <button type="button" className="settings_button" disabled={untouched} onClick={resetChartDefaults} title="Put every setting on this page back as it was built in">Reset to built-in</button>
        </PageHero>
        <Stats label="Chart default figures" columns={4}>
          <Stat text icon="layers" label="Scope" value={scope?.label || '—'} note="what a chart measures" />
          <Stat text icon="bolt" label="Generation" value={mode?.label || '—'} note={auto ? 'charts come up by themselves' : 'the board starts empty'} />
          <Stat lead icon="list" label="Starting charts" value={auto ? defaults.autoMetrics.length.toLocaleString() : '0'} note={auto ? `of ${available.length} charts` : 'manual generation'} />
          <Stat text icon="sun" label="Colours" value={defaults.colorful ? defaults.schema : 'Greyscale'} note={defaults.colorful ? 'colour schema' : 'colour off'} />
        </Stats>
      </Masthead>

      <p className="settings_hint">A Chart window follows these until it has settings of its own (its first change, or its first charts coming up); windows already set up keep what they have.</p>

      <Block title="Starting point" description="What a new Chart window measures, and whether it fills its board by itself.">
        <div className="config_card">
          <div className="config_card_grid">
            <div className="config_window_field">
              <span className="config_window_field_label">Scope</span>
              <Choice label="Scope" options={TABLE_SCOPES} value={defaults.scope} onChange={(value) => setChartDefaults({ scope: value })} />
              <small className="config_window_field_hint">{scope?.hint}.</small>
            </div>
            <div className="config_window_field">
              <span className="config_window_field_label">Generation</span>
              <Choice label="Generation" options={MODES} value={defaults.mode} onChange={(value) => setChartDefaults({ mode: value })} />
              <small className="config_window_field_hint">{mode?.hint}</small>
            </div>
          </div>
        </div>
      </Block>

      <Block
        title="Starting charts"
        description={auto ? 'The charts that come up by themselves once a Chart window is linked to a graph. Others are added in the window.' : 'Generation is Manual, so none come up by themselves. Switch to Automatic to choose them.'}
        actions={(
          <>
            <button type="button" className="settings_button" disabled={!auto} onClick={() => setChartDefaults({ autoMetrics: builtinAutoMetrics() })}>Global only</button>
            <button type="button" className="settings_button" disabled={!auto || defaults.autoMetrics.length === 0} onClick={() => setChartDefaults({ autoMetrics: [] })}>None</button>
          </>
        )}
      >
        <div className={`config_card libraries_metrics${auto ? '' : ' is-off'}`}>
          {METRIC_GROUPS.map((group) => {
            const ids = groupIds(group.id);
            const on = ids.filter((id) => chosen.has(id)).length;
            return (
              <React.Fragment key={group.id}>
                <p className="config_card_label">
                  {group.label}
                  <span className="libraries_metrics_count">{on} of {ids.length}</span>
                  <button type="button" className="libraries_metrics_all" disabled={!auto} onClick={() => setGroup(group.id, on !== ids.length)}>{on === ids.length ? 'Clear' : 'All'}</button>
                </p>
                <div className="libraries_choices" role="group" aria-label={group.label}>
                  {available.filter((metric) => metric.group === group.id).map((metric) => (
                    <button
                      key={metric.id}
                      type="button"
                      aria-pressed={chosen.has(metric.id)}
                      className={`libraries_choice${chosen.has(metric.id) ? ' is-on' : ''}`}
                      title={metric.hint}
                      disabled={!auto}
                      onClick={() => toggleMetric(metric.id)}
                    >
                      {metric.label}
                      {metric.advanced ? <small>specialist</small> : null}
                    </button>
                  ))}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </Block>

      <Block title="Colours and selection" description="How new charts are coloured, and whether they follow what is selected on the graph.">
        <div className="settings_options">
          <Option
            icon="glass"
            title="Colour charts by a schema"
            description="Off: charts are drawn in shades of grey."
            checked={defaults.colorful}
            onChange={(checked) => setChartDefaults({ colorful: checked })}
          />
          <Option
            icon="motion"
            title="Follow selection"
            description="Each chart zooms to what is selected on the graph."
            checked={defaults.follow}
            onChange={(checked) => setChartDefaults({ follow: checked })}
          />
        </div>
        <div className="config_card">
          <div className="config_card_grid">
            <Field icon={SCHEMA_ICON} label="Colour schema">
              <select className="settings_input" value={defaults.schema} disabled={!defaults.colorful} onChange={(event) => setChartDefaults({ schema: event.target.value })}>
                {SCHEMA_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </Field>
            <div className="config_window_field">
              <span className="config_window_field_label">Preview</span>
              <span className={`libraries_schema_strip${defaults.colorful ? '' : ' is-off'}`} style={{ backgroundImage: schemaStrip(defaults.colorful ? defaults.schema : 'Grayscale') }} role="img" aria-label={`${defaults.colorful ? defaults.schema : 'Greyscale'} colours, low to high`} />
              <small className="config_window_field_hint">Low values on the left, high on the right.</small>
            </div>
          </div>
        </div>
      </Block>
    </SettingsPage>
  );
}
