import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import WindowLoadScreen from '../../../shared/components/WindowLoadScreen.jsx';
import { useCan } from '../../../auth/useCan.js';
import { SOURCE_PERMISSIONS } from '../../../auth/permissions.js';
import { isSuccessResponse } from '../../../services/apiClient.js';
import { sanitizeBackendUserMessage } from '../../../services/apiErrors.js';
import { loadSessionConfiguration, switchSessionDomain } from '../../../services/sessionApi.js';
import {
  buildAddressDataframePayload,
  buildArrayDataframePayload,
  buildToolConnectPayload,
  connectSource,
  connectTool,
  createDataframe,
  disconnectSource,
  disconnectTool,
  formatDataframeFailureMessage,
  isMaskedSecret,
  searchSourceFiles,
  toHybridResultItem,
  toStorageFileItem,
  uploadBatchFiles,
  buildStreamPayload,
  endStreamRequest,
  resolveStreamLogFile,
  startStreamRequest,
  waitForStreamJob,
} from '../../../services/sourceApi.js';
import { persistRealtimeToolConfiguration } from '../../../services/configurationApi.js';
import { useNotifications } from '../../../shared/notifications/useNotifications.js';
import { useSession } from '../../../shared/session/useSession.js';
import {
  compactValidationErrors,
  sanitizeConnectionValue,
  sanitizeIdentifier,
  sanitizeKafkaTopic,
  sanitizeText,
  validateConnectionValue,
  validateKafkaTopic,
  sanitizeRelationshipName,
} from '../../../utils/inputSecurity.js';
import { useWorkspaceActions } from '../../../workspace/hooks/useWorkspace.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { buildSourceAutofillPatch, resolveSourceDefaults } from '../lib/sourceConfig.js';
import {
  canPrepareDataframe,
  canStream,
  connectionKindOf,
  DATAFRAME_ACTION_BACKEND_VALUES,
  DATAFRAME_STATUSES,
  displaySourceMessage,
  displayToolMessage,
  configDefaultsPatch,
  domainDefaultsPatch,
  formatDomainLabel,
  getAccessibleSteps,
  getContinueBlockers,
  getDataframeFlow,
  getWorkflowSteps,
  isInputStep,
  isSourceBusy,
  isSourceReady,
  isStreamActive,
  isToolBusy,
  mergeSourceState,
  modeLabels,
  normalizeWindowSessionId,
  SOURCE_MODES,
  SOURCE_STATUSES,
  sourceStatusFromMessage,
  STALE_DATAFRAME_PATCH,
  STORAGE_SEARCH_RESET_PATCH,
  STREAM_STATUSES,
  TOOL_STATUSES,
  toolStatusFromMessage,
  UPLOAD_STATUSES,
} from '../lib/sourceModel.js';
import {
  abortSourceRequests,
  getSecret,
  getStagedFiles,
  setActiveJob,
  onSourceRuntimeDispose,
  windowRef,
  setSecret,
  trackRequest,
} from '../lib/sourceRuntime.js';
import {
  appendStreamLog,
  clearStreamLog,
  getStreamLogFile,
  getStreamLogLines,
  peekStreamLogLines,
  plugStreamLog,
  subscribeStreamLog,
  unplugStreamLog,
} from '../lib/streamLogs.js';
import { endAbandonedStream, markStreamActive, markStreamEnded, setActiveStreamLogFile } from '../lib/activeStreams.js';
import { watchStreamTask } from '../lib/backgroundStreams.js';
import { markGraphSessionTerminated } from '../../graph/lib/graphStatus.js';
import {
  TASK_ORIGINS,
  TASK_STATUSES,
  createTask,
  finishTask,
  freezeWindowTaskLogs,
  getTask,
  isTaskActive,
  markTaskRunning,
  requestTaskFocus,
  setTaskHandlers,
  updateTask,
} from '../../tasks/lib/taskRegistry.js';
import { ModeChooser } from './ModeChooser.jsx';
import { SessionBadge, SourceWindowHeading, WorkflowTimeline } from './sourceUi.jsx';
import { WorkflowBody } from './steps/WorkflowBody.jsx';
import { createLogger } from '../../../shared/logger.js';

const log = createLogger('source');

