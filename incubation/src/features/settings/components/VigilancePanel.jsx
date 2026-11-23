import React, { useCallback, useEffect, useRef, useState } from 'react';
import WindowLoadScreen from '../../../shared/components/WindowLoadScreen.jsx';

import { Section } from '../../../shared/components/form/FormFields.jsx';
import Modal from '../../../shared/components/Modal.jsx';
import { Masthead, PageHero, Stat, Stats } from './SettingsPage.jsx';

const HEALTH_POLL_MS = 10000;
const isSuccessStatus = (status) => ['success', 'succeeded'].includes(String(status || '').toLowerCase());

const describeFeed = (rawName, isCdr) => {
  if (!rawName) return isCdr ? 'CDR Voice/SMS Stream' : 'BDR Transaction Stream';
  return isCdr ? String(rawName).replace(/transactions?/gi, 'Calls / CDRs').replace(/bdr/gi, 'CDR') : rawName;
};

const parseWindowTime = (value) => {
  let text = String(value || '').replace(' ', 'T');
  if (!text.endsWith('Z') && text.includes('T') && text.length <= 19) text += 'Z';
  return new Date(text).getTime();
};

const toLocalQueryTime = (timestamp) => {
  if (!timestamp || Number.isNaN(timestamp)) return '';
  const date = new Date(timestamp);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

async function downloadSummaryPdf(data, isCdr) {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF();
  const { checkpoint, recent_runs: runs = [] } = data;
  doc.setFillColor(49, 73, 97);
  doc.rect(0, 0, 210, 40, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('xVigilance Health Summary', 14, 25);
  doc.setTextColor(50, 50, 50);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  let y = 55;
  doc.text(`Feed Name: ${describeFeed(checkpoint.feed_name, isCdr)}`, 14, y);
  doc.text(`Last Window End: ${checkpoint.last_window_end || 'N/A'}`, 110, y);
  y += 8;
  doc.text(`Total ${isCdr ? 'Calls / Sessions' : 'Records'} Analyzed: ${checkpoint.total_graph_analyzed || 0}`, 14, y);
  doc.text(`Status: ${(checkpoint.status || 'inactive').toUpperCase()}`, 110, y);
  y += 15;
  const head = [['Run ID', 'Window', 'Duration (ms)', isCdr ? 'Calls (CDRs)' : 'Records', 'Status']];
  const rows = (list) => list.map((run) => [run.run_id, `${run.window_start} - ${run.window_end}`, run.duration_ms, run.records_count, run.status]);
  const ok = runs.filter((run) => isSuccessStatus(run.status));
  const failed = runs.filter((run) => !isSuccessStatus(run.status));
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Successful Executions', 14, y);
  autoTable(doc, {
    startY: y + 5, head, body: rows(ok), theme: 'striped',
    headStyles: { fillColor: [49, 73, 97], textColor: 255, fontSize: 10 }, bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [240, 245, 250] }, margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 15;
  if (failed.length) {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(200, 50, 50);
    doc.text('Failed / Incomplete Executions', 14, y);
    autoTable(doc, {
      startY: y + 5, head, body: rows(failed), theme: 'striped',
      headStyles: { fillColor: [200, 50, 50], textColor: 255, fontSize: 10 }, bodyStyles: { fontSize: 9 },
      alternateRowStyles: { fillColor: [255, 240, 240] }, margin: { left: 14, right: 14 },
    });
  }
  doc.save(`xvigilance_summary_${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`);
}

const ActionIcon = ({ d }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

// Production SmartVigilancePanel: xVigilance engine health, audit log,
// pause/resume, rewind and findings.
export default function VigilancePanel({ apiFetch, canManage, isCdr, notify, onOpenFindings }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [togglingPause, setTogglingPause] = useState(false);
  const [rewindOpen, setRewindOpen] = useState(false);
  const [rewindDate, setRewindDate] = useState('');
  const [rewinding, setRewinding] = useState(false);
  const [errorTrace, setErrorTrace] = useState(null);
  const [checkingRunId, setCheckingRunId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const lastPayloadRef = useRef('');
  const fetchHealth = useCallback(async () => {
    try {
      const response = await apiFetch('/api/v1/reports/xvigilance/health?limit=50', { suppressForbiddenHandler: true });
      if (!mountedRef.current) return;
      if (!response?.success) throw new Error('Failed to load xVigilance health data');
      // Skip re-rendering when nothing changed since the last poll.
      const serialized = JSON.stringify(response);
      if (serialized !== lastPayloadRef.current) {
        lastPayloadRef.current = serialized;
        setData(response);
      }
      setError('');
    } catch (err) {
      if (mountedRef.current) setError(err?.message || 'Failed to load xVigilance health data');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [apiFetch]);

  // Poll only while the browser tab is visible, and schedule the next poll
  // after the previous reply so requests never overlap.
  useEffect(() => {
    let timer = null;
    let stopped = false;
    const schedule = () => {
      clearTimeout(timer);
      if (stopped || document.visibilityState === 'hidden') return;
      timer = setTimeout(async () => {
        await fetchHealth();
        schedule();
      }, HEALTH_POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchHealth().then(schedule);
      } else {
        clearTimeout(timer);
      }
    };
    fetchHealth().then(schedule);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchHealth]);

  const retry = () => { setLoading(true); setError(''); fetchHealth(); };

  const togglePause = async (isPaused) => {
    setTogglingPause(true);
    try {
      await apiFetch('/api/v1/reports/xvigilance/state', { method: 'POST', body: { is_paused: isPaused } });
      await fetchHealth();
      notify({ title: 'Engine state updated', message: isPaused ? 'Engine paused.' : 'Engine resumed.', level: 'success', source: 'Vigilance' });
    } catch (err) {
      notify({ title: 'Engine state', message: `Failed to toggle engine state: ${err?.message || 'unknown error'}`, level: 'error', source: 'Vigilance' });
    } finally {
      setTogglingPause(false);
    }
  };

  const rewind = async () => {
    if (!rewindDate) return;
    setRewinding(true);
    try {
      await apiFetch('/api/v1/reports/xvigilance/rewind', { method: 'POST', body: { target_date: new Date(rewindDate).toISOString() } });
      notify({ title: 'Clock rewound', message: 'The xVigilance engine was rewound and will re-process history.', level: 'success', source: 'Vigilance' });
      setRewindOpen(false);
      setRewindDate('');
      fetchHealth();
    } catch (err) {
      notify({ title: 'Rewind failed', message: err?.message || 'Unknown error', level: 'error', source: 'Vigilance' });
    } finally {
      setRewinding(false);
    }
  };

  const exportSummary = async () => {
    setExporting(true);
    try {
      await downloadSummaryPdf(data, isCdr);
    } catch {
      notify({ title: 'Summary', message: 'Failed to generate the PDF. Please try again.', level: 'error', source: 'Vigilance' });
    } finally {
      setExporting(false);
    }
  };

  const openRunFindings = async (run) => {
    if (checkingRunId) return;
    if (Number(run.records_count) === 0) {
      notify({ title: 'No records', message: `This audit run processed 0 ${isCdr ? 'call records' : 'records'}, so there are no findings to display.`, level: 'warning', source: 'Vigilance' });
      return;
    }
    setCheckingRunId(run.run_id);
    const detail = { tab: 'xvigilance', window_start: run.window_start, window_end: run.window_end, run_id: run.run_id };
    try {
      const start = encodeURIComponent(toLocalQueryTime(parseWindowTime(run.window_start) - 300000));
      const end = encodeURIComponent(toLocalQueryTime(parseWindowTime(run.window_end) + 300000));
      const res = await apiFetch(`/api/v1/reports/xvigilance?limit=1&start_date=${start}&end_date=${end}`, { suppressForbiddenHandler: true });
      if (!res || res.count === undefined || res.count === 0) {
        notify({ title: 'No reports found', message: 'No flagged reports are available for this audit window.', level: 'warning', source: 'Vigilance' });
        return;
      }
      onOpenFindings(detail);
    } catch {
      notify({ title: 'Check failed', message: 'Could not verify reports; opening the findings anyway.', level: 'warning', source: 'Vigilance' });
      onOpenFindings(detail);
    } finally {
      if (mountedRef.current) setCheckingRunId(null);
    }
  };

  if (loading && !data) return <WindowLoadScreen className="is-block" label="Loading xVigilance health…" />;
  if (error && !data) {
    return (
      <Section title="Linkx Vigilance">
        <div className="settings_error">{error}</div>
        <div className="config_window_inline_actions"><button type="button" className="settings_button" onClick={retry}>Retry request</button></div>
      </Section>
    );
  }
  if (!data?.checkpoint) {
    return (
      <Section title="Linkx Vigilance">
        <p className="settings_hint">No data available.</p>
        <div className="config_window_inline_actions"><button type="button" className="settings_button" onClick={retry}>Refresh</button></div>
      </Section>
    );
  }

  const { checkpoint } = data;
  const status = checkpoint.is_paused ? 'paused' : (checkpoint.status || 'inactive');
  const isRunning = (run) => String(run.status || '').toLowerCase().includes('run');
  const runs = Array.isArray(data.recent_runs)
    ? [...data.recent_runs].sort((a, b) => Number(isRunning(b)) - Number(isRunning(a)))
    : [];
  // Figures of the loaded runs (the audit log below).
  const finished = runs.filter((run) => !isRunning(run));
  const succeeded = finished.filter((run) => isSuccessStatus(run.status)).length;
  const failed = finished.length - succeeded;
  const durations = finished.map((run) => Number(run.duration_ms)).filter((value) => Number.isFinite(value) && value >= 0);
  const averageMs = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null;
  const formatCount = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value).toLocaleString() : (value ?? '–'));
  const unit = isCdr ? 'calls / sessions analyzed' : 'records analyzed';

  return (
    <div className="settings_page vigilance is-fill">
      {error ? <div className="settings_error">{error} (showing the last loaded data)</div> : null}

      <Masthead>
        <PageHero
          tone={status}
          eyebrow="Linkx Vigilance"
          title={describeFeed(checkpoint.feed_name, isCdr)}
          titleHint={isCdr ? 'Data stream' : 'Feed name'}
          media={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
            </svg>
          )}
          meta={(
            <>
              <span>{isCdr ? 'CDR ingestion progress tracker' : 'Progress tracker'}</span>
              <i aria-hidden="true">·</i>
              <span>{isCdr ? 'Last window end time' : 'Last window end'}</span>
              <strong>{checkpoint.last_window_end || 'N/A'}</strong>
            </>
          )}
        >
          <span className={`settings_pill is-${status}${status === 'active' ? ' is-live' : ''}`}><i aria-hidden="true" />{status}</span>
          {canManage ? (
            <label className="settings_switch" title={checkpoint.is_paused ? 'Resume engine' : 'Pause engine'}>
              <span>{togglingPause ? 'Updating…' : checkpoint.is_paused ? 'Engine off' : 'Engine on'}</span>
              <input type="checkbox" role="switch" checked={!checkpoint.is_paused} disabled={togglingPause} onChange={() => togglePause(!checkpoint.is_paused)} />
            </label>
          ) : null}
        </PageHero>
        <Stats label="Engine figures" columns={4}>
          <Stat lead icon="layers" label={isCdr ? 'Total digested calls & sessions' : 'Total digested counter'} value={Number(checkpoint.total_graph_analyzed || 0).toLocaleString()} note={unit} />
          <Stat icon="check" tone="success" label="Succeeded" value={succeeded.toLocaleString()} note={`of ${finished.length.toLocaleString()} finished runs`} />
          <Stat icon="cross" tone={failed ? 'danger' : ''} label="Failed" value={failed.toLocaleString()} note={failed ? 'open a run for its error' : 'none in the log'} />
          <Stat icon="clock" label="Average duration" value={averageMs == null ? '–' : averageMs.toLocaleString()} note="ms per run" />
        </Stats>
      </Masthead>

      <section className="settings_block" aria-label={isCdr ? 'CDR stream audit log' : 'Audit log'}>
        <header className="settings_block_header vigilance_log_header">
          <div className="vigilance_log_heading">
            <h4>{isCdr ? 'CDR stream audit log' : 'Audit log'}</h4>
            <span className="vigilance_log_count">{runs.length.toLocaleString()} {runs.length === 1 ? 'run' : 'runs'}</span>
            <span className="vigilance_log_live" title="Refreshes every 10 seconds."><i aria-hidden="true" />Live · 10s</span>
          </div>
          {canManage ? (
            <button type="button" className="vigilance_action is-danger vigilance_log_rewind" onClick={() => setRewindOpen(true)}>
              <ActionIcon d="M1 4v6h6M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              {isCdr ? 'Re-analyze CDR history' : 'Re-analyze history'}
            </button>
          ) : null}
          <p className="vigilance_log_note">Click a run to open its findings. Refreshes every 10 seconds.</p>
          <div className="vigilance_log_actions">
            <button type="button" className="vigilance_action" disabled={exporting} onClick={exportSummary}>
              <ActionIcon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              {exporting ? 'Preparing…' : 'Download summary'}
            </button>
            <button type="button" className="vigilance_action is-primary" onClick={() => onOpenFindings({ tab: 'xvigilance' })}>
              Show findings
              <ActionIcon d="M5 12h14M12 5l7 7-7 7" />
            </button>
          </div>
        </header>
        <div className="config_window_table_wrap is-scroll vigilance_runs">
          <table className="config_window_table">
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Window</th>
                <th className="is-number">Duration (ms)</th>
                <th className="is-number">{isCdr ? 'Calls (CDRs)' : 'Records'}</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr><td colSpan={6} className="config_window_table_empty">No runs found.</td></tr>
              ) : runs.map((run) => {
                const ok = isSuccessStatus(run.status);
                const running = isRunning(run);
                const tone = running ? 'running' : ok ? 'succeeded' : 'failed';
                return (
                  <tr
                    key={run.run_id}
                    className={`vigilance_run is-${tone}${checkingRunId === run.run_id ? ' is-checking' : ''}`}
                    onClick={() => openRunFindings(run)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openRunFindings(run);
                      }
                    }}
                    tabIndex={0}
                    aria-label={`Open findings for run ${run.run_id}`}
                    title="View findings for this run"
                  >
                    <td className="vigilance_run_id">{run.run_id}</td>
                    <td className="vigilance_run_window">
                      <span>{run.window_start}</span>
                      <i aria-hidden="true">→</i>
                      <span>{run.window_end}</span>
                    </td>
                    <td className="is-number">{formatCount(run.duration_ms)}</td>
                    <td className="is-number">{formatCount(run.records_count)}</td>
                    <td><span className={`vigilance_run_status is-${tone}`}><i aria-hidden="true" />{run.status}</span></td>
                    <td className="config_window_table_actions vigilance_run_actions">
                      {!ok && run.error_message ? (
                        <button type="button" className="settings_link_button vigilance_run_error" onClick={(event) => { event.stopPropagation(); setErrorTrace(run.error_message); }}>View error</button>
                      ) : null}
                      <span className="vigilance_run_chevron" aria-hidden="true">›</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {rewindOpen ? (
        <Modal
          title={isCdr ? 'Re-analyze history (rewind CDR stream)' : 'Re-analyze history (rewind)'}
          onClose={() => setRewindOpen(false)}
          closeDisabled={rewinding}
          footer={(
            <>
              <button type="button" className="settings_button" disabled={rewinding} onClick={() => setRewindOpen(false)}>Cancel</button>
              <button type="button" className="settings_button is-danger" disabled={rewinding || !rewindDate} onClick={rewind}>{rewinding ? 'Rewinding…' : 'Confirm rewind'}</button>
            </>
          )}
        >
          <div className="settings_error">
            <strong>Warning:</strong> rewinding clears the audit log after the selected date and forces the engine to re-process all {isCdr ? 'call records (CDRs)' : 'transactions'}. This may cause high CPU usage.
          </div>
          <label className="config_window_field">
            <span className="config_window_field_label">Select date &amp; time</span>
            <input type="datetime-local" className="settings_input" value={rewindDate} onChange={(event) => setRewindDate(event.target.value)} />
          </label>
        </Modal>
      ) : null}

      {errorTrace ? (
        <Modal title="Engine error trace" wide onClose={() => setErrorTrace(null)} footer={<button type="button" className="settings_button" onClick={() => setErrorTrace(null)}>Close</button>}>
          <pre className="vigilance_error_trace">{errorTrace}</pre>
        </Modal>
      ) : null}
    </div>
  );
}
