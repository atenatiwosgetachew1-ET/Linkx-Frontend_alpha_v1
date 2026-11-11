import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/*
 * Global tooltip layer.
 *
 * Any element with `data-tooltip` and a tooltip anchor class gets a tooltip
 * rendered here — one fixed-position node portalled to <body>, so it can never
 * be clipped by an `overflow: hidden/auto` ancestor (panels, windows, lists).
 * Placement prefers the side given by `data-tooltip-placement` (or a contextual
 * default), flips when there is no room, and is clamped to the viewport.
 * Positioning is done imperatively to avoid React re-renders on hover.
 */

const ANCHOR_SELECTOR = '.linkx_tooltip_anchor[data-tooltip], .source_window_tooltip_anchor[data-tooltip]';
const GAP = 8;
const EDGE = 6;
const SHOW_DELAY_MS = 120;

const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function preferredPlacement(anchor) {
  const explicit = anchor.getAttribute('data-tooltip-placement');
  if (explicit && OPPOSITE[explicit]) return explicit;
  if (anchor.closest('.workspace_launcher')) return 'right';
  if (anchor.closest('.workspace_collapsed_rail_main, .workspace_collapsed_rail_btn')) return 'left';
  return 'top';
}

function fits(placement, rect, tip, vw, vh) {
  switch (placement) {
    case 'top': return rect.top - GAP - tip.height >= EDGE;
    case 'bottom': return rect.bottom + GAP + tip.height <= vh - EDGE;
    case 'left': return rect.left - GAP - tip.width >= EDGE;
    default: return rect.right + GAP + tip.width <= vw - EDGE;
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export default function TooltipLayer() {
  const tipRef = useRef(null);
  const textRef = useRef(null);
  const arrowRef = useRef(null);

  useEffect(() => {
    const tip = tipRef.current;
    if (!tip) return undefined;

    let current = null;
    let showTimer = 0;

    const position = () => {
      if (!current || !current.isConnected) return;
      const rect = current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const size = { width: tip.offsetWidth, height: tip.offsetHeight };

      const first = preferredPlacement(current);
      const order = [first, OPPOSITE[first], ...['top', 'bottom', 'right', 'left'].filter((p) => p !== first && p !== OPPOSITE[first])];
      const placement = order.find((p) => fits(p, rect, size, vw, vh)) || first;

      let x;
      let y;
      if (placement === 'top' || placement === 'bottom') {
        x = clamp(rect.left + rect.width / 2 - size.width / 2, EDGE, vw - size.width - EDGE);
        y = placement === 'top' ? rect.top - GAP - size.height : rect.bottom + GAP;
      } else {
        x = placement === 'left' ? rect.left - GAP - size.width : rect.right + GAP;
        y = clamp(rect.top + rect.height / 2 - size.height / 2, EDGE, vh - size.height - EDGE);
      }

      tip.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      tip.dataset.placement = placement;

      // Keep the arrow pointing at the anchor even when the bubble was clamped.
      const arrow = arrowRef.current;
      if (placement === 'top' || placement === 'bottom') {
        arrow.style.left = `${clamp(rect.left + rect.width / 2 - x, 10, size.width - 10)}px`;
        arrow.style.top = '';
      } else {
        arrow.style.top = `${clamp(rect.top + rect.height / 2 - y, 10, size.height - 10)}px`;
        arrow.style.left = '';
      }
    };

    const hide = () => {
      window.clearTimeout(showTimer);
      current = null;
      tip.classList.remove('is-visible');
    };

    const show = (anchor) => {
      const text = anchor.getAttribute('data-tooltip');
      if (!text) return;
      current = anchor;
      textRef.current.textContent = text;
      window.clearTimeout(showTimer);
      showTimer = window.setTimeout(() => {
        if (current !== anchor) return;
        position();
        tip.classList.add('is-visible');
      }, SHOW_DELAY_MS);
    };

    const onPointerOver = (event) => {
      const anchor = event.target.closest?.(ANCHOR_SELECTOR);
      if (anchor === current) return;
      if (anchor) show(anchor);
      else if (current) hide();
    };

    const onPointerOut = (event) => {
      if (!current) return;
      const next = event.relatedTarget;
      if (next && current.contains(next)) return;
      if (!next || !next.closest?.(ANCHOR_SELECTOR)) hide();
    };

    const onFocusIn = (event) => {
      const anchor = event.target.closest?.(ANCHOR_SELECTOR);
      if (anchor && anchor.matches(':focus-visible')) show(anchor);
    };

    // Tooltip text can change while it is open (e.g. Expand/Collapse labels).
    const observer = new MutationObserver(() => {
      if (!current) return;
      if (!current.isConnected) {
        hide();
        return;
      }
      const text = current.getAttribute('data-tooltip');
      if (!text) {
        hide();
        return;
      }
      if (textRef.current.textContent !== text) {
        textRef.current.textContent = text;
        position();
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tooltip'] });

    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);

    return () => {
      window.clearTimeout(showTimer);
      observer.disconnect();
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('pointerout', onPointerOut, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);

  return createPortal(
    <div ref={tipRef} className="linkx_tooltip" role="tooltip" aria-hidden="true">
      <span ref={textRef} className="linkx_tooltip_text" />
      <span ref={arrowRef} className="linkx_tooltip_arrow" />
    </div>,
    document.body,
  );
}
