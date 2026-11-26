import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import WindowLoadScreen from '../../../shared/components/WindowLoadScreen.jsx';
import { InfoTip } from '../../../shared/components/form/FormFields.jsx';
import { Block, Masthead, PageHero, Pill, SettingsPage, Stat, Stats } from '../../settings/components/SettingsPage.jsx';
import {
  formatDomainPillarLabel,
  DEFAULT_BANK_MONEY_THRESHOLDS,
  DEFAULT_BANK_NODE_THRESHOLDS,
  DEFAULT_BANK_TYPOLOGIES,
  DEFAULT_CDR_DURATION_THRESHOLDS,
  DEFAULT_CDR_NODE_THRESHOLDS,
  DEFAULT_CDR_TYPOLOGIES,
} from '../lib/configModel.js';
import {
  fetchRuleThresholdHistory,
  fetchRuleThresholds,
  fetchScoreLineage,
  fetchScoreLineageHistory,
  saveRuleThresholds,
  saveScoreLineage,
} from '../../../services/configurationApi.js';
import { getServiceRefusalMessage } from '../../../services/apiErrors.js';
import { readThresholdAnswer, readVersionConflict } from '../../../services/domainConfigApi.js';
import { getDomainDraft, getDomainsView, hasDomainDraft, keepDomainDraft, keepDomainsView, otherThresholds, readThresholds, thresholdProblem } from '../lib/domainDrafts.js';
import { asOwnChange, getDomainChangeSeq, subscribeDomainChanges } from '../lib/domainChanges.js';
import { listChanges, numberText, thresholdForm, thresholdKeyProblem, valueText, wordKey } from '../lib/domainFields.js';
import { HistoryBlock } from './DomainHistory.jsx';
import DomainSensitivity from './DomainSensitivity.jsx';
import DomainColumns from './DomainColumns.jsx';
import DomainMapping from './DomainMapping.jsx';

// What a threshold's "i" says: what it is for, then what it accepts.
const describeThreshold = (opts = {}, fallback) => [
  opts.hint,
  opts.type === 'checkbox' ? '' : (opts.min != null && opts.max != null ? `Range ${numberText(opts.min)} to ${numberText(opts.max)}` : ''),
  opts.integer ? 'Whole number' : '',
  opts.type === 'checkbox' || opts.step == null || opts.step === 'any' || opts.integer ? '' : `Step ${numberText(opts.step)}`,
  fallback === undefined ? '' : `Default ${typeof fallback === 'boolean' ? (fallback ? 'on' : 'off') : numberText(fallback)}`,
].filter(Boolean).join(' · ');

const pickKnown = (source, defaults) => Object.keys(defaults).reduce((acc, key) => {
  if (source?.[key] !== undefined) acc[key] = source[key];
  return acc;
}, {});

// Each field the Service refused, with its reason ({ errors: [{ field, message }] }).
const fieldErrors = (error) => Object.fromEntries((Array.isArray(error?.data?.errors) ? error.data.errors : [])
  .filter((entry) => typeof entry?.field === 'string' && entry.message)
  .map((entry) => [entry.field, String(entry.message).slice(0, 200)]));

/* ── Rule thresholds (production RuleThresholdsPanel) ───────────────── */

