import React, { useCallback, useEffect, useState } from 'react';
import { useTheme } from './ThemeContext.jsx';
import { SCROLLBAR_PSEUDO_RE, expandScopedVariable, stateFreeSelector } from './pickerSelectors.js';
import { resolveCssColor } from './resolveColor.js';

/**
 * VisualElementPicker — Inspector overlay.
 * When active, the user hovers over any element in the app to:
 *   1) See a cyan outline around the hovered element
 *   2) See a floating tooltip listing ALL CSS variables affecting that element
 *   3) Click to "pin" the element and open an inline color editor panel
 *   4) Edit any CSS variable on the spot — changes are saved as custom overrides
 *
 * Press Escape or click the X to exit inspector mode.
 */
const PICKER_LANDMARK_SELECTOR = [
  '.workspace_window',
  '.workspace_window_header',
  '.workspace_window_body',
  '[class*="workspace_zone_"]',
  // The Settings window and its popups set their own variables on these.
  '.settings_theme_scope',
  '.configuration_theme_scope',
  '.libraries_theme_scope',
  '.settings_popup_backdrop',
].join(', ');

// Custom properties a rule sets ("--x: ..."), as [name, value] pairs.
const customDeclarations = (rule) => {
  const style = rule.style;
  const out = [];
  if (!style) return out;
  for (let i = 0; i < style.length; i++) {
    if (style[i].startsWith('--')) out.push([style[i], style.getPropertyValue(style[i]).trim()]);
  }
  return out;
};

// Variables set somewhere between the element and the root (a window's or a
// popup's own scope), nearest first. Overrides are written on the root, so a
// variable set closer than that cannot be changed from there: it has to be
// followed to the root-level variables it is made of.
const collectScopedVariables = (el, allRules) => {
  const scoped = new Map();
  const root = document.documentElement;
  const declaring = [];
  for (const rule of allRules) {
    const declarations = customDeclarations(rule);
    if (declarations.length) declaring.push([rule, declarations]);
  }
  for (let current = el; current && current !== root; current = current.parentElement) {
    const here = new Map();
    for (const [rule, declarations] of declaring) {
      let matches = false;
      for (const part of splitSelectorList(rule.selectorText)) {
        try {
          if (current.matches(stateFreeSelector(part))) { matches = true; break; }
        } catch { /* unsupported selector */ }
      }
      if (matches) declarations.forEach(([name, value]) => here.set(name, value));
    }
    const inline = current.style;
    for (let i = 0; inline && i < inline.length; i++) {
      if (inline[i].startsWith('--')) here.set(inline[i], inline.getPropertyValue(inline[i]).trim());
    }
    here.forEach((value, name) => { if (!scoped.has(name)) scoped.set(name, value); });
  }
  return scoped;
};

