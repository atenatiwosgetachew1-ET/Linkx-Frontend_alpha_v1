import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { NotificationContext } from './notificationContext.js';

const NOTICE_LEVELS = new Set(['success', 'warning', 'error', 'info']);

// Time on screen follows importance: errors stay until dismissed (they
// usually need action), warnings linger, routine success/info notices are
// brief. A caller's explicit durationMs still wins.
const NOTICE_DURATIONS_MS = { error: 0, warning: 8000, success: 4000, info: 4000 };

const NOTICE_ICONS = {
  success: <polyline points="5 12.5 10 17 19 7" />,
  warning: <><path d="M12 8v5" /><path d="M12 16.5v.01" /></>,
  error: <><path d="M8 8l8 8" /><path d="M16 8l-8 8" /></>,
  info: <><path d="M12 11v5" /><path d="M12 7.5v.01" /></>,
};

const stringifyNoticeValue = (value) => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? '');
  }
};

const stripControlCharacters = (value) => Array.from(String(value ?? ''))
  .filter((character) => {
    const code = character.charCodeAt(0);
    return code > 31 && code !== 127;
  })
  .join('');

const sanitizeNoticeText = (value, { maxLength = 500 } = {}) => {
  let text = stripControlCharacters(value).trim();
  if (!text) return '';
  text = text.replace(/[<>]/g, '');
  text = text.replace(/\s+/g, ' ');
  text = text.replace(/^\s*(message(?:\s+alert)?|alert|warning|notice|message\s*box)\s*[:-]\s*/i, '');
  text = text.replace(/^\s*message\s*box\s*/i, '');
  return text.trim().slice(0, maxLength);
};

function NoticeStack({ items, onDismiss, onPause, onResume }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  if (typeof document === 'undefined' || !document.body) return null;

  return createPortal(
    <div className="linkx_notice_stack" role="region" aria-label="Notifications">
      {items.map((item) => (
        <article
          key={item.id}
          className={'linkx_notice linkx_notice_' + item.level + (item.durationMs > 0 ? ' is-timed' : ' is-sticky')}
          role={item.level === 'error' ? 'alert' : 'status'}
          style={item.durationMs > 0 ? { '--notice-duration': item.durationMs + 'ms' } : undefined}
          onMouseEnter={() => onPause(item.id)}
          onMouseLeave={() => onResume(item.id)}
          onFocus={() => onPause(item.id)}
          onBlur={() => onResume(item.id)}
        >
          <div className="linkx_notice_head">
            <span className="linkx_notice_icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">{NOTICE_ICONS[item.level]}</svg>
            </span>
            <span className="linkx_notice_title">{item.title}</span>
            <button
              className="linkx_notice_close linkx_tooltip_anchor"
              type="button"
              data-tooltip="Dismiss notification"
              onClick={() => onDismiss(item.id)}
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </div>
          <div className="linkx_notice_body">{item.message}</div>
          <div className="linkx_notice_meta">
            <span>{item.source}</span>
            {item.action ? (
              <button
                type="button"
                className="linkx_notice_action"
                onClick={() => {
                  onDismiss(item.id);
                  item.action.onClick();
                }}
              >
                {item.action.label}
              </button>
            ) : null}
          </div>
          {item.durationMs > 0 ? <span className="linkx_notice_timer" aria-hidden="true" /> : null}
        </article>
      ))}
    </div>,
    document.body
  );
}

