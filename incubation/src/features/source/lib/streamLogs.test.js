import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  appendStreamLog,
  bindStreamLogSocket,
  disposeAllStreamLogs,
  disposeStreamLog,
  getStreamLogFile,
  getStreamLogLines,
  plugStreamLog,
  subscribeStreamLog,
  unplugStreamLog,
} from './streamLogs.js';

const fakeSocket = () => {
  const handlers = {};
  return {
    connected: true,
    emitted: [],
    on: (event, fn) => { handlers[event] = fn; },
    off: (event) => { delete handlers[event]; },
    emit(event, payload) { this.emitted.push([event, payload]); },
    receive: (event, payload) => handlers[event]?.(payload),
  };
};

describe('stream logs', () => {
  afterEach(() => {
    vi.useRealTimers();
    disposeStreamLog('w1');
  });

  it('plugs the log file over the socket and collects matching lines', () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    plugStreamLog('w1', { socket, sessionId: '1_42', filename: 'run.log' });
    expect(socket.emitted).toContainEqual(['log_stream_plug', { session_id: '1_42', filename: 'run.log' }]);
    expect(getStreamLogFile('w1')).toBe('run.log');

    const listener = vi.fn();
    subscribeStreamLog('w1', listener);
    socket.receive('stream_logs', { session_id: '1_42', data: 'line one' });
    socket.receive('stream_logs', { session_id: 'other', data: 'ignored' });
    vi.advanceTimersByTime(250); // batched flush
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getStreamLogLines('w1').map((line) => line.message)).toEqual(['line one']);
  });

  it('splits backend data into lines and drops blank trailing newlines', () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    plugStreamLog('w1', { socket, sessionId: '1_42', filename: 'run.log' });
    socket.receive('stream_logs', { session_id: '1_42', data: '[09:04:56] [Info] - Injection started\n' });
    socket.receive('stream_logs', { session_id: '1_42', data: 'a\r\n\nb\n' });
    vi.advanceTimersByTime(250);
    const lines = getStreamLogLines('w1');
    expect(lines.map((line) => line.message)).toEqual(['[09:04:56] [Info] - Injection started', 'a', 'b']);
    expect(lines.every((line) => line.source === 'backend')).toBe(true);
  });

  it('unplugs and stops collecting', () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    plugStreamLog('w1', { socket, sessionId: '1_42', filename: 'run.log' });
    unplugStreamLog('w1');
    expect(socket.emitted).toContainEqual(['log_stream_unplug', { session_id: '1_42', filename: 'run.log' }]);
    socket.receive('stream_logs', { session_id: '1_42', data: 'late' });
    appendStreamLog('w1', 'local note');
    vi.advanceTimersByTime(250);
    expect(getStreamLogLines('w1').map((line) => line.message)).toEqual(['local note']);
  });
});

describe('stream logs across sockets and sign-out', () => {
  afterEach(() => disposeAllStreamLogs());

  it('moves running streams to a re-created socket (token renewal)', () => {
    vi.useFakeTimers();
    const first = fakeSocket();
    plugStreamLog('w2', { socket: first, sessionId: '1_7', filename: 'a.log' });
    const second = fakeSocket();
    bindStreamLogSocket(second);
    expect(second.emitted).toContainEqual(['log_stream_plug', { session_id: '1_7', filename: 'a.log' }]);
    second.receive('stream_logs', { session_id: '1_7', data: 'after renewal' });
    vi.advanceTimersByTime(250);
    expect(getStreamLogLines('w2').map((line) => line.message)).toContain('after renewal');
    vi.useRealTimers();
  });

  it('forgets every window log on sign-out', () => {
    appendStreamLog('w3', 'secret run');
    appendStreamLog('w4', 'other run');
    disposeAllStreamLogs();
    expect(getStreamLogLines('w3')).toEqual([]);
    expect(getStreamLogLines('w4')).toEqual([]);
  });
});