function RuleThresholds({ windowId, apiFetch, domain, isCdr, canManage, notify, requestConfirmation, onFigures }) {
  const [answer, setAnswer] = useState(null); // what the Service sent
  const [edits, setEdits] = useState(() => getDomainDraft(windowId, domain, 'thresholds') || {}); // { key: value }
  const [refused, setRefused] = useState({});
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);

  const changeSeq = useSyncExternalStore(subscribeDomainChanges, () => getDomainChangeSeq(domain, 'thresholds'));
  const load = useCallback(async () => {
    // Read again: what is on screen stays until the answer is here.
    setLoadError((message) => { if (message) setLoading(true); return ''; });
    try {
      setAnswer(readThresholdAnswer(await fetchRuleThresholds(apiFetch, domain)) || { config: {} });
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
  }, [apiFetch, canManage, domain]);

  // Read again when someone (or a preset) changed them.
  useEffect(() => { load(); }, [load, changeSeq]);

  const { groups: formGroups, defaults, open, fromService } = useMemo(() => thresholdForm(answer || {}, isCdr), [answer, isCdr]);
  const formKeys = formGroups.flatMap(([, list]) => list.map(([key]) => key));
  // An open domain: keys added here and not saved yet.
  const added = open ? Object.keys(edits).filter((key) => !formKeys.includes(key)) : [];
  const groups = added.length ? [...formGroups, ['Added', added.map((key) => [key, wordKey(key), { step: 'any' }])]] : formGroups;
  const fields = groups.flatMap(([, list]) => list);
  const kinds = Object.fromEntries(fields.map(([key, , opts = {}]) => [key, opts.type === 'checkbox' ? false : 0]));
  const saved = readThresholds(answer?.config, kinds);
  const others = otherThresholds(answer?.config, kinds);
  // Shown for a key the Service did not send: its default, marked.
  const current = { ...defaults, ...saved };
  const values = { ...current, ...edits };
  const changed = fields.map(([key]) => key).filter((key) => key in edits && edits[key] !== current[key]);
  const optsOf = Object.fromEntries(fields.map(([key, , opts = {}]) => [key, opts]));
  const problems = Object.fromEntries(changed.map((key) => [key, thresholdProblem(edits[key], optsOf[key])]).filter(([, text]) => text));
  const dirty = changed.length > 0;
  // Not while the saved values are unknown: what is changed is not known then.
  const known = !loading && !loadError;
  useEffect(() => { if (known) keepDomainDraft(windowId, domain, 'thresholds', dirty ? edits : null); }, [known, windowId, domain, dirty, edits]);

  // What the page header shows of this part.
  const latest = history[0];
  const latestVersion = latest?.version_id;
  const latestBy = latest?.updated_by;
  const fieldCount = fields.length;
  useEffect(() => {
    onFigures?.({ thresholds: fieldCount, groups: groups.length, version: latestVersion, updatedBy: latestBy, ready: known, thresholdsLoading: loading, thresholdsDirty: known ? changed.length : 0 });
  }, [onFigures, fieldCount, groups.length, latestVersion, latestBy, known, loading, changed.length]);

  const edit = (key, value) => {
    setRefused((list) => Object.fromEntries(Object.entries(list).filter(([name]) => name !== key)));
    setEdits((previous) => ({ ...previous, [key]: value }));
  };
  const handleChange = (key, type) => (event) => {
    const { value, checked } = event.target;
    edit(key, type === 'checkbox' ? checked : (value === '' ? '' : Number(value)));
  };

  const handleSave = async () => {
    if (!canManage || !dirty || Object.keys(problems).length) return;
    const label = formatDomainPillarLabel(domain);
    const labels = Object.fromEntries(fields.map(([key, name]) => [key, name]));
    const confirmed = await requestConfirmation({
      title: `Change ${label} thresholds?`,
      icon: 'warning',
      message: `Everyone working in ${label} gets this from their next run. ${listChanges(changed.map((key) => ({ label: labels[key] || key, from: key in current ? valueText(current[key]) : 'not set', to: valueText(edits[key]) })))}`,
      confirmText: 'Save',
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      // Only what was changed; the Service keeps the rest.
      const values = Object.fromEntries(changed.map((key) => [key, edits[key]]));
      await asOwnChange(
        domain,
        'thresholds',
        () => saveRuleThresholds(apiFetch, domain, answer?.versionId === undefined ? values : { ...values, version_id: answer.versionId }),
        (data) => readThresholdAnswer(data?.state ? data.state : data)?.versionId,
      );
      notify({ title: 'Thresholds saved', message: `${label}: ${changed.length} changed. They apply from the next run.`, level: 'success', source: 'Configuration' });
      keepDomainDraft(windowId, domain, 'thresholds', null);
      setEdits({});
      setRefused({});
    } catch (error) {
      // Another admin was first: theirs is shown, the edits stay.
      const conflict = readVersionConflict(error, readThresholdAnswer);
      if (conflict) {
        setAnswer((previous) => ({ ...conflict, keys: conflict.keys || previous?.keys || null, closed: conflict.closed ?? previous?.closed ?? null }));
        notify({ title: 'Not saved: changed meanwhile', message: `${conflict.updatedBy || 'Someone else'} saved ${label} thresholds since you opened them. Theirs are shown now and your edits are kept. Check them, then save again.`, level: 'warning', source: 'Configuration' });
        return;
      }
      setRefused(fieldErrors(error));
      notify({ title: 'Save failed', message: getServiceRefusalMessage(error) || error?.message || 'Failed to save detection thresholds.', level: 'error', source: 'Configuration' });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setRefused({});
    setEdits(Object.fromEntries(Object.keys(defaults).filter((key) => current[key] !== defaults[key]).map((key) => [key, defaults[key]])));
    notify({ title: 'Defaults filled in', message: 'Not saved yet.', level: 'info', source: 'Configuration' });
  };
  const discard = () => {
    setRefused({});
    setEdits({});
  };
  const noteOf = (key) => problems[key] || refused[key] || '';

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
        description={canManage ? 'What a rule must see before it raises a finding, for everyone in this domain. Only what you change is saved.' : 'You need users:manage to change detection thresholds.'}
        actions={canManage ? (
          <>
            {dirty ? <button type="button" className="settings_button" disabled={saving} onClick={discard}>Discard changes</button> : null}
            <button type="button" className="settings_button" disabled={saving} onClick={handleReset}>{fromService ? 'Fill in defaults' : 'Fill in built-in defaults'}</button>
            <button type="button" className="settings_button settings_primary" disabled={saving || !dirty || Object.keys(problems).length > 0} onClick={handleSave}>{saving ? 'Saving…' : dirty ? `Save ${changed.length} changed` : 'Save thresholds'}</button>
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
                    <label key={key} className={`settings_switch config_switch_row${changed.includes(key) ? ' is-changed' : ''}`}>
                      <span>{label}<InfoTip text={describeThreshold(opts, defaults[key])} />{key in saved ? null : <small className="config_domain_mark">{key in defaults ? 'default' : 'not set'}</small>}</span>
                      <input type="checkbox" role="switch" checked={values[key] === true} disabled={!canManage} onChange={handleChange(key, 'checkbox')} />
                    </label>
                  ) : (
                    <label key={key} className={`config_window_field${changed.includes(key) ? ' is-changed' : ''}`}>
                      <span className="config_window_field_label">{label}<InfoTip text={describeThreshold(opts, defaults[key])} />{key in saved ? null : <small className="config_domain_mark" title="The Service sent no value for this one. It is saved only if you change it.">{key in defaults ? 'default' : 'not set'}</small>}</span>
                      <input
                        type="number"
                        className="settings_input"
                        min={opts.min}
                        max={opts.max}
                        step={opts.step}
                        value={values[key] ?? ''}
                        disabled={!canManage}
                        aria-invalid={noteOf(key) ? true : undefined}
                        onChange={handleChange(key)}
                      />
                      {noteOf(key) ? <small className="config_domain_error" role="alert">{noteOf(key)}</small> : null}
                    </label>
                  )
                ))}
              </div>
            </React.Fragment>
          ))}
          {!fields.length ? <p className="settings_hint">This domain has no thresholds yet.</p> : null}
          {open && canManage ? <AddThreshold taken={fields.map(([key]) => key)} onAdd={(key) => edit(key, '')} /> : null}
          {others.length ? (
            <>
              <p className="config_card_label">Other thresholds of this domain (read-only here)</p>
              <dl className="config_domain_others">
                {others.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{Array.isArray(value) ? value.join(', ') || 'none' : valueText(value)}</dd></div>)}
              </dl>
            </>
          ) : null}
        </div>
      </Block>
      {canManage ? <HistoryBlock label="Threshold history" description="Every saved version of the thresholds, newest first." items={history} /> : null}
    </>
  );
}

