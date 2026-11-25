import { afterEach, expect, it, vi } from 'vitest';

import { cancelJob } from './jobs.js';
import { buildArrayDataframePayload, formatDataframeFailureMessage, waitForStreamJob } from './sourceApi.js';

afterEach(() => vi.useRealTimers());
const status = (code) => Object.assign(new Error('x'), { status: code });

it('a dropped network or a restarting Service is not the job’s failure', async () => {
  const answers = [new TypeError('Failed to fetch'), status(502), { results: { status: 'running' } }, status(429), { results: { status: 'succeeded', result: { done: true } } }];
  const apiFetch = vi.fn(async () => {
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  expect(await waitForStreamJob(apiFetch, '/jobs/1', { retryMs: 0 })).toEqual({ done: true });
});

it('the job’s own failure, and a job that is gone, end it', async () => {
  await expect(waitForStreamJob(async () => ({ results: { status: 'failed', error: 'bad' } }), '/jobs/1', { retryMs: 0 })).rejects.toMatchObject({ jobStatus: 'failed' });
  await expect(waitForStreamJob(async () => { throw status(404); }, '/jobs/1', { retryMs: 0 })).rejects.toMatchObject({ status: 404 });
});

it('gives up after 45 seconds without an answer, and stops when cancelled', async () => {
  vi.useFakeTimers();
  const gone = expect(waitForStreamJob(async () => { throw status(503); }, '/jobs/1')).rejects.toMatchObject({ status: 503 });
  await vi.advanceTimersByTimeAsync(40 * 1000);
  let ended = false;
  gone.then(() => { ended = true; });
  await vi.advanceTimersByTimeAsync(0);
  expect(ended).toBe(false);
  await vi.advanceTimersByTimeAsync(20 * 1000);
  await gone;
  const controller = new AbortController();
  const cancelled = expect(waitForStreamJob(async () => { throw status(503); }, '/jobs/1', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(1000);
  controller.abort();
  await cancelled;
});

it('dates go top-level on create_DF, and coded refusals are worded (B-5, B-19)', () => {
  expect(buildArrayDataframePayload({ sourceSessionId: '1_2', kind: 'hybrid', items: [], dateFrom: '2026-01-01' })).toMatchObject({ start_date: '2026-01-01', end_date: null });
  expect(buildArrayDataframePayload({ sourceSessionId: '1_2', kind: 'files', items: [] })).not.toHaveProperty('start_date');
  expect(formatDataframeFailureMessage({ status: 400, data: { code: 'source_not_connected', message: 'x' } }, 'f')).toMatch(/not connected/);
  expect(formatDataframeFailureMessage({ jobStatus: 'failed', jobResponse: { code: 'empty_selection' } }, 'f')).toMatch(/Nothing is selected/);
});

it('a locked screen is not a lost job, however long', async () => {
  vi.useFakeTimers();
  let locked = true;
  const apiFetch = vi.fn(async () => {
    if (locked) throw status(423);
    return { results: { status: 'succeeded', result: { done: true } } };
  });
  const job = waitForStreamJob(apiFetch, '/jobs/1');
  await vi.advanceTimersByTimeAsync(14 * 60 * 1000);
  locked = false;
  await vi.advanceTimersByTimeAsync(10 * 1000);
  expect(await job).toEqual({ done: true });
});

it('a job is cancelled by its id or poll path, and a refusal is ignored (B-7)', async () => {
  const apiFetch = vi.fn(async () => { throw status(409); });
  expect(await cancelJob(apiFetch, '/jobs/a%2Fb?include_chunks=1')).toBeNull();
  await cancelJob(apiFetch, 'j7');
  expect(apiFetch.mock.calls.map(([path, options]) => [path, options.method])).toEqual([['/jobs/a%2Fb/cancel', 'POST'], ['/jobs/j7/cancel', 'POST']]);
  await cancelJob(apiFetch, '');
  expect(apiFetch).toHaveBeenCalledTimes(2);
});