// Comma split that ignores commas inside (...) / [...].
const splitSelectorList = (selectorText) => {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selectorText.length; i++) {
    const ch = selectorText[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(selectorText.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(selectorText.slice(start).trim());
  return parts.filter(Boolean);
};

const isScrollable = (el) => {
  const cs = getComputedStyle(el);
  const scrollY = /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight;
  const scrollX = /(auto|scroll|overlay)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth;
  return scrollY || scrollX || el === document.scrollingElement;
};

// Rules that only set scrollbar-width/scrollbar-color (Firefox) count as scrollbar rules.
const isScrollbarOnlyRule = (rule) => {
  const style = rule.style;
  if (!style || style.length === 0) return false;
  for (let i = 0; i < style.length; i++) {
    if (!style[i].startsWith('scrollbar')) return false;
  }
  return true;
};

// Flattens style rules, descending into @media/@supports/@layer blocks that apply.
const collectStyleRules = (ruleList, out) => {
  for (const rule of ruleList) {
    if (rule.selectorText) {
      out.push(rule);
      continue;
    }
    if (!rule.cssRules) continue;
    try {
      if (rule.media && rule.conditionText && !window.matchMedia(rule.conditionText).matches) continue;
      if (!rule.media && rule.conditionText && typeof CSS !== 'undefined' && !CSS.supports(rule.conditionText)) continue;
    } catch { /* unknown condition: include */ }
    collectStyleRules(rule.cssRules, out);
  }
  return out;
};

// Returns { selector, isScrollbar } for the first selector part matching `el`, or null.
const matchRule = (el, rule, scrollable) => {
  const scrollbarOnly = isScrollbarOnlyRule(rule);
  if (scrollbarOnly && !scrollable) return null;
  for (const part of splitSelectorList(rule.selectorText)) {
    const isScrollbarPart = SCROLLBAR_PSEUDO_RE.test(part);
    if (isScrollbarPart && !scrollable) continue;
    const base = stateFreeSelector(part);
    try {
      if (el.matches(base)) return { selector: part, isScrollbar: isScrollbarPart || scrollbarOnly };
    } catch {
      // Stripping can break selectors like :not(:hover); fall back to the original.
      try {
        if (!isScrollbarPart && el.matches(part)) return { selector: part, isScrollbar: scrollbarOnly };
      } catch { /* unsupported selector */ }
    }
  }
  return null;
};

// Held keys that let a click through to the app. Ctrl is the one offered;
// Alt (the earlier one) and ⌘ on a Mac work the same.
const isPassThrough = (event) => Boolean(event.ctrlKey || event.altKey || event.metaKey);

// An element as the picker names it: its tag and its first two classes.
const elementLabel = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''}`;

export default function VisualElementPicker() {
  const { inspectorActive, toggleInspector, setCustomVariable, customOverrides } = useTheme();
  const [hoveredEl, setHoveredEl] = useState(null);
  const [pinnedEl, setPinnedEl] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [pinnedVars, setPinnedVars] = useState([]);
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 });
  // While Ctrl (or Alt) is held the picker steps aside: clicks do what they
  // normally do, and the highlight and the crosshair are put away.
  const [passThrough, setPassThrough] = useState(false);
  // Whether the variables of what surrounds the picked element are listed.
  const [showAround, setShowAround] = useState(false);

  // Extract CSS variables that affect a given DOM element (+ parents up to 6 levels)
  const extractCssVars = useCallback((el) => {
    if (!el) return [];
    const vars = [];
    const seen = new Set();
    const rootStyle = getComputedStyle(document.documentElement);

    // Scan an element's matching CSS rules for var(--xxx) references
    const allRules = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules || sheet.rules; } catch { continue; }
      if (rules) collectStyleRules(rules, allRules);
    }

    const scanElement = (targetEl, depth) => {
      const computed = getComputedStyle(targetEl);
      const tag = depth === 0 ? '(self)' : `(parent ×${depth})`;
      const scrollable = isScrollable(targetEl);

      try {
        {
          for (const rule of allRules) {
            try {
              const match = matchRule(targetEl, rule, scrollable);
              if (match) {
                const ruleText = rule.cssText;
                const varMatches = ruleText.matchAll(/var\((--[\w-]+)/g);
                for (const m of varMatches) {
                  const varName = m[1];
                  if (!seen.has(varName)) {
                    seen.add(varName);
                    const val = computed.getPropertyValue(varName).trim() || rootStyle.getPropertyValue(varName).trim();
                    let propContext = 'unknown';
                    const escaped = varName.replace(/[-]/g, '\\-');
                    if (match.isScrollbar) {
                      propContext = 'scrollbar';
                    } else if (ruleText.match(new RegExp(`(?:background|background-color)\\s*:\\s*[^;]*var\\(${escaped}[,)]`))) {
                      propContext = 'background';
                    } else if (ruleText.match(new RegExp(`(?:^|[^-])color\\s*:\\s*[^;]*var\\(${escaped}[,)]`))) {
                      propContext = 'text color';
                    } else if (ruleText.match(new RegExp(`border[^:]*:\\s*[^;]*var\\(${escaped}[,)]`))) {
                      propContext = 'border';
                    } else if (ruleText.match(new RegExp(`box-shadow\\s*:\\s*[^;]*var\\(${escaped}[,)]`))) {
                      propContext = 'shadow';
                    } else if (ruleText.match(new RegExp(`accent-color\\s*:\\s*[^;]*var\\(${escaped}[,)]`))) {
                      propContext = 'accent';
                    }
                    vars.push({
                      name: varName,
                      value: val,
                      context: propContext,
                      selector: match.selector,
                      source: depth === 0 ? 'direct' : `inherited ${tag}`,
                      depth,
                      owner: elementLabel(targetEl),
                    });
                  }
                }
              }
            } catch { /* selector match can fail */ }
          }
        }
      } catch { /* cross-origin sheets */ }
    };

    // Scan self + parents (up to 6 levels), then keep climbing but only scan
    // container landmarks (window frame/header/body, workspace zones) so deeply
    // nested content still exposes its window's border/background variables.
    let current = el;
    for (let depth = 0; current && current !== document.documentElement; depth++) {
      if (depth < 6 || current.matches(PICKER_LANDMARK_SELECTOR)) scanElement(current, depth);
      current = current.parentElement;
    }

    // Also check inline styles
    const inlineStyle = el.getAttribute('style');
    if (inlineStyle) {
      const inlineVarMatches = inlineStyle.matchAll(/var\((--[\w-]+)/g);
      for (const m of inlineVarMatches) {
        const varName = m[1];
        if (!seen.has(varName)) {
          seen.add(varName);
          const val = getComputedStyle(el).getPropertyValue(varName).trim();
          vars.push({ name: varName, value: val, context: 'inline', selector: 'inline', source: 'direct', depth: 0, owner: elementLabel(el) });
        }
      }
    }

    // A variable set by the element's own window or popup is swapped for
    // the root-level variables behind it (the ones an override can reach).
    const scoped = collectScopedVariables(el, allRules);
    const reachable = [];
    const listed = new Set();
    vars.forEach((entry) => {
      expandScopedVariable(entry.name, scoped).forEach((name) => {
        if (listed.has(name)) return;
        listed.add(name);
        reachable.push(name === entry.name ? entry : {
          ...entry,
          name,
          value: rootStyle.getPropertyValue(name).trim(),
          source: `${entry.source} · via ${entry.name}`,
        });
      });
    });

    // The picked element's own first, then outwards; by name within each.
    return reachable.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));

  }, []);

  // Hover handler
  const handleMouseMove = useCallback((e) => {
    if (!inspectorActive) return;
    // Also read here, in case the key went down or up outside the window.
    setPassThrough(isPassThrough(e));
    if (pinnedEl) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    // Ignore the inspector overlay and its children
    if (!el || el.closest('.element_picker_overlay') || el.closest('.element_picker_panel')) return;
    setHoveredEl(el);
    setTooltipPos({ x: e.clientX, y: e.clientY });
  }, [inspectorActive, pinnedEl]);

  // Click handler — pin element
  const handleClick = useCallback((e) => {
    if (!inspectorActive) return;
    // Ctrl+click (or Alt+click) passes through to the app: open a tab, a
    // page or a menu as usual, then pick inside it.
    if (isPassThrough(e)) return;
    // If clicking inside the panel, let it through
    if (e.target.closest('.element_picker_panel')) return;
    e.preventDefault();
    e.stopPropagation();

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.closest('.element_picker_overlay') || el.closest('.element_picker_panel')) return;

    const vars = extractCssVars(el);
    setPinnedEl(el);
    setPinnedVars(vars);
    // Only the element's own, unless it has none.
    setShowAround(!vars.some((entry) => entry.depth === 0));
    setPanelPos({ x: Math.min(e.clientX + 12, window.innerWidth - 380), y: Math.min(e.clientY + 12, window.innerHeight - 400) });
  }, [inspectorActive, extractCssVars]);

  // Escape key to exit
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        if (pinnedEl) {
          setPinnedEl(null);
          setPinnedVars([]);
        } else if (inspectorActive) {
          toggleInspector();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [inspectorActive, pinnedEl, toggleInspector]);

  // Attach move + click listeners when inspector active
  useEffect(() => {
    if (!inspectorActive) {
      setHoveredEl(null);
      setPinnedEl(null);
      setPinnedVars([]);
      return;
    }
    const onModifier = (e) => setPassThrough(isPassThrough(e));
    const onBlur = () => setPassThrough(false);
    window.addEventListener('keydown', onModifier, true);
    window.addEventListener('keyup', onModifier, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('mousemove', handleMouseMove, true);
    window.addEventListener('click', handleClick, true);
    return () => {
      window.removeEventListener('keydown', onModifier, true);
      window.removeEventListener('keyup', onModifier, true);
      window.removeEventListener('blur', onBlur);
      setPassThrough(false);
      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('click', handleClick, true);
    };
  }, [inspectorActive, handleMouseMove, handleClick]);

  // The crosshair, except while the picker is stepping aside.
  useEffect(() => {
    if (!inspectorActive || passThrough) return undefined;
    document.documentElement.classList.add('is-element-picking');
    return () => document.documentElement.classList.remove('is-element-picking');
  }, [inspectorActive, passThrough]);

  if (!inspectorActive) return null;

  // Hover outline box
  const hoverBox = hoveredEl && !pinnedEl && !passThrough ? (() => {
    const rect = hoveredEl.getBoundingClientRect();
    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };
  })() : null;

  // Pinned outline box
  const pinBox = pinnedEl ? (() => {
    const rect = pinnedEl.getBoundingClientRect();
    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };
  })() : null;

  // Tooltip content: element class + tag
  const hoverLabel = hoveredEl ? `${hoveredEl.tagName.toLowerCase()}${hoveredEl.className && typeof hoveredEl.className === 'string' ? '.' + hoveredEl.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''}` : '';

  const toHex = (val) => {
    if (!val) return '#000000';
    if (val.startsWith('#')) return val.length <= 7 ? val : val.substring(0, 7);
    // Try parsing rgb/rgba
    const m = val.match(/rgba?\(\s*(\d+),?\s*(\d+),?\s*(\d+)/);
    if (m) {
      const hex = '#' + [m[1], m[2], m[3]].map((c) => parseInt(c).toString(16).padStart(2, '0')).join('');
      return hex;
    }
    // A variable or a mix of colours: the colour it gives right now.
    const resolved = resolveCssColor(val);
    if (resolved.startsWith('#')) return resolved.substring(0, 7);
    const mixed = resolved.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
    if (mixed) return '#' + [mixed[1], mixed[2], mixed[3]].map((c) => parseInt(c).toString(16).padStart(2, '0')).join('');
    return '#000000';
  };

  // One variable of the pinned element: its name, where it applies, its
  // control and (once changed) its reset.
  const renderVar = (v) => {
    const isOverridden = Boolean(customOverrides[v.name]);
    return (
      <div key={v.name} className={`element_picker_var_row ${isOverridden ? 'is-overridden' : ''}`}>
        <div className="element_picker_var_info">
          <code className="element_picker_var_name">{v.name}</code>
          <span className="element_picker_var_context">{v.context}</span>
        </div>
        <div className="element_picker_var_controls">
          <input
            type="color"
            className="element_picker_color_input"
            value={toHex(customOverrides[v.name] || v.value)}
            onChange={(e) => setCustomVariable(v.name, e.target.value)}
          />
          <input
            type="text"
            className="element_picker_text_input"
            value={customOverrides[v.name] || v.value}
            onChange={(e) => setCustomVariable(v.name, e.target.value)}
            placeholder={v.value}
          />
          {isOverridden && (
            <button
              className="element_picker_reset_btn"
              title="Reset to theme default"
              onClick={() => setCustomVariable(v.name, undefined)}
            >↺</button>
          )}
        </div>
        <div className="element_picker_var_selector" title={v.selector}>
          {v.selector.length > 50 ? v.selector.slice(0, 50) + '…' : v.selector}
        </div>
      </div>
    );
  };

  // What the popup lists: the picked element's own variables first; those
  // of what it sits in (its parents, its window) are kept apart and closed
  // until asked for, by the element they belong to.
  const ownVars = pinnedVars.filter((v) => v.depth === 0);
  const aroundVars = pinnedVars.filter((v) => v.depth !== 0);
  const aroundGroups = [];
  aroundVars.forEach((v) => {
    const last = aroundGroups[aroundGroups.length - 1];
    if (last && last.depth === v.depth) last.vars.push(v);
    else aroundGroups.push({ depth: v.depth, owner: v.owner, vars: [v] });
  });

  return (
    <>
      {/* Full screen cursor override */}
      <div className="element_picker_overlay" style={{ position: 'fixed', inset: 0, zIndex: 99998, cursor: passThrough ? 'auto' : 'crosshair', pointerEvents: 'none' }} />

      {/* Hover highlight box */}
      {hoverBox && (
        <div
          className="element_picker_highlight"
          style={{
            position: 'fixed',
            top: hoverBox.top,
            left: hoverBox.left,
            width: hoverBox.width,
            height: hoverBox.height,
            border: '2px solid #FCC676',
            background: 'rgba(252, 198, 118, 0.08)',
            borderRadius: 3,
            pointerEvents: 'none',
            zIndex: 99999,
            transition: 'all 0.08s ease-out',
          }}
        />
      )}

      {/* Pinned highlight box */}
      {pinBox && (
        <div
          className="element_picker_highlight is-pinned"
          style={{
            position: 'fixed',
            top: pinBox.top,
            left: pinBox.left,
            width: pinBox.width,
            height: pinBox.height,
            border: '2px solid #FCC676',
            background: 'rgba(252, 198, 118, 0.12)',
            borderRadius: 3,
            pointerEvents: 'none',
            zIndex: 99999,
            boxShadow: '0 0 12px rgba(252, 198, 118, 0.4)',
          }}
        />
      )}

      {/* Hover tooltip label */}
      {hoveredEl && !pinnedEl && !passThrough && (
        <div
          className="element_picker_tooltip"
          style={{
            position: 'fixed',
            top: tooltipPos.y + 18,
            left: tooltipPos.x + 14,
            zIndex: 100000,
            pointerEvents: 'none',
          }}
        >
          <span className="element_picker_tooltip_tag">{hoverLabel}</span>
          <span className="element_picker_tooltip_hint">Click to inspect CSS variables</span>
        </div>
      )}

      {/* Floating badge: inspector mode active */}
      <div className="element_picker_badge" style={{ position: 'fixed', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 100001, pointerEvents: 'auto' }}>
        <span>🔍 Element Picker Active</span>
        <span className="element_picker_badge_hint">{passThrough ? 'Ctrl held: clicks work as usual — release to pick again' : 'Hover & click any element • Hold Ctrl to click normally (open tabs, pages, menus) • ESC to exit'}</span>
        <button className="element_picker_badge_close" onClick={toggleInspector}>✕</button>
      </div>

      {/* Pinned element variable editor panel */}
      {pinnedEl && (
        <div
          className="element_picker_panel"
          style={{
            position: 'fixed',
            top: panelPos.y,
            left: panelPos.x,
            zIndex: 100002,
            pointerEvents: 'auto',
          }}
        >
          <div className="element_picker_panel_header">
            <div>
              <strong>Picked element</strong>
              <code>{pinnedEl.tagName.toLowerCase()}{pinnedEl.className && typeof pinnedEl.className === 'string' ? '.' + pinnedEl.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''}</code>
            </div>
            <button className="element_picker_panel_close" onClick={() => { setPinnedEl(null); setPinnedVars([]); }}>✕</button>
          </div>

          <div className="element_picker_panel_body">
            {pinnedVars.length === 0 ? (
              <div className="element_picker_panel_empty">
                <p>No CSS variables found on this element.</p>
                <p>This element might use inherited styles. Try clicking a parent or child element instead.</p>
              </div>
            ) : (
              <>
                <div className="element_picker_section is-picked">
                  <span className="element_picker_section_mark" aria-hidden="true" />
                  <strong>Picked element</strong>
                  <span>{ownVars.length}</span>
                </div>
                {ownVars.length === 0 ? (
                  <p className="element_picker_section_note">It has no colours of its own: it shows what is around it.</p>
                ) : ownVars.map(renderVar)}
                {aroundVars.length > 0 ? (
                  <button type="button" className={`element_picker_section is-toggle${showAround ? ' is-open' : ''}`} aria-expanded={showAround} onClick={() => setShowAround((current) => !current)}>
                    <span className="element_picker_section_chevron" aria-hidden="true">›</span>
                    <strong>Around it</strong>
                    <span>{aroundVars.length}</span>
                  </button>
                ) : null}
                {showAround ? aroundGroups.map((group) => (
                  <React.Fragment key={group.depth}>
                    <div className="element_picker_owner" title={group.owner}>⬆ {group.owner}</div>
                    {group.vars.map(renderVar)}
                  </React.Fragment>
                )) : null}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
