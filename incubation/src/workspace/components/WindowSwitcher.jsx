import React, { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { getActiveTaskForWindow, getTasksSnapshot, subscribeTasks } from '../../features/tasks/lib/taskRegistry.js';
import { isTypingTarget, matchesWindow, useWindowMru, windowDetail } from '../lib/windowSwitcher.js';

// Window switcher for floating mode (analyst decision 2026-11-21, option A):
// at the bottom of the launcher, with the number of open windows. The list is
// in most-recently-used order (one click goes back to the previous window),
// can be searched, shows which windows are running an analysis, and closes
// a window without bringing it forward.
//
// Keyboard (analyst decision 2026-11-21: Tab stays for moving between
// fields, so the key left of 1 is used):
// - ` alone, when not typing: switches at once, press after press. The walk
//   follows the order at its first press (back to the previous window, then
//   older ones); after WALK_IDLE_MS without a press the window it stopped
//   on becomes the most recent. Shift+` walks back. A name tag shows where
//   it landed.
// - Alt+` (Shift reverses), also while typing: steps through the list while
//   Alt is held, like Alt+Tab; releasing Alt switches.
// Alt+Tab and Ctrl+Tab belong to the operating system and the browser. In
// the open list: ↑ / ↓, Enter, Escape.
const WALK_IDLE_MS = 1000;
const TAG_MS = 1100;

// renderIcon(path, className?): the launcher's icon.
export default function WindowSwitcher({ workspace, iconPaths = {}, fallbackIcon, renderIcon, onSwitched }) {
  const { windows, activeWindowId, focusWindow, closeWindow } = workspace;
  // A ` walk in progress: { ids, index } (the order at its first press).
  const [walking, setWalking] = useState(false);
  const walkRef = useRef(null);
  const walkTimerRef = useRef(null);
  // The name tag of the window a ` press landed on.
  const [tag, setTag] = useState(null);
  const tagTimerRef = useRef(null);
  const ordered = useWindowMru(windows, activeWindowId, { hold: walking });
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  // Alt+` cycling: the list is open while Alt is held.
  const [cycling, setCycling] = useState(false);
  useSyncExternalStore(subscribeTasks, getTasksSnapshot);
  const wrapRef = useRef(null);
  const searchRef = useRef(null);
  const listId = useId();

  const visible = useMemo(() => (cycling ? ordered : ordered.filter((windowItem) => matchesWindow(windowItem, query.trim()))), [cycling, ordered, query]);
  const safeHighlight = visible.length ? Math.min(highlight, visible.length - 1) : 0;

  const close = useCallback(() => {
    setIsOpen(false);
    setCycling(false);
    setQuery('');
    setHighlight(0);
  }, []);
  const switchTo = useCallback((id) => {
    if (id) focusWindow(id);
    close();
    onSwitched?.();
  }, [close, focusWindow, onSwitched]);

  const open = () => {
    setQuery('');
    // The previous window is one Enter away.
    setHighlight(ordered.length > 1 ? 1 : 0);
    setIsOpen(true);
  };

  useEffect(() => {
    if (isOpen && !cycling) searchRef.current?.focus();
  }, [isOpen, cycling]);

  // A click outside closes the list.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [isOpen, close]);

  // Alt+` / Alt+Shift+`: step while Alt is held; releasing Alt switches.
  const stateRef = useRef({});
  stateRef.current = { cycling, visible, safeHighlight, ordered, windows, isOpen };
  // ` alone: switch now, and keep walking while presses keep coming.
  const walkStep = useCallback((step) => {
    const { ordered: list, windows: open } = stateRef.current;
    let walk = walkRef.current;
    if (!walk) {
      if (list.length < 2) return false;
      walk = { ids: list.map((windowItem) => windowItem.id), index: 0 };
    }
    const openIds = new Set(open.map((windowItem) => windowItem.id));
    const ids = walk.ids.filter((id) => openIds.has(id));
    if (ids.length < 2) return false;
    const index = (Math.min(walk.index, ids.length - 1) + step + ids.length) % ids.length;
    walkRef.current = { ids, index };
    setWalking(true);
    focusWindow(ids[index]);
    const target = open.find((windowItem) => windowItem.id === ids[index]);
    setTag({ id: ids[index], title: target?.title || '', detail: target ? windowDetail(target) : '', position: index + 1, total: ids.length });
    clearTimeout(walkTimerRef.current);
    walkTimerRef.current = setTimeout(() => {
      walkRef.current = null;
      setWalking(false);
    }, WALK_IDLE_MS);
    clearTimeout(tagTimerRef.current);
    tagTimerRef.current = setTimeout(() => setTag(null), TAG_MS);
    return true;
  }, [focusWindow]);
  useEffect(() => () => {
    clearTimeout(walkTimerRef.current);
    clearTimeout(tagTimerRef.current);
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && stateRef.current.cycling) {
        event.preventDefault();
        close();
        return;
      }
      if (event.code === 'Backquote' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        if (event.repeat || stateRef.current.isOpen || isTypingTarget(event.target)) return;
        if (walkStep(event.shiftKey ? -1 : 1)) event.preventDefault();
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey || event.code !== 'Backquote') return;
      const { cycling: isCycling, ordered: list } = stateRef.current;
      if (list.length < 2) return;
      event.preventDefault();
      const step = event.shiftKey ? -1 : 1;
      if (!isCycling) {
        setCycling(true);
        setIsOpen(true);
        setQuery('');
        setHighlight(event.shiftKey ? list.length - 1 : 1);
        return;
      }
      setHighlight((current) => (current + step + list.length) % list.length);
    };
    const onKeyUp = (event) => {
      if (event.key !== 'Alt' || !stateRef.current.cycling) return;
      const { visible: list, safeHighlight: index } = stateRef.current;
      switchTo(list[index]?.id);
    };
    const onBlur = () => {
      if (stateRef.current.cycling) close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [switchTo, close, walkStep]);

  const onListKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!visible.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight((safeHighlight + step + visible.length) % visible.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (visible[safeHighlight]) switchTo(visible[safeHighlight].id);
    }
  };

  if (!windows.length) return null;
  const highlightedId = visible[safeHighlight]?.id;

  return (
    <div className="workspace_switcher" ref={wrapRef}>
      <button
        className="workspace_launcher_button workspace_switcher_button linkx_tooltip_anchor"
        type="button"
        data-tooltip="Switch window (` next window)"
        aria-label={`Switch window: ${windows.length} open`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => (isOpen ? close() : open())}
      >
        {renderIcon(fallbackIcon)}
        <span className="workspace_launcher_label">Windows</span>
        <span className="workspace_switcher_count" aria-hidden="true">{windows.length}</span>
      </button>
      {isOpen ? (
        <div className="workspace_switcher_panel" role="dialog" aria-label="Switch window" onKeyDown={onListKeyDown}>
          {cycling ? null : (
            <input
              ref={searchRef}
              className="workspace_switcher_search"
              type="search"
              placeholder="Find a window"
              aria-label="Find a window"
              aria-controls={listId}
              aria-activedescendant={highlightedId ? `${listId}-${highlightedId}` : undefined}
              value={query}
              maxLength={80}
              onChange={(event) => { setQuery(event.target.value); setHighlight(0); }}
            />
          )}
          <ul className="workspace_switcher_list" id={listId} role="listbox" aria-label="Open windows">
            {visible.map((windowItem, index) => {
              const isActive = windowItem.id === activeWindowId;
              const running = Boolean(getActiveTaskForWindow(windowItem.id));
              const detail = windowDetail(windowItem);
              return (
                <li
                  key={windowItem.id}
                  id={`${listId}-${windowItem.id}`}
                  role="option"
                  aria-selected={index === safeHighlight}
                  className={'workspace_switcher_item' + (index === safeHighlight ? ' is-highlighted' : '') + (isActive ? ' is-active' : '')}
                  onPointerEnter={() => setHighlight(index)}
                >
                  <button type="button" className="workspace_switcher_focus" tabIndex={-1} onClick={() => switchTo(windowItem.id)}>
                    {renderIcon(iconPaths[windowItem.type] || fallbackIcon, 'workspace_switcher_icon')}
                    <span className="workspace_switcher_text">
                      <strong>{windowItem.title}</strong>
                      {detail ? <small>{detail}</small> : null}
                    </span>
                    {running ? <span className="workspace_switcher_running" title="An analysis is running in this window"><i aria-hidden="true" />Running</span> : null}
                    {isActive ? <span className="workspace_switcher_current">Current</span> : null}
                  </button>
                  {cycling ? null : (
                    <button
                      type="button"
                      className="workspace_switcher_close"
                      tabIndex={-1}
                      aria-label={'Close ' + windowItem.title}
                      title={'Close ' + windowItem.title}
                      onClick={() => closeWindow(windowItem.id)}
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {visible.length ? null : <p className="workspace_switcher_empty" role="status">No window matches.</p>}
          <p className="workspace_switcher_hint">{cycling ? 'Release Alt to switch · ` next · Shift+` back' : '↑ ↓ to choose · Enter to switch · ` next window'}</p>
        </div>
      ) : null}
      {tag && typeof document !== 'undefined' ? createPortal(
        <div className="workspace_switcher_tag" role="status" aria-live="polite" key={tag.id + tag.position}>
          <strong>{tag.title}</strong>
          {tag.detail ? <small>{tag.detail}</small> : null}
          <span>{tag.position} / {tag.total}</span>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
