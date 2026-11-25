// Queued-job helpers. The backend may answer long requests (search, create_DF,
// stream) with `{ results: { accepted: true, job_id | poll_url } }`; callers
// then poll `/jobs/:id` until a terminal status. Ported from the production
// app (pollJob / fetchMaybeQueued) with AbortSignal support kept intact.

export const JOB_POLL_DEFAULT_INTERVAL_MS = 1000;
export const JOB_POLL_DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const LONG_JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export const JOB_SUCCESS_STATUSES = new Set(['succeeded', 'success', 'finished', 'completed', 'done']);
export const JOB_PENDING_STATUSES = new Set(['queued', 'pending', 'running', 'started', 'processing', 'in_progress']);
export const JOB_CANCEL_STATUSES = new Set(['cancel_requested', 'cancellation_requested', 'cancelled', 'canceled']);
export const JOB_FAILURE_STATUSES = new Set(['failed', 'failure', 'error', ...JOB_CANCEL_STATUSES]);

// The abort listener is removed when the timer fires, so long polls don't
// pile up one listener per tick on the signal.
const delay = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(new DOMException('Job request was cancelled', 'AbortError'));
    return;
  }
  const onAbort = () => {
    clearTimeout(timer);
    reject(new DOMException('Job request was cancelled', 'AbortError'));
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});

export const getQueuedJobId = (data) => (
  data?.results?.job_id ??
  data?.results?.jobId ??
  data?.results?.job?.job_id ??
  data?.results?.job?.jobId ??
  data?.job_id ??
  data?.jobId ??
  data?.result?.job_id ??
  data?.result?.jobId ??
  null
);

export const getQueuedPollPath = (data) => {
  const pollUrl = data?.results?.poll_url ?? data?.results?.pollUrl ?? data?.poll_url ?? data?.pollUrl ?? null;
  if (pollUrl) return String(pollUrl);
  const jobId = getQueuedJobId(data);
  return jobId ? '/jobs/' + encodeURIComponent(jobId) : null;
};

export const isQueuedJobResponse = (data) => data?.results?.accepted === true && Boolean(getQueuedPollPath(data));

export const getJobStatus = (job) => String(
  job?.results?.status ??
  job?.status ??
  job?.result?.status ??
  job?.graph?.status ??
  ''
).trim().toLowerCase();

export const getJobResult = (job) => job?.results?.result ?? job?.result ?? job?.results ?? job;

export const getJobErrorMessage = (job, fallback = 'Job failed') => {
  const result = getJobResult(job);
  return result?.message ??
    result?.error ??
    job?.results?.error_message ??
    job?.results?.message ??
    job?.results?.error ??
    job?.message ??
    job?.error ??
    fallback;
};

export const pollJob = async (apiFetch, jobIdOrPath, {
  intervalMs = JOB_POLL_DEFAULT_INTERVAL_MS,
  timeoutMs,
  signal,
  timeoutMessage = 'Job timed out',
  cancelledMessage = 'Job request cancelled',
  label = 'job',
  onProgress,
} = {}) => {
  const effectiveTimeoutMs = timeoutMs || (label === 'ingestion' || label === 'analysis' ? LONG_JOB_TIMEOUT_MS : JOB_POLL_DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();
  const pollPath = String(jobIdOrPath || '').startsWith('/') ? String(jobIdOrPath) : '/jobs/' + encodeURIComponent(jobIdOrPath);
  let attempt = 0;

  while (Date.now() - startedAt < effectiveTimeoutMs) {
    if (signal?.aborted) throw new DOMException('Job request was cancelled', 'AbortError');

    const job = await apiFetch(pollPath, { method: 'GET', signal });
    attempt += 1;
    const status = getJobStatus(job);
    const result = getJobResult(job);
    onProgress?.({ status, attempt, job });

    if (JOB_SUCCESS_STATUSES.has(status)) return result;

    if (JOB_FAILURE_STATUSES.has(status)) {
      const rawMessage = getJobErrorMessage(job);
      const message = JOB_CANCEL_STATUSES.has(status) && (!rawMessage || String(rawMessage).toLowerCase() === 'success')
        ? cancelledMessage
        : rawMessage;
      const error = new Error(message);
      error.jobResponse = job;
      error.jobResult = result;
      error.jobStatus = status;
      error.pollPath = pollPath;
      throw error;
    }

    await delay(intervalMs, signal);
  }

  const timeoutError = new Error(timeoutMessage);
  timeoutError.pollPath = pollPath;
  throw timeoutError;
};

// Sends a request and, when the backend queues it, transparently polls the job.
export const fetchMaybeQueued = async (apiFetch, path, options = {}, pollOptions = {}) => {
  const response = await apiFetch(path, options);
  if (!isQueuedJobResponse(response)) return response;

  const pollPath = getQueuedPollPath(response);
  pollOptions.onQueued?.({ path, pollPath, jobId: getQueuedJobId(response), response });
  return pollJob(apiFetch, pollPath, { ...pollOptions, signal: pollOptions.signal ?? options.signal });
};

// Asks the Service to stop a search, dataframe or graph job (B-7). Nothing
// waits for it: the answer is ignored, and so is a refusal.
export const cancelJob = (apiFetch, jobIdOrPath) => {
  const id = decodeURIComponent(String(jobIdOrPath || '').replace(/^.*\/jobs\//, '').replace(/[?/].*$/, ''));
  if (!id) return Promise.resolve(null);
  return Promise.resolve(apiFetch(`/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {}, suppressForbiddenHandler: true })).catch(() => null);
};
