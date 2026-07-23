import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { NotificationContext } from './notificationContext.js';

const NOTICE_LEVELS = new Set(['success', 'warning', 'error', 'info']);

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

function NoticeStack({ items, onDismiss }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  if (typeof document === 'undefined' || !document.body) return null;

  return createPortal(
    <div className="linkx_notice_stack" role="region" aria-label="Notifications">
      {items.map((item) => (
        <article key={item.id} className={'linkx_notice linkx_notice_' + item.level} role="status">
          <div className="linkx_notice_head">
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
          <div className="linkx_notice_meta">{item.source}</div>
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
  const noticeSeqRef = useRef(1);
  const messageSeqRef = useRef(1);
  const confirmSeqRef = useRef(1);
  const noticeTimersRef = useRef({});
  const nativeAlertRef = useRef(null);
  const nativeConfirmRef = useRef(null);

  const dismissNotice = useCallback((id) => {
    setNotices((current) => current.filter((item) => item.id !== id));
    if (noticeTimersRef.current[id]) {
      clearTimeout(noticeTimersRef.current[id]);
      delete noticeTimersRef.current[id];
    }
  }, []);

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
    const durationMs = Number.isFinite(payload.durationMs) ? Number(payload.durationMs) : 5400;

    setNotices((current) => [...current, { id, title, message, source, level }].slice(-5));
    if (durationMs > 0) {
      noticeTimersRef.current[id] = setTimeout(() => dismissNotice(id), durationMs);
    }
    return id;
  }, [dismissNotice]);

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
    nativeConfirmRef.current = window.confirm;

    window.alert = (message) => {
      showMessage({ title: 'Notice', message: String(message ?? ''), source: 'Linkx', level: 'warning' });
    };

    window.confirm = (message) => {
      requestConfirmation({ title: 'Confirmation Required', message: String(message ?? '') });
      return false;
    };

    return () => {
      if (nativeAlertRef.current) window.alert = nativeAlertRef.current;
      if (nativeConfirmRef.current) window.confirm = nativeConfirmRef.current;
      Object.values(noticeTimersRef.current).forEach((timerId) => clearTimeout(timerId));
      noticeTimersRef.current = {};
    };
  }, [showMessage, requestConfirmation]);

  const value = useMemo(
    () => ({ notify, showMessage, requestConfirmation, dismissNotice, dismissMessage }),
    [notify, showMessage, requestConfirmation, dismissNotice, dismissMessage]
  );

  const activeMessage = messages[0] || null;
  const activeConfirmation = confirmations[0] || null;

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <NoticeStack items={notices} onDismiss={dismissNotice} />
      <MessageDialog item={activeMessage} onResolve={dismissMessage} />
      <ConfirmationDialog item={activeConfirmation} onResolve={resolveConfirmation} />
    </NotificationContext.Provider>
  );
}
