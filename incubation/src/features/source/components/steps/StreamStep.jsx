import React, { useEffect, useRef } from 'react';

import { formatLogTimestamp, formatStreamLog, STREAM_STATUSES } from '../../lib/sourceModel.js';
import { taskLogHead } from '../../../tasks/lib/taskFormat.js';
import { getLatestTaskForWindow } from '../../../tasks/lib/taskRegistry.js';
import { StatusPill } from '../sourceUi.jsx';
import LogLines from '../../../../shared/logs/LogLines.jsx';

// keepRunning: the run's "Keep running while I'm away" option.
export function StreamStep({ state, sessionId, windowId = '', logLines = [], validationMessage, keepRunning = null }) {
  const isLive = state.streamStatus === STREAM_STATUSES.RUNNING;
  // Hot while the backend is ingesting (red dot), passive once it completed
  // (green dot); other states keep the neutral title.
  const isHot = isLive || state.streamStatus === STREAM_STATUSES.STARTING;
  const isPassive = state.streamStatus === STREAM_STATUSES.COMPLETED;
  const title = isHot ? 'Live streaming...' : isPassive ? 'Cold streaming' : 'Streaming';
  const logEntries = logLines;
  const logRef = useRef(null);
  // Keep the newest line in view while streaming, unless the user scrolled
  // up to read older lines.
  const followRef = useRef(true);
  useEffect(() => {
    if (logRef.current && followRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logEntries]);

  const downloadLog = () => {
    if (!logEntries.length) return;
    const stamp = formatLogTimestamp().replace(/[: ]/g, '-');
    const blob = new Blob([taskLogHead(getLatestTaskForWindow(windowId)) + formatStreamLog(logEntries) + '\n'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `linkx-stream-${sessionId || 'session'}-${stamp}.log`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="source_window_step_body source_window_step_body_stream">
      <section className="source_window_stream_card">
        <header className={'source_window_stream_header' + (isLive ? ' is-live' : '') + (isHot ? ' is-hot' : '') + (isPassive ? ' is-passive' : '')}>
          <span className="source_window_panel_title">
            <span className="source_window_stream_icon" aria-hidden="true">
              <span className="source_window_stream_dot" />
            </span>
            <h3>{title}</h3>
          </span>
          <span className="source_window_stream_header_actions">
            <StatusPill label="Stream" status={isLive ? 'streaming' : state.streamStatus} />
            <button
              type="button"
              className="source_window_stream_download linkx_tooltip_anchor"
              data-tooltip={logEntries.length ? 'Download streaming log' : 'No log to download yet'}
              aria-label="Download streaming log"
              disabled={!logEntries.length}
              onClick={downloadLog}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 4v11" />
                <polyline points="7 10 12 15 17 10" />
                <path d="M5 19h14" />
              </svg>
              <span>Log</span>
            </button>
          </span>
        </header>
        <div
          ref={logRef}
          role="log"
          tabIndex={0}
          aria-label="Stream log"
          aria-live={isLive ? 'polite' : 'off'}
          className="source_window_log source_window_stream_log"
          onScroll={(event) => {
            const box = event.currentTarget;
            followRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
          }}
        >
          <LogLines
            lines={logEntries}
            classPrefix="source_window_stream_log"
            emptyText="Session log will appear here once the analysis starts."
          />
        </div>
        {keepRunning}
        {validationMessage ? <p className="source_window_validation" role="alert">{validationMessage}</p> : null}
      </section>
    </div>
  );
}
