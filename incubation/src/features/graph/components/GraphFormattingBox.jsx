import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  BUILT_IN_KEYS, OPERATORS, describeRule, matchCounts, matchingIds, newRuleId, normalizeRule,
} from '../lib/conditionalFormatting.js';
import { EDGE_STYLES, EDGE_WIDTH_RANGE, NODE_SHAPES } from '../lib/graphEditing.js';
import { iconForTheme, resolveIconUrl, themeModeOf } from '../lib/graphIcons.js';
import { LiveColor, Swatches } from './GraphAdjustBox.jsx';
import { IconAlbumPopover } from './GraphCustomizeBox.jsx';

// Conditional formatting editor (G3.5 i2 #4; analyst decision 2026-11-16):
// toolbar ▸ Conditional formatting, or right-click ▸ Analyze. The rules on
// the left (on / off, order, how many drawn elements each matches), the
// selected rule on the right: its conditions (a property, built-in facts
// included, an operator and a value) and the styles it sets. Nothing changes
// on the graph until Apply (one undo step). "Select matches" selects what
// the rule matches, to check it; "Colour by…" makes one rule per value of a
// property.
//
// rules: the graph's rules; keys: { node: [...], edge: [...] } property
// names; items / ctx: the drawn nodes and links for the counts
// (conditionalFormatting matchCounts); valuesOf(target, key): the most used
// values of a property; onApply(rules, useDomainRules); onSelect(target, ids);
// onClose().
//
// domain ({ label, rules, use }): the domain's rules (Configuration ▸ Rules),
// listed read-only below this graph's, with "Use domain rules".
// configMode: the editor of the domain's rules themselves (Configuration ▸
// Rules ▸ Formatting rules): no graph, so property names are typed (the
// facts suggested) and there are no counts, Select them or Colour by.
const PALETTE = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e', '#fd79a8', '#00b894', '#6c5ce7', '#d35400'];
const OP_KIND = Object.fromEntries(OPERATORS.map((entry) => [entry.value, entry.kind]));

const blankRule = (target) => normalizeRule({ id: newRuleId(), target, name: '', conditions: [{ key: '', op: 'eq', value: '' }], style: target === 'node' ? { fill: '#e74c3c' } : { color: '#e74c3c' } });

// A small sample of a rule's look (the list, the legend).
export function RuleSample({ rule }) {
  const { style } = rule;
  if (rule.target === 'edge') {
    const dashes = EDGE_STYLES.find((entry) => entry.value === style.lineStyle)?.dashes;
    return (
      <svg className="graph_format_sample" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <line x1="3" y1="18" x2="21" y2="6" style={{ stroke: style.hide ? 'transparent' : style.color || 'var(--graph-edge)', strokeWidth: Math.min(4, style.width || 2), strokeDasharray: dashes ? dashes.map((value) => value * 0.4).join(' ') : 'none' }} />
        {style.hide ? <path d="M4 4 20 20" className="graph_format_sample_off" /> : null}
      </svg>
    );
  }
  return (
    <svg className="graph_format_sample" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {style.hide
        ? <path d="M4 4 20 20" className="graph_format_sample_off" />
        : style.shape === 'box'
          ? <rect x="4" y="7" width="16" height="10" rx="2" style={{ fill: style.fill || 'var(--graph-node-fill)', stroke: style.border || style.fill || 'var(--graph-node-border)', strokeWidth: 2 }} />
          : style.shape === 'diamond'
            ? <path d="M12 3 21 12 12 21 3 12Z" style={{ fill: style.fill || 'var(--graph-node-fill)', stroke: style.border || style.fill || 'var(--graph-node-border)', strokeWidth: 2 }} />
            : <circle cx="12" cy="12" r="8" style={{ fill: style.fill || 'var(--graph-node-fill)', stroke: style.border || style.fill || 'var(--graph-node-border)', strokeWidth: 2 }} />}
    </svg>
  );
}