// An open domain (insurance, social media) accepts any numeric threshold.
function AddThreshold({ taken, onAdd }) {
  const [name, setName] = useState('');
  const problem = name ? thresholdKeyProblem(name, taken) : '';
  return (
    <form className="config_domain_add" onSubmit={(event) => { event.preventDefault(); if (name && !problem) { onAdd(name); setName(''); } }}>
      <input className="settings_input" aria-label="New threshold name" placeholder="new_threshold_name" value={name} aria-invalid={problem ? true : undefined} onChange={(event) => setName(event.target.value.trim().slice(0, 80))} />
      <button type="submit" className="settings_button" disabled={!name || Boolean(problem)}>Add threshold</button>
      {problem ? <small className="config_domain_error" role="alert">{problem}</small> : null}
    </form>
  );
}

/* ── Score lineage (production ScoreLineagePanel) ───────────────────── */

const cloneRows = (rows) => rows.map((row) => ({ ...row }));

// What is sent and compared, from what is on screen.
const lineageOf = ({ scores, nodes, tiers }, isCdr) => ({
  base_scores: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, Number(value)])),
  node_thresholds: nodes.map((row) => ({ min_nodes: Number(row.min_nodes), add_points: Number(row.add_points) })),
  money_thresholds: tiers.map((row) => ({ min_amount: Number(row.min_amount), add_points: Number(row.add_points) })),
  ...(isCdr ? { duration_thresholds: tiers.map((row) => ({ min_seconds: Number(row.min_amount), add_points: Number(row.add_points) })) } : {}),
});

