import React, { useEffect, useMemo, useState } from 'react';

import ThemePicker from '../../../../shared/theme/ThemePicker.jsx';
import { useTheme } from '../../../../shared/theme/ThemeContext.jsx';
import { hexAlphaToOutput, parseColorToHexAlpha } from '../../lib/settingsModel.js';

export function ColorAlphaPicker({ value, onChange }) {
  const parsed = parseColorToHexAlpha(value);
  const [hex, setHex] = React.useState(parsed.hex);
  const [alpha, setAlpha] = React.useState(parsed.alpha);
  const [rawText, setRawText] = React.useState(value);

  // Sync from parent when value changes externally
  React.useEffect(() => {
    const p = parseColorToHexAlpha(value);
    setHex(p.hex);
    setAlpha(p.alpha);
    setRawText(value);
  }, [value]);

  const emitChange = (newHex, newAlpha) => {
    const out = hexAlphaToOutput(newHex, newAlpha);
    setRawText(out);
    onChange(out);
  };

  return (
    <div className="theme_studio_color_alpha">
      <div
        className="theme_studio_swatch_preview"
        style={{ background: (rawText && rawText.includes('gradient')) ? rawText : hexAlphaToOutput(hex, alpha) }}
      />
      <input
        type="color"
        className="theme_studio_color_swatch"
        value={hex}
        onChange={(e) => { setHex(e.target.value); emitChange(e.target.value, alpha); }}
      />
      <div className="theme_studio_alpha_wrap">
        <label className="theme_studio_alpha_label">α</label>
        <input
          type="range"
          className="theme_studio_range_slider"
          min="0"
          max="1"
          step="0.01"
          value={alpha}
          onChange={(e) => { const a = parseFloat(e.target.value); setAlpha(a); emitChange(hex, a); }}
        />
        <span className="theme_studio_alpha_value">{Math.round(alpha * 100)}%</span>
      </div>
      <input
        type="text"
        className="settings_input theme_studio_hex_input"
        value={rawText}
        onChange={(e) => { setRawText(e.target.value); onChange(e.target.value); }}
        placeholder="#hex, rgba(...), or linear-gradient(...)"
      />
    </div>
  );
}

