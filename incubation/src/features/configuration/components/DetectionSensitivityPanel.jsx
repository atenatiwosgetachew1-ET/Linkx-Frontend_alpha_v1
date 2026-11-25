import React, { useCallback, useEffect, useState } from 'react';

import WindowLoadScreen from '../../../shared/components/WindowLoadScreen.jsx';
import { InfoTip } from '../../../shared/components/form/FormFields.jsx';
import { Block, Masthead, PageHero, Pill, SettingsPage, Stat, Stats } from '../../settings/components/SettingsPage.jsx';
import {
  formatDomainPillarLabel,
  BANK_THRESHOLD_GROUPS,
  CDR_THRESHOLD_GROUPS,
  DEFAULT_BANK_MONEY_THRESHOLDS,
  DEFAULT_BANK_NODE_THRESHOLDS,
  DEFAULT_BANK_THRESHOLDS,
  DEFAULT_BANK_TYPOLOGIES,
  DEFAULT_CDR_DURATION_THRESHOLDS,
  DEFAULT_CDR_NODE_THRESHOLDS,
  DEFAULT_CDR_THRESHOLDS,
  DEFAULT_CDR_TYPOLOGIES,
} from '../lib/configModel.js';
import {
  fetchRuleThresholdHistory,
  fetchRuleThresholds,
  fetchScoreLineage,
  saveRuleThresholds,
  saveScoreLineage,
} from '../../../services/configurationApi.js';

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '—') : date.toLocaleString();
};

// What a threshold's "i" says: what it is for, then what it accepts.
const numberText = (value) => (typeof value === 'number' ? value.toLocaleString() : String(value));
const describeThreshold = (opts = {}, fallback) => [
  opts.hint,
  opts.type === 'checkbox' ? '' : (opts.min != null && opts.max != null ? `Range ${numberText(opts.min)} to ${numberText(opts.max)}` : ''),
  opts.type === 'checkbox' || opts.step == null ? '' : `Step ${numberText(opts.step)}`,
  fallback === undefined ? '' : `Default ${typeof fallback === 'boolean' ? (fallback ? 'on' : 'off') : numberText(fallback)}`,
].filter(Boolean).join(' · ');

const pickKnown = (source, defaults) => Object.keys(defaults).reduce((acc, key) => {
  if (source?.[key] !== undefined) acc[key] = source[key];
  return acc;
}, {});

/* ── Rule thresholds (production RuleThresholdsPanel) ───────────────── */