function ScoreLineage({ windowId, apiFetch, domain, isCdr, canManage, notify, requestConfirmation, onFigures }) {
  const typologyDefaults = isCdr ? DEFAULT_CDR_TYPOLOGIES : DEFAULT_BANK_TYPOLOGIES;
  const [baseScores, setBaseScores] = useState(typologyDefaults);
  const [nodeThresholds, setNodeThresholds] = useState(cloneRows(isCdr ? DEFAULT_CDR_NODE_THRESHOLDS : DEFAULT_BANK_NODE_THRESHOLDS));
  const [valueThresholds, setValueThresholds] = useState(cloneRows(isCdr ? DEFAULT_CDR_DURATION_THRESHOLDS : DEFAULT_BANK_MONEY_THRESHOLDS));
  const [otherScores, setOtherScores] = useState({}); // typologies this page has no slider for: kept
  const [base, setBase] = useState(''); // what the Service has, to tell what is changed
  const [stale, setStale] = useState(false); // it changed there since the kept edits began
  const [versionId, setVersionId] = useState(undefined);
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const [reloadKey, setReloadKey] = useState(0);

  const changeSeq = useSyncExternalStore(subscribeDomainChanges, () => getDomainChangeSeq(domain, 'lineage'));
  // A version replaced while its own was being edited, carried by the refusal.
  const conflictRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    const typologies = isCdr ? DEFAULT_CDR_TYPOLOGIES : DEFAULT_BANK_TYPOLOGIES;
    const theirs = conflictRef.current;
    conflictRef.current = null;
    if (canManage) {
      fetchScoreLineageHistory(apiFetch, domain)
        .then((res) => { if (!cancelled) setHistory(Array.isArray(res?.results) ? res.results : []); })
        .catch(() => {}); // a Service without it
    }
    (theirs ? Promise.resolve(theirs) : fetchScoreLineage(apiFetch, domain)).then((res) => {
      if (cancelled) return;
      const sentAnswer = readThresholdAnswer(res);
      const cfg = sentAnswer?.config || {};
      setVersionId(sentAnswer?.versionId);
      const sent = cfg.base_scores && typeof cfg.base_scores === 'object' ? cfg.base_scores : {};
      const domainMatches = isCdr ? cfg.domain_id === 'cdr' : cfg.domain_id !== 'cdr';
      const read = {
        scores: { ...typologies, ...pickKnown(sent, typologies) },
        nodes: domainMatches && Array.isArray(cfg.node_thresholds) && cfg.node_thresholds.length ? cloneRows(cfg.node_thresholds) : cloneRows(isCdr ? DEFAULT_CDR_NODE_THRESHOLDS : DEFAULT_BANK_NODE_THRESHOLDS),
        tiers: isCdr
          ? (Array.isArray(cfg.duration_thresholds) && cfg.duration_thresholds.length ? cfg.duration_thresholds.map((row) => ({ min_amount: row.min_seconds ?? row.min_amount, add_points: row.add_points })) : cloneRows(DEFAULT_CDR_DURATION_THRESHOLDS))
          : (Array.isArray(cfg.money_thresholds) && cfg.money_thresholds.length ? cloneRows(cfg.money_thresholds) : cloneRows(DEFAULT_BANK_MONEY_THRESHOLDS)),
      };
      const nextBase = JSON.stringify(lineageOf(read, isCdr));
      setOtherScores(domainMatches ? Object.fromEntries(Object.entries(sent).filter(([key]) => !(key in typologies))) : {});
      setBase(nextBase);
      // Edits made before this page was left are kept.
      const draft = getDomainDraft(windowId, domain, 'lineage');
      setStale(Boolean(draft) && draft.base !== nextBase);
      const shown = draft ? draft.value : read;
      setBaseScores(shown.scores);
      setNodeThresholds(shown.nodes);
      setValueThresholds(shown.tiers);
      setLoadState('ready');
    }).catch(() => { if (!cancelled) setLoadState('error'); });
    return () => { cancelled = true; };
  }, [windowId, apiFetch, domain, isCdr, canManage, reloadKey, changeSeq]);

  const screen = useMemo(() => ({ scores: baseScores, nodes: nodeThresholds, tiers: valueThresholds }), [baseScores, nodeThresholds, valueThresholds]);
  const now = lineageOf(screen, isCdr);
  const dirty = loadState === 'ready' && JSON.stringify(now) !== base;
  const draftBase = useRef('');
  if (dirty && !draftBase.current) draftBase.current = getDomainDraft(windowId, domain, 'lineage')?.base || base;
  useEffect(() => {
    if (loadState !== 'ready') return;
    if (!dirty) draftBase.current = '';
    keepDomainDraft(windowId, domain, 'lineage', dirty ? { base: draftBase.current, value: screen } : null);
  }, [windowId, domain, dirty, loadState, screen]);

  const reload = () => {
    keepDomainDraft(windowId, domain, 'lineage', null);
    draftBase.current = '';
    setReloadKey((key) => key + 1);
  };

  const handleSave = async () => {
    if (!canManage || !dirty) return;
    const label = formatDomainPillarLabel(domain);
    const before = JSON.parse(base);
    const changes = Object.keys(now.base_scores).filter((key) => now.base_scores[key] !== before.base_scores[key])
      .map((key) => ({ label: key, from: valueText(before.base_scores[key]), to: valueText(now.base_scores[key]) }));
    [['node_thresholds', isCdr ? 'network scale tiers' : 'node count tiers'], [isCdr ? 'duration_thresholds' : 'money_thresholds', isCdr ? 'duration tiers' : 'value tiers']].forEach(([key, name]) => {
      const tiers = (rows) => rows.map((row) => Object.values(row).map(numberText).join(' +')).join(', ') || 'none';
      if (JSON.stringify(now[key]) !== JSON.stringify(before[key])) changes.push({ label: name, from: tiers(before[key]), to: tiers(now[key]) });
    });
    const confirmed = await requestConfirmation({
      title: `Change ${label} score lineage?`,
      icon: 'warning',
      message: `${stale ? 'Someone saved another version since you began: this replaces it. ' : ''}Everyone working in ${label} gets a new version. ${listChanges(changes)}`,
      confirmText: 'Save',
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      const payload = { domain_id: domain, ...now, base_scores: { ...otherScores, ...now.base_scores } };
      await asOwnChange(
        domain,
        'lineage',
        () => saveScoreLineage(apiFetch, domain, versionId === undefined ? payload : { ...payload, version_id: versionId }),
        (data) => readThresholdAnswer(data?.state ? data.state : data)?.versionId,
      );
      notify({ title: 'Score lineage saved', message: `${label}: saved as a new version.`, level: 'success', source: 'Configuration' });
      reload();
    } catch (error) {
      const conflict = readVersionConflict(error, readThresholdAnswer);
      if (conflict) {
        // The edits stay on screen, on top of theirs.
        conflictRef.current = error.data.current;
        setReloadKey((key) => key + 1);
        notify({ title: 'Not saved: changed meanwhile', message: `${conflict.updatedBy || 'Someone else'} saved ${label} score lineage since you opened it. Your edits are kept. Check them, then save again to replace theirs.`, level: 'warning', source: 'Configuration' });
        return;
      }
      notify({ title: 'Save failed', message: getServiceRefusalMessage(error) || error?.message || 'Error saving score lineage.', level: 'error', source: 'Configuration' });
    } finally {
      setSaving(false);
    }
  };

  const editRow = (rows, setRows, index, key) => (event) => setRows(rows.map((row, i) => (i === index ? { ...row, [key]: Number(event.target.value) } : row)));

  const typologyCount = Object.keys(typologyDefaults).length;
  const tierCount = nodeThresholds.length + valueThresholds.length;
  useEffect(() => {
    onFigures?.({ typologies: typologyCount, tiers: tierCount, lineageReady: loadState === 'ready', lineageLoading: loadState === 'loading', lineageDirty: dirty });
  }, [onFigures, typologyCount, tierCount, loadState, dirty]);

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
    <>
    <Block
      title="Score lineage"
      description={canManage ? "How a finding's risk score is built, for everyone in this domain: points per typology, then points added by scale. Each save is a new version." : 'You need users:manage to change the score lineage.'}
      actions={canManage ? (
        <>
          {dirty ? <button type="button" className="settings_button" disabled={saving} onClick={reload}>Discard changes</button> : null}
          <button type="button" className="settings_button settings_primary" disabled={saving || !dirty} onClick={handleSave}>{saving ? 'Saving…' : 'Save new version'}</button>
        </>
      ) : null}
    >
      {stale && dirty ? <div className="settings_error" role="alert">Someone saved another version since you began these edits. Saving replaces it; Discard changes shows it.</div> : null}
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
    {canManage ? <HistoryBlock label="Score lineage history" description="Every saved version of the score lineage, newest first." items={history} /> : null}
    </>
  );
}