export default function SourceWindowBody({ windowItem }) {
  const workspace = useWorkspaceActions();
  const { notify } = useNotifications();
  const { apiFetch, configuration, setConfiguration, mainSessionId, socket } = useSession();
  // Live stream log (runtime store, not window state; see streamLogs.js).
  const streamLogLines = useSyncExternalStore(
    (listener) => subscribeStreamLog(windowItem.id, listener),
    () => getStreamLogLines(windowItem.id),
  );
  const can = useCan();
  const [validationMessage, setValidationMessage] = useState('');
  const [toolValidationMessage, setToolValidationMessage] = useState('');
  // Production's per-action RBAC (getWindowActionPermission + requirePermission):
  // the action is refused with a "Permission denied" notice and an inline
  // reason. UI gating only; the backend enforces the same permissions.
  const requirePermission = (permission, actionName, { setMessage = setValidationMessage } = {}) => {
    if (can(permission)) return true;
    const message = `You need ${permission} to ${actionName}.`;
    setMessage(message);
    notify({ title: 'Permission denied', message, level: 'warning', source: 'RBAC' });
    return false;
  };
  // Memoised so derived values (accessible steps, defaults merge) only
  // recompute when this window's state actually changes.
  const sourceState = useMemo(() => mergeSourceState(windowItem.sourceState), [windowItem.sourceState]);
  const sourceDefaults = useMemo(() => resolveSourceDefaults(configuration), [configuration]);
  const hasConfiguration = Boolean(configuration && Object.keys(configuration).length);
  const activeMode = sourceState.mode;
  const modeKey = activeMode === SOURCE_MODES.REALTIME ? 'realtime' : 'batch';
  const modeState = sourceState[modeKey];
  const isChoosing = activeMode === SOURCE_MODES.CHOOSE;
  const accessibleSteps = useMemo(() => getAccessibleSteps(activeMode, modeState), [activeMode, modeState]);

  // Async flows (upload -> tool -> create_DF) patch state across awaits, so
  // updates build on the latest written state rather than this render's copy.
  // Per-window (not per-component) ref: see windowRef in sourceRuntime.js.
  const sourceStateRef = windowRef(windowItem.id, 'sourceState');
  sourceStateRef.current = sourceState;

  const updateSourceState = (nextSourceState) => {
    sourceStateRef.current = nextSourceState;
    workspace.updateWindowMetadata(windowItem.id, { sourceState: nextSourceState });
  };

  const patchModeState = (patch, key = modeKey) => {
    const current = sourceStateRef.current;
    updateSourceState({
      ...current,
      [key]: {
        ...current[key],
        ...patch,
      },
    });
  };

  // Prefill connection fields from the session configuration once per window
  // (or as soon as /init delivers it). Analyst-typed values are never replaced.
  const windowId = windowItem.id;
  const rawSourceState = windowItem.sourceState;
  const { updateWindowMetadata } = workspace;
  useEffect(() => {
    if (!hasConfiguration) return;
    const current = mergeSourceState(sourceStateRef.current || rawSourceState);
    if (current.autofillApplied) return;
    const next = {
      ...current,
      autofillApplied: true,
      batch: { ...current.batch, ...buildSourceAutofillPatch(sourceDefaults, current.batch) },
      realtime: { ...current.realtime, ...buildSourceAutofillPatch(sourceDefaults, current.realtime) },
    };
    // Same path as updateSourceState: keep the ref in step so a patch that
    // lands before the next render builds on the autofilled state.
    sourceStateRef.current = next;
    updateWindowMetadata(windowId, { sourceState: next });
  }, [hasConfiguration, rawSourceState, sourceDefaults, sourceStateRef, updateWindowMetadata, windowId]);

  // Closes a backend connection that no longer matches the selected input
  // (e.g. storage -> upload). Runs in the background; the UI is reset first.
  const releaseConnection = async (key, previous) => {
    const mode = key === 'realtime' ? SOURCE_MODES.REALTIME : SOURCE_MODES.BATCH;
    const tracked = trackRequest(windowItem.id);
    try {
      if (previous.toolStatus === TOOL_STATUSES.CONNECTED) {
        await disconnectTool(apiFetch, buildToolDisconnectPayload(), { signal: tracked.signal }).catch(() => null);
      }
      if (previous.sourceStatus === SOURCE_STATUSES.CONNECTED) {
        await disconnectSource(apiFetch, buildSourcePayload(previous, sourceDefaults, mode), { signal: tracked.signal }).catch(() => null);
      }
    } finally {
      tracked.release();
    }
  };

  const selectMode = (mode, connectionType = '') => {
    setValidationMessage('');
    setToolValidationMessage('');
    const addressTypePatch = ['broker', 'storage'].includes(connectionType)
      ? { sourceAddressType: connectionType }
      : connectionType === 'search'
        ? { sourceAddressType: 'storage' }
        : {};
    const nextModeKey = mode === SOURCE_MODES.REALTIME ? 'realtime' : 'batch';
    const current = sourceStateRef.current;
    const previous = current[nextModeKey];
    const typeChanged = previous.selectedConnectionType !== connectionType;
    const nextKind = connectionKindOf({ selectedConnectionType: connectionType });
    const previousKind = previous.connectedKind || connectionKindOf(previous);
    const hasLiveConnection = previous.sourceStatus === SOURCE_STATUSES.CONNECTED;
    // A live connection (or an upload) only carries over to an input that
    // uses the same backend connection; otherwise it is closed and reset.
    const mustRelease = mode === SOURCE_MODES.BATCH && typeChanged && (
      (hasLiveConnection && previousKind !== nextKind) ||
      (previous.sourceStatus === SOURCE_STATUSES.UPLOADED && nextKind !== 'upload')
    );
    const resetPatch = mustRelease
      ? {
        sourceStatus: SOURCE_STATUSES.IDLE,
        sourceMessage: displaySourceMessage(SOURCE_STATUSES.IDLE),
        connectedKind: '',
        toolStatus: TOOL_STATUSES.IDLE,
        toolMessage: displayToolMessage(TOOL_STATUSES.IDLE),
        ...STORAGE_SEARCH_RESET_PATCH,
      }
      : {};

    updateSourceState({
      ...current,
      mode,
      [nextModeKey]: {
        ...previous,
        step: mode === SOURCE_MODES.REALTIME ? 'connect' : 'upload',
        selectedConnectionType: connectionType,
        // A dataframe belongs to the input it was built from.
        ...(typeChanged ? STALE_DATAFRAME_PATCH : {}),
        ...resetPatch,
        ...addressTypePatch,
      },
    });

    if (mustRelease && hasLiveConnection) {
      releaseConnection(nextModeKey, previous);
      notify({
        title: `${previousKind === 'storage' ? 'Storage' : 'Broker'} disconnected`,
        message: 'The previous connection was closed because a different input type was selected.',
        level: 'info',
        source: windowItem.title,
      });
    }
  };

  const copySessionId = async (sessionId) => {
    if (!sessionId) return;
    try {
      await navigator.clipboard.writeText(sessionId);
      notify({
        title: 'Session copied',
        message: 'The source session id was copied to the clipboard.',
        level: 'success',
        source: windowItem.title,
      });
    } catch (error) {
      log.error('Session id copy failed', { name: error?.name });
      notify({
        title: 'Copy failed',
        message: 'The session id could not be copied from this browser context.',
        level: 'warning',
        source: windowItem.title,
      });
    }
  };

  const openConfigurationWindow = () => {
    workspace.openWindow(WORKSPACE_WINDOW_TYPES.CONFIGURATION, {
      customTitle: 'Source defaults',
    });
  };

  const openLibrariesWindow = () => {
    workspace.openWindow(WORKSPACE_WINDOW_TYPES.LIBRARIES, {
      customTitle: 'Rules library',
      metadata: { librariesUi: { activeTab: 'rules' }, librariesRequest: { tab: 'rules', seq: Date.now() } },
    });
  };

  // Back to the chooser; it reopens on the input this window was using so a
  // plain Continue never switches (and disconnects) the input by accident.
  const changeInputSelection = () => {
    setValidationMessage('');
    const current = sourceStateRef.current;
    updateSourceState({
      ...current,
      lastMode: current.mode === SOURCE_MODES.CHOOSE ? current.lastMode : current.mode,
      mode: SOURCE_MODES.CHOOSE,
    });
  };

  const workflowSteps = getWorkflowSteps(activeMode, modeState);
  const activeStepIndex = workflowSteps.findIndex((step) => step.id === modeState.step);
  const activeWorkflowStep = activeStepIndex >= 0 ? workflowSteps[activeStepIndex] : workflowSteps[0];
  const previousStep = activeStepIndex > 0 ? workflowSteps[activeStepIndex - 1] : null;
  const nextStep = activeStepIndex >= 0 && activeStepIndex < workflowSteps.length - 1 ? workflowSteps[activeStepIndex + 1] : null;
  const isPreparing = Boolean(modeState.preparing);
  // Branded overlay for long-running actions: upload, tool connect, create_DF
  // (Continue pipeline) and source/tool connect or disconnect.
  const busyLabel = modeState.preparing
    || (isSourceBusy(modeState) ? displaySourceMessage(modeState.sourceStatus) : '')
    || (isToolBusy(modeState) ? displayToolMessage(modeState.toolStatus) : '');
  // On the input step Continue runs upload/tool/create_DF unless a dataframe
  // for this input already exists (then it simply moves on).
  const runsDataframePipeline = isInputStep(modeState) &&
    modeState.dataframeStatus !== DATAFRAME_STATUSES.READY;
  const canContinueWorkflow = runsDataframePipeline
    ? canPrepareDataframe(activeMode, modeState) && !isPreparing
    : Boolean(nextStep && accessibleSteps.has(nextStep.id));
  const continueBlockers = nextStep && !canContinueWorkflow && !isPreparing ? getContinueBlockers(activeMode, modeState) : [];
  const continueBlockedHint = continueBlockers.length ? 'To continue: ' + continueBlockers.join(' · ') : '';
  const workflowFooterMessage = activeMode === SOURCE_MODES.BATCH && modeState.step === 'upload'
    ? modeState.selectedConnectionType === 'storage'
      ? 'Selected storage files will be used to create the dataframe.'
      : modeState.selectedConnectionType === 'search'
        ? 'Selected search results will be used to create the dataframe.'
        : 'Selected files will be used to create the dataframe.'
    : nextStep
      ? 'Continue to the next source workflow step.'
      : 'This source workflow is ready for the next integration.';
  const streamActionLabels = {
    'Store data': 'Store data',
    'Source / Target Mapping': 'Map network',
    'Link Analysis': 'Analyze',
  };
  const runActionLabel = streamActionLabels[modeState.dataframeAction] || 'Analyze';
  const isDataframeStep = modeState.step === 'dataframe';
  const isStreamStep = modeState.step === 'stream';
  const isStreamRunning = isStreamActive(modeState);
  const isStreamTerminating = modeState.streamStatus === STREAM_STATUSES.TERMINATING;
  // Once a run exists (live or terminated) the primary button leads to the
  // results; while live the left button becomes Terminate instead of Back.
  const isStreamDone = [STREAM_STATUSES.TERMINATED, STREAM_STATUSES.COMPLETED].includes(modeState.streamStatus);
  const hasStreamRun = isStreamStep && (isStreamRunning || isStreamTerminating || isStreamDone);
  const continueButtonLabel = isPreparing
    ? modeState.preparing
    : isStreamStep
      ? (hasStreamRun ? 'Show results' : runActionLabel)
      : isDataframeStep ? runActionLabel : 'Continue';
  const primaryActionDisabled = isPreparing || (isStreamStep
    ? !hasStreamRun && !canStream(modeState)
    : !canContinueWorkflow);
  const footerMessage = isStreamStep
    ? modeState.streamStatus === STREAM_STATUSES.STARTING
      ? 'The ingestion job is queued on the backend. The live log appears once it starts.'
      : modeState.streamStatus === STREAM_STATUSES.RUNNING
        ? 'Streaming in progress. Show the results or terminate the ingestion.'
        : isStreamTerminating
          ? 'Terminating the stream…'
          : modeState.streamStatus === STREAM_STATUSES.COMPLETED
            ? 'Ingestion completed. Show the results, download the log, or go back to run it again.'
            : modeState.streamStatus === STREAM_STATUSES.TERMINATED
              ? 'Streaming was terminated. Download the log, show the results, or go back to run it again.'
            : modeState.streamStatus === STREAM_STATUSES.FAILED
              ? 'The stream could not start. Check the details in the log and try again.'
              : 'Ready to start. Run the analysis to begin streaming.'
    : workflowFooterMessage;

  const describeStreamInput = () => {
    if (activeMode === SOURCE_MODES.REALTIME) {
      return `Realtime ${modeState.sourceAddressType || 'broker'} ${modeState.brokerAddress || ''}${modeState.topic ? ' / ' + modeState.topic : ''}`.trim();
    }
    if (modeState.selectedConnectionType === 'storage') {
      const files = (modeState.selectedStorageFiles || []).map((file) => file.name);
      return 'Batch storage: ' + files.length + (files.length === 1 ? ' file' : ' files') + (files.length ? ' (' + files.join(', ') + ')' : '');
    }
    if (modeState.selectedConnectionType === 'search') return 'Batch search results: ' + (modeState.selectedSearchFiles || []).length + ' selected';
    if (modeState.selectedConnectionType === 'broker') return `Batch broker ${modeState.brokerAddress || ''}${modeState.topic ? ' / ' + modeState.topic : ''}`.trim();
    const files = modeState.selectedFiles || [];
    return 'Batch upload: ' + files.length + (files.length === 1 ? ' file' : ' files') + (files.length ? ' (' + files.join(', ') + ')' : '');
  };

  const describeStreamAction = () => {
    if (modeState.dataframeAction === 'Link Analysis') return 'Link Analysis with rule "' + modeState.rule + '"';
    if (modeState.dataframeAction === 'Source / Target Mapping') {
      return `Source / Target Mapping ${modeState.sourceColumn} -> ${modeState.targetColumn}${modeState.relationship ? ' [' + modeState.relationship + ']' : ''}`;
    }
    return modeState.dataframeAction || 'No action';
  };

  // Production stream flow: POST /live_batch_files {id:'stream'}; the reply
  // (or the queued ingestion job) names the log file, which is followed over
  // the socket (log_stream_plug / stream_logs). Terminate sends end_session.
  const streamJobRef = windowRef(windowItem.id, 'streamJob'); // { controller, terminateRequested }
  // The Tasks window record of this window's latest run (taskRegistry.js).
  const streamTaskRef = windowRef(windowItem.id, 'streamTaskId');
  const terminateStreamRef = windowRef(windowItem.id, 'terminateStream');

  // The live state follows the backend log: the first backend line means the
  // ingestion is actually running; its "Injection finished" line means done.
  useEffect(() => {
    if (modeState.step !== 'stream') return;
    const status = modeState.streamStatus;
    if (status !== STREAM_STATUSES.STARTING && status !== STREAM_STATUSES.RUNNING) return;
    const backendLines = streamLogLines.filter((line) => line.source === 'backend');
    if (!backendLines.length) return;
    if (backendLines.some((line) => /Injection finished for action/i.test(line.message))) {
      completeStream(modeKey);
      return;
    }
    markTaskRunning(streamTaskRef.current);
    if (status === STREAM_STATUSES.STARTING) patchModeState({ streamStatus: STREAM_STATUSES.RUNNING }, modeKey);
    // Handlers are recreated each render; only the log/status drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamLogLines, modeState.streamStatus, modeState.step, modeKey]);

  const failStream = (key, message) => {
    markStreamEnded(windowItem.id);
    unplugStreamLog(windowItem.id);
    appendStreamLog(windowItem.id, message, 'error');
    patchModeState({ streamStatus: STREAM_STATUSES.FAILED, streamLogFile: '', preparing: '' }, key);
    finishTask(streamTaskRef.current, TASK_STATUSES.FAILED, { message });
    notify({ title: 'Streaming could not start', message, level: 'error', source: windowItem.title });
  };

  // Ingestion finished (job resolved, or the backend logged its end line).
  const completeStream = (key) => {
    const state = sourceStateRef.current[key];
    if (state?.streamStatus === STREAM_STATUSES.COMPLETED || state?.streamStatus === STREAM_STATUSES.TERMINATED) return;
    markStreamEnded(windowItem.id);
    const completionMessages = {
      'Link Analysis': 'Analysis complete',
      'Source / Target Mapping': 'Mapping complete',
      'Store data': 'Data Store completed',
    };
    appendStreamLog(windowItem.id, completionMessages[state?.dataframeAction] || 'Ingestion completed.');
    patchModeState({ streamStatus: STREAM_STATUSES.COMPLETED, preparing: '' }, key);
    finishTask(streamTaskRef.current, TASK_STATUSES.COMPLETED);
  };

  const followStreamLog = (key, logFile, status) => {
    const sourceSessionId = normalizeWindowSessionId(windowItem);
    plugStreamLog(windowItem.id, { socket, sessionId: sourceSessionId, filename: logFile });
    setActiveStreamLogFile(windowItem.id, logFile);
    updateTask(streamTaskRef.current, { logFile });
    patchModeState({ streamStatus: status, streamLogFile: logFile, preparing: '' }, key);
  };

  const startStream = async () => {
    const key = modeKey;
    const state = sourceStateRef.current[key];
    // One stream per window: a second start would orphan the running job.
    if (!canStream(state) || isStreamActive(state)) return;
    if (!requirePermission(SOURCE_PERMISSIONS.ANALYSIS_RUN, 'run the analysis')) return;
    const sourceSessionId = normalizeWindowSessionId(windowItem);
    if (!sourceSessionId) {
      setValidationMessage('Source session is not ready yet.');
      return;
    }
    const isRealtime = key === 'realtime';
    // Realtime streams need Neo4j connected and its credentials saved to
    // this session (production realtime start guard).
    if (isRealtime && (state.toolStatus !== TOOL_STATUSES.CONNECTED || state.realtimeConfigSavedFor !== sourceSessionId)) {
      const message = state.toolStatus !== TOOL_STATUSES.CONNECTED
        ? `Connect Neo4j successfully for session ${sourceSessionId} before starting realtime.`
        : state.realtimeConfigMessage || `Save Neo4j credentials for session ${sourceSessionId} before starting realtime (reconnect the tool).`;
      setValidationMessage(message);
      notify({ title: 'Realtime stream blocked', message, level: 'warning', source: windowItem.title });
      return;
    }

    const action = DATAFRAME_ACTION_BACKEND_VALUES[state.dataframeAction] || state.dataframeAction;
    const needsSourceTarget = action === 'Source / Target Relationship';
    // An empty field means the configured default (shown as its placeholder).
    const relationship = sanitizeRelationshipName(state.relationship || sourceDefaults.dataframe.relationship || 'HAS_RELATIONSHIP') || 'HAS_RELATIONSHIP';
    if (needsSourceTarget && !/^[A-Z][A-Z0-9_]*$/.test(relationship)) {
      setValidationMessage('The relationship must start with a letter and use letters, digits or underscores.');
      return;
    }
    const tool = sanitizeIdentifier(state.dataframeInfo?.tool || sourceDefaults.tool.name || 'neo4j', { maxLength: 80 });
    const payload = buildStreamPayload({
      sourceSessionId,
      mode: isRealtime ? 'realtime' : 'batch',
      tool,
      action,
      rule: sanitizeText(state.rule || '', { maxLength: 160 }).trim(),
      source: needsSourceTarget ? sanitizeText(state.sourceColumn, { maxLength: 120 }).trim() : '',
      target: needsSourceTarget ? sanitizeText(state.targetColumn, { maxLength: 120 }).trim() : '',
      relationship,
    });

    setValidationMessage('');
    unplugStreamLog(windowItem.id);
    // The previous run's task keeps its log once this window's log moves on.
    freezeWindowTaskLogs(windowItem.id, peekStreamLogLines(windowItem.id));
    clearStreamLog(windowItem.id);
    appendStreamLog(windowItem.id, `Session ${sourceSessionId}: ${runActionLabel} requested.`);
    appendStreamLog(windowItem.id, 'Input: ' + describeStreamInput());
    appendStreamLog(windowItem.id, 'Action: ' + describeStreamAction());
    patchModeState({ step: 'stream', streamStatus: STREAM_STATUSES.STARTING, streamLogFile: '', preparing: 'Starting stream…' }, key);
    // From here on the backend may be ingesting: leaving the window any other
    // way than complete/fail/terminate sends end_session (activeStreams.js).
    markStreamActive(windowItem.id, { sourceSessionId });
    const taskId = createTask({
      origin: TASK_ORIGINS.SOURCE,
      title: state.dataframeAction || 'Analysis',
      action: state.dataframeAction || '',
      input: describeStreamInput(),
      mode: isRealtime ? 'realtime' : 'batch',
      windowId: windowItem.id,
      windowTitle: windowItem.title,
      sourceSessionId,
      rule: payload.rule || '',
      sourceColumn: payload.source || '',
      targetColumn: payload.target || '',
      relationship: needsSourceTarget ? relationship : '',
      // The dataframe this run streams (shown in the Tasks window).
      dataframe: state.dataframeInfo ? {
        totalRows: state.dataframeInfo.totalRows,
        totalColumns: state.dataframeInfo.totalColumns,
        columns: [...(state.dataframeInfo.columns || [])],
        name: state.dataframeInfo.storage || state.dataframeInfo.source || '',
        tool: state.dataframeInfo.tool || tool,
      } : null,
    });
    streamTaskRef.current = taskId;
    // Stopped from the Tasks window: the same path as this window's Terminate.
    setTaskHandlers(taskId, { terminate: () => terminateStreamRef.current?.() });
    // Completion must not depend on this body being mounted (docked tabs).
    watchStreamTask(windowItem.id, taskId);

    const request = trackRequest(windowItem.id);
    let started;
    try {
      started = await startStreamRequest(apiFetch, payload, { signal: request.signal });
    } catch (error) {
      if (error?.name === 'AbortError' || request.signal.aborted) {
        // The backend may already have accepted the start: close it.
        appendStreamLog(windowItem.id, 'Start request cancelled. Closing the stream session on the backend.', 'warn');
        patchModeState({ streamStatus: STREAM_STATUSES.IDLE, preparing: '' }, key);
        finishTask(taskId, TASK_STATUSES.TERMINATED, { message: 'Start request cancelled.' });
        endAbandonedStream(apiFetch, windowItem.id, { reason: 'start_cancelled' });
        return;
      }
      failStream(key, 'The streaming request failed. Please try again.');
      return;
    } finally {
      request.release();
    }
    if (request.signal.aborted) {
      finishTask(taskId, TASK_STATUSES.TERMINATED, { message: 'Start request cancelled.' });
      endAbandonedStream(apiFetch, windowItem.id, { reason: 'start_cancelled' });
      return;
    }
    // Terminated (from Tasks, or by closing the window) while the start
    // request was in flight: the backend may have just accepted it, so close
    // that stream again instead of following it.
    if (!isTaskActive(getTask(taskId))) {
      if (started.accepted) {
        endStreamRequest(apiFetch, { sourceSessionId: normalizeWindowSessionId(windowItem), logFile: started.logFile || '' })
          .catch(() => null);
      }
      return;
    }
    if (!started.accepted) {
      failStream(key, started.message);
      return;
    }

    appendStreamLog(windowItem.id, started.queued ? 'Ingestion job queued on the backend.' : 'Stream accepted by the backend.');
    // Stays "starting" until the first backend log line arrives (see the
    // effect below); the live indicator then follows the actual ingestion.
    if (started.logFile) followStreamLog(key, started.logFile, STREAM_STATUSES.STARTING);
    else patchModeState({ preparing: '', streamStatus: STREAM_STATUSES.STARTING }, key);
    if (!started.queued || !started.pollPath) return;

    // Long-running ingestion job: follow it outside the busy overlay.
    const controller = new AbortController();
    const job = { controller, terminateRequested: false };
    streamJobRef.current = job;
    // Closing the window stops following the job (the backend cleans up).
    onSourceRuntimeDispose(windowItem.id, () => controller.abort());
    setActiveJob(windowItem.id, 'stream', started.jobId);
    try {
      const result = await waitForStreamJob(apiFetch, started.pollPath, { signal: controller.signal });
      if (job.terminateRequested || controller.signal.aborted) return;
      // The queued job resolves when the ingestion has finished.
      const logFile = resolveStreamLogFile(result) || started.logFile;
      setActiveStreamLogFile(windowItem.id, logFile);
      if (logFile) updateTask(taskId, { logFile });
      if (logFile && !sourceStateRef.current[key]?.streamLogFile) plugStreamLog(windowItem.id, { socket, sessionId: normalizeWindowSessionId(windowItem), filename: logFile });
      completeStream(key);
    } catch (error) {
      if (job.terminateRequested || controller.signal.aborted || error?.name === 'AbortError') return;
      log.error('Stream job failed', { status: error?.status, jobStatus: error?.jobStatus });
      failStream(key, sanitizeBackendUserMessage(error?.message, 'The stream job failed before it started.'));
    } finally {
      if (streamJobRef.current === job) streamJobRef.current = null;
      setActiveJob(windowItem.id, 'stream', null);
    }
  };

  const terminateStream = async () => {
    const key = modeKey;
    const state = sourceStateRef.current[key];
    if (!isStreamActive(state)) return;
    if (!requirePermission(SOURCE_PERMISSIONS.ANALYSIS_RUN, 'terminate the analysis')) return;
    const sourceSessionId = normalizeWindowSessionId(windowItem);
    const logFile = state.streamLogFile || getStreamLogFile(windowItem.id);
    if (streamJobRef.current) {
      streamJobRef.current.terminateRequested = true;
      streamJobRef.current.controller.abort();
    }
    markStreamEnded(windowItem.id); // this request is the closing request
    unplugStreamLog(windowItem.id);
    // Production (A:16448): Graph windows linked to this session unlink and
    // its relationships clear; what they show is kept.
    markGraphSessionTerminated(sourceSessionId);
    patchModeState({ streamStatus: STREAM_STATUSES.TERMINATING }, key);
    appendStreamLog(windowItem.id, 'Terminating the stream…');
    const result = await endStreamRequest(apiFetch, { sourceSessionId, logFile });
    patchModeState({ streamStatus: STREAM_STATUSES.TERMINATED, streamLogFile: '' }, key);
    finishTask(streamTaskRef.current, TASK_STATUSES.TERMINATED, { message: result.ok ? '' : result.message });
    if (result.ok) {
      appendStreamLog(windowItem.id, 'Streaming terminated by user.');
      notify({ title: 'Stream terminated', message: 'The stream was stopped on the backend.', level: 'info', source: windowItem.title });
    } else {
      appendStreamLog(windowItem.id, result.message, 'warn');
      notify({ title: 'Stream state', message: result.message, level: 'warning', source: windowItem.title });
    }
  };

  terminateStreamRef.current = terminateStream;

  // Results live in the Tasks window: it shows this run's record and opens
  // its Graph (graph link) or Chart from there.
  const showStreamResults = () => {
    if (streamTaskRef.current) requestTaskFocus(streamTaskRef.current);
    workspace.openWindow(WORKSPACE_WINDOW_TYPES.TASKS, { title: 'Tasks' });
  };

  const handlePrimaryAction = () => {
    if (isStreamStep) {
      if (hasStreamRun) showStreamResults();
      else startStream();
      return;
    }
    if (isDataframeStep) {
      startStream();
      return;
    }
    continueWorkflow();
  };

  const goBackInWorkflow = () => {
    setValidationMessage('');
    if (!previousStep) {
      changeInputSelection();
      return;
    }
    patchModeState({ step: previousStep.id });
  };

  const continueWorkflow = () => {
    if (!canContinueWorkflow) return;
    if (!requirePermission(SOURCE_PERMISSIONS.BATCH_QUERY, 'prepare the dataframe')) return;
    if (runsDataframePipeline) {
      prepareDataframe();
      return;
    }
    setValidationMessage('');
    patchModeState({ step: nextStep.id });
  };

  const validateSourcePayload = (state = modeState, defaults = sourceDefaults) => {
    if (!normalizeWindowSessionId(windowItem)) return 'Source session is not ready yet.';
    if (state.sourceAddressType === 'storage') {
      if (state.storageUseDefault !== false && !resolveStorageAddress(state, defaults)) {
        return 'No default storage address is configured. Untick "Use Default" and enter one.';
      }
      if (state.storageUseDefault === false && state.selectedConnectionType === 'storage') {
        const port = String(state.storagePort || '').trim();
        if (port && !(Number(port) >= 1 && Number(port) <= 65535)) return 'The RPC/Web port must be a number between 1 and 65535.';
        if (port && /:\d+$/.test(String(state.storageAddress || '').trim())) return 'Enter the port either in the address or in the port field, not both.';
      }
      return validateConnectionValue(resolveStorageAddress(state, defaults), 'Storage address');
    }
    return compactValidationErrors(
      validateConnectionValue(state.brokerAddress, 'Broker/API address'),
      state.sourceAddressType === 'broker' ? validateKafkaTopic(state.topic, 'Kafka topic') : ''
    );
  };

  const validateToolPayload = () => {
    if (!normalizeWindowSessionId(windowItem)) return 'Source session is not ready yet.';
    if (!isSourceReady(modeState)) return 'Connect the source first.';
    return compactValidationErrors(
      validateConnectionValue(modeState.toolUrl, 'Tool URL'),
      modeState.toolUsername ? '' : 'Tool username is required.',
      getSecret(windowItem.id, modeKey) || (isMaskedSecret(modeState.toolPassword) && modeState.toolPasswordRef) ? '' : 'Tool password is required.'
    );
  };

  // With "Use Default" on, storage always targets the configured address and
  // the typed address/port are discarded (shown struck through); the backend
  // reads port and path from the session configuration. A custom target sends
  // "host:port" (the connect contract has no separate port field).
  const resolveStorageAddress = (state = modeState, defaults = sourceDefaults) => {
    if (state.storageUseDefault !== false) return sanitizeConnectionValue(defaults.storage.address || state.storageAddress);
    const address = sanitizeConnectionValue(state.storageAddress);
    // Only the Storage page has a port field (Elastic search shares the state).
    const port = state.selectedConnectionType === 'storage' ? String(state.storagePort || '').trim() : '';
    return address && port && !/:\d+$/.test(address) ? `${address}:${port}` : address;
  };

  // Same body the production app sends to /connect_to_source and
  // /disconnect_source (sourceConnectionSchema).
  const buildSourcePayload = (state = modeState, defaults = sourceDefaults, mode = activeMode) => {
    const isStorage = state.sourceAddressType === 'storage';
    const brokerAddress = sanitizeConnectionValue(state.brokerAddress);
    const storageAddress = resolveStorageAddress(state, defaults);
    const address = isStorage ? storageAddress : brokerAddress;

    return {
      addressType: state.sourceAddressType,
      address,
      broker: isStorage ? '' : brokerAddress,
      hdfs: storageAddress,
      storage: storageAddress,
      topic: state.sourceAddressType === 'broker' ? sanitizeKafkaTopic(state.topic) : null,
      mode: mode === SOURCE_MODES.REALTIME ? 'realtime' : 'batch',
      session_id: normalizeWindowSessionId(windowItem),
    };
  };

  const buildToolDisconnectPayload = () => {
    const sourceSessionId = normalizeWindowSessionId(windowItem);
    return { tool_name: sourceDefaults.tool.name || 'neo4j', source_id: sourceSessionId, session_id: sourceSessionId };
  };

  // Storage / Elastic pages keep their connection form collapsed; problems
  // are reported in the page message (shown below the results) with a hint
  // to open the form, never by expanding it on the analyst's behalf.
  const isStorageInput = activeMode === SOURCE_MODES.BATCH && ['storage', 'search'].includes(modeState.selectedConnectionType);
  const OPEN_FORM_HINT = ' Open the connection form (chevron in the header) to review it.';

  const handleSourceAction = async ({ auto = false } = {}) => {
    setValidationMessage('');
    const isDisconnecting = modeState.sourceStatus === SOURCE_STATUSES.CONNECTED;
    // Production gates the analyst's connect / disconnect, not auto_connect.
    if (!auto && !requirePermission(
      isDisconnecting ? SOURCE_PERMISSIONS.SOURCE_DISCONNECT : SOURCE_PERMISSIONS.SOURCE_CONNECT,
      isDisconnecting ? 'disconnect the source' : 'connect the source',
    )) return;
    const validationError = isDisconnecting ? '' : validateSourcePayload();
    if (validationError) {
      setValidationMessage(validationError + (auto && isStorageInput ? OPEN_FORM_HINT : ''));
      return;
    }
    if (auto) log.info('Auto-connecting storage with the configured default');

    const pendingStatus = isDisconnecting ? SOURCE_STATUSES.DISCONNECTING : SOURCE_STATUSES.CONNECTING;
    patchModeState({ sourceStatus: pendingStatus, sourceMessage: displaySourceMessage(pendingStatus) });
    const tracked = trackRequest(windowItem.id);
    const { signal } = tracked;

    try {
      if (isDisconnecting && modeState.toolStatus === TOOL_STATUSES.CONNECTED) {
        patchModeState({ toolStatus: TOOL_STATUSES.DISCONNECTING, toolMessage: displayToolMessage(TOOL_STATUSES.DISCONNECTING) });
        await disconnectTool(apiFetch, buildToolDisconnectPayload(), { signal });
        if (signal.aborted) return;
      }

      const request = isDisconnecting ? disconnectSource : connectSource;
      const result = await request(apiFetch, buildSourcePayload(), { signal });
      // Cancelled from the load screen: cancelBusyAction already reset state.
      if (signal.aborted) return;
      const nextStatus = !result.ok
        ? SOURCE_STATUSES.FAILED
        : isDisconnecting
          ? SOURCE_STATUSES.DISCONNECTED
          : sourceStatusFromMessage(result.message || 'Connection established!');
      patchModeState({
        sourceStatus: nextStatus,
        sourceMessage: result.ok ? displaySourceMessage(nextStatus) : result.message,
        connectedKind: result.ok && !isDisconnecting ? connectionKindOf(modeState) : '',
        ...(result.ok ? { ...STALE_DATAFRAME_PATCH, ...STORAGE_SEARCH_RESET_PATCH } : {}),
        ...(isDisconnecting ? { toolStatus: TOOL_STATUSES.IDLE, toolMessage: displayToolMessage(TOOL_STATUSES.IDLE), step: activeMode === SOURCE_MODES.BATCH ? 'upload' : 'connect' } : {}),
      });
      if (!result.ok && auto) {
        setValidationMessage(isStorageInput
          ? `Automatic connection to the default storage failed${result.message ? ': ' + result.message : '.'}${OPEN_FORM_HINT}`
          : `Automatic connection failed${result.message ? ': ' + result.message : '.'} Review the values and press Connect.`);
      }
      notify({
        title: !result.ok ? (isDisconnecting ? 'Source disconnect failed' : 'Source connection failed') : isDisconnecting ? 'Source disconnected' : 'Source connected',
        message: !result.ok ? result.message : isDisconnecting ? 'The source connection was closed.' : 'The source connection is ready.',
        level: nextStatus === SOURCE_STATUSES.FAILED ? 'error' : 'success',
        source: windowItem.title,
      });
    } catch (error) {
      if (signal.aborted) return;
      log.error('Source connection action failed', { status: error?.status });
      patchModeState({ sourceStatus: SOURCE_STATUSES.FAILED, sourceMessage: displaySourceMessage(SOURCE_STATUSES.FAILED) });
      if (auto && isStorageInput) setValidationMessage(`Automatic connection to the default storage failed.${OPEN_FORM_HINT}`);
      notify({
        title: 'Source connection failed',
        message: 'The source connection could not be completed. Please review the values and try again.',
        level: 'error',
        source: windowItem.title,
      });
    } finally {
      tracked.release();
    }
  };

  // Connects the tool for one mode using the latest state (also used by the
  // upload pipeline's automatic connect). Returns { ok, message }.
  // Pass `signal` when part of a larger tracked action; otherwise it tracks
  // its own request so the load screen can cancel it.
  const runToolConnect = async (key = modeKey, { quiet = false, signal: outerSignal } = {}) => {
    const state = sourceStateRef.current[key];
    const built = buildToolConnectPayload({
      sourceSessionId: normalizeWindowSessionId(windowItem),
      toolName: sourceDefaults.tool.name || 'neo4j',
      url: sanitizeConnectionValue(state.toolUrl),
      username: sanitizeIdentifier(state.toolUsername),
      // A typed password wins; otherwise the saved-secret marker + ref.
      password: getSecret(windowItem.id, key) || (isMaskedSecret(state.toolPassword) ? state.toolPassword : ''),
      passwordRef: getSecret(windowItem.id, key) ? '' : state.toolPasswordRef,
      database: sanitizeIdentifier(state.toolDatabase),
    });
    if (!built.ok) {
      patchModeState({ toolStatus: TOOL_STATUSES.FAILED, toolMessage: built.message }, key);
      return { ok: false, message: built.message };
    }

    patchModeState({ toolStatus: TOOL_STATUSES.CONNECTING, toolMessage: displayToolMessage(TOOL_STATUSES.CONNECTING) }, key);
    // A saved-secret reference survives the round trip; a typed password is
    // dropped from window state once used.
    const keptPassword = { toolPasswordTyped: false, ...(state.toolPasswordRef ? { toolPassword: '***' } : { toolPassword: '' }) };
    const tracked = outerSignal ? null : trackRequest(windowItem.id);
    const signal = outerSignal || tracked.signal;
    let result;
    try {
      result = await connectTool(apiFetch, built.payload, { signal });
    } finally {
      tracked?.release();
    }
    if (signal.aborted) return { ok: false, cancelled: true, message: 'Cancelled.' };
    const nextStatus = result.ok ? toolStatusFromMessage(result.message) : TOOL_STATUSES.FAILED;
    patchModeState({
      toolStatus: nextStatus,
      toolMessage: result.ok ? displayToolMessage(nextStatus) : result.message,
      ...(result.ok ? keptPassword : {}),
    }, key);
    // Realtime: save the credentials to this source session (production
    // persistRealtimeToolConfigurationForWindow) while the typed password is
    // still available; the realtime start guard checks the result.
    if (result.ok && key === 'realtime' && nextStatus === TOOL_STATUSES.CONNECTED) {
      const sourceSessionId = normalizeWindowSessionId(windowItem);
      const persisted = await persistRealtimeToolConfiguration(apiFetch, {
        sourceSessionId,
        sessionConfiguration: configuration,
        tool: {
          url: sanitizeConnectionValue(state.toolUrl),
          username: sanitizeIdentifier(state.toolUsername),
          database: sanitizeIdentifier(state.toolDatabase),
          password: getSecret(windowItem.id, key),
        },
      });
      patchModeState(persisted.ok
        ? { realtimeConfigSavedFor: sourceSessionId, realtimeConfigMessage: '', ...(persisted.passwordRef ? { toolPasswordRef: persisted.passwordRef, toolPassword: '***' } : {}) }
        : { realtimeConfigSavedFor: '', realtimeConfigMessage: persisted.message }, key);
      if (!persisted.ok) notify({ title: 'Neo4j credentials not saved', message: persisted.message, level: 'warning', source: windowItem.title });
    }
    // A typed password is dropped once used successfully.
    if (result.ok) setSecret(windowItem.id, key, '');
    if (!quiet || !result.ok) {
      notify({
        title: result.ok ? 'Tool connected' : 'Tool connection failed',
        message: result.ok ? 'The tool is ready for this source window.' : result.message,
        level: result.ok ? 'success' : 'error',
        source: windowItem.title,
      });
    }
    return { ok: result.ok && nextStatus === TOOL_STATUSES.CONNECTED, message: result.message };
  };

  const handleToolAction = async () => {
    setToolValidationMessage('');
    const isDisconnecting = modeState.toolStatus === TOOL_STATUSES.CONNECTED;
    if (!requirePermission(
      isDisconnecting ? SOURCE_PERMISSIONS.SOURCE_DISCONNECT : SOURCE_PERMISSIONS.SOURCE_CONNECT,
      isDisconnecting ? 'disconnect the tool' : 'connect the tool',
      { setMessage: setToolValidationMessage },
    )) return;
    const validationError = isDisconnecting ? '' : validateToolPayload();
    if (validationError) {
      setToolValidationMessage(validationError);
      return;
    }

    if (!isDisconnecting) {
      // Failures are reported by runToolConnect (status text + notification).
      await runToolConnect(modeKey);
      return;
    }

    patchModeState({ toolStatus: TOOL_STATUSES.DISCONNECTING, toolMessage: displayToolMessage(TOOL_STATUSES.DISCONNECTING) });
    const tracked = trackRequest(windowItem.id);
    let result;
    try {
      result = await disconnectTool(apiFetch, buildToolDisconnectPayload(), { signal: tracked.signal });
    } finally {
      tracked.release();
    }
    if (tracked.signal.aborted) return;
    patchModeState({
      toolStatus: result.ok ? TOOL_STATUSES.DISCONNECTED : TOOL_STATUSES.FAILED,
      toolMessage: result.ok ? displayToolMessage(TOOL_STATUSES.DISCONNECTED) : result.message,
      ...(result.ok ? { step: activeMode === SOURCE_MODES.BATCH ? 'upload' : 'connect' } : {}),
    });
    notify({
      title: result.ok ? 'Tool disconnected' : 'Tool disconnect failed',
      message: result.ok ? 'The tool connection was closed.' : result.message,
      level: result.ok ? 'success' : 'error',
      source: windowItem.title,
    });
  };

  // Continue on the input step: (upload files ->) (connect tool ->) create_DF,
  // then move to the dataframe step. Mirrors the production page I -> III path.
  const prepareDataframe = async () => {
    const key = modeKey;
    const flow = getDataframeFlow(activeMode, modeState);
    const sourceSessionId = normalizeWindowSessionId(windowItem);
    const read = () => sourceStateRef.current[key];
    const patch = (values) => patchModeState(values, key);
    const failDataframe = (message) => {
      patch({ dataframeStatus: DATAFRAME_STATUSES.FAILED, dataframeMessage: message, preparing: '' });
      notify({ title: 'Dataframe not created', message, level: 'error', source: windowItem.title });
    };

    if (!sourceSessionId) {
      setValidationMessage('Source session is not ready yet.');
      return;
    }
    setValidationMessage('');
    setToolValidationMessage('');
    const request = trackRequest(windowItem.id);
    // Upload and storage flows connect the tool on the analyst's behalf.
    const ensureToolConnected = async () => {
      if (read().toolStatus === TOOL_STATUSES.CONNECTED) return true;
      patch({ preparing: 'Connecting tool…' });
      const tool = await runToolConnect(key, { quiet: true, signal: request.signal });
      if (request.signal.aborted) return false;
      if (!tool.ok) {
        patch({ preparing: '' });
        return false;
      }
      return true;
    };

    try {
      let payload;
      if (flow === 'files') {
        const names = read().selectedFiles || [];
        const uploaded = read().uploadedFiles || [];
        const alreadyUploaded = uploaded.length === names.length && names.every((name, index) => uploaded[index] === name);

        if (!alreadyUploaded) {
          const files = getStagedFiles(windowItem.id);
          if (files.length === 0 || files.length !== names.length) {
            setValidationMessage('The staged files are no longer available. Select them again.');
            return;
          }
          if (!requirePermission(SOURCE_PERMISSIONS.BATCH_UPLOAD, 'upload files')) return;
          patch({ uploadStatus: UPLOAD_STATUSES.UPLOADING, preparing: 'Uploading files…' });
          const upload = await uploadBatchFiles(apiFetch, { sourceSessionId, files, signal: request.signal });
          if (request.signal.aborted) return;
          if (!upload.ok) {
            patch({ uploadStatus: UPLOAD_STATUSES.FAILED, sourceMessage: upload.message, preparing: '' });
            notify({ title: 'Upload failed', message: upload.message, level: 'error', source: windowItem.title });
            return;
          }
          patch({
            uploadStatus: UPLOAD_STATUSES.UPLOADED,
            uploadedFiles: names,
            sourceStatus: SOURCE_STATUSES.UPLOADED,
            sourceMessage: 'Dataset uploaded.',
          });
        }

        if (!(await ensureToolConnected())) return;
        payload = buildArrayDataframePayload({ sourceSessionId, kind: 'files', items: names });
      } else if (flow === 'hdfs') {
        const items = (read().selectedStorageFiles || []).map(toStorageFileItem);
        if (items.length === 0) {
          setValidationMessage('Select at least one file from the storage search.');
          return;
        }
        if (!(await ensureToolConnected())) return;
        payload = buildArrayDataframePayload({ sourceSessionId, kind: 'hdfs', items });
      } else if (flow === 'hybrid') {
        const items = (read().selectedSearchFiles || []).map((item) => toHybridResultItem(item));
        if (items.length === 0) {
          setValidationMessage('Select at least one Elasticsearch result.');
          return;
        }
        if (!(await ensureToolConnected())) return;
        payload = buildArrayDataframePayload({ sourceSessionId, kind: 'hybrid', items });
      } else {
        const state = read();
        payload = buildAddressDataframePayload({
          sourceSessionId,
          addressType: state.sourceAddressType,
          address: sanitizeConnectionValue(state.brokerAddress),
          topic: state.sourceAddressType === 'broker' ? sanitizeKafkaTopic(state.topic) : null,
        });
      }

      patch({ dataframeStatus: DATAFRAME_STATUSES.CREATING, dataframeMessage: '', preparing: 'Creating dataframe…' });
      const result = await createDataframe(apiFetch, payload, {
        signal: request.signal,
        onQueued: ({ jobId }) => setActiveJob(windowItem.id, 'dataframe', jobId),
      });
      if (request.signal.aborted) return;
      if (!result.ok) {
        failDataframe(formatDataframeFailureMessage(result.data, 'The dataframe could not be created from this source. Please check it and try again.'));
        return;
      }

      const info = { ...result.info };
      if (key === 'realtime' && read().sourceAddressType === 'broker') info.totalRows = 'Live';
      const state = read();
      // Same option lists the Dataframe step offers.
      const ruleOptions = info.rules.length
        ? info.rules
        : (sourceDefaults.dataframe.rules.length ? sourceDefaults.dataframe.rules : sourceDefaults.dataframe.builtinRules);
      const columnOptions = info.columns.length ? info.columns : sourceDefaults.dataframe.fetchColumns;
      const columnHas = (column) => Boolean(column) && columnOptions.includes(column);
      patch({
        dataframeStatus: DATAFRAME_STATUSES.READY,
        dataframeInfo: info,
        dataframeMessage: '',
        preparing: '',
        step: 'dataframe',
        // Keep earlier picks this dataframe still offers; otherwise preselect
        // the configured defaults that exist in it (or clear the pick).
        ...(!ruleOptions.includes(state.rule) ? { rule: ruleOptions[0] || '' } : {}),
        ...(!columnHas(state.sourceColumn) ? { sourceColumn: columnHas(sourceDefaults.dataframe.sourceColumn) ? sourceDefaults.dataframe.sourceColumn : '' } : {}),
        ...(!columnHas(state.targetColumn) ? { targetColumn: columnHas(sourceDefaults.dataframe.targetColumn) ? sourceDefaults.dataframe.targetColumn : '' } : {}),
        ...(!state.relationship && sourceDefaults.dataframe.relationship ? { relationship: sourceDefaults.dataframe.relationship } : {}),
      });
      notify({
        title: 'Dataframe created',
        message: `${info.totalRows} rows · ${info.totalColumns} columns ready for analysis.`,
        level: 'success',
        source: windowItem.title,
      });
    } catch (error) {
      if (error?.name === 'AbortError' || request.signal.aborted) return;
      log.error('Dataframe preparation failed', { status: error?.status, jobStatus: error?.jobStatus });
      if (read().uploadStatus === UPLOAD_STATUSES.UPLOADING) {
        patch({ uploadStatus: UPLOAD_STATUSES.FAILED, preparing: '' });
      }
      failDataframe(formatDataframeFailureMessage(error, 'The dataframe could not be created right now. Please try again in a moment.'));
    } finally {
      request.release();
      setActiveJob(windowItem.id, 'dataframe', null);
    }
  };

  // One paged-search runner for both searches (same /live_batch_files
  // request). `kind` picks the state fields and request details:
  //   storage: raw HDFS file search (production's Search page, Files radio)
  //   elastic: hybrid Elastic + Hive search with strict_mood / search_column
  // A new search replaces the list; `more` pages on with the same context.
  // The context object identifies the search: any reset (new search,
  // disconnect, domain change) replaces it, so late replies are dropped.
  const SEARCH_KINDS = {
    storage: {
      fields: { status: 'storageSearchStatus', results: 'storageSearchResults', hasMore: 'storageSearchHasMore', message: 'storageSearchMessage', last: 'storageSearchLast' },
      preparing: 'Searching storage…',
      emptyKeyword: 'Type a keyword to search the storage files.',
      failure: 'The storage search failed. Please try again.',
      readInput: (state) => ({
        keyword: sanitizeText(state.storageSearchQuery || '', { maxLength: 500 }).trim(),
        date: String(state.storageSearchDate || '').trim(),
      }),
      request: () => ({ hybrid: false }),
      mapItem: (item) => toStorageFileItem(item),
      emptyMessage: ({ keyword, date }) => `No files matched "${keyword}"${date ? ' on ' + date : ''}`,
      onEmpty: (response) => {
        // Where the backend looked (storage paths, raw errors) is internal:
        // only administrators see it, as a notification.
        const { basePath, errors } = response.diagnostics;
        const errorText = errors ? (Array.isArray(errors) ? errors.join('\n') : String(errors)) : '';
        if (can('users:manage') && (basePath || errorText)) {
          notify({
            title: 'No storage files found',
            message: [basePath && `Searched in ${basePath}`, errorText].filter(Boolean).join('\n'),
            level: errorText ? 'warning' : 'info',
            source: windowItem.title,
          });
        }
      },
    },
    elastic: {
      fields: { status: 'elasticSearchStatus', results: 'elasticSearchResults', hasMore: 'elasticSearchHasMore', message: 'elasticSearchMessage', last: 'elasticSearchLast' },
      preparing: 'Searching Elasticsearch…',
      emptyKeyword: 'Type a keyword to search.',
      failure: 'The Elasticsearch search failed. Please try again.',
      readInput: (state) => {
        const strict = state.searchMode === 'strict';
        const columnList = strict ? sourceDefaults.search.strictColumns : sourceDefaults.search.fuzzyColumns;
        return {
          keyword: sanitizeText(state.searchQuery || '', { maxLength: 500 }).trim(),
          dateFrom: String(state.elasticSearchDateFrom || '').trim(),
          dateTo: String(state.elasticSearchDateTo || '').trim(),
          strict,
          column: columnList.includes(state.elasticColumn) ? state.elasticColumn : '',
        };
      },
      validate: ({ strict, column, dateFrom, dateTo }) => {
        if (strict && !column) return 'Strict Elasticsearch search requires selecting a search column.';
        if (dateFrom && dateTo && dateFrom > dateTo) return 'The start date must be on or before the end date.';
        return '';
      },
      request: ({ strict, column, dateFrom, dateTo }) => ({ hybrid: true, strictMode: strict, searchColumn: column, dateFrom, dateTo }),
      mapItem: (item, { strict, column }) => toHybridResultItem(item, { strict, column }),
      emptyMessage: ({ keyword, dateFrom, dateTo, column }) => {
        const range = dateFrom && dateTo
          ? (dateFrom === dateTo ? ` on ${dateFrom}` : ` between ${dateFrom} and ${dateTo}`)
          : dateFrom ? ` from ${dateFrom}` : dateTo ? ` up to ${dateTo}` : '';
        return `No results matched "${keyword}"${column ? ` in ${column.replace(/_/g, ' ')}` : ''}${range}`;
      },
    },
  };

  const runPagedSearch = async (kind, { more = false } = {}) => {
    const config = SEARCH_KINDS[kind];
    const { fields } = config;
    const key = modeKey;
    const read = () => sourceStateRef.current[key] || {};
    const patch = (values) => patchModeState(values, key);
    const state = read();
    const last = state[fields.last] || {};
    const input = more ? last : config.readInput(state);
    const sourceSessionId = normalizeWindowSessionId(windowItem);

    if (!input.keyword) {
      setValidationMessage(config.emptyKeyword);
      return;
    }
    const invalid = config.validate?.(input);
    if (invalid) {
      setValidationMessage(invalid);
      return;
    }
    if (!sourceSessionId) {
      setValidationMessage('Source session is not ready yet.');
      return;
    }
    setValidationMessage('');
    const context = more ? last : { ...input, nextOffset: 0 };
    const offset = more ? (Number.isFinite(last.nextOffset) ? last.nextOffset : (state[fields.results] || []).length) : 0;
    patch(more
      ? { [fields.status]: 'loading_more' }
      : {
        [fields.status]: 'loading',
        [fields.results]: [],
        [fields.hasMore]: false,
        [fields.message]: '',
        [fields.last]: context,
        preparing: config.preparing,
      });

    const request = trackRequest(windowItem.id);
    try {
      const response = await searchSourceFiles(apiFetch, {
        sourceSessionId,
        keyword: context.keyword,
        date: context.date,
        offset,
        ...config.request(context),
        signal: request.signal,
        onQueued: ({ jobId }) => setActiveJob(windowItem.id, 'search', jobId),
      });
      if (request.signal.aborted || read()[fields.last] !== context) return;
      const items = response.results.map((item) => config.mapItem(item, context)).filter((item) => item.name);
      const nextOffset = response.nextOffset ?? offset + response.results.length;
      const results = more ? [...(read()[fields.results] || []), ...items] : items;
      let message = '';
      if (results.length === 0) {
        message = config.emptyMessage(context);
        config.onEmpty?.(response);
      } else if (response.message === 'Result out of bound!') {
        message = response.message;
      }
      patch({
        [fields.status]: 'done',
        [fields.last]: { ...context, nextOffset },
        [fields.results]: results,
        [fields.hasMore]: response.hasMore && response.results.length > 0,
        [fields.message]: message,
        ...(more ? {} : { preparing: '' }),
      });
    } catch (error) {
      if (error?.name === 'AbortError' || request.signal.aborted || read()[fields.last] !== context) return;
      log.error(`${kind} search failed`, { status: error?.status, jobStatus: error?.jobStatus });
      const message = sanitizeBackendUserMessage(error?.data?.message || error?.message, config.failure);
      patch({
        [fields.status]: more ? 'done' : 'error',
        [fields.message]: message,
        ...(more ? {} : { preparing: '' }),
      });
      notify({ title: 'Search failed', message, level: 'error', source: windowItem.title });
    } finally {
      request.release();
      setActiveJob(windowItem.id, 'search', null);
    }
  };

  const runStorageSearch = (options) => runPagedSearch('storage', options);
  const runElasticSearch = (options) => runPagedSearch('elastic', options);

  // The session domain changed (Configuration window, or another Source
  // window) while this mode was connected: the old connection points at the
  // previous domain's endpoints, so disconnect and reconnect with the new
  // domain's defaults. Fields the analyst typed by hand are kept.
  const reconnectAfterDomainChange = async (key, previousDefaults, nextDefaults) => {
    const before = sourceStateRef.current[key];
    const mode = key === 'realtime' ? SOURCE_MODES.REALTIME : SOURCE_MODES.BATCH;
    const label = formatDomainLabel(nextDefaults.domain);
    const refreshed = domainDefaultsPatch(before, previousDefaults, nextDefaults);
    const after = { ...before, ...refreshed };
    const what = before.sourceAddressType === 'storage' ? 'storage' : 'source';

    // A stream reads from the connection being replaced: close it first.
    const streamWasActive = isStreamActive(before);
    if (streamWasActive) {
      const streamJob = windowRef(windowItem.id, 'streamJob').current;
      if (streamJob) {
        streamJob.terminateRequested = true;
        streamJob.controller.abort();
      }
      appendStreamLog(windowItem.id, `Domain changed to ${label}: ending the running stream.`, 'warn');
      finishTask(streamTaskRef.current, TASK_STATUSES.TERMINATED, { message: `Domain changed to ${label}.` });
      endAbandonedStream(apiFetch, windowItem.id, { reason: 'domain_changed' }).then((ended) => {
        appendStreamLog(windowItem.id, ended?.ok ? 'Stream ended on the backend.' : (ended?.message || 'The stream end could not be confirmed.'), ended?.ok ? 'info' : 'warn');
      });
    }

    const tracked = trackRequest(windowItem.id);
    const { signal } = tracked;
    patchModeState({
      ...(streamWasActive ? { streamStatus: STREAM_STATUSES.TERMINATED, streamLogFile: '' } : {}),
      ...refreshed,
      ...STALE_DATAFRAME_PATCH,
      ...STORAGE_SEARCH_RESET_PATCH,
      preparing: `Domain changed to ${label}: reconnecting the ${what}…`,
      domainReconnect: true,
      sourceStatus: SOURCE_STATUSES.DISCONNECTING,
      sourceMessage: displaySourceMessage(SOURCE_STATUSES.DISCONNECTING),
    }, key);
    try {
      if (before.toolStatus === TOOL_STATUSES.CONNECTED) {
        await disconnectTool(apiFetch, buildToolDisconnectPayload(), { signal }).catch(() => null);
        if (signal.aborted) return;
      }
      await disconnectSource(apiFetch, buildSourcePayload(before, previousDefaults, mode), { signal }).catch(() => null);
      if (signal.aborted) return;
      patchModeState({
        sourceStatus: SOURCE_STATUSES.CONNECTING,
        sourceMessage: displaySourceMessage(SOURCE_STATUSES.CONNECTING),
        toolStatus: TOOL_STATUSES.IDLE,
        toolMessage: displayToolMessage(TOOL_STATUSES.IDLE),
      }, key);
      const validationError = validateSourcePayload(after, nextDefaults);
      const result = validationError
        ? { ok: false, message: validationError }
        : await connectSource(apiFetch, buildSourcePayload(after, nextDefaults, mode), { signal });
      if (signal.aborted) return;
      if (!result.ok) {
        patchModeState({ preparing: '', domainReconnect: false, sourceStatus: SOURCE_STATUSES.DISCONNECTED, sourceMessage: result.message || displaySourceMessage(SOURCE_STATUSES.DISCONNECTED) }, key);
        notify({
          title: 'Disconnected after domain change',
          message: `The session moved to the ${label} domain and the ${what} could not reconnect (${result.message || 'connection failed'}). Review the values and connect again.`,
          level: 'warning',
          source: windowItem.title,
        });
        return;
      }
      const nextStatus = sourceStatusFromMessage(result.message || 'Connection established!');
      patchModeState({ preparing: '', domainReconnect: false, sourceStatus: nextStatus, sourceMessage: displaySourceMessage(nextStatus) }, key);
      notify({
        title: `Reconnected to ${label}`,
        message: `The session domain changed, so the ${what} connection was re-established with the ${label} endpoints${nextDefaults.storage.path && what === 'storage' ? ` (${nextDefaults.storage.path})` : ''}. Previous search results and dataframes were cleared.`,
        level: 'info',
        source: windowItem.title,
      });
    } catch (error) {
      if (signal.aborted) return;
      log.error('Reconnect after domain change failed', { status: error?.status });
      patchModeState({ preparing: '', domainReconnect: false, sourceStatus: SOURCE_STATUSES.DISCONNECTED, sourceMessage: displaySourceMessage(SOURCE_STATUSES.DISCONNECTED) }, key);
      notify({
        title: 'Disconnected after domain change',
        message: `The session moved to the ${label} domain and the ${what} could not reconnect. Connect again to continue.`,
        level: 'warning',
        source: windowItem.title,
      });
    } finally {
      tracked.release();
    }
  };

  // Storage / Elastic pages connect on their own with the configured default
  // storage (the form starts collapsed). Once per input visit: a manual
  // disconnect, a failure or a custom target is never retried automatically.
  const autoConnectRef = windowRef(windowItem.id, 'storageAutoConnect', { kind: '' });
  const handleSourceActionRef = useRef(handleSourceAction);
  handleSourceActionRef.current = handleSourceAction;
  const storageAutoConnectKind = isStorageInput && modeState.step === 'upload' ? modeState.selectedConnectionType : '';
  useEffect(() => {
    if (!storageAutoConnectKind) {
      autoConnectRef.current.kind = '';
      return;
    }
    if (autoConnectRef.current.kind === storageAutoConnectKind) return;
    const state = sourceStateRef.current.batch || {};
    const ready = hasConfiguration && Boolean(normalizeWindowSessionId(windowItem));
    if (!ready || isSourceBusy(state) || state.preparing) return;
    autoConnectRef.current.kind = storageAutoConnectKind;
    // Every visit starts with the form collapsed (also for windows opened
    // before this default existed).
    if (!state.storageToolbarCollapsed) patchModeState({ storageToolbarCollapsed: true }, 'batch');
    if (state.sourceStatus === SOURCE_STATUSES.CONNECTED) return;
    if (state.storageUseDefault === false) {
      setValidationMessage(`A custom storage target is set, so it was not connected automatically.${OPEN_FORM_HINT}`);
      return;
    }
    if (!sourceDefaults.storage.address) {
      setValidationMessage(`No default storage address is configured, so the storage was not connected automatically.${OPEN_FORM_HINT}`);
      return;
    }
    handleSourceActionRef.current({ auto: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageAutoConnectKind, hasConfiguration, sourceDefaults.storage.address, windowItem.sourceSessionId]);

  // Message broker page (batch broker input and realtime connect): connect
  // the configured Kafka broker / REST API, then the tool, on the analyst's
  // behalf. Once per visit, like the storage pages; a manual disconnect or a
  // failure is never retried automatically.
  const brokerAutoConnectRef = windowRef(windowItem.id, 'brokerAutoConnect', { visit: '' });
  const brokerAutoConnectVisit = (activeMode === SOURCE_MODES.BATCH && modeState.step === 'upload' && modeState.selectedConnectionType === 'broker')
    || (activeMode === SOURCE_MODES.REALTIME && modeState.step === 'connect')
    ? modeKey
    : '';
  const runToolConnectRef = useRef(runToolConnect);
  runToolConnectRef.current = runToolConnect;
  useEffect(() => {
    if (!brokerAutoConnectVisit) {
      brokerAutoConnectRef.current.visit = '';
      return;
    }
    if (brokerAutoConnectRef.current.visit === brokerAutoConnectVisit) return;
    const key = brokerAutoConnectVisit;
    const initial = sourceStateRef.current[key] || {};
    const ready = hasConfiguration && Boolean(normalizeWindowSessionId(windowItem));
    if (!ready || isSourceBusy(initial) || isToolBusy(initial) || initial.preparing) return;
    brokerAutoConnectRef.current.visit = key;

    const isKafka = initial.sourceAddressType !== 'api';
    const label = isKafka ? 'Kafka broker' : 'REST API';
    const toolLabel = (sourceDefaults.tool.name || 'neo4j') === 'neo4j' ? 'Neo4j' : sourceDefaults.tool.name;

    // Tool: only with complete saved credentials (a typed password or the
    // configuration's saved-secret reference).
    const autoConnectTool = async () => {
      const state = sourceStateRef.current[key] || {};
      if (!isSourceReady(state) || state.toolStatus === TOOL_STATUSES.CONNECTED || isToolBusy(state)) return;
      const hasPassword = Boolean(getSecret(windowItem.id, key)) || (isMaskedSecret(state.toolPassword) && Boolean(state.toolPasswordRef));
      if (!state.toolUrl || !state.toolUsername || !hasPassword) {
        setToolValidationMessage(`${toolLabel} was not connected automatically: complete its ${!state.toolUrl ? 'URL' : !state.toolUsername ? 'username' : 'password'}, then connect the tool.`);
        return;
      }
      await runToolConnectRef.current(key);
    };

    (async () => {
      if (initial.sourceStatus !== SOURCE_STATUSES.CONNECTED) {
        if (!initial.brokerAddress || (isKafka && !initial.topic)) {
          setValidationMessage(`No default ${label}${isKafka ? ' address and topic are' : ' address is'} configured, so it was not connected automatically. Enter ${isKafka ? 'them' : 'it'} and press Connect.`);
          return;
        }
        await handleSourceActionRef.current({ auto: true });
      }
      await autoConnectTool();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brokerAutoConnectVisit, hasConfiguration, windowItem.sourceSessionId]);

  const reconnectAfterDomainChangeRef = useRef(reconnectAfterDomainChange);
  reconnectAfterDomainChangeRef.current = reconnectAfterDomainChange;
  // The defaults this window last applied. Kept per window (not per mount):
  // in docked mode the body is unmounted while another tab is active, and a
  // change made meanwhile must still be applied when it comes back.
  const lastDefaultsRef = windowRef(windowItem.id, 'lastAppliedDefaults', sourceDefaults);
  useEffect(() => {
    const previous = lastDefaultsRef.current;
    lastDefaultsRef.current = sourceDefaults;
    if (!previous || previous === sourceDefaults || !sourceDefaults.domain) return;
    const hasTypedPassword = (key) => Boolean(getSecret(windowItem.id, key)) || Boolean(sourceStateRef.current[key]?.toolPasswordTyped);
    if (previous.domain && previous.domain !== sourceDefaults.domain) {
      ['batch', 'realtime'].forEach((key) => {
        const state = sourceStateRef.current[key];
        if (state?.sourceStatus === SOURCE_STATUSES.CONNECTED) {
          reconnectAfterDomainChangeRef.current(key, previous, sourceDefaults);
          const ref = configDefaultsPatch(state, previous, sourceDefaults, { hasTypedPassword: hasTypedPassword(key) });
          if ('toolPasswordRef' in ref) patchModeState({ toolPasswordRef: ref.toolPasswordRef, toolPassword: ref.toolPassword }, key);
        } else if (state) {
          // Not connected: refresh default-held fields, and drop a dataframe
          // built under the old domain's rules and columns.
          const hasDataframe = state.dataframeStatus && state.dataframeStatus !== DATAFRAME_STATUSES.NONE;
          const refreshed = configDefaultsPatch(state, previous, sourceDefaults, { hasTypedPassword: hasTypedPassword(key) });
          if (hasDataframe || Object.keys(refreshed).length) {
            patchModeState({ ...refreshed, ...(hasDataframe ? { ...STALE_DATAFRAME_PATCH, ...STORAGE_SEARCH_RESET_PATCH } : {}) }, key);
          }
        }
      });
      return;
    }
    // Same domain, configuration saved / reset / imported: move fields still
    // holding the old defaults (tool URL, user, database, saved password
    // ref, broker, topic) to the new ones. A live connection is kept; the
    // new values apply on the next connect.
    ['batch', 'realtime'].forEach((key) => {
      const state = sourceStateRef.current[key];
      if (!state) return;
      const refreshed = configDefaultsPatch(state, previous, sourceDefaults, { hasTypedPassword: hasTypedPassword(key), onlyChanged: true });
      if (Object.keys(refreshed).length) patchModeState(refreshed, key);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceDefaults]);

  // Session-wide domain switch (same request as production's Configuration
  // window). The backend re-projects storage path, tables and defaults from the
  // domain; every window reads the new configuration from the session.
  const switchDomain = async (domain) => {
    const nextDomain = String(domain || '').trim();
    if (!nextDomain || nextDomain === sourceDefaults.domain) return;
    if (!mainSessionId) {
      setValidationMessage('Session is still initializing. Please try again in a moment.');
      return;
    }
    setValidationMessage('');
    patchModeState({ preparing: `Switching domain to ${formatDomainLabel(nextDomain)}…` });
    const request = trackRequest(windowItem.id);
    try {
      const switched = await switchSessionDomain(apiFetch, mainSessionId, nextDomain, { signal: request.signal });
      if (request.signal.aborted) {
        if (switched?.configuration && Object.keys(switched.configuration).length) setConfiguration(switched.configuration);
        return;
      }
      if (!isSuccessResponse(switched.data)) {
        const message = sanitizeBackendUserMessage(switched.data?.message || switched.data?.error, `Could not switch to ${formatDomainLabel(nextDomain)}.`);
        patchModeState({ preparing: '' });
        notify({ title: 'Domain switch failed', message, level: 'warning', source: windowItem.title });
        return;
      }
      let nextConfiguration = switched.configuration;
      if (!nextConfiguration || typeof nextConfiguration !== 'object' || !nextConfiguration.domain_connections) {
        nextConfiguration = (await loadSessionConfiguration(apiFetch, mainSessionId)).configuration;
        if (request.signal.aborted) return;
      }
      setConfiguration({
        ...(nextConfiguration || {}),
        active_domain: nextConfiguration?.active_domain || nextDomain,
        domain: nextConfiguration?.domain || nextDomain,
      });
      patchModeState({ preparing: '', ...STORAGE_SEARCH_RESET_PATCH, ...STALE_DATAFRAME_PATCH });
      notify({
        title: 'Domain switched',
        message: `The session now uses the ${formatDomainLabel(nextDomain)} domain. Storage path and defaults were updated.`,
        level: 'success',
        source: windowItem.title,
      });
    } catch (error) {
      if (error?.name === 'AbortError' || request.signal.aborted) {
        // The backend may already have switched (there is no job cancel yet,
        // backend request B-7): reload so the UI matches the session again.
        loadSessionConfiguration(apiFetch, mainSessionId)
          .then(({ configuration: reloaded }) => {
            if (reloaded && typeof reloaded === 'object' && Object.keys(reloaded).length) setConfiguration(reloaded);
          })
          .catch(() => {});
        return;
      }
      log.error('Domain switch failed', { status: error?.status });
      patchModeState({ preparing: '' });
      notify({
        title: 'Domain switch failed',
        message: sanitizeBackendUserMessage(error?.data?.message || error?.message, 'Failed to switch the domain. Please try again.'),
        level: 'error',
        source: windowItem.title,
      });
    } finally {
      request.release();
    }
  };

  // "Esc or click here to cancel" on the load screen: abort whatever is in
  // flight for this window and roll the busy statuses back. Queued backend jobs
  // have no cancel endpoint, so their result is simply ignored.
  const cancelBusyAction = () => {
    abortSourceRequests(windowItem.id);
    // Requests of both modes share the window's controllers, so roll back
    // every mode that was busy (e.g. a domain reconnect running for both).
    ['batch', 'realtime'].forEach((key) => {
      const state = sourceStateRef.current[key] || {};
      const sourcePatch = state.domainReconnect
        ? { domainReconnect: false, connectedKind: '', sourceStatus: SOURCE_STATUSES.DISCONNECTED, sourceMessage: 'Disconnected: the domain changed. Connect again to use the new domain.' }
        : state.sourceStatus === SOURCE_STATUSES.CONNECTING
          ? { sourceStatus: SOURCE_STATUSES.IDLE, sourceMessage: displaySourceMessage(SOURCE_STATUSES.IDLE) }
          : state.sourceStatus === SOURCE_STATUSES.DISCONNECTING
            ? { sourceStatus: SOURCE_STATUSES.CONNECTED, sourceMessage: displaySourceMessage(SOURCE_STATUSES.CONNECTED) }
            : {};
      const toolPatch = state.toolStatus === TOOL_STATUSES.CONNECTING
        ? { toolStatus: TOOL_STATUSES.IDLE, toolMessage: displayToolMessage(TOOL_STATUSES.IDLE) }
        : state.toolStatus === TOOL_STATUSES.DISCONNECTING
          ? { toolStatus: TOOL_STATUSES.CONNECTED, toolMessage: displayToolMessage(TOOL_STATUSES.CONNECTED) }
          : {};
      patchModeState({
        preparing: '',
        ...sourcePatch,
        ...toolPatch,
        ...(state.uploadStatus === UPLOAD_STATUSES.UPLOADING ? { uploadStatus: UPLOAD_STATUSES.IDLE } : {}),
        ...(state.storageSearchStatus === 'loading' ? { storageSearchStatus: 'idle', storageSearchLast: null } : {}),
        ...(state.storageSearchStatus === 'loading_more' ? { storageSearchStatus: 'done' } : {}),
        ...(state.elasticSearchStatus === 'loading' ? { elasticSearchStatus: 'idle', elasticSearchLast: null } : {}),
        ...(state.elasticSearchStatus === 'loading_more' ? { elasticSearchStatus: 'done' } : {}),
        ...(state.dataframeStatus === DATAFRAME_STATUSES.CREATING ? { dataframeStatus: DATAFRAME_STATUSES.NONE, dataframeMessage: '' } : {}),
      }, key);
    });
    notify({ title: 'Cancelled', message: 'The running action was stopped.', level: 'info', source: windowItem.title });
  };

  if (isChoosing) {
    return (
      <div className="workspace_window_body source_window_body">
        <ModeChooser
          sourceSessionId={normalizeWindowSessionId(windowItem)}
          initialMode={sourceState.lastMode}
          initialConnectionType={sourceState.lastMode === SOURCE_MODES.REALTIME ? 'broker' : sourceState.batch.selectedConnectionType}
          onSelectMode={selectMode}
          onOpenConfiguration={openConfigurationWindow}
          onCopySession={copySessionId}
        />
      </div>
    );
  }

  return (
    <div className="workspace_window_body source_window_body">
      <div className="source_window_workspace">
        <header className="source_window_choose_header">
          <SourceWindowHeading
            icon={modeState.step === 'upload' ? ({ storage: 'hadoop', search: 'elastic', broker: 'kafka' })[modeState.selectedConnectionType] || 'upload' : activeMode === SOURCE_MODES.REALTIME ? 'realtime' : 'source'}
            title="Analysis Source"
            subtitle={(activeWorkflowStep?.label ? activeWorkflowStep.label + ' · ' : '') + (activeWorkflowStep?.value || 'Continue configuring this source window.')}
            tags={[
              { label: modeLabels[activeMode] || 'Source' },
              { label: 'Step ' + (Math.max(activeStepIndex, 0) + 1) + ' of ' + workflowSteps.length, tone: 'muted' },
            ]}
          >
            <SessionBadge sessionId={normalizeWindowSessionId(windowItem)} onCopySession={copySessionId} />
          </SourceWindowHeading>
        </header>
        <div className="source_window_workflow_shell">
          <WorkflowTimeline
            activeStep={modeState.step}
            steps={workflowSteps}
            accessibleSteps={accessibleSteps}
            onStepChange={(step) => patchModeState({ step })}
          />
          <WorkflowBody
          mode={activeMode}
          modeState={modeState}
          windowId={windowItem.id}
          validationMessage={validationMessage}
          toolValidationMessage={toolValidationMessage}
          toolOptions={sourceDefaults.tool.options}
          defaults={sourceDefaults}
          handlers={{ onSourceAction: handleSourceAction, onToolAction: handleToolAction, onStorageSearch: runStorageSearch, onElasticSearch: runElasticSearch, onSwitchDomain: switchDomain }}
          sessionId={normalizeWindowSessionId(windowItem)}
          streamLogLines={streamLogLines}
          onPatchModeState={patchModeState}
          onOpenConfiguration={openConfigurationWindow}
          onOpenLibrary={openLibrariesWindow}
        />
        </div>
        {busyLabel ? <WindowLoadScreen overlay label={busyLabel} onCancel={cancelBusyAction} /> : null}
        <footer className="source_window_choose_footer">
          <span>
            <svg className="window_footer_info_icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            {footerMessage}
          </span>
          <div>
            {continueBlockers.length > 0 && (
              <span className="source_window_continue_blockers" role="status" aria-live="polite">
                <span className="source_window_required_badge_dot" aria-hidden="true" />
                <span className="source_window_continue_blockers_label">To continue</span>
                {continueBlockers.map((blocker) => <b key={blocker}>{blocker}</b>)}
              </span>
            )}
            {isStreamStep && (isStreamRunning || isStreamTerminating) ? (
              <button type="button" className="source_window_terminate_btn" disabled={isStreamTerminating} onClick={terminateStream}>
                {isStreamTerminating ? 'Terminating…' : 'Terminate'}
              </button>
            ) : (
              <button type="button" disabled={isPreparing} onClick={goBackInWorkflow}>Back</button>
            )}
            <span
              className={continueBlockedHint ? 'source_window_continue_wrap linkx_tooltip_anchor' : 'source_window_continue_wrap'}
              data-tooltip={continueBlockedHint || undefined}
            >
              <button
                type="button"
                className={hasStreamRun ? 'source_window_show_results_btn' : undefined}
                disabled={primaryActionDisabled}
                onClick={handlePrimaryAction}
              >
                {continueButtonLabel}
              </button>
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