function MessageDialog({ item, onResolve }) {
  useEffect(() => {
    if (!item) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' && event.key !== 'Enter') return;
      event.preventDefault();
      onResolve(item.id);
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [item, onResolve]);

  if (!item) return null;
  if (typeof document === 'undefined' || !document.body) return null;

  return createPortal(
    <div
      className="linkx_message_overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onResolve(item.id);
      }}
    >
      <section
        className={'linkx_message_box linkx_message_' + item.level}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="linkx-message-title"
        aria-describedby="linkx-message-body"
      >
        <div className="linkx_message_accent" aria-hidden="true" />
        <div className="linkx_message_content">
          <div className="linkx_message_header">
            <span id="linkx-message-title" className="linkx_message_title">{item.title}</span>
            <button
              className="linkx_message_close linkx_tooltip_anchor"
              type="button"
              data-tooltip="Close message"
              onClick={() => onResolve(item.id)}
              aria-label="Close message"
            >
              ✕
            </button>
          </div>
          <div id="linkx-message-body" className="linkx_message_body">{item.message}</div>
          <div className="linkx_message_footer">
            <span>{item.source}</span>
            <button type="button" onClick={() => onResolve(item.id)} autoFocus>{item.confirmText}</button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

function ConfirmationDialog({ item, onResolve }) {
  useEffect(() => {
    if (!item) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onResolve(item.id, false);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onResolve(item.id, true);
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [item, onResolve]);

  if (!item) return null;
  if (typeof document === 'undefined' || !document.body) return null;

  return createPortal(
    <div
      className="linkx_confirm_overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onResolve(item.id, false);
      }}
    >
      <section
        className="linkx_confirm_box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="linkx-confirm-title"
        aria-describedby="linkx-confirm-body"
      >
        <div className="linkx_confirm_header">
          <span id="linkx-confirm-title" className="linkx_confirm_title">
            {item.title}
          </span>
          <button
            className="linkx_confirm_close linkx_tooltip_anchor"
            type="button"
            data-tooltip="Cancel"
            onClick={() => onResolve(item.id, false)}
            aria-label="Cancel"
          >
            ✕
          </button>
        </div>
        <div id="linkx-confirm-body" className="linkx_confirm_body">
          {item.message}
        </div>
        <div className="linkx_confirm_footer">
          <button
            type="button"
            className="linkx_confirm_btn_cancel"
            onClick={() => onResolve(item.id, false)}
          >
            {item.cancelText}
          </button>
          <button
            type="button"
            className="linkx_confirm_btn_ok"
            autoFocus
            onClick={() => onResolve(item.id, true)}
          >
            {item.confirmText}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

export function NotificationProvider({ children }) {
  const [notices, setNotices] = useState([]);
  const [messages, setMessages] = useState([]);
  const [confirmations, setConfirmations] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const noticeSeqRef = useRef(1);
  const messageSeqRef = useRef(1);
  const confirmSeqRef = useRef(1);
  const noticeTimersRef = useRef({});
  const nativeAlertRef = useRef(null);

  const clearNoticeTimer = useCallback((id) => {
    const timer = noticeTimersRef.current[id];
    if (timer) clearTimeout(timer.handle);
    delete noticeTimersRef.current[id];
  }, []);

  const dismissNotice = useCallback((id) => {
    setNotices((current) => current.filter((item) => item.id !== id));
    clearNoticeTimer(id);
  }, [clearNoticeTimer]);

  const startNoticeTimer = useCallback((id, remaining) => {
    clearNoticeTimer(id);
    noticeTimersRef.current[id] = {
      remaining,
      startedAt: Date.now(),
      pausedRemaining: null,
      handle: setTimeout(() => dismissNotice(id), remaining),
    };
  }, [clearNoticeTimer, dismissNotice]);

  const notify = useCallback((payload = {}) => {
    const levelCandidate = String(payload.level || payload.severity || 'info').toLowerCase();
    const level = NOTICE_LEVELS.has(levelCandidate) ? levelCandidate : 'info';
    const rawMessage = payload.message ?? payload.text ?? payload.detail ?? '';
    const message = sanitizeNoticeText(stringifyNoticeValue(rawMessage), { maxLength: 500 });
    if (!message) return null;

    const id = 'notice_' + Date.now() + '_' + noticeSeqRef.current++;
    const fallbackTitle = level === 'error' ? 'Error' : level === 'warning' ? 'Warning' : level === 'success' ? 'Success' : 'Notice';
    const rawTitle = sanitizeNoticeText(payload.title || '', { maxLength: 80 });
    const title = rawTitle && !/^(alert|message|message alert)$/i.test(rawTitle) ? rawTitle : fallbackTitle;
    const source = sanitizeNoticeText(payload.source || 'Linkx', { maxLength: 80 }) || 'Linkx';
    const durationMs = Number.isFinite(payload.durationMs) ? Number(payload.durationMs) : NOTICE_DURATIONS_MS[level];
    // Optional shortcut, e.g. { label: 'View task', onClick }.
    const actionLabel = sanitizeNoticeText(payload.action?.label || '', { maxLength: 24 });
    const action = actionLabel && typeof payload.action?.onClick === 'function'
      ? { label: actionLabel, onClick: payload.action.onClick }
      : null;

    setNotices((current) => {
      const next = [...current, { id, title, message, source, level, durationMs, action }];
      // Max 5 on screen; drop the oldest (and its timer).
      next.slice(0, Math.max(0, next.length - 5)).forEach((item) => clearNoticeTimer(item.id));
      return next.slice(-5);
    });
    setUnreadCount((current) => current + 1);
    if (durationMs > 0) startNoticeTimer(id, durationMs);
    return id;
  }, [clearNoticeTimer, startNoticeTimer]);

  // Hover/focus pauses the countdown (and its progress bar, via CSS); leaving
  // resumes it with the time that was left.
  const pauseNotice = useCallback((id) => {
    const timer = noticeTimersRef.current[id];
    if (!timer || timer.pausedRemaining != null) return;
    clearTimeout(timer.handle);
    timer.pausedRemaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
  }, []);

  const resumeNotice = useCallback((id) => {
    const timer = noticeTimersRef.current[id];
    if (!timer || timer.pausedRemaining == null) return;
    startNoticeTimer(id, Math.max(800, timer.pausedRemaining));
  }, [startNoticeTimer]);

  const showMessage = useCallback((payload = {}) => {
    const levelCandidate = String(payload.level || payload.severity || 'warning').toLowerCase();
    const level = NOTICE_LEVELS.has(levelCandidate) ? levelCandidate : 'warning';
    const message = sanitizeNoticeText(payload.message ?? payload.text ?? payload.detail ?? '', { maxLength: 1200 });
    if (!message) return null;

    const id = 'message_' + Date.now() + '_' + messageSeqRef.current++;
    const fallbackTitle = level === 'error' ? 'Error' : level === 'success' ? 'Success' : level === 'info' ? 'Notice' : 'Message';
    const title = sanitizeNoticeText(payload.title || '', { maxLength: 80 }) || fallbackTitle;
    const source = sanitizeNoticeText(payload.source || 'Linkx', { maxLength: 80 }) || 'Linkx';
    const confirmText = sanitizeNoticeText(payload.confirmText || 'OK', { maxLength: 24 }) || 'OK';
    setMessages((current) => [...current, { id, title, message, source, level, confirmText }].slice(-3));
    setUnreadCount((current) => current + 1);
    return id;
  }, []);

  const dismissMessage = useCallback((id) => {
    setMessages((current) => current.filter((item) => item.id !== id));
  }, []);

  const requestConfirmation = useCallback((payload = {}) => {
    return new Promise((resolve) => {
      const id = 'confirm_' + Date.now() + '_' + confirmSeqRef.current++;
      const message = sanitizeNoticeText(payload.message ?? payload.text ?? payload.detail ?? '', { maxLength: 1200 });
      const title = sanitizeNoticeText(payload.title || '', { maxLength: 80 }) || 'Confirm Action';
      const confirmText = sanitizeNoticeText(payload.confirmText || 'Continue', { maxLength: 24 }) || 'Continue';
      const cancelText = sanitizeNoticeText(payload.cancelText || 'Cancel', { maxLength: 24 }) || 'Cancel';

      setConfirmations((current) => [
        ...current,
        { id, title, message, confirmText, cancelText, resolve },
      ]);
    });
  }, []);

  const resolveConfirmation = useCallback((id, result) => {
    setConfirmations((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.resolve) {
        target.resolve(Boolean(result));
      }
      return current.filter((item) => item.id !== id);
    });
  }, []);

  useEffect(() => {
    nativeAlertRef.current = window.alert;

    window.alert = (message) => {
      showMessage({ title: 'Notice', message: String(message ?? ''), source: 'Linkx', level: 'warning' });
    };

    // window.confirm is deliberately NOT overridden: it must answer
    // synchronously, which an in-app dialog cannot. Use
    // `await requestConfirmation({...})` from useNotifications() instead.

    return () => {
      if (nativeAlertRef.current) window.alert = nativeAlertRef.current;
      Object.values(noticeTimersRef.current).forEach((timer) => clearTimeout(timer?.handle));
      noticeTimersRef.current = {};
    };
  }, [showMessage]);

  const markAllRead = useCallback(() => setUnreadCount(0), []);

  const value = useMemo(
    () => ({ notify, showMessage, requestConfirmation, dismissNotice, dismissMessage, unreadCount, markAllRead }),
    [notify, showMessage, requestConfirmation, dismissNotice, dismissMessage, unreadCount, markAllRead]
  );

  const activeMessage = messages[0] || null;
  const activeConfirmation = confirmations[0] || null;

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <NoticeStack items={notices} onDismiss={dismissNotice} onPause={pauseNotice} onResume={resumeNotice} />
      <MessageDialog item={activeMessage} onResolve={dismissMessage} />
      <ConfirmationDialog item={activeConfirmation} onResolve={resolveConfirmation} />
    </NotificationContext.Provider>
  );
}