const PARTS = [
  { id: 'thresholds', label: 'Thresholds' },
  { id: 'sensitivity', label: 'Sensitivity' },
  { id: 'lineage', label: 'Score lineage' },
  { id: 'columns', label: 'Columns' },
  { id: 'mapping', label: 'Column mapping' },
];
// Loaded when first opened; the others load with the page, for its figures.
const LAZY_PARTS = { sensitivity: DomainSensitivity, columns: DomainColumns, mapping: DomainMapping };

function DomainDetail({ windowId, apiFetch, domain, isActiveDomain, part, onPart, canManage, notify, requestConfirmation, onDirty }) {
  const isCdr = domain === 'cdr';
  // The two parts load and save on their own; each reports its figures here.
  const [figures, setFigures] = useState({});
  const mergeFigures = useCallback((patch) => setFigures((current) => ({ ...current, ...patch })), []);
  const [columnsDirty, setColumnsDirty] = useState(() => Boolean(getDomainDraft(windowId, domain, 'columns')));
  const [mappingDirty, setMappingDirty] = useState(() => Boolean(getDomainDraft(windowId, domain, 'mapping')));
  const onPartDirty = { columns: setColumnsDirty, mapping: setMappingDirty };
  const dirty = { thresholds: Boolean(figures.thresholdsDirty), lineage: Boolean(figures.lineageDirty), columns: columnsDirty, mapping: mappingDirty };
  const anyDirty = Object.values(dirty).some(Boolean);
  // Once opened, a part stays, with what was typed in it.
  const [opened, setOpened] = useState(() => new Set([part]));
  if (!opened.has(part)) setOpened(new Set([...opened, part]));
  useEffect(() => { onDirty(anyDirty); }, [onDirty, anyDirty]);
  const parts = { windowId, apiFetch, domain, isCdr, canManage, notify, requestConfirmation, onFigures: mergeFigures };
  return (
    <>
      <Masthead>
        <PageHero
          eyebrow="Domain"
          title={formatDomainPillarLabel(domain)}
          pill={canManage ? null : <Pill tone="neutral">Read-only</Pill>}
          meta={`What detection uses for everyone in this domain. ${isActiveDomain ? 'It is this session’s active domain.' : 'It is not this session’s active domain: looking here does not switch it.'}`}
          media={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21a9 9 0 1 1 9-9M12 12l5-5M12 3v2M3 12h2M5.6 5.6l1.4 1.4M19 16v6M16 19h6" />
            </svg>
          )}
        />
        <Stats label="Domain figures" columns={4}>
          <Stat lead icon="list" label="Thresholds" value={figures.ready ? Number(figures.thresholds || 0).toLocaleString() : '–'} note={figures.ready ? `in ${figures.groups} groups` : 'not loaded'} />
          <Stat text icon="clock" label="Latest version" value={figures.version != null ? `v${figures.version}` : '—'} note={figures.updatedBy ? `by ${figures.updatedBy}` : (canManage ? 'no saved version' : 'needs users:manage')} />
          <Stat icon="layers" label="Typologies" value={figures.lineageReady ? Number(figures.typologies || 0).toLocaleString() : '–'} note="base scores" />
          <Stat icon="bolt" label="Score tiers" value={figures.lineageReady ? Number(figures.tiers || 0).toLocaleString() : '–'} note="scale multipliers" />
        </Stats>
      </Masthead>
      <div className="config_domain_tabs" role="tablist" aria-label="Domain settings">
        {PARTS.map(({ id, label }) => (
          <button key={id} type="button" role="tab" aria-selected={part === id} className={part === id ? 'is-active' : ''} onClick={() => onPart(id)}>
            {label}{dirty[id] ? <small>unsaved</small> : null}
          </button>
        ))}
      </div>
      {!LAZY_PARTS[part] && figures[part === 'lineage' ? 'lineageLoading' : 'thresholdsLoading'] !== false ? (
        <WindowLoadScreen className="is-block" label="Loading the domain’s settings…" />
      ) : null}
      <div className="config_domain_part" hidden={part !== 'thresholds'}><RuleThresholds {...parts} /></div>
      <div className="config_domain_part" hidden={part !== 'lineage'}><ScoreLineage {...parts} /></div>
      {Object.keys(LAZY_PARTS).filter((id) => opened.has(id)).map((id) => {
        const Part = LAZY_PARTS[id];
        return <div key={id} className="config_domain_part" hidden={part !== id}><Part {...parts} onDirty={onPartDirty[id]} thresholdsDirty={dirty.thresholds} /></div>;
      })}
    </>
  );
}