function RuleThresholds({ apiFetch, domain, isCdr, canManage, notify, onFigures }) {
  const defaults = isCdr ? DEFAULT_CDR_THRESHOLDS : DEFAULT_BANK_THRESHOLDS;
  const groups = isCdr ? CDR_THRESHOLD_GROUPS : BANK_THRESHOLD_GROUPS;
  const [values, setValues] = useState(defaults);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const activeDefaults = isCdr ? DEFAULT_CDR_THRESHOLDS : DEFAULT_BANK_THRESHOLDS;
    setValues(activeDefaults);
    try {
      const res = await fetchRuleThresholds(apiFetch, domain);
      if (res?.results?.config) setValues((prev) => ({ ...prev, ...pickKnown(res.results.config, activeDefaults) }));
      if (canManage) {
        const hist = await fetchRuleThresholdHistory(apiFetch, domain).catch(() => null);
        setHistory(Array.isArray(hist?.results) ? hist.results : []);
      }
    } catch (error) {
      // Never show (and let Save push) defaults as if they were the server's.
      setLoadError(error?.message || 'Could not load detection thresholds.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, canManage, domain, isCdr]);

  useEffect(() => { load(); }, [load]);

  // What the page header shows of this part.
  const latest = history[0];
  const latestVersion = latest?.version_id;
  const latestBy = latest?.updated_by;
  const fieldCount = groups.reduce((sum, [, fields]) => sum + fields.length, 0);
  useEffect(() => {
    onFigures?.({ thresholds: fieldCount, groups: groups.length, version: latestVersion, updatedBy: latestBy, ready: !loading && !loadError, thresholdsLoading: loading });
  }, [onFigures, fieldCount, groups.length, latestVersion, latestBy, loading, loadError]);

  const handleChange = (key, type) => (event) => {
    const { value, checked } = event.target;
    setValues((prev) => ({ ...prev, [key]: type === 'checkbox' ? checked : (value === '' ? '' : Number(value)) }));
  };

  const handleSave = async () => {
    if (!canManage) return;
    setSaving(true);
    try {
      const clean = Object.keys(defaults).reduce((acc, key) => {
        if (typeof defaults[key] === 'boolean') acc[key] = values[key] === true || values[key] === 'true';
        else {
          const num = Number(values[key]);
          acc[key] = Number.isNaN(num) || values[key] === '' ? defaults[key] : num;
        }
        return acc;
      }, {});
      await saveRuleThresholds(apiFetch, domain, clean);
      notify({ title: 'Detection thresholds saved', message: isCdr ? 'CDR telecom detection thresholds saved.' : 'Rule thresholds saved.', level: 'success', source: 'Configuration' });
      load();
    } catch (error) {
      notify({ title: 'Save failed', message: error?.message || 'Failed to save detection thresholds.', level: 'error', source: 'Configuration' });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setValues(defaults);
    notify({ title: 'Defaults restored', message: 'Thresholds reset to defaults (not saved yet).', level: 'info', source: 'Configuration' });
  };

  // The page shows one load screen for both parts.
  if (loading) return null;
  if (loadError) {
    return (
      <Block title="Rule thresholds" actions={<button type="button" className="settings_button" onClick={load}>Retry</button>}>
        <div className="settings_error" role="alert">{loadError} The current thresholds are unknown, so they cannot be edited or saved.</div>
      </Block>
    );
  }

  return (
    <>
      <Block
        title="Rule thresholds"
        description={canManage ? 'What a rule must see before it raises a finding. Saved on its own, not with the configuration.' : 'You need users:manage to change detection thresholds.'}
        actions={canManage ? (
          <>
            <button type="button" className="settings_button" disabled={saving} onClick={handleReset}>Reset to defaults</button>
            <button type="button" className="settings_button settings_primary" disabled={saving} onClick={handleSave}>{saving ? 'Saving…' : 'Save sensitivity settings'}</button>
          </>
        ) : null}
      >
        <div className="config_card">
          {groups.map(([legend, fields]) => (
            <React.Fragment key={legend}>
              <p className="config_card_label">{legend}</p>
              <div className="config_card_grid is-thresholds">
                {fields.map(([key, label, opts = {}]) => (
                  opts.type === 'checkbox' ? (
                    <label key={key} className="settings_switch config_switch_row">
                      <span>{label}<InfoTip text={describeThreshold(opts, defaults[key])} /></span>
                      <input type="checkbox" role="switch" checked={values[key] === true} disabled={!canManage} onChange={handleChange(key, 'checkbox')} />
                    </label>
                  ) : (
                    <label key={key} className="config_window_field">
                      <span className="config_window_field_label">{label}<InfoTip text={describeThreshold(opts, defaults[key])} /></span>
                      <input
                        type="number"
                        className="settings_input"
                        min={opts.min}
                        max={opts.max}
                        step={opts.step}
                        value={values[key] ?? ''}
                        disabled={!canManage}
                        onChange={handleChange(key)}
                      />
                    </label>
                  )
                ))}
              </div>
            </React.Fragment>
          ))}
        </div>
      </Block>
      {canManage && history.length > 0 ? (
        <Block title="Audit trail" description="Every saved version of the thresholds, newest first.">
          <div className="config_window_table_wrap is-scroll">
            <table className="config_window_table" aria-label="Threshold history">
              <thead><tr><th>Version</th><th>Updated by</th><th>Date</th><th>Config snippet</th></tr></thead>
              <tbody>
                {history.map((item, index) => (
                  <tr key={item.version_id || index}>
                    <td>v{item.version_id}</td>
                    <td>{item.updated_by}</td>
                    <td>{formatDate(item.created_at)}</td>
                    <td className="config_window_table_snippet" title={JSON.stringify(item.config)}>{JSON.stringify(item.config)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>
      ) : null}
    </>
  );
}

/* ── Score lineage (production ScoreLineagePanel) ───────────────────── */

const cloneRows = (rows) => rows.map((row) => ({ ...row }));

function ScoreLineage({ apiFetch, domain, isCdr, canManage, notify, onFigures }) {
  const typologyDefaults = isCdr ? DEFAULT_CDR_TYPOLOGIES : DEFAULT_BANK_TYPOLOGIES;
  const [baseScores, setBaseScores] = useState(typologyDefaults);
  const [nodeThresholds, setNodeThresholds] = useState(cloneRows(isCdr ? DEFAULT_CDR_NODE_THRESHOLDS : DEFAULT_BANK_NODE_THRESHOLDS));
  const [valueThresholds, setValueThresholds] = useState(cloneRows(isCdr ? DEFAULT_CDR_DURATION_THRESHOLDS : DEFAULT_BANK_MONEY_THRESHOLDS));
  const [saving, setSaving] = useState(false);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    const typologies = isCdr ? DEFAULT_CDR_TYPOLOGIES : DEFAULT_BANK_TYPOLOGIES;
    setBaseScores(typologies);
    setNodeThresholds(cloneRows(isCdr ? DEFAULT_CDR_NODE_THRESHOLDS : DEFAULT_BANK_NODE_THRESHOLDS));
    setValueThresholds(cloneRows(isCdr ? DEFAULT_CDR_DURATION_THRESHOLDS : DEFAULT_BANK_MONEY_THRESHOLDS));
    fetchScoreLineage(apiFetch, domain).then((res) => {
      if (cancelled) return;
      setLoadState('ready');
      const cfg = res?.results?.config;
      if (!cfg) return;
      const scores = pickKnown(cfg.base_scores, typologies);
      if (Object.keys(scores).length) setBaseScores((prev) => ({ ...prev, ...scores }));
      const domainMatches = isCdr ? cfg.domain_id === 'cdr' : cfg.domain_id !== 'cdr';
      if (domainMatches && Array.isArray(cfg.node_thresholds) && cfg.node_thresholds.length) setNodeThresholds(cloneRows(cfg.node_thresholds));
      if (isCdr && Array.isArray(cfg.duration_thresholds) && cfg.duration_thresholds.length) {
        setValueThresholds(cfg.duration_thresholds.map((row) => ({ min_amount: row.min_seconds ?? row.min_amount, add_points: row.add_points })));
      }
      if (!isCdr && Array.isArray(cfg.money_thresholds) && cfg.money_thresholds.length) setValueThresholds(cloneRows(cfg.money_thresholds));
    }).catch(() => { if (!cancelled) setLoadState('error'); });
    return () => { cancelled = true; };
  }, [apiFetch, domain, isCdr, reloadKey]);

  const handleSave = async () => {
    if (!canManage || loadState !== 'ready') return;
    setSaving(true);
    try {
      const cleanScores = Object.keys(typologyDefaults).reduce((acc, key) => {
        acc[key] = Number(baseScores[key] ?? typologyDefaults[key]);
        return acc;
      }, {});
      await saveScoreLineage(apiFetch, domain, {
        domain_id: domain,
        base_scores: cleanScores,
        node_thresholds: nodeThresholds.map((row) => ({ min_nodes: Number(row.min_nodes), add_points: Number(row.add_points) })),
        money_thresholds: valueThresholds.map((row) => ({ min_amount: Number(row.min_amount), add_points: Number(row.add_points) })),
        ...(isCdr ? { duration_thresholds: valueThresholds.map((row) => ({ min_seconds: Number(row.min_amount), add_points: Number(row.add_points) })) } : {}),
      });
      notify({ title: 'Score lineage saved', message: isCdr ? 'CDR telecom score lineage saved.' : 'Saved as a new version (append-only).', level: 'success', source: 'Configuration' });
    } catch (error) {
      notify({ title: 'Save failed', message: error?.message || 'Error saving score lineage.', level: 'error', source: 'Configuration' });
    } finally {
      setSaving(false);
    }
  };

  const editRow = (rows, setRows, index, key) => (event) => setRows(rows.map((row, i) => (i === index ? { ...row, [key]: Number(event.target.value) } : row)));

  const typologyCount = Object.keys(typologyDefaults).length;
  const tierCount = nodeThresholds.length + valueThresholds.length;
  useEffect(() => {
    onFigures?.({ typologies: typologyCount, tiers: tierCount, lineageReady: loadState === 'ready', lineageLoading: loadState === 'loading' });
  }, [onFigures, typologyCount, tierCount, loadState]);

  // A list of score tiers: from a minimum, the points it adds.
  const renderRows = (rows, setRows, minKey, minLabel, blank, describe, minInfo) => (
    <div className="config_tiers">
      {rows.map((row, index) => (
        <div key={index} className="config_tier">
          <label className="config_window_field">
            <span className="config_window_field_label">{minLabel}<InfoTip text={minInfo} /></span>
            <input type="number" className="settings_input" value={row[minKey]} disabled={!canManage} onChange={editRow(rows, setRows, index, minKey)} />
          </label>
          <label className="config_window_field">
            <span className="config_window_field_label">Add points<InfoTip text="Points added to the risk score once the minimum beside it is reached. A whole number." /></span>
            <input type="number" className="settings_input" value={row.add_points} disabled={!canManage} onChange={editRow(rows, setRows, index, 'add_points')} />
          </label>
          {describe ? <small className="config_tier_note">{describe(row[minKey])}</small> : null}
          {canManage ? (
            <button type="button" className="config_row_remove" aria-label="Remove threshold" title="Remove" onClick={() => setRows(rows.filter((_, i) => i !== index))}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
              </svg>
            </button>
          ) : null}
        </div>
      ))}
      {rows.length === 0 ? <p className="settings_hint">No tiers yet.</p> : null}
      {canManage ? <button type="button" className="settings_button config_window_add_row" onClick={() => setRows([...rows, blank])}>+ Add threshold</button> : null}
    </div>
  );

  const describeDuration = (seconds) => (seconds >= 3600 ? `~${(seconds / 3600).toFixed(1)} hrs` : seconds >= 60 ? `~${(seconds / 60).toFixed(0)} min` : `${seconds}s`);

  if (loadState === 'loading') return null;
  if (loadState === 'error') {
    return (
      <Block title="Score lineage" actions={<button type="button" className="settings_button" onClick={() => setReloadKey((key) => key + 1)}>Retry</button>}>
        <div className="settings_error" role="alert">Could not load the score lineage. The current values are unknown, so they cannot be edited or saved.</div>
      </Block>
    );
  }

  return (
    <Block
      title="Score lineage"
      description="How a finding's risk score is built: points per typology, then points added by scale. Each save is a new version."
      actions={canManage ? <button type="button" className="settings_button settings_primary" disabled={saving} onClick={handleSave}>{saving ? 'Saving…' : 'Save new version'}</button> : null}
    >
      <div className="config_card">
        <p className="config_card_label">Base scores by typology</p>
        <div className="config_window_slider_grid">
          {Object.keys(typologyDefaults).map((key) => (
            <label key={key} className="config_window_slider config_score" style={{ '--score-fill': `${Math.max(0, Math.min(100, Number(baseScores[key]) || 0))}%` }}>
              <span title={key}>{key}<InfoTip text={`Points a finding of this typology starts with, before the multipliers. Range 0 to 100 · Default ${typologyDefaults[key]}`} /></span>
              <b>{baseScores[key] ?? 0}</b>
              <input type="range" min="0" max="100" value={baseScores[key] ?? 0} disabled={!canManage} onChange={(event) => setBaseScores((prev) => ({ ...prev, [key]: Number(event.target.value) }))} />
            </label>
          ))}
        </div>
        {/* The two lists of tiers side by side, each filling its half. */}
        <div className="config_tier_columns">
          <div>
            <p className="config_card_label">{isCdr ? 'Network scale / subscriber multipliers' : 'Node count multipliers'}</p>
            {renderRows(nodeThresholds, setNodeThresholds, 'min_nodes', isCdr ? 'Min contacts / MSISDNs' : 'Min nodes', { min_nodes: 0, add_points: 0 }, null, isCdr ? 'From this many contacts or MSISDNs in a finding, the points beside it are added.' : 'From this many nodes in a finding, the points beside it are added.')}
          </div>
          <div>
            <p className="config_card_label">{isCdr ? 'Cumulative duration volume score tiers' : 'Financial value multipliers'}</p>
            {renderRows(valueThresholds, setValueThresholds, 'min_amount', isCdr ? 'Min duration (sec)' : 'Min amount', { min_amount: 0, add_points: 0 }, isCdr ? describeDuration : null, isCdr ? 'From this total call duration in seconds, the points beside it are added.' : 'From this total amount in a finding, the points beside it are added.')}
          </div>
        </div>
      </div>
    </Block>
  );
}

export default function DetectionSensitivityPanel({ apiFetch, isCdr, domain = isCdr ? 'cdr' : 'bank', canManage, notify }) {
  // The two parts load and save on their own; each reports its figures here.
  const [figures, setFigures] = useState({});
  const mergeFigures = useCallback((patch) => setFigures((current) => ({ ...current, ...patch })), []);
  return (
    <SettingsPage className="config_page config_sensitivity">
      <Masthead>
        <PageHero
          eyebrow="Detection sensitivity"
          title={isCdr ? 'CDR telecom detection' : `${formatDomainPillarLabel(domain)} detection`}
          pill={canManage ? null : <Pill tone="neutral">Read-only</Pill>}
          meta="Rule thresholds and the points behind the risk score. Each part is saved on its own, not with the configuration."
          media={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21a9 9 0 1 1 9-9M12 12l5-5M12 3v2M3 12h2M5.6 5.6l1.4 1.4M19 16v6M16 19h6" />
            </svg>
          )}
        />
        <Stats label="Sensitivity figures" columns={4}>
          <Stat lead icon="list" label="Thresholds" value={figures.ready ? Number(figures.thresholds || 0).toLocaleString() : '–'} note={figures.ready ? `in ${figures.groups} groups` : 'not loaded'} />
          <Stat text icon="clock" label="Latest version" value={figures.version != null ? `v${figures.version}` : '—'} note={figures.updatedBy ? `by ${figures.updatedBy}` : (canManage ? 'no saved version' : 'needs users:manage')} />
          <Stat icon="layers" label="Typologies" value={figures.lineageReady ? Number(figures.typologies || 0).toLocaleString() : '–'} note="base scores" />
          <Stat icon="bolt" label="Score tiers" value={figures.lineageReady ? Number(figures.tiers || 0).toLocaleString() : '–'} note="scale multipliers" />
        </Stats>
      </Masthead>
      {/* One load screen while either part is still fetching; a part that is
          ready shows meanwhile. Until they report, both count as loading. */}
      {figures.thresholdsLoading !== false || figures.lineageLoading !== false ? (
        <WindowLoadScreen className="is-block" label="Loading detection sensitivity…" />
      ) : null}
      <RuleThresholds apiFetch={apiFetch} domain={domain} isCdr={isCdr} canManage={canManage} notify={notify} onFigures={mergeFigures} />
      <ScoreLineage apiFetch={apiFetch} domain={domain} isCdr={isCdr} canManage={canManage} notify={notify} onFigures={mergeFigures} />
    </SettingsPage>
  );
}