// A colour that may be unset ("Keep": the element's own).
function OptionalColour({ label, value, onChange }) {
  return (
    <div className="graph_format_colour">
      <span className="graph_customize_field_label">{label}</span>
      <LiveColor label={label} value={value || '#e74c3c'} onPick={onChange} />
      <Swatches value={value} onPick={onChange} />
      <button type="button" className={`graph_customize_chip${value ? '' : ' is-current'}`} aria-pressed={!value} aria-label={`Keep ${label.toLowerCase()}`} onClick={() => onChange('')}>Keep</button>
    </div>
  );
}

function Segments({ label, options, value, onPick }) {
  return (
    <div className="graph_customize_segments" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`graph_customize_segment${value === option.value ? ' is-current' : ''}`}
          onClick={() => onPick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ConditionRow({ condition, index, target, keys, values = [], freeKeys = false, onChange, onRemove }) {
  const kind = OP_KIND[condition.op];
  const listId = useId();
  const builtIns = BUILT_IN_KEYS[target];
  const known = new Set([...builtIns.map((entry) => entry.key), ...keys]);
  const keyListId = useId();
  const ops = OPERATORS.filter((entry) => !(condition.key === '@alerted' || condition.key === '@pinned') || entry.value === 'eq');
  return (
    <div className="graph_format_condition" role="group" aria-label={`Condition ${index + 1}`}>
      {freeKeys ? (
        <>
          <input
            type="text"
            aria-label="Property"
            placeholder="Property name or @fact"
            value={condition.key}
            list={keyListId}
            onChange={(event) => onChange({ key: event.target.value.slice(0, 120), ...(event.target.value === '@alerted' || event.target.value === '@pinned' ? { op: 'eq', value: 'yes' } : {}) })}
          />
          <datalist id={keyListId}>
            {builtIns.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
          </datalist>
        </>
      ) : (
      <select aria-label="Property" value={condition.key} onChange={(event) => onChange({ key: event.target.value, ...(event.target.value === '@alerted' || event.target.value === '@pinned' ? { op: 'eq', value: 'yes' } : {}) })}>
        <option value="">Choose…</option>
        <optgroup label="Facts">
          {builtIns.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
        </optgroup>
        <optgroup label="Properties">
          {condition.key && !known.has(condition.key) ? <option value={condition.key}>{condition.key} (not in this graph)</option> : null}
          {keys.map((key) => <option key={key} value={key}>{key}</option>)}
        </optgroup>
      </select>
      )}
      <select aria-label="Operator" value={condition.op} onChange={(event) => onChange({ op: event.target.value })}>
        {ops.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
      </select>
      {kind === 'none' ? <span className="graph_format_condition_gap" /> : (
        <span className={`graph_format_values${kind === 'range' || kind === 'dateRange' ? ' is-pair' : ''}`}>
          {condition.key === '@alerted' || condition.key === '@pinned' ? (
            <select aria-label="Value" value={condition.value || 'yes'} onChange={(event) => onChange({ value: event.target.value })}>
              <option value="yes">yes</option>
              <option value="no">no</option>
            </select>
          ) : (
            <input
              type={kind === 'date' || kind === 'dateRange' ? 'date' : 'text'}
              aria-label="Value"
              placeholder={kind === 'list' ? 'a, b, c' : kind === 'number' || kind === 'range' ? 'Number' : 'Value'}
              value={condition.value}
              list={kind === 'text' || kind === 'list' ? listId : undefined}
              onChange={(event) => onChange({ value: event.target.value })}
            />
          )}
          {kind === 'range' || kind === 'dateRange' ? (
            <input type={kind === 'dateRange' ? 'date' : 'text'} aria-label="Second value" placeholder="and" value={condition.value2} onChange={(event) => onChange({ value2: event.target.value })} />
          ) : null}
        </span>
      )}
      <button type="button" className="graph_format_remove" aria-label={`Remove condition ${index + 1}`} title="Remove" onClick={onRemove}>×</button>
      {/* The most used values of the property, as suggestions. */}
      {values.length ? (
        <datalist id={listId}>
          {values.map((value) => <option key={value} value={value} />)}
        </datalist>
      ) : null}
    </div>
  );
}

function RuleEditor({ rule, keys, count, mode, stage, valuesOf, configMode = false, onChange, onSelectMatches }) {
  const [album, setAlbum] = useState(null);
  const set = (patch) => onChange({ ...rule, ...patch });
  const setStyle = (key, value) => {
    const style = { ...rule.style };
    if (value === '' || value === null || value === false || value === undefined) delete style[key];
    else style[key] = value;
    onChange({ ...rule, style });
  };
  const setCondition = (index, patch) => set({ conditions: rule.conditions.map((condition, i) => (i === index ? { ...condition, ...patch } : condition)) });
  const datalistValues = (key) => (key && !key.startsWith('@') ? valuesOf(rule.target, key) : []);
  const node = rule.target === 'node';
  const icon = rule.style.icon ? iconForTheme(resolveIconUrl(rule.style.icon), mode) : '';
  return (
    <div className="graph_format_editor">
      <section className="graph_customize_section" aria-label="Rule">
        <h4 className="graph_customize_section_head">Rule</h4>
        <input className="graph_customize_input" aria-label="Rule name" placeholder={describeRule(rule)} value={rule.name} onChange={(event) => set({ name: event.target.value.slice(0, 80) })} />
        <div className="graph_format_row">
          <Segments label="Applies to" options={[{ value: 'node', label: 'Nodes' }, { value: 'edge', label: 'Links' }]} value={rule.target} onPick={(target) => onChange(normalizeRule({ ...rule, target, style: {}, conditions: rule.conditions.filter((condition) => !condition.key.startsWith('@') || BUILT_IN_KEYS[target].some((entry) => entry.key === condition.key)) }))} />
          <Segments label="Match" options={[{ value: 'all', label: 'All conditions' }, { value: 'any', label: 'Any condition' }]} value={rule.match} onPick={(match) => set({ match })} />
        </div>
      </section>
      <section className="graph_customize_section" aria-label="Conditions">
        <h4 className="graph_customize_section_head">When</h4>
        {rule.conditions.length ? rule.conditions.map((condition, index) => (
          <ConditionRow
            // Conditions have no ids; their place is their identity.
            key={index}
            condition={condition}
            index={index}
            target={rule.target}
            keys={keys[rule.target]}
            values={datalistValues(condition.key)}
            freeKeys={configMode}
            onChange={(patch) => setCondition(index, patch)}
            onRemove={() => set({ conditions: rule.conditions.filter((_, i) => i !== index) })}
          />
        )) : <p className="graph_customize_hint">No conditions: the rule applies to every {node ? 'node' : 'link'}.</p>}
        <div className="graph_format_row">
          <button type="button" className="graph_customize_chip graph_format_add" disabled={rule.conditions.length >= 12} onClick={() => set({ conditions: [...rule.conditions, { key: '', op: 'eq', value: '', value2: '' }] })}>+ Condition</button>
          {configMode ? null : (
            <>
              <span className="graph_format_count" aria-live="polite">Matches {count} {node ? (count === 1 ? 'node' : 'nodes') : (count === 1 ? 'link' : 'links')}</span>
              <button type="button" className="graph_customize_chip" disabled={!count} onClick={onSelectMatches}>Select them</button>
            </>
          )}
        </div>
      </section>
      <section className="graph_customize_section" aria-label="Style">
        <h4 className="graph_customize_section_head">Show as</h4>
        <label className="graph_format_check">
          <input type="checkbox" checked={Boolean(rule.style.hide)} onChange={(event) => setStyle('hide', event.target.checked)} />
          <span>Hide matching {node ? 'nodes (and their links)' : 'links'}</span>
        </label>
        {rule.style.hide ? null : node ? (
          <>
            <OptionalColour label="Fill" value={rule.style.fill || ''} onChange={(value) => setStyle('fill', value)} />
            <OptionalColour label="Border" value={rule.style.border || ''} onChange={(value) => setStyle('border', value)} />
            <OptionalColour label="Label" value={rule.style.labelColor || ''} onChange={(value) => setStyle('labelColor', value)} />
            <div className="graph_customize_field">
              <span className="graph_customize_field_label">Shape</span>
              <Segments label="Shape" options={[{ value: '', label: 'Keep' }, ...NODE_SHAPES]} value={rule.style.shape || ''} onPick={(value) => setStyle('shape', value)} />
            </div>
            <div className="graph_customize_field">
              <span className="graph_customize_field_label">{rule.style.size ? `Size · ${rule.style.size}` : 'Size · keep'}</span>
              <div className="graph_customize_range">
                <input type="range" aria-label="Size" min={5} max={40} step={1} value={rule.style.size || 15} style={{ '--fill': `${Math.round((((rule.style.size || 15) - 5) / 35) * 100)}%` }} onChange={(event) => setStyle('size', Number(event.target.value))} />
              </div>
              <button type="button" className={`graph_customize_chip${rule.style.size ? '' : ' is-current'}`} aria-label="Keep size" onClick={() => setStyle('size', '')}>Keep</button>
            </div>
            <div className="graph_customize_field">
              <span className="graph_customize_field_label">Icon</span>
              <button type="button" className="graph_customize_icon" aria-label="Choose an icon" aria-haspopup="dialog" aria-expanded={Boolean(album)} onClick={(event) => setAlbum(album ? null : event.currentTarget)}>
                {icon ? <img src={icon} alt="" /> : <span aria-hidden="true">+</span>}
              </button>
              {rule.style.icon ? <button type="button" className="graph_customize_chip is-danger" aria-label="Remove icon" onClick={() => setStyle('icon', '')}>Remove</button> : <span className="graph_customize_hint">Keep</span>}
            </div>
            {album ? (
              <IconAlbumPopover
                anchor={album}
                stage={stage}
                mode={mode}
                value={rule.style.icon || ''}
                onClose={() => setAlbum(null)}
                onPick={(path) => {
                  setStyle('icon', path);
                  setAlbum(null);
                }}
              />
            ) : null}
          </>
        ) : (
          <>
            <OptionalColour label="Colour" value={rule.style.color || ''} onChange={(value) => setStyle('color', value)} />
            <div className="graph_customize_field">
              <span className="graph_customize_field_label">Line</span>
              <Segments label="Line style" options={[{ value: '', label: 'Keep' }, ...EDGE_STYLES.map((entry) => ({ value: entry.value, label: entry.value[0].toUpperCase() + entry.value.slice(1) }))]} value={rule.style.lineStyle || ''} onPick={(value) => setStyle('lineStyle', value)} />
            </div>
            <div className="graph_customize_field">
              <span className="graph_customize_field_label">{rule.style.width ? `Width · ${rule.style.width}` : 'Width · keep'}</span>
              <div className="graph_customize_range">
                <input type="range" aria-label="Width" min={EDGE_WIDTH_RANGE.min} max={8} step={0.5} value={rule.style.width || 1} style={{ '--fill': `${Math.round((((rule.style.width || 1) - 1) / 7) * 100)}%` }} onChange={(event) => setStyle('width', Number(event.target.value))} />
              </div>
              <button type="button" className={`graph_customize_chip${rule.style.width ? '' : ' is-current'}`} aria-label="Keep width" onClick={() => setStyle('width', '')}>Keep</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const NO_ITEMS = { node: [], edge: [] };
const NO_KEYS = { node: [], edge: [] };
const noValues = () => [];

export default function GraphFormattingBox({
  rules: initial, keys = NO_KEYS, items = NO_ITEMS, ctx = null, valuesOf = noValues, domain = null, configMode = false, title = 'Conditional formatting', onApply, onSelect, onClose,
}) {
  const ref = useRef(null);
  const stageRef = useRef(null);
  const titleId = useId();
  const [rules, setRules] = useState(initial);
  const [selectedId, setSelectedId] = useState(initial[0]?.id || null);
  const [mode, setMode] = useState('light');
  const [template, setTemplate] = useState(null); // { target, key }
  const [useDomain, setUseDomain] = useState(domain ? domain.use : true);
  useLayoutEffect(() => setMode(themeModeOf(ref.current)), []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // The icon album (if open) closes first.
      if (stageRef.current?.querySelector('.graph_customize_album')) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const counts = useMemo(() => (configMode ? {} : matchCounts(rules, items, ctx || {})), [configMode, ctx, items, rules]);
  const domainCounts = useMemo(() => (domain && !configMode ? matchCounts(domain.rules, items, ctx || {}) : {}), [configMode, ctx, domain, items]);
  const selected = rules.find((rule) => rule.id === selectedId) || null;
  const changed = JSON.stringify(rules) !== JSON.stringify(initial) || Boolean(domain && useDomain !== domain.use);
  const replace = (rule) => setRules((current) => current.map((entry) => (entry.id === rule.id ? rule : entry)));
  const add = (target) => {
    const rule = blankRule(target);
    setRules((current) => [rule, ...current]);
    setSelectedId(rule.id);
  };
  const move = (id, step) => setRules((current) => {
    const index = current.findIndex((rule) => rule.id === id);
    const to = index + step;
    if (index < 0 || to < 0 || to >= current.length) return current;
    const next = [...current];
    [next[index], next[to]] = [next[to], next[index]];
    return next;
  });
  const remove = (id) => {
    setRules((current) => current.filter((rule) => rule.id !== id));
    if (selectedId === id) setSelectedId(rules.find((rule) => rule.id !== id)?.id || null);
  };
  const duplicate = (rule) => {
    const copy = normalizeRule({ ...rule, id: newRuleId(), name: rule.name ? `${rule.name} (copy)` : '' });
    setRules((current) => {
      const index = current.findIndex((entry) => entry.id === rule.id);
      return [...current.slice(0, index + 1), copy, ...current.slice(index + 1)];
    });
    setSelectedId(copy.id);
  };
  // "Colour by…": one rule per value (the 12 most used), palette colours.
  const colourBy = useCallback(() => {
    if (!template?.key) return;
    const values = valuesOf(template.target, template.key).slice(0, PALETTE.length);
    const made = values.map((value, index) => normalizeRule({
      id: newRuleId(),
      target: template.target,
      name: `${template.key} = ${value}`,
      conditions: [{ key: template.key, op: 'eq', value }],
      style: template.target === 'node' ? { fill: PALETTE[index] } : { color: PALETTE[index] },
    }));
    if (!made.length) return;
    setRules((current) => [...made, ...current]);
    setSelectedId(made[0].id);
    setTemplate(null);
  }, [template, valuesOf]);

  return (
    <div ref={stageRef} className={`graph_customize_backdrop${configMode ? ' is-screen' : ''}`} onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={ref} className="graph_customize graph_format" role="dialog" aria-modal="true" aria-labelledby={titleId} onContextMenu={(event) => event.preventDefault()}>
        <header className="graph_customize_header">
          <div className="graph_customize_heading">
            <strong id={titleId}>{title}</strong>
            <span title="Rules higher in the list win when two set the same style">{rules.length} {rules.length === 1 ? 'rule' : 'rules'}</span>
          </div>
          <button type="button" className="graph_customize_close" aria-label="Close" title="Close (Esc)" onClick={onClose}>×</button>
        </header>
        <div className="graph_format_body">
          <aside className="graph_format_list" aria-label="Rules">
            <div className="graph_format_list_actions">
              <button type="button" className="graph_customize_chip graph_format_add" onClick={() => add('node')}>+ Node rule</button>
              <button type="button" className="graph_customize_chip graph_format_add" onClick={() => add('edge')}>+ Link rule</button>
            </div>
            {configMode ? null : template ? (
              <div className="graph_format_template" role="group" aria-label="Colour by a property">
                <Segments label="Colour" options={[{ value: 'node', label: 'Nodes' }, { value: 'edge', label: 'Links' }]} value={template.target} onPick={(target) => setTemplate({ target, key: '' })} />
                <select aria-label="Colour by property" value={template.key} onChange={(event) => setTemplate({ ...template, key: event.target.value })}>
                  <option value="">Choose a property…</option>
                  {keys[template.target].map((key) => <option key={key} value={key}>{key}</option>)}
                </select>
                <div className="graph_format_row">
                  <button type="button" className="graph_customize_chip" onClick={() => setTemplate(null)}>Cancel</button>
                  <button type="button" className="graph_customize_chip is-current" disabled={!template.key} onClick={colourBy}>Make rules</button>
                </div>
              </div>
            ) : (
              <button type="button" className="graph_customize_chip graph_format_template_open" onClick={() => setTemplate({ target: 'node', key: '' })}>Colour by a property…</button>
            )}
            <ol className="graph_format_rules">
              {rules.map((rule, index) => (
                <li key={rule.id} className={`graph_format_rule${rule.id === selectedId ? ' is-current' : ''}${rule.on ? '' : ' is-off'}`}>
                  <input type="checkbox" aria-label={`Rule ${index + 1} on`} checked={rule.on} onChange={(event) => replace({ ...rule, on: event.target.checked })} />
                  <button type="button" className="graph_format_rule_main" aria-current={rule.id === selectedId} onClick={() => setSelectedId(rule.id)}>
                    <RuleSample rule={rule} />
                    <span className="graph_format_rule_name">{rule.name || describeRule(rule)}</span>
                    {configMode ? null : <span className="graph_format_rule_count" title="Drawn elements it matches">{counts[rule.id] ?? 0}</span>}
                  </button>
                  <span className="graph_format_rule_tools">
                    <button type="button" aria-label={`Move rule ${index + 1} up`} title="Up (wins over the ones below)" disabled={index === 0} onClick={() => move(rule.id, -1)}>↑</button>
                    <button type="button" aria-label={`Move rule ${index + 1} down`} title="Down" disabled={index === rules.length - 1} onClick={() => move(rule.id, 1)}>↓</button>
                    <button type="button" aria-label={`Duplicate rule ${index + 1}`} title="Duplicate" onClick={() => duplicate(rule)}>⧉</button>
                    <button type="button" aria-label={`Delete rule ${index + 1}`} title="Delete" className="is-danger" onClick={() => remove(rule.id)}>×</button>
                  </span>
                </li>
              ))}
            </ol>
            {rules.length ? null : <p className="graph_customize_hint graph_format_empty">{configMode ? 'No rules yet for this domain.' : 'No rules yet. Add one, or colour by a property.'}</p>}
            {domain ? (
              <section className="graph_format_domain" aria-label="Domain rules">
                <label className="graph_format_check">
                  <input type="checkbox" checked={useDomain} onChange={(event) => setUseDomain(event.target.checked)} />
                  <span>Use domain rules · {domain.label}</span>
                </label>
                {domain.rules.length ? (
                  <ol className={`graph_format_rules is-domain${useDomain ? '' : ' is-off'}`}>
                    {domain.rules.map((rule) => (
                      <li key={rule.id} className={`graph_format_rule${rule.on ? '' : ' is-off'}`} title="Set in Configuration ▸ Rules ▸ Formatting rules">
                        <span className="graph_format_rule_main">
                          <RuleSample rule={rule} />
                          <span className="graph_format_rule_name">{rule.name || describeRule(rule)}</span>
                          <span className="graph_format_rule_count">{domainCounts[rule.id] ?? 0}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="graph_customize_hint">None set for this domain.</p>}
                <small className="graph_customize_hint">Below this graph's rules (they win). Edited in Configuration ▸ Rules ▸ Formatting rules.</small>
              </section>
            ) : null}
          </aside>
          <div className="graph_format_main">
            {selected ? (
              <RuleEditor
                key={selected.id}
                rule={selected}
                keys={keys}
                count={counts[selected.id] ?? 0}
                mode={mode}
                stage={stageRef.current}
                valuesOf={valuesOf}
                configMode={configMode}
                onChange={replace}
                onSelectMatches={() => onSelect?.(selected.target, matchingIds(selected, items, ctx || {}))}
              />
            ) : <p className="graph_customize_hint graph_format_empty">Choose a rule to edit it.</p>}
          </div>
        </div>
        <footer className="graph_customize_footer">
          <span className="graph_customize_hint">{changed ? (configMode ? 'Kept with the configuration when you Save it' : 'Not applied yet') : 'Rules re-apply as the view changes; the data is never changed.'}</span>
          <button
            type="button"
            className="graph_customize_button"
            disabled={!changed}
            onClick={() => {
              setRules(initial);
              if (domain) setUseDomain(domain.use);
            }}
          >
            Reset
          </button>
          <button type="button" className="graph_customize_button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="graph_customize_button is-primary"
            disabled={!changed}
            onClick={() => {
              onApply(rules.map((rule) => normalizeRule(rule)), useDomain);
              onClose();
            }}
          >
            Apply
          </button>
        </footer>
      </section>
    </div>
  );
}
