import React, { useCallback, useEffect, useRef, useState } from 'react';

import { Section } from '../../../shared/components/form/FormFields.jsx';
import Modal from '../../../shared/components/Modal.jsx';

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

  if (loading && !data) return <p className="settings_hint">Loading xVigilance health…</p>;
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
  const runs = Array.isArray(data.recent_runs)
    ? [...data.recent_runs].sort((a, b) => Number(String(b.status || '').toLowerCase().includes('run')) - Number(String(a.status || '').toLowerCase().includes('run')))
    : [];

  return (
    <>
      {error ? <div className="settings_error">{error} (showing the last loaded data)</div> : null}
      <Section
        title={isCdr ? 'CDR ingestion progress tracker' : 'Progress tracker'}
        description={`${isCdr ? 'Last window end time' : 'Last window end'}: ${checkpoint.last_window_end || 'N/A'}`}
        actions={(
          <>
            <span className={`vigilance_status_pill is-${status}`}>{status}</span>
            {canManage ? (
              <label className="settings_toggle_row config_window_toggle" title={checkpoint.is_paused ? 'Resume engine' : 'Pause engine'}>
                <input type="checkbox" checked={!checkpoint.is_paused} disabled={togglingPause} onChange={() => togglePause(!checkpoint.is_paused)} />
                <span>{togglingPause ? 'Updating…' : checkpoint.is_paused ? 'Engine off' : 'Engine on'}</span>
              </label>
            ) : null}
          </>
        )}
      >
        <p className="vigilance_feed"><span>{isCdr ? 'Data stream' : 'Feed name'}</span> {describeFeed(checkpoint.feed_name, isCdr)}</p>
      </Section>

      <Section
        title={isCdr ? 'Total digested calls & sessions' : 'Total digested counter'}
        actions={(
          <>
            {canManage ? <button type="button" className="settings_button is-danger" onClick={() => setRewindOpen(true)}>{isCdr ? 'Re-analyze CDR history' : 'Re-analyze history'}</button> : null}
            <button type="button" className="settings_button" disabled={exporting} onClick={exportSummary}>{exporting ? 'Preparing…' : 'Download summary'}</button>
            <button type="button" className="settings_button" onClick={() => onOpenFindings({ tab: 'xvigilance' })}>Show findings</button>
          </>
        )}
      >
        <p className="vigilance_counter">
          <strong>{Number(checkpoint.total_graph_analyzed || 0).toLocaleString()}</strong>
          <span>{isCdr ? 'calls / sessions analyzed' : 'records analyzed'}</span>
        </p>
      </Section>

      <Section title={isCdr ? 'CDR stream audit log' : 'Audit log'} description="Click a run to open its findings. Refreshes every 10 seconds.">
        <div className="config_window_table_wrap is-scroll vigilance_runs">
          <table className="config_window_table">
            <thead>
              <tr><th>Run ID</th><th>Window</th><th>Duration (ms)</th><th>{isCdr ? 'Calls (CDRs)' : 'Records'}</th><th>Status</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr><td colSpan={6} className="config_window_table_empty">No runs found.</td></tr>
              ) : runs.map((run) => {
                const ok = isSuccessStatus(run.status);
                return (
                  <tr
                    key={run.run_id}
                    className={`vigilance_run${ok ? '' : ' is-failed'}${checkingRunId === run.run_id ? ' is-checking' : ''}`}
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
                    <td>{run.run_id}</td>
                    <td>{run.window_start} – {run.window_end}</td>
                    <td>{run.duration_ms}</td>
                    <td>{run.records_count}</td>
                    <td><span className={`config_window_status is-${ok ? 'succeeded' : 'failed'}`}>{run.status}</span></td>
                    <td className="config_window_table_actions">
                      {!ok && run.error_message ? (
                        <button type="button" className="settings_button is-danger" onClick={(event) => { event.stopPropagation(); setErrorTrace(run.error_message); }}>View error</button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

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
    </>
  );
}
