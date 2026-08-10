import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from './ThemeContext.jsx';

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
export default function VisualElementPicker() {
  const { inspectorActive, toggleInspector, setCustomVariable, customOverrides } = useTheme();
  const [hoveredEl, setHoveredEl] = useState(null);
  const [pinnedEl, setPinnedEl] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [pinnedVars, setPinnedVars] = useState([]);
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 });
  const overlayRef = useRef(null);

  // Extract CSS variables that affect a given DOM element (+ parents up to 6 levels)
  const extractCssVars = useCallback((el) => {
    if (!el) return [];
    const vars = [];
    const seen = new Set();
    const rootStyle = getComputedStyle(document.documentElement);

    // Scan an element's matching CSS rules for var(--xxx) references
    const scanElement = (targetEl, depth) => {
      const computed = getComputedStyle(targetEl);
      const tag = depth === 0 ? '(self)' : `(parent ×${depth})`;

      try {
        for (const sheet of document.styleSheets) {
          let rules;
          try { rules = sheet.cssRules || sheet.rules; } catch { continue; }
          if (!rules) continue;

          for (const rule of rules) {
            if (!rule.selectorText) continue;
            try {
              if (targetEl.matches(rule.selectorText)) {
                const ruleText = rule.cssText;
                const varMatches = ruleText.matchAll(/var\((--[\w-]+)/g);
                for (const m of varMatches) {
                  const varName = m[1];
                  if (!seen.has(varName)) {
                    seen.add(varName);
                    const val = computed.getPropertyValue(varName).trim() || rootStyle.getPropertyValue(varName).trim();
                    let propContext = 'unknown';
                    const escaped = varName.replace(/[-]/g, '\\-');
                    if (ruleText.match(new RegExp(`(?:background|background-color)\\s*:\\s*[^;]*var\\(${escaped}\\)`))) {
                      propContext = 'background';
                    } else if (ruleText.match(new RegExp(`(?:^|[^-])color\\s*:\\s*[^;]*var\\(${escaped}\\)`))) {
                      propContext = 'text color';
                    } else if (ruleText.match(new RegExp(`border[^:]*:\\s*[^;]*var\\(${escaped}\\)`))) {
                      propContext = 'border';
                    } else if (ruleText.match(new RegExp(`box-shadow\\s*:\\s*[^;]*var\\(${escaped}\\)`))) {
                      propContext = 'shadow';
                    } else if (ruleText.match(new RegExp(`accent-color\\s*:\\s*[^;]*var\\(${escaped}\\)`))) {
                      propContext = 'accent';
                    }
                    vars.push({
                      name: varName,
                      value: val,
                      context: propContext,
                      selector: rule.selectorText,
                      source: depth === 0 ? 'direct' : `inherited ${tag}`,
                    });
                  }
                }
              }
            } catch { /* selector match can fail */ }
          }
        }
      } catch { /* cross-origin sheets */ }
    };

    // Scan self + parents (up to 6 levels for good coverage)
    let current = el;
    for (let depth = 0; depth < 6 && current && current !== document.documentElement; depth++) {
      scanElement(current, depth);
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
          vars.push({ name: varName, value: val, context: 'inline', selector: 'inline', source: 'direct' });
        }
      }
    }

    return vars.sort((a, b) => a.name.localeCompare(b.name));

  }, []);

  // Hover handler
  const handleMouseMove = useCallback((e) => {
    if (!inspectorActive || pinnedEl) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    // Ignore the inspector overlay and its children
    if (!el || el.closest('.element_picker_overlay') || el.closest('.element_picker_panel')) return;
    setHoveredEl(el);
    setTooltipPos({ x: e.clientX, y: e.clientY });
  }, [inspectorActive, pinnedEl]);

  // Click handler — pin element
  const handleClick = useCallback((e) => {
    if (!inspectorActive) return;
    // If clicking inside the panel, let it through
    if (e.target.closest('.element_picker_panel')) return;
    e.preventDefault();
    e.stopPropagation();

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.closest('.element_picker_overlay') || el.closest('.element_picker_panel')) return;

    const vars = extractCssVars(el);
    setPinnedEl(el);
    setPinnedVars(vars);
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
    window.addEventListener('mousemove', handleMouseMove, true);
    window.addEventListener('click', handleClick, true);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('click', handleClick, true);
    };
  }, [inspectorActive, handleMouseMove, handleClick]);

  if (!inspectorActive) return null;

  // Hover outline box
  const hoverBox = hoveredEl && !pinnedEl ? (() => {
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
    return '#000000';
  };

  return (
    <>
      {/* Full screen cursor override */}
      <div className="element_picker_overlay" style={{ position: 'fixed', inset: 0, zIndex: 99998, cursor: 'crosshair', pointerEvents: 'none' }} />

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
      {hoveredEl && !pinnedEl && (
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
        <span className="element_picker_badge_hint">Hover & click any element • ESC to exit</span>
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
              <strong>CSS Variables</strong>
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
              pinnedVars.map((v) => {
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
                      {v.source !== 'direct' ? `⬆ ${v.source} · ` : ''}{v.selector.length > 50 ? v.selector.slice(0, 50) + '…' : v.selector}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </>
  );
}
