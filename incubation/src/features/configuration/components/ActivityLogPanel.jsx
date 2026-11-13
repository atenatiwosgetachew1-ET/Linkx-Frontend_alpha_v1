import React, { useCallback, useEffect, useRef, useState } from 'react';

import { Section } from '../../../shared/components/form/FormFields.jsx';
import { fetchCleanupAudit, requestSessionCleanup } from '../../../services/configurationApi.js';
import { sanitizeText } from '../../../utils/inputSecurity.js';
import { useNotifications } from '../../../shared/notifications/useNotifications.js';

const ID_PATTERN = /[^A-Za-z0-9_.:-]/g;
const sanitizeId = (value, maxLength) => String(value || '').replace(ID_PATTERN, '').slice(0, maxLength);
const CLEANUP_TYPES = ['session', 'session_tree', 'window', 'run', 'neo4j_session'];

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
      <Section title="Activity log">
        <p className="settings_hint">You need users:manage to view cleanup activity logs.</p>
      </Section>
    );
  }

  const canPrev = audit.offset > 0 && !loading;
  const canNext = audit.offset + audit.items.length < audit.total && !loading;
  const updateFilter = (name) => (event) => setFilters((prev) => ({ ...prev, [name]: sanitizeText(event.target.value, { maxLength: 120 }) }));
  const updateDraft = (name) => (event) => {
    setDraft((prev) => ({ ...prev, [name]: name === 'preserve_session_config' ? event.target.checked : sanitizeText(event.target.value, { maxLength: 160 }) }));
    setCleanupMessage('');
  };

  return (
    <>
      <Section title="Manual cleanup" description="Preview or queue cleanup of session artifacts (dataframes, graphs, Neo4j data).">
        <div className="config_window_grid is-compact">
          <label className="config_window_field"><span className="config_window_field_label">Session ID</span><input className="settings_input" value={draft.session_id} placeholder="1_815493" onChange={updateDraft('session_id')} /></label>
          <label className="config_window_field">
            <span className="config_window_field_label">Cleanup type</span>
            <select className="settings_input" value={draft.cleanup_type} onChange={updateDraft('cleanup_type')}>
              <option value="">Auto</option>
              <option value="session">Session</option>
              <option value="session_tree">Session tree</option>
              <option value="window">Window</option>
              <option value="run">Run</option>
              <option value="neo4j_session">Neo4j session</option>
            </select>
          </label>
          <label className="config_window_field"><span className="config_window_field_label">Run ID</span><input className="settings_input" value={draft.run_id} placeholder="Optional" onChange={updateDraft('run_id')} /></label>
        </div>
        <label className="settings_toggle_row config_window_toggle">
          <input type="checkbox" checked={draft.preserve_session_config !== false} onChange={updateDraft('preserve_session_config')} />
          <span>Preserve session configuration</span>
        </label>
        <div className="config_window_inline_actions">
          <button type="button" className="settings_button" disabled={cleanupBusy} onClick={() => submitCleanup(true)}>{cleanupBusy ? 'Working…' : 'Preview cleanup'}</button>
          <button type="button" className="settings_button is-danger" disabled={cleanupBusy} onClick={() => submitCleanup(false)}>{cleanupBusy ? 'Working…' : 'Queue cleanup'}</button>
          {cleanupMessage ? <span className="settings_hint">{cleanupMessage}</span> : null}
        </div>
        {preview ? (
          <dl className="config_window_domain_meta">
            <div><dt>Type</dt><dd>{preview.cleanup_type || 'auto'}</dd></div>
            <div><dt>Status</dt><dd>{preview.status || 'unknown'}</dd></div>
            <div><dt>Dry run</dt><dd>{preview.dry_run ? 'yes' : 'no'}</dd></div>
            {preview.cleanup_id ? <div><dt>Cleanup ID</dt><dd>{preview.cleanup_id}</dd></div> : null}
          </dl>
        ) : null}
      </Section>

      <Section title="Cleanup activity">
        <div className="config_window_grid is-compact">
          <label className="config_window_field"><span className="config_window_field_label">Session ID</span><input className="settings_input" value={filters.session_id} placeholder="1_895258" onChange={updateFilter('session_id')} /></label>
          <label className="config_window_field"><span className="config_window_field_label">Cleanup type</span><input className="settings_input" value={filters.cleanup_type} placeholder="window" onChange={updateFilter('cleanup_type')} /></label>
          <label className="config_window_field"><span className="config_window_field_label">Status</span><input className="settings_input" value={filters.status} placeholder="succeeded" onChange={updateFilter('status')} /></label>
          <label className="config_window_field"><span className="config_window_field_label">Limit</span><input className="settings_input" type="number" min="1" max="100" value={filters.limit} onChange={updateFilter('limit')} /></label>
        </div>
        <div className="config_window_inline_actions">
          <button type="button" className="settings_button" disabled={loading} onClick={() => loadAudit(0)}>{loading ? 'Loading…' : 'Refresh'}</button>
          <button type="button" className="settings_button" disabled={!canPrev} onClick={() => loadAudit(Math.max(0, audit.offset - audit.limit))}>Prev</button>
          <button type="button" className="settings_button" disabled={!canNext} onClick={() => loadAudit(audit.offset + audit.limit)}>Next</button>
          <span className="settings_hint">{audit.total ? audit.offset + 1 : 0}–{audit.offset + audit.items.length} of {audit.total}</span>
        </div>
        {error ? <div className="settings_error">{error}</div> : null}
        <div className="config_window_table_wrap">
          <table className="config_window_table">
            <thead><tr><th>Created</th><th>Session</th><th>Type</th><th>Status</th><th>Owner</th><th>Artifacts</th><th>Error</th></tr></thead>
            <tbody>
              {audit.items.length === 0 && !loading ? (
                <tr><td colSpan={7} className="config_window_table_empty">No cleanup activity found.</td></tr>
              ) : audit.items.map((item, index) => (
                <tr key={item.id || item.created_at || index}>
                  <td>{formatDate(item.created_at || item.started_at)}</td>
                  <td title={item.session_id || ''}>{item.session_id || '—'}</td>
                  <td>{item.cleanup_type || '—'}</td>
                  <td><span className={`config_window_status is-${String(item.status || 'unknown').toLowerCase()}`}>{item.status || 'unknown'}</span></td>
                  <td>{item.session?.owner_user_id ?? '—'}</td>
                  <td>{item.artifacts?.deleted_count ?? 0}/{item.artifacts?.count ?? 0}</td>
                  <td className="config_window_table_snippet" title={item.error_message || ''}>{item.error_message || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
