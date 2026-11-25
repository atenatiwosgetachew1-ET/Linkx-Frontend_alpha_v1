// The quick analysis panel's run (B-35; analyst decision 2026-11-24): the same
// pipeline as a Source window's Link Analysis, with limits the Service sets
// and enforces (`quick: true`; nothing here relaxes or sends them):
//   upload        one file, 5 MB, 20,000 rows
//   batch_kafka   the last hour of the configured topic, 20,000 rows
//   kafka, rest_api   the next 15 minutes of the configured live source,
//                     analysed as it arrives (B-39: to be confirmed)
// Rule and connections are the session configuration's. The run is a
// background task: it has its own source session, closed when it ends (the
// Service keeps a finished run's graph by its task, B-37).
//
// One at a time, outside React: it goes on whichever windows are open.

import { getServiceRefusalMessage } from '../../../services/apiErrors.js';
import { cancelJob } from '../../../services/jobs.js';
import {
  UPLOAD_LIMITS, buildAddressDataframePayload, buildArrayDataframePayload, buildStreamPayload, buildToolConnectPayload, closeSourceWindow, connectSource, connectTool,
  createDataframe, formatDataframeFailureMessage, startStreamRequest, uploadBatchFiles, waitForStreamJob,
} from '../../../services/sourceApi.js';
import { sanitizeConnectionValue, sanitizeIdentifier, sanitizeKafkaTopic, sanitizeText } from '../../../utils/inputSecurity.js';
import { openSourceSession } from '../../../workspace/lib/openSourceSession.js';
import { endAbandonedStream, markStreamActive, markStreamEnded, setActiveStreamLogFile } from '../../source/lib/activeStreams.js';
import { continueStreamInBackground } from '../../source/lib/backgroundStreams.js';
import { appendStreamLog, disposeStreamLog, plugStreamLog } from '../../source/lib/streamLogs.js';
import { TASK_ORIGINS, TASK_STATUSES, createTask, finishTask, getTask, isTaskActive, linkServerTask, updateTask } from '../../tasks/lib/taskRegistry.js';

export const QUICK_LIMITS = Object.freeze({ fileBytes: 5 * 1024 * 1024, rows: 20000, batchHours: 1, realtimeMinutes: 15 });
export const QUICK_INPUTS = Object.freeze({
  upload: { label: 'File', realtime: false },
  batch_kafka: { label: 'Kafka, last hour', realtime: false },
  kafka: { label: 'Kafka, live', realtime: true },
  rest_api: { label: 'REST API, live', realtime: true },
});

/* ── What it needs ──────────────────────────────────────────────────── */

// Why a file cannot be used ('' when it can).
export const quickFileProblem = (file) => {
  if (!file) return 'Choose a file.';
  const extension = String(file.name || '').toLowerCase().split('.').pop();
  if (!UPLOAD_LIMITS.allowedExtensions.includes(extension)) return `Only ${UPLOAD_LIMITS.allowedExtensions.map((item) => item.toUpperCase()).join(', ')} files.`;
  if (!file.size) return 'The file is empty.';
  if (file.size > QUICK_LIMITS.fileBytes) return 'The file is over 5 MB. Use a Source window for larger files.';
  return '';
};

// Why it cannot start with this input ('' when it can).
export const quickBlocker = ({ input, file = null, defaults }) => {
  if (!QUICK_INPUTS[input]) return 'Choose a file or a source.';
  const { broker = {}, tool = {}, dataframe = {} } = defaults || {};
  if (input === 'upload') {
    const problem = quickFileProblem(file);
    if (problem) return problem;
  }
  if (['kafka', 'batch_kafka'].includes(input) && !(broker.address && broker.topic)) return 'Set the Kafka broker and topic in Configuration first.';
  if (input === 'rest_api' && !broker.apiAddress) return 'Set the REST API address in Configuration first.';
  if (!tool.url || !tool.username) return 'Set the graph tool’s address and user in Configuration first.';
  if (!dataframe.activeRule) return 'Choose the active rule in Configuration first.';
  return '';
};

/* ── State ──────────────────────────────────────────────────────────── */

const IDLE = Object.freeze({ phase: 'idle', step: '', message: '', taskId: '', input: '' });
let state = IDLE; // phase: idle | preparing | started (see its task) | failed
let running = null; // { controller, jobId }
const listeners = new Set();
const set = (next) => {
  state = next;
  listeners.forEach((listener) => listener());
};
export const getQuickRun = () => state;
export const subscribeQuickRun = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
// Going: preparing, or its task is.
export const isQuickRunGoing = () => state.phase === 'preparing' || (state.phase === 'started' && isTaskActive(getTask(state.taskId)));
// Forget the last result (the panel's reset); a run that goes on is left.
export const clearQuickRun = () => { if (!isQuickRunGoing()) set(IDLE); };
// Signed out: nothing of it stays here.
export const resetQuickRun = () => {
  running?.controller.abort();
  running = null;
  set(IDLE);
};

