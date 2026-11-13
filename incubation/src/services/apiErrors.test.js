import { describe, expect, it } from 'vitest';

import { getConnectSourceErrorMessage, sanitizeBackendUserMessage } from './apiErrors.js';

describe('sanitizeBackendUserMessage', () => {
  it('passes ordinary messages through', () => {
    expect(sanitizeBackendUserMessage('Broker unreachable')).toBe('Broker unreachable');
  });

  it('never shows HTML pages, stack traces, internal codes or huge dumps', () => {
    expect(sanitizeBackendUserMessage('<html><body>502 Bad Gateway</body></html>', 'fallback')).toBe('fallback');
    expect(sanitizeBackendUserMessage('Traceback (most recent call last):\n  File "x.py", line 3', 'fallback')).toBe('fallback');
    expect(sanitizeBackendUserMessage('validation_error: session_id', 'fallback')).toBe('fallback');
    expect(sanitizeBackendUserMessage('x'.repeat(400), 'fallback')).toBe('fallback');
  });
});

describe('getConnectSourceErrorMessage', () => {
  it('sanitizes the backend detail', () => {
    expect(getConnectSourceErrorMessage({ data: { message: '<h1>Proxy error</h1>' } }, 'Connection failed!')).toBe('Connection failed!');
    expect(getConnectSourceErrorMessage({ data: { detail: 'Host not reachable' } })).toBe('Host not reachable');
  });
});