// Configuration ▸ Domains (Phase 6): any domain's thresholds, sensitivity,
// score lineage, columns and column mapping. domains: the Service's; activeDomain: the session's.
export default function DomainsPanel({ windowId = '', apiFetch, domains, activeDomain, canManage, notify, requestConfirmation }) {
  const [view, setView] = useState(() => getDomainsView(windowId));
  const show = useCallback((patch) => {
    keepDomainsView(windowId, patch);
    setView(getDomainsView(windowId));
  }, [windowId]);
  // The one picked; until then, the session's.
  const domain = view.domain && domains.includes(view.domain) ? view.domain : activeDomain;
  const [, setDirty] = useState(false);
  // Edited: it stays shown when the session's domain is switched elsewhere.
  const handleDirty = useCallback((dirty) => {
    setDirty(dirty);
    if (dirty) show({ domain });
  }, [domain, show]);
  return (
    <SettingsPage className="config_page config_sensitivity">
      <div className="config_system_domains" role="radiogroup" aria-label="Domain to show">
        {domains.map((key) => (
          <button key={key} type="button" role="radio" aria-checked={key === domain} className={`config_system_domain${key === domain ? ' is-on' : ''}`} onClick={() => show({ domain: key })}>
            <i aria-hidden="true" />
            {formatDomainPillarLabel(key)}
            {hasDomainDraft(windowId, key) ? <small>unsaved</small> : key === activeDomain ? <small>active</small> : null}
          </button>
        ))}
      </div>
      <DomainDetail
        key={domain}
        windowId={windowId}
        apiFetch={apiFetch}
        domain={domain}
        isActiveDomain={domain === activeDomain}
        part={PARTS.some(({ id }) => id === view.part) ? view.part : 'thresholds'}
        onPart={(part) => show({ part })}
        canManage={canManage}
        notify={notify}
        requestConfirmation={requestConfirmation}
        onDirty={handleDirty}
      />
    </SettingsPage>
  );
}
