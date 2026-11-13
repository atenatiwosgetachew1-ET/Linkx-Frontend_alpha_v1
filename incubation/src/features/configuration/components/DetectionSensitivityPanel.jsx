import React, { useCallback, useEffect, useState } from 'react';

import { Section } from '../../../shared/components/form/FormFields.jsx';
import {
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

const pickKnown = (source, defaults) => Object.keys(defaults).reduce((acc, key) => {
  if (source?.[key] !== undefined) acc[key] = source[key];
  return acc;
}, {});

/* ── Rule thresholds (production RuleThresholdsPanel) ───────────────── */

function RuleThresholds({ apiFetch, isCdr, canManage, notify }) {
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
      const res = await fetchRuleThresholds(apiFetch, isCdr);
      if (res?.results?.config) setValues((prev) => ({ ...prev, ...pickKnown(res.results.config, activeDefaults) }));
      if (canManage) {
        const hist = await fetchRuleThresholdHistory(apiFetch, isCdr).catch(() => null);
        setHistory(Array.isArray(hist?.results) ? hist.results : []);
      }
    } catch (error) {
      // Never show (and let Save push) defaults as if they were the server's.
      setLoadError(error?.message || 'Could not load detection thresholds.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, canManage, isCdr]);

  useEffect(() => { load(); }, [load]);

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
      await saveRuleThresholds(apiFetch, isCdr, clean);
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

  if (loading) return <p className="settings_hint">Loading detection thresholds…</p>;
  if (loadError) {
    return (
      <Section title="Detection thresholds">
        <div className="settings_error" role="alert">{loadError} The current thresholds are unknown, so they cannot be edited or saved.</div>
        <div className="config_window_inline_actions"><button type="button" className="settings_button" onClick={load}>Retry</button></div>
      </Section>
    );
  }

  return (
    <>
      {groups.map(([legend, fields]) => (
        <Section key={legend} title={legend}>
          <div className="config_window_grid">
            {fields.map(([key, label, opts = {}]) => (
              opts.type === 'checkbox' ? (
                <label key={key} className="settings_toggle_row config_window_toggle" title={opts.hint}>
                  <input type="checkbox" checked={values[key] === true} disabled={!canManage} onChange={handleChange(key, 'checkbox')} />
                  <span>{label}</span>
                </label>
              ) : (
                <label key={key} className="config_window_field" title={opts.hint}>
                  <span className="config_window_field_label">{label}</span>
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
        </Section>
      ))}
      {canManage ? (
        <div className="config_window_inline_actions is-end">
          <button type="button" className="settings_button" disabled={saving} onClick={handleReset}>Reset to defaults</button>
          <button type="button" className="settings_button" disabled={saving} onClick={handleSave}>{saving ? 'Saving…' : 'Save sensitivity settings'}</button>
        </div>
      ) : <p className="settings_hint">You need users:manage to change detection thresholds.</p>}
      {canManage && history.length > 0 ? (
        <Section title="Audit trail / history">
          <div className="config_window_table_wrap is-scroll">
            <table className="config_window_table">
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
        </Section>
      ) : null}
    </>
  );
}

/* ── Score lineage (production ScoreLineagePanel) ───────────────────── */

const cloneRows = (rows) => rows.map((row) => ({ ...row }));

function ScoreLineage({ apiFetch, isCdr, canManage, notify }) {
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
    fetchScoreLineage(apiFetch, isCdr).then((res) => {
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
  }, [apiFetch, isCdr, reloadKey]);

  const handleSave = async () => {
    if (!canManage || loadState !== 'ready') return;
    setSaving(true);
    try {
      const cleanScores = Object.keys(typologyDefaults).reduce((acc, key) => {
        acc[key] = Number(baseScores[key] ?? typologyDefaults[key]);
        return acc;
      }, {});
      await saveScoreLineage(apiFetch, isCdr, {
        domain_id: isCdr ? 'cdr' : 'bank',
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

  const renderRows = (rows, setRows, minKey, minLabel, blank, describe) => (
    <>
      {rows.map((row, index) => (
        <div key={index} className="config_window_threshold_row">
          <label>
            <span>{minLabel}</span>
            <input type="number" className="settings_input" value={row[minKey]} disabled={!canManage} onChange={editRow(rows, setRows, index, minKey)} />
          </label>
          {describe ? <small>{describe(row[minKey])}</small> : null}
          <label>
            <span>Add points</span>
            <input type="number" className="settings_input" value={row.add_points} disabled={!canManage} onChange={editRow(rows, setRows, index, 'add_points')} />
          </label>
          {canManage ? <button type="button" className="settings_button is-danger" aria-label="Remove threshold" onClick={() => setRows(rows.filter((_, i) => i !== index))}>Remove</button> : null}
        </div>
      ))}
      {canManage ? <button type="button" className="settings_button config_window_add_row" onClick={() => setRows([...rows, blank])}>+ Add threshold</button> : null}
    </>
  );

  const describeDuration = (seconds) => (seconds >= 3600 ? `~${(seconds / 3600).toFixed(1)} hrs` : seconds >= 60 ? `~${(seconds / 60).toFixed(0)} min` : `${seconds}s`);

  if (loadState === 'loading') return <p className="settings_hint">Loading score lineage…</p>;
  if (loadState === 'error') {
    return (
      <Section title="Score lineage">
        <div className="settings_error" role="alert">Could not load the score lineage. The current values are unknown, so they cannot be edited or saved.</div>
        <div className="config_window_inline_actions"><button type="button" className="settings_button" onClick={() => setReloadKey((key) => key + 1)}>Retry</button></div>
      </Section>
    );
  }

  return (
    <>
      <Section title="Base scores by typology" description="Points a finding of each typology contributes to the risk score.">
        <div className="config_window_slider_grid">
          {Object.keys(typologyDefaults).map((key) => (
            <label key={key} className="config_window_slider" title={key}>
              <span>{key}</span>
              <input type="range" min="0" max="100" value={baseScores[key] ?? 0} disabled={!canManage} onChange={(event) => setBaseScores((prev) => ({ ...prev, [key]: Number(event.target.value) }))} />
              <b>{baseScores[key] ?? 0}</b>
            </label>
          ))}
        </div>
      </Section>
      <Section title={isCdr ? 'Network scale / subscriber multipliers' : 'Node count multipliers'}>
        {renderRows(nodeThresholds, setNodeThresholds, 'min_nodes', isCdr ? 'Min contacts / MSISDNs' : 'Min nodes', { min_nodes: 0, add_points: 0 })}
      </Section>
      <Section title={isCdr ? 'Cumulative duration volume score tiers' : 'Financial value multipliers'}>
        {renderRows(valueThresholds, setValueThresholds, 'min_amount', isCdr ? 'Min duration (sec)' : 'Min amount', { min_amount: 0, add_points: 0 }, isCdr ? describeDuration : null)}
      </Section>
      {canManage ? (
        <div className="config_window_inline_actions is-end">
          <button type="button" className="settings_button" disabled={saving} onClick={handleSave}>{saving ? 'Saving…' : 'Save new version'}</button>
        </div>
      ) : null}
    </>
  );
}

export default function DetectionSensitivityPanel({ apiFetch, isCdr, canManage, notify }) {
  return (
    <>
      <RuleThresholds apiFetch={apiFetch} isCdr={isCdr} canManage={canManage} notify={notify} />
      <ScoreLineage apiFetch={apiFetch} isCdr={isCdr} canManage={canManage} notify={notify} />
    </>
  );
}
