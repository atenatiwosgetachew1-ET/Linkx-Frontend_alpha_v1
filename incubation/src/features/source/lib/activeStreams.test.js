import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  endAbandonedStream,
  endAllAbandonedStreams,
  getActiveStream,
  markStreamActive,
  markStreamEnded,
  setActiveStreamLogFile,
} from './activeStreams.js';

const okFetch = () => vi.fn(async () => ({ message: 'success' }));

afterEach(() => {
  ['w1', 'w2'].forEach(markStreamEnded);
});

describe('activeStreams', () => {
  it('sends the production end_session request with the followed log file', async () => {
    const apiFetch = okFetch();
    markStreamActive('w1', { sourceSessionId: 's1' });
    setActiveStreamLogFile('w1', 'ingest_s1.log');
    const result = await endAbandonedStream(apiFetch, 'w1', { reason: 'user_closed_window' });
    expect(result.ok).toBe(true);
    expect(apiFetch).toHaveBeenCalledWith('/live_batch_files', {
      method: 'POST',
      body: { id: 'end_session', session_id: 's1', value: { window_id: 's1', session_id: 's1', log_file: 'ingest_s1.log' } },
    });
    expect(getActiveStream('w1')).toBeNull();
  });

  it('does nothing for a window without a running stream (and never twice)', async () => {
    const apiFetch = okFetch();
    expect(await endAbandonedStream(apiFetch, 'w1')).toBeNull();
    markStreamActive('w1', { sourceSessionId: 's1' });
    await Promise.all([endAbandonedStream(apiFetch, 'w1'), endAbandonedStream(apiFetch, 'w1')]);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('forgets streams that completed, failed or were terminated', async () => {
    const apiFetch = okFetch();
    markStreamActive('w1', { sourceSessionId: 's1' });
    markStreamEnded('w1');
    expect(await endAbandonedStream(apiFetch, 'w1')).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('ends every running stream with keepalive on sign-out / page close', async () => {
    const apiFetch = okFetch();
    markStreamActive('w1', { sourceSessionId: 's1' });
    markStreamActive('w2', { sourceSessionId: 's2', logFile: 'b.log' });
    await endAllAbandonedStreams(apiFetch, { reason: 'page_closed' });
    expect(apiFetch).toHaveBeenCalledTimes(2);
    apiFetch.mock.calls.forEach(([, options]) => expect(options.keepalive).toBe(true));
    expect(apiFetch.mock.calls.map(([, options]) => options.body.value.log_file)).toEqual([null, 'b.log']);
  });

  it('reports a backend refusal without throwing', async () => {
    const apiFetch = vi.fn(async () => ({ message: 'failed!', results: 'No streaming found' }));
    markStreamActive('w1', { sourceSessionId: 's1' });
    const result = await endAbandonedStream(apiFetch, 'w1');
    expect(result.ok).toBe(false);
  });
});
