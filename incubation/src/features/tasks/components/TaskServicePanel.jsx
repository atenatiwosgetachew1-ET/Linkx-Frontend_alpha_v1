import React, { useState } from 'react';
import { createPortal } from 'react-dom';

import { useCan } from '../../../auth/useCan.js';
import { useSession } from '../../../shared/session/useSession.js';
import { useWorkspaceActions } from '../../../workspace/hooks/useWorkspace.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { getServiceRefusalMessage } from '../../../services/apiErrors.js';
import { reconfirmTask } from '../../../services/tasksApi.js';
import TaskEvidenceDialog from './TaskEvidenceDialog.jsx';
import { canSaveAsEvidence, saveRunAsEvidence } from '../lib/saveEvidence.js';
import { TASK_LIFECYCLES, applyServerTask, releaseTaskSession, taskRemark } from '../lib/taskRegistry.js';
import { formatDateTime } from '../lib/taskFormat.js';

// A task's record on the Service (frontend alignment 2026-11-20): its
// lifecycle (H-2: expiring, expired → Reconfirm, archived) and Save as
// evidence (H-6, analysis-results-plan Phase 5). Nothing for a run the
// Service does not know (no task id).
//
// dialogHost: the Tasks window's element the Save as evidence popup covers
// (as the report popup covers its Graph window).
// graphMissing: why the run's graph cannot be kept ('' when it can).
export default function TaskServicePanel({ task, dialogHost = null, graphMissing = '' }) {
  const can = useCan();
  const { apiFetch } = useSession();
  const { openWindow } = useWorkspaceActions();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  if (!task.serverId) return null;

  const expired = task.lifecycle === TASK_LIFECYCLES.EXPIRED || task.lifecycle === TASK_LIFECYCLES.ARCHIVED;
  const canSave = canSaveAsEvidence(task, can);

  const reconfirm = async () => {
    setBusy('reconfirm');
    setMessage('');
    try {
      const raw = await reconfirmTask(apiFetch, task.serverId);
      if (raw) applyServerTask(raw);
    } catch (error) {
      setMessage(getServiceRefusalMessage(error) || 'The task could not be reconfirmed.');
    } finally {
      setBusy('');
    }
  };

  // From the popup. -> { ok, message?, offerWithoutGraph? }
  const save = async (values, options) => {
    const result = await saveRunAsEvidence(apiFetch, task, values, options);
    if (result.ok) {
      setDialogOpen(false);
      // Its graph is in the record now: a background run's session is freed.
      if (result.graphKept === true) releaseTaskSession(task.id);
      setMessage(result.message);
    }
    return result;
  };
  const dialog = dialogOpen ? (
    <TaskEvidenceDialog
      initial={{ title: `${task.title} #${task.number}`, summary: '', includeGraph: true }}
      graphMissing={graphMissing}
      remark={taskRemark(task)}
      taskLabel={`${task.title} #${task.number}`}
      onSave={save}
      onCancel={() => setDialogOpen(false)}
    />
  ) : null;

  const openEvidence = () => openWindow(WORKSPACE_WINDOW_TYPES.REPORTS, {
    title: 'Reports',
    // Service evidence ▸ Analysts, with the saved record selected.
    metadata: { reportsTab: 'evidence', reportsRequester: 'analyst', reportsSelect: task.evidenceId || null, openSeq: Date.now() },
  });

  // One line each: what it says on the left, its button (if any) on the right.
  const row = (key, text, action = null) => (
    <div className="tasks_service_row" key={key}>
      <p className="tasks_service_note">{text}</p>
      {action ? <div className="tasks_service_actions">{action}</div> : null}
    </div>
  );

  return (
    <div className={`tasks_service is-${task.lifecycle || 'active'}${task.evidenceId ? ' is-saved' : ''}`} aria-label="Service record">
      {task.lifecycle === TASK_LIFECYCLES.EXPIRING
        ? row('expiring', `Expires soon${task.expiresAt ? ` (${formatDateTime(task.expiresAt)})` : ''}. Save or report it before then.`)
        : null}
      {expired ? row(
        'expired',
        `${task.lifecycle === TASK_LIFECYCLES.ARCHIVED ? 'Archived' : 'Expired'}: read-only. Reconfirm it to save it or report it back.`,
        !task.foreign ? (
          <button type="button" className="tasks_action" disabled={busy === 'reconfirm'} onClick={reconfirm}>
            {busy === 'reconfirm' ? 'Reconfirming…' : 'Reconfirm'}
          </button>
        ) : null,
      ) : null}
      {task.foreign && task.ownerName ? row('owner', `Run by ${task.ownerName}.`) : null}

      {task.evidenceId ? row(
        'saved',
        <span className="tasks_evidence_badge">Saved as evidence</span>,
        <button type="button" className="tasks_action" onClick={openEvidence}>Open in Reports</button>,
      ) : canSave ? row(
        'save',
        'Keep this run as a permanent record in Reports.',
        <button type="button" className="tasks_action tasks_evidence_button" onClick={() => { setMessage(''); setDialogOpen(true); }}>Save as evidence</button>,
      ) : null}
      {message ? <p className="tasks_service_message" role="status">{message}</p> : null}
      {dialog && dialogHost ? createPortal(dialog, dialogHost) : dialog}
    </div>
  );
}