/* ── Running ────────────────────────────────────────────────────────── */

class QuickError extends Error {}
const withQuick = (payload, extra = {}) => ({ ...payload, value: { ...payload.value, quick: true, ...extra } });

const sourcePayload = (input, defaults, sessionId) => {
  const addressType = input === 'rest_api' ? 'api' : 'broker';
  const address = sanitizeConnectionValue(addressType === 'api' ? defaults.broker.apiAddress : defaults.broker.address);
  return {
    addressType,
    address,
    broker: address,
    hdfs: '',
    storage: '',
    topic: addressType === 'broker' ? sanitizeKafkaTopic(defaults.broker.topic) : null,
    mode: QUICK_INPUTS[input].realtime ? 'realtime' : 'batch',
    session_id: sessionId,
  };
};

// Stops preparing: what is in flight is dropped, a queued job cancelled and
// the session closed (by the run itself).
export const cancelQuickPreparation = () => {
  if (state.phase === 'preparing') running?.controller.abort();
};

// getDefaults: the session configuration as it is now. A run uses what it was
// started with, so a domain or rule changed meanwhile stops it before it is sent.
// -> true when the run was accepted by the Service.
export const startQuickRun = async ({ apiFetch, socket, mainSessionId, nextWindowNumber = 1, defaults, getDefaults = () => defaults, input, file = null }) => {
  if (isQuickRunGoing()) return false;
  const blocker = quickBlocker({ input, file, defaults });
  if (blocker) {
    set({ ...IDLE, phase: 'failed', input, message: blocker });
    return false;
  }
  const controller = new AbortController();
  const { signal } = controller;
  const mine = { controller, jobId: '' };
  running = mine;
  const current = () => running === mine && !signal.aborted;
  const step = (text) => { if (current()) set({ ...IDLE, phase: 'preparing', step: text, input }); };
  const { realtime, label } = QUICK_INPUTS[input];
  let identity = null;
  const closeSession = (reason) => {
    if (identity) closeSourceWindow(apiFetch, { sessionId: identity.parentSessionId, windowId: identity.windowId, reason, keepalive: true }).catch(() => null);
  };
  // Every step stops here once cancelled.
  const check = () => {
    if (!current()) throw new DOMException('Cancelled', 'AbortError');
    const now = getDefaults();
    if (now?.domain !== defaults.domain || now?.dataframe?.activeRule !== defaults.dataframe.activeRule) {
      throw new QuickError('The domain or the active rule was changed while this was getting ready. Analyze again to use the new one.');
    }
  };
  let streamWindowId = ''; // the start was sent: the Service may run it
  try {
    step('Opening a session…');
    identity = await openSourceSession(apiFetch, mainSessionId, nextWindowNumber);
    check();
    const sessionId = identity.sourceSessionId;

    if (input === 'upload') {
      step('Uploading the file…');
      const upload = await uploadBatchFiles(apiFetch, { sourceSessionId: sessionId, files: [file], signal });
      check();
      if (!upload.ok) throw new QuickError(upload.message);
    } else {
      step('Connecting to the source…');
      const connected = await connectSource(apiFetch, sourcePayload(input, defaults, sessionId), { signal });
      check();
      if (!connected.ok) throw new QuickError(connected.message);
    }

    step('Connecting to the graph tool…');
    const tool = buildToolConnectPayload({
      sourceSessionId: sessionId,
      toolName: defaults.tool.name || 'neo4j',
      url: sanitizeConnectionValue(defaults.tool.url),
      username: sanitizeIdentifier(defaults.tool.username),
      password: defaults.tool.passwordRef ? '***' : '',
      passwordRef: defaults.tool.passwordRef,
      database: sanitizeIdentifier(defaults.tool.database),
    });
    const toolConnected = await connectTool(apiFetch, tool.payload, { signal });
    check();
    if (!toolConnected.ok) throw new QuickError(`${toolConnected.message} Connect it once in a Source window, or save its password in Configuration.`);

    // A live source has no dataframe of its own.
    let info = null;
    if (!realtime) {
      step(input === 'upload' ? 'Reading the file…' : 'Reading the last hour…');
      const payload = input === 'upload'
        ? buildArrayDataframePayload({ sourceSessionId: sessionId, kind: 'files', items: [file.name] })
        : buildAddressDataframePayload({ sourceSessionId: sessionId, addressType: 'broker', address: sanitizeConnectionValue(defaults.broker.address), topic: sanitizeKafkaTopic(defaults.broker.topic) });
      const made = await createDataframe(apiFetch, { ...payload, quick: true }, { signal, onQueued: ({ jobId }) => { mine.jobId = jobId || ''; } });
      mine.jobId = '';
      check();
      if (!made.ok) throw new QuickError(formatDataframeFailureMessage(made.data, 'The data could not be read.'));
      info = made.info;
      if (info.rules.length && !info.rules.includes(defaults.dataframe.activeRule)) {
        throw new QuickError(`The active rule “${defaults.dataframe.activeRule}” does not fit this data. Choose another in Configuration, or use a Source window.`);
      }
    }

    step('Starting the analysis…');
    const rule = sanitizeText(defaults.dataframe.activeRule, { maxLength: 160 }).trim();
    const windowId = `quick-${identity.windowId}`;
    streamWindowId = windowId;
    markStreamActive(windowId, { sourceSessionId: sessionId });
    const started = await startStreamRequest(apiFetch, withQuick(buildStreamPayload({
      sourceSessionId: sessionId,
      mode: realtime ? 'realtime' : 'batch',
      tool: sanitizeIdentifier(info?.tool || defaults.tool.name || 'neo4j', { maxLength: 80 }),
      action: 'Link Analysis',
      rule,
    }), realtime ? { listen_realtime: true } : {}), { signal });
    setActiveStreamLogFile(windowId, started.logFile);
    if (!current()) throw new DOMException('Cancelled', 'AbortError');
    if (!started.accepted) {
      streamWindowId = '';
      markStreamEnded(windowId);
      throw new QuickError(started.message);
    }

    const taskId = createTask({
      origin: TASK_ORIGINS.SOURCE,
      quick: true,
      title: 'Quick analysis',
      action: 'Link Analysis',
      input: input === 'upload' ? file.name : label,
      mode: realtime ? 'realtime' : 'batch',
      windowId,
      windowTitle: 'Quick analysis panel',
      sourceSessionId: sessionId,
      domain: defaults.domain || '',
      rule,
      dataframe: info ? { totalRows: info.totalRows, totalColumns: info.totalColumns, columns: [...info.columns], name: input === 'upload' ? file.name : label, tool: info.tool } : null,
    });
    appendStreamLog(windowId, `Session ${sessionId}: quick analysis (${label}), rule ${rule}.`);
    if (started.logFile) {
      plugStreamLog(windowId, { socket, sessionId, filename: started.logFile });
      updateTask(taskId, { logFile: started.logFile });
    }
    continueStreamInBackground({
      windowId,
      taskId,
      apiFetch,
      note: 'It runs in the background: windows can be opened and closed.',
      release: () => {
        disposeStreamLog(windowId);
        closeSession('quick_run_ended');
      },
    });
    if (started.taskId) linkServerTask(taskId, started.taskId);
    if (started.queued && started.pollPath) followJob(apiFetch, started.pollPath, taskId);
    running = null;
    set({ ...IDLE, phase: 'started', taskId, input });
    return true;
  } catch (error) {
    if (mine.jobId) cancelJob(apiFetch, mine.jobId);
    // Cancelled while it was being started: the Service may have accepted it.
    if (streamWindowId) await endAbandonedStream(apiFetch, streamWindowId, { reason: 'quick_start_cancelled' }).catch(() => null);
    closeSession('quick_run_not_started');
    if (running !== mine) return false; // signed out
    running = null;
    if (signal.aborted || error?.name === 'AbortError') set(IDLE);
    else set({ ...IDLE, phase: 'failed', input, message: error instanceof QuickError ? error.message : getServiceRefusalMessage(error) || formatDataframeFailureMessage(error, 'The quick analysis could not be started.') });
    return false;
  }
};

// The queued job's end ends the run, unless the Service's task said so first.
const followJob = async (apiFetch, pollPath, taskId) => {
  updateTask(taskId, { jobFollowed: true });
  const controller = new AbortController();
  const stop = setInterval(() => { if (!isTaskActive(getTask(taskId))) controller.abort(); }, 2000);
  try {
    await waitForStreamJob(apiFetch, pollPath, { signal: controller.signal });
    finishTask(taskId, TASK_STATUSES.COMPLETED);
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') return;
    // Contact was lost, not the run: the Service's task says how it ends.
    if (!error?.jobStatus && getTask(taskId)?.serverId) updateTask(taskId, { jobFollowed: false });
    else finishTask(taskId, TASK_STATUSES.FAILED, { message: getServiceRefusalMessage(error?.jobResponse || error) || 'The run failed on the Service.' });
  } finally {
    clearInterval(stop);
  }
};
