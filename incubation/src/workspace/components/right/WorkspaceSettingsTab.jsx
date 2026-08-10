import React from 'react';
import { useTheme } from '../../../shared/theme/ThemeContext.jsx';
import { useBackgroundAnimations } from '../../../utils/backgroundAnimations.js';

export default function WorkspaceSettingsTab() {
  const { theme, setTheme, themes } = useTheme();
  const { areBackgroundAnimationsEnabled, setBackgroundAnimationsEnabled } = useBackgroundAnimations();

  return (
    <div className="workspace_context_settings_wrapper">
      {/* Theme Studio Picker Grid Section */}
      <section className="workspace_context_section" aria-label="Theme settings">
        <h2>Appearance & Theme</h2>
        <div className="workspace_theme_picker_grid">
          {themes.map((t) => (
            <button
              key={t.id}
              type="button"
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
      </section>

      {/* Visual Effects Motion Controls Section */}
      <section className="workspace_context_section" aria-label="Visual effects settings">
        <h2>Visual Effects</h2>
        <div className="workspace_context_form_stack">
          <label className="workspace_context_switch">
            <input
              type="checkbox"
              checked={areBackgroundAnimationsEnabled}
              onChange={(e) => setBackgroundAnimationsEnabled(e.target.checked)}
            />
            <span>Background Motion Effects</span>
          </label>
        </div>
      </section>

      {/* Graph Physics & Engine Settings Section */}
      <section className="workspace_context_section" aria-label="Graph settings">
        <h2>Graph Settings</h2>
        <div className="workspace_context_form_stack">
          <label className="workspace_context_switch">
            <input type="checkbox" disabled />
            <span>Show node labels</span>
          </label>
          <label className="workspace_context_switch">
            <input type="checkbox" disabled />
            <span>Enable graph physics</span>
          </label>
          <label>
            <span>Layout algorithm</span>
            <select disabled defaultValue="directed">
              <option value="directed">Force Directed</option>
            </select>
          </label>
        </div>
      </section>
    </div>
  );
}
