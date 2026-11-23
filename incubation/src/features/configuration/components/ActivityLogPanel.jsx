import React, { useCallback, useEffect, useRef, useState } from 'react';

import WindowLoadScreen from '../../../shared/components/WindowLoadScreen.jsx';
import { Field, InfoTip } from '../../../shared/components/form/FormFields.jsx';
import { Block, Masthead, PageHero, Pill, SettingsPage, Stat, Stats } from '../../settings/components/SettingsPage.jsx';
import { fetchCleanupAudit, requestSessionCleanup } from '../../../services/configurationApi.js';
import { sanitizeText } from '../../../utils/inputSecurity.js';
import { useNotifications } from '../../../shared/notifications/useNotifications.js';

const ID_PATTERN = /[^A-Za-z0-9_.:-]/g;
const sanitizeId = (value, maxLength) => String(value || '').replace(ID_PATTERN, '').slice(0, maxLength);
const CLEANUP_TYPES = ['session', 'session_tree', 'window', 'run', 'neo4j_session'];

// Glyphs for the field labels (24px grid, stroked).
const ICONS = {
  session: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  type: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  run: 'M5 3l14 9-14 9V3z',
  status: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3',
  limit: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
};
const OK_STATUSES = ['succeeded', 'success', 'completed'];
const BAD_STATUSES = ['failed', 'error'];
const statusTone = (status) => {
  const value = String(status || '').toLowerCase();
  return OK_STATUSES.includes(value) ? ' is-ok' : BAD_STATUSES.includes(value) ? ' is-bad' : '';
};

const hero = (pill) => (
  <PageHero
    tone={pill ? 'locked' : ''}
    eyebrow="Activity log"
    title="Session cleanup"
    pill={pill}
    meta="Preview or queue the cleanup of session artifacts (dataframes, graphs, Neo4j data), and review what was cleaned."
    media={(
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />
      </svg>
    )}
  />
);

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
};

