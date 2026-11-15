import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// The Graph window's right-click menu (production #customContextMenu), with
// production's items grouped into submenus so it never needs a scrollbar.
// Styled like the hover title box. Both levels stay inside the canvas
// (production's 10 px margin); a submenu opens to the left when there is no
// room on the right.
//
// Keys: ↑ ↓ move, → or Enter opens a group, ← or Escape closes it, Escape
// on the main menu closes the menu. Clicking elsewhere or any canvas
// interaction closes it too.
const MARGIN = 10;
const GAP = 2;

const clampInto = (element, stage, left, top) => {
  const maxLeft = stage.clientWidth - element.offsetWidth - MARGIN;
  const maxTop = stage.clientHeight - element.offsetHeight - MARGIN;
  element.style.left = `${Math.max(MARGIN, Math.min(left, maxLeft))}px`;
  element.style.top = `${Math.max(MARGIN, Math.min(top, maxTop))}px`;
};

const focusables = (element) => [...element.querySelectorAll('[role="menuitem"]')];
const firstEnabled = (element) => element.querySelector('[role="menuitem"]:not([aria-disabled="true"])') || focusables(element)[0];

const Chevron = () => (
  <svg className="graph_context_menu_chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 6 6 6-6 6" /></svg>
);

function MenuItems({ items, openGroup, onOpenGroup, onRun }) {
  return items.map((entry) => {
    if (entry.items) {
      const open = openGroup === entry.group;
      return (
        <button
          key={entry.group}
          type="button"
          role="menuitem"
          className={`graph_context_menu_item is-group${open ? ' is-open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-disabled={!entry.enabled}
          data-group={entry.group}
          title={entry.pending || undefined}
          onMouseEnter={(event) => onOpenGroup(entry.group, event.currentTarget, false)}
          onClick={(event) => onOpenGroup(entry.group, event.currentTarget, true)}
        >
          <span>{entry.label}</span>
          <Chevron />
        </button>
      );
    }
    return (
      <button
        key={entry.action}
        type="button"
        role="menuitem"
        className="graph_context_menu_item"
        aria-disabled={!entry.enabled}
        title={entry.pending || undefined}
        onMouseEnter={() => onOpenGroup(null)}
        onClick={() => onRun(entry)}
      >
        {entry.label}
      </button>
    );
  });
}

export default function GraphContextMenu({ menu, onAction, onClose }) {
  const ref = useRef(null);
  const subRef = useRef(null);
  const [sub, setSub] = useState(null); // { group, anchor, focus }
  const { header, items } = menu.content;
  const openEntry = sub ? items.find((entry) => entry.group === sub.group) : null;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element?.parentElement) return;
    clampInto(element, element.parentElement, menu.x, menu.y);
    setSub(null);
    (firstEnabled(element) || element).focus();
  }, [menu]);

  // Beside its group row: right, else left; clamped into the canvas.
  useLayoutEffect(() => {
    const element = subRef.current;
    const main = ref.current;
    if (!element || !main || !sub) return;
    const stage = main.parentElement;
    const row = sub.anchor;
    const rightX = main.offsetLeft + main.offsetWidth + GAP;
    const fitsRight = rightX + element.offsetWidth <= stage.clientWidth - MARGIN;
    const left = fitsRight ? rightX : main.offsetLeft - element.offsetWidth - GAP;
    clampInto(element, stage, left, main.offsetTop + row.offsetTop - 5);
    if (sub.focus) firstEnabled(element)?.focus();
  }, [sub]);

  const openGroup = useCallback((group, anchor, focus) => {
    setSub((current) => {
      if (!group) return null;
      if (current?.group === group && !focus) return current;
      return { group, anchor, focus };
    });
  }, []);

  const closeSub = useCallback(() => {
    if (!sub) return;
    sub.anchor?.focus();
    setSub(null);
  }, [sub]);

  useEffect(() => {
    const inside = (target) => ref.current?.contains(target) || subRef.current?.contains(target);
    const onPointerDown = (event) => {
      if (!inside(event.target)) onClose();
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (subRef.current) closeSub();
      else onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [closeSub, onClose]);

  const run = (entry) => {
    if (!entry.enabled) return;
    onClose();
    onAction(entry.action);
  };

  const onKeyDown = (event, level) => {
    const container = level === 'sub' ? subRef.current : ref.current;
    if (!container) return;
    const list = focusables(container);
    const index = list.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      list[(index + step + list.length) % list.length]?.focus();
    } else if (event.key === 'ArrowRight' && level === 'main') {
      const row = document.activeElement;
      if (row?.dataset?.group) {
        event.preventDefault();
        openGroup(row.dataset.group, row, true);
      }
    } else if (event.key === 'ArrowLeft' && level === 'sub') {
      event.preventDefault();
      closeSub();
    }
  };

  return (
    <>
      <div
        ref={ref}
        className="graph_context_menu"
        role="menu"
        aria-label={header ? header.title : 'Graph actions'}
        tabIndex={-1}
        style={{ left: menu.x, top: menu.y }}
        onKeyDown={(event) => onKeyDown(event, 'main')}
        onContextMenu={(event) => event.preventDefault()}
      >
        {header ? (
          <div className="graph_context_menu_header">
            <strong>{header.title}</strong>
            {header.rows.map(([label, value]) => (
              <span key={label}>{label}: <b>{value}</b></span>
            ))}
          </div>
        ) : null}
        <MenuItems items={items} openGroup={sub?.group} onOpenGroup={openGroup} onRun={run} />
      </div>
      {openEntry ? (
        <div
          ref={subRef}
          className="graph_context_menu is-submenu"
          role="menu"
          aria-label={openEntry.label}
          tabIndex={-1}
          onKeyDown={(event) => onKeyDown(event, 'sub')}
          onContextMenu={(event) => event.preventDefault()}
        >
          <MenuItems items={openEntry.items} onOpenGroup={() => {}} onRun={run} />
        </div>
      ) : null}
    </>
  );
}
