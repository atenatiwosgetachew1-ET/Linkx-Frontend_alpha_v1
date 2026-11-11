import React from 'react';

import { useTheme } from './ThemeContext.jsx';

/**
 * Shared theme selector used by every theme surface (context panel, right
 * settings tab, settings window).
 *  - variant "cards": descriptive grid; "pills": compact row.
 *  - showPresets: also list repo-committed presets (src/shared/theme/presets).
 */
export default function ThemePicker({ variant = 'cards', showPresets = false }) {
  const { theme, setTheme, themes, presets, applyPreset } = useTheme();

  const themeList = variant === 'pills' ? (
    <div className="theme_studio_preset_pills" role="radiogroup" aria-label="Theme">
      {themes.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={theme === t.id}
          className={`theme_studio_pill ${theme === t.id ? 'is-active' : ''}`}
          onClick={() => setTheme(t.id)}
        >
          <span className="theme_studio_pill_dot" style={{ backgroundColor: t.previewColor }} />
          <span>{t.name}</span>
        </button>
      ))}
    </div>
  ) : (
    <div className="workspace_theme_picker_grid" role="radiogroup" aria-label="Theme">
      {themes.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={theme === t.id}
          className={`workspace_theme_option ${theme === t.id ? 'is-selected' : ''}`}
          onClick={() => setTheme(t.id)}
        >
          <div className="workspace_theme_preview_header">
            <span className="workspace_theme_color_badge" style={{ backgroundColor: t.previewColor }} />
            <span className="workspace_theme_name">{t.name}</span>
            {theme === t.id && <span className="workspace_theme_active_badge">Active</span>}
          </div>
          <small className="workspace_theme_desc">{t.description}</small>
        </button>
      ))}
    </div>
  );

  if (!showPresets) return themeList;

  return (
    <>
      {themeList}
      <h3 className="workspace_context_subheading">Custom presets</h3>
      {presets.length === 0 ? (
        <p className="workspace_context_hint">
          No presets committed yet. Use “Save current as preset…”, then drop the file into
          <code> src/shared/theme/presets/</code> and commit it.
        </p>
      ) : (
        <div className="workspace_preset_list">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="workspace_preset_option"
              onClick={() => applyPreset(preset)}
            >
              <strong>{preset.name}</strong>
              {preset.description && <small>{preset.description}</small>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