// Production ActivityAuditPanel: manual session cleanup + cleanup audit log.
export default function ActivityLogPanel({ apiFetch, canManage, defaultSessionId }) {
  const { requestConfirmation } = useNotifications();
  const [filters, setFilters] = useState({ session_id: '', cleanup_type: '', status: '', limit: '20' });
  const [draft, setDraft] = useState({ session_id: defaultSessionId || '', cleanup_type: '', run_id: '', preserve_session_config: true });
  const [preview, setPreview] = useState(null);
  const [cleanupMessage, setCleanupMessage] = useState('');
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [audit, setAudit] = useState({ items: [], total: 0, limit: 20, offset: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const loadedRef = useRef(false);

  const loadAudit = useCallback(async (offset = 0, activeFilters = filters) => {
    if (!canManage) return;
    setLoading(true);
    setError('');
    try {
      setAudit(await fetchCleanupAudit(apiFetch, {
        limit: Math.max(1, Math.min(Number.parseInt(activeFilters.limit, 10) || 20, 100)),
        offset: Math.max(0, offset),
        sessionId: activeFilters.session_id.trim(),
        cleanupType: activeFilters.cleanup_type.trim(),
        status: activeFilters.status.trim(),
      }));
      loadedRef.current = true;
    } catch (err) {
      setError(err?.message || 'Could not load cleanup activity logs.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, canManage, filters]);

  useEffect(() => {
    if (canManage && !loadedRef.current) loadAudit(0);
  }, [canManage, loadAudit]);

  const submitCleanup = async (dryRun) => {
    const sessionId = sanitizeId(draft.session_id, 128);
    const runId = sanitizeId(draft.run_id, 128);
    if (!sessionId) {
      setError('Provide a valid session ID before cleanup.');
      return;
    }
    if (draft.cleanup_type && !CLEANUP_TYPES.includes(draft.cleanup_type)) {
      setError('Cleanup type is not valid.');
      return;
    }
    if (!dryRun && !(await requestConfirmation({
      title: 'Queue cleanup?',
      message: `Queue cleanup for ${runId || sessionId}? Session artifacts will be removed.`,
      confirmText: 'Queue cleanup',
    }))) return;
    const payload = {
      id: 'cleanup_session',
      session_id: sessionId,
      reason: dryRun ? 'admin_cleanup_preview' : 'admin_manual_cleanup',
      dry_run: dryRun,
      preserve_session_config: draft.preserve_session_config !== false,
      ...(draft.cleanup_type ? { cleanup_type: draft.cleanup_type } : {}),
      ...(runId ? { run_id: runId } : {}),
    };
    setCleanupBusy(true);
    setError('');
    setCleanupMessage('');
    try {
      setPreview(await requestSessionCleanup(apiFetch, payload));
      setCleanupMessage(dryRun ? 'Cleanup preview completed.' : 'Cleanup queued.');
      const nextFilters = { ...filters, session_id: sessionId };
      setFilters(nextFilters);
      await loadAudit(0, nextFilters);
    } catch (err) {
      setError(err?.message || 'Cleanup request failed.');
    } finally {
      setCleanupBusy(false);
    }
  };

  if (!canManage) {
    return (
      <SettingsPage className="config_page config_activity">
        <Masthead>{hero(<Pill tone="neutral">Requires users:manage</Pill>)}</Masthead>
        <p className="settings_hint">You need users:manage to view cleanup activity logs.</p>
      </SettingsPage>
    );
  }

  const canPrev = audit.offset > 0 && !loading;
  const canNext = audit.offset + audit.items.length < audit.total && !loading;
  const updateFilter = (name) => (event) => setFilters((prev) => ({ ...prev, [name]: sanitizeText(event.target.value, { maxLength: 120 }) }));
  const updateDraft = (name) => (event) => {
    setDraft((prev) => ({ ...prev, [name]: name === 'preserve_session_config' ? event.target.checked : sanitizeText(event.target.value, { maxLength: 160 }) }));
    setCleanupMessage('');
  };

  // The page's figures: the whole log's size, then what this page of it holds.
  const succeeded = audit.items.filter((item) => OK_STATUSES.includes(String(item.status || '').toLowerCase())).length;
  const failed = audit.items.filter((item) => BAD_STATUSES.includes(String(item.status || '').toLowerCase())).length;
  const removed = audit.items.reduce((sum, item) => sum + (Number(item.artifacts?.deleted_count) || 0), 0);
  const first = audit.total ? audit.offset + 1 : 0;
  const last = audit.offset + audit.items.length;

  return (
    <SettingsPage className="config_page config_activity">
      <Masthead>
        {hero(null)}
        <Stats label="Cleanup figures" columns={4}>
          <Stat lead icon="list" label="Log entries" value={Number(audit.total || 0).toLocaleString()} note="match the filters" />
          <Stat icon="check" tone="success" label="Succeeded" value={succeeded.toLocaleString()} note="on this page" />
          <Stat icon="cross" tone={failed ? 'danger' : ''} label="Failed" value={failed.toLocaleString()} note="on this page" />
          <Stat icon="layers" label="Artifacts removed" value={removed.toLocaleString()} note="on this page" />
        </Stats>
      </Masthead>

      <Block
        title="Manual cleanup"
        description="Preview first to see what would be removed; queue to remove it."
        actions={(
          <>
            <button type="button" className="settings_button" disabled={cleanupBusy} onClick={() => submitCleanup(true)}>{cleanupBusy ? 'Working…' : 'Preview cleanup'}</button>
            <button type="button" className="settings_button is-danger" disabled={cleanupBusy} onClick={() => submitCleanup(false)}>{cleanupBusy ? 'Working…' : 'Queue cleanup'}</button>
          </>
        )}
      >
        <div className="config_card">
          <div className="config_card_grid is-thirds">
            <Field icon={ICONS.session} label="Session ID">
              <input className="settings_input" value={draft.session_id} placeholder="1_815493" onChange={updateDraft('session_id')} />
            </Field>
            <Field icon={ICONS.type} label="Cleanup type">
              <select className="settings_input" value={draft.cleanup_type} onChange={updateDraft('cleanup_type')}>
                <option value="">Auto</option>
                <option value="session">Session</option>
                <option value="session_tree">Session tree</option>
                <option value="window">Window</option>
                <option value="run">Run</option>
                <option value="neo4j_session">Neo4j session</option>
              </select>
            </Field>
            <Field icon={ICONS.run} label="Run ID">
              <input className="settings_input" value={draft.run_id} placeholder="Optional" onChange={updateDraft('run_id')} />
            </Field>
          </div>
          <label className="settings_switch config_switch_row">
            <span>Preserve session configuration<InfoTip text="Keep the session's saved configuration; only its artifacts are removed." /></span>
            <input type="checkbox" role="switch" checked={draft.preserve_session_config !== false} onChange={updateDraft('preserve_session_config')} />
          </label>
          {cleanupMessage ? <p className="settings_hint" role="status">{cleanupMessage}</p> : null}
          {preview ? (
            <dl className="config_result" aria-label="Cleanup result">
              <div><dt>Type</dt><dd>{preview.cleanup_type || 'auto'}</dd></div>
              <div><dt>Status</dt><dd>{preview.status || 'unknown'}</dd></div>
              <div><dt>Dry run</dt><dd>{preview.dry_run ? 'yes' : 'no'}</dd></div>
              {preview.cleanup_id ? <div><dt>Cleanup ID</dt><dd title={preview.cleanup_id}>{preview.cleanup_id}</dd></div> : null}
            </dl>
          ) : null}
        </div>
      </Block>

      <Block
        title="Cleanup activity"
        description="What was cleaned, newest first. Set the filters, then Refresh."
        actions={(
          <>
            <span className="config_table_range">{first.toLocaleString()}–{last.toLocaleString()} of {Number(audit.total || 0).toLocaleString()}</span>
            <button type="button" className="settings_button" disabled={!canPrev} onClick={() => loadAudit(Math.max(0, audit.offset - audit.limit))}>Prev</button>
            <button type="button" className="settings_button" disabled={!canNext} onClick={() => loadAudit(audit.offset + audit.limit)}>Next</button>
            <button type="button" className="settings_button settings_primary" disabled={loading} onClick={() => loadAudit(0)}>{loading ? 'Loading…' : 'Refresh'}</button>
          </>
        )}
      >
        <div className="config_card">
          <div className="config_card_grid is-filters">
            <Field icon={ICONS.session} label="Session ID">
              <input className="settings_input" value={filters.session_id} placeholder="1_895258" onChange={updateFilter('session_id')} />
            </Field>
            <Field icon={ICONS.type} label="Cleanup type">
              <input className="settings_input" value={filters.cleanup_type} placeholder="window" onChange={updateFilter('cleanup_type')} />
            </Field>
            <Field icon={ICONS.status} label="Status">
              <input className="settings_input" value={filters.status} placeholder="succeeded" onChange={updateFilter('status')} />
            </Field>
            <Field icon={ICONS.limit} label={<>Limit<InfoTip text="Rows per page. Range 1 to 100 · Default 20" /></>}>
              <input className="settings_input" type="number" min="1" max="100" value={filters.limit} onChange={updateFilter('limit')} />
            </Field>
          </div>
        </div>
        {error ? <div className="settings_error" role="alert">{error}</div> : null}
        {loading && audit.items.length === 0 ? <WindowLoadScreen className="is-block" label="Loading cleanup activity…" /> : null}
        <div className="config_window_table_wrap" hidden={loading && audit.items.length === 0}>
          <table className="config_window_table" aria-label="Cleanup activity">
            <thead><tr><th>Created</th><th>Session</th><th>Type</th><th>Status</th><th>Owner</th><th>Artifacts</th><th>Error</th></tr></thead>
            <tbody>
              {audit.items.length === 0 && !loading ? (
                <tr><td colSpan={7} className="config_window_table_empty">No cleanup activity found.</td></tr>
              ) : audit.items.map((item, index) => (
                <tr key={item.id || item.created_at || index}>
                  <td>{formatDate(item.created_at || item.started_at)}</td>
                  <td title={item.session_id || ''}>{item.session_id || '—'}</td>
                  <td>{item.cleanup_type || '—'}</td>
                  <td><span className={`config_window_status${statusTone(item.status)}`}>{item.status || 'unknown'}</span></td>
                  <td>{item.session?.owner_user_id ?? '—'}</td>
                  <td>{item.artifacts?.deleted_count ?? 0}/{item.artifacts?.count ?? 0}</td>
                  <td className="config_window_table_snippet" title={item.error_message || ''}>{item.error_message || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
    </SettingsPage>
  );
}