export function LiveThemeCustomizerStudio() {
  const { categories, customOverrides, setCustomVariable, resetCustomOverrides, exportThemeConfig, importThemeConfig, inspectorActive, toggleInspector } = useTheme();
  const [selectedCategoryId, setSelectedCategoryId] = useState(categories[0]?.id || 'shell');
  const [searchQuery, setSearchQuery] = useState('');
  const [importJson, setImportJson] = useState('');
  const [copyNotice, setCopyNotice] = useState('');

  const selectedCategory = useMemo(
    () => categories.find((cat) => cat.id === selectedCategoryId) || categories[0],
    [categories, selectedCategoryId]
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  // Match counts per category when searching
  const categoryMatchCounts = useMemo(() => {
    if (!normalizedQuery) return {};
    const counts = {};
    categories.forEach((cat) => {
      const matchingTokens = cat.tokens.filter(
        (t) =>
          t.label.toLowerCase().includes(normalizedQuery) ||
          t.key.toLowerCase().includes(normalizedQuery)
      );
      counts[cat.id] = matchingTokens.length;
    });
    return counts;
  }, [categories, normalizedQuery]);

  // Auto-switch to first category with matching items if current category has 0 matches
  useEffect(() => {
    if (!normalizedQuery) return;
    const currentCount = categoryMatchCounts[selectedCategoryId] || 0;
    if (currentCount === 0) {
      const firstMatchingCat = categories.find((cat) => (categoryMatchCounts[cat.id] || 0) > 0);
      if (firstMatchingCat) {
        setSelectedCategoryId(firstMatchingCat.id);
      }
    }
  }, [normalizedQuery, categoryMatchCounts, selectedCategoryId, categories]);

  // Filter visible tokens within selected category
  const visibleTokens = useMemo(() => {
    if (!selectedCategory) return [];
    if (!normalizedQuery) return selectedCategory.tokens;
    return selectedCategory.tokens.filter(
      (t) =>
        t.label.toLowerCase().includes(normalizedQuery) ||
        t.key.toLowerCase().includes(normalizedQuery)
    );
  }, [selectedCategory, normalizedQuery]);

  const rootStyle = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const getEffectiveValue = (token) => {
    if (customOverrides[token.key]) return customOverrides[token.key];
    if (rootStyle) {
      const computed = rootStyle.getPropertyValue(token.key).trim();
      if (computed && (computed.startsWith('#') || computed.startsWith('rgb'))) return computed;
    }
    return token.default || '#000000';
  };

  const handleColorChange = (key, hexColor) => {
    setCustomVariable(key, hexColor);
  };

  const handleExport = () => {
    const json = exportThemeConfig();
    navigator.clipboard?.writeText(json);
    setCopyNotice('Theme JSON configuration copied to clipboard!');
    setTimeout(() => setCopyNotice(''), 3500);
  };

  const handleImport = () => {
    if (!importJson.trim()) return;
    const success = importThemeConfig(importJson);
    if (success) {
      setImportJson('');
      setCopyNotice('Custom theme imported successfully!');
      setTimeout(() => setCopyNotice(''), 3500);
    } else {
      setCopyNotice('Failed to import JSON configuration.');
      setTimeout(() => setCopyNotice(''), 3500);
    }
  };

  return (
    <div className="theme_studio_container">
      <div className="theme_studio_header">
        <div>
          <h4>🎨 Live Theme Studio & Component Customizer</h4>
          <p>Select any component category below to adjust its live colors, backgrounds, and borders in real-time.</p>
        </div>
        <div className="theme_studio_actions">
          <button type="button" className={`workspace_button ${inspectorActive ? 'workspace_button_primary' : 'workspace_button_secondary'}`} onClick={toggleInspector}>
            🔍 {inspectorActive ? 'Picker Active' : 'Element Picker'}
          </button>
          <button type="button" className="workspace_button workspace_button_secondary" onClick={handleExport}>
            📥 Export Config
          </button>
          <button type="button" className="workspace_button workspace_button_secondary" onClick={resetCustomOverrides}>
            🔄 Reset Overrides
          </button>
        </div>
      </div>

      {copyNotice && <div className="theme_studio_notice">{copyNotice}</div>}

      {/* Base Theme Preset Selection */}
      <div className="theme_studio_base_row">
        <label className="settings_label">Active Theme Preset Base:</label>
        <ThemePicker variant="pills" />
      </div>

      {/* Customization Items Search Box */}
      <div className="theme_studio_search_row">
        <div className="theme_studio_search_input_wrapper">
          <span className="theme_studio_search_icon">🔍</span>
          <input
            type="text"
            className="settings_input theme_studio_search_input"
            placeholder="Search customization items (e.g. Session, Gradient, Opacity, Card, Text, Border)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="theme_studio_search_clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="theme_studio_category_tabs">
        {categories.map((cat) => {
          const matchCount = categoryMatchCounts[cat.id];
          return (
            <button
              key={cat.id}
              type="button"
              className={`theme_studio_cat_btn ${selectedCategoryId === cat.id ? 'is-active' : ''}`}
              onClick={() => setSelectedCategoryId(cat.id)}
            >
              <span>{cat.name}</span>
              {normalizedQuery && matchCount > 0 && (
                <span className="theme_studio_cat_badge">{matchCount}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected Category Token Editor */}
      {selectedCategory && (
        <div className="theme_studio_token_card">
          <div className="theme_studio_card_info">
            <h5>{selectedCategory.name}</h5>
            <p>{selectedCategory.description}</p>
          </div>

          {visibleTokens.length === 0 ? (
            <div className="theme_studio_empty_search">
              <p>No customization items matching "<strong>{searchQuery}</strong>" in <em>{selectedCategory.name}</em>.</p>
              {Object.values(categoryMatchCounts).some((count) => count > 0) && (
                <p className="theme_studio_search_hint">
                  💡 Try switching category tabs above to view matching results in other categories.
                </p>
              )}
            </div>
          ) : (
            <div className="theme_studio_token_grid">
              {visibleTokens.map((token) => {
                const currentValue = getEffectiveValue(token);
                const isOverridden = Boolean(customOverrides[token.key]);

                return (
                  <div key={token.key} className={`theme_studio_token_row ${isOverridden ? 'is-overridden' : ''}`}>
                    <div className="theme_studio_token_label">
                      <strong>{token.label}</strong>
                      <code>{token.key}</code>
                    </div>

                    <div className="theme_studio_token_controls">
                      {token.type === 'range' ? (
                        <>
                          <input
                            type="range"
                            className="theme_studio_range_slider"
                            min="0"
                            max="1"
                            step="0.01"
                            value={parseFloat(currentValue) || 0}
                            onChange={(e) => handleColorChange(token.key, e.target.value)}
                          />
                          <input
                            type="text"
                            className="settings_input theme_studio_hex_input"
                            value={currentValue}
                            onChange={(e) => handleColorChange(token.key, e.target.value)}
                            placeholder="0.0 — 1.0"
                            style={{ maxWidth: 64 }}
                          />
                        </>
                      ) : token.type === 'text' ? (
                        <input
                          type="text"
                          className="settings_input theme_studio_hex_input"
                          value={currentValue}
                          onChange={(e) => handleColorChange(token.key, e.target.value)}
                          placeholder={token.placeholder || 'e.g. 180deg, 45deg'}
                          style={{ minWidth: 120, flex: '1 1 120px' }}
                        />
                      ) : (
                        <ColorAlphaPicker
                          value={currentValue}
                          onChange={(val) => handleColorChange(token.key, val)}
                        />
                      )}
                      {isOverridden && (
                        <button
                          type="button"
                          className="theme_studio_reset_btn"
                          title="Reset token override"
                          onClick={() => handleColorChange(token.key, undefined)}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* JSON Import Section */}
      <div className="theme_studio_import_card">
        <h5>📥 Import Theme Configuration JSON</h5>
        <div className="theme_studio_import_row">
          <textarea
            className="settings_input theme_studio_json_area"
            rows={2}
            placeholder='Paste JSON configuration here... (e.g. {"theme": "nbe-daylight", "customOverrides": {"--app-bg": "#F4F7FA"}})'
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
          />
          <button type="button" className="workspace_button workspace_button_primary" onClick={handleImport}>
            Apply Import
          </button>
        </div>
      </div>
    </div>
  );
}
