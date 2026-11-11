import React, { useRef } from 'react';
import { useTheme } from '../../../shared/theme/ThemeContext.jsx';
import ThemePicker from '../../../shared/theme/ThemePicker.jsx';
import { useBackgroundAnimations } from '../../../utils/backgroundAnimations.js';
import { useGlassEffects } from '../../../utils/glassEffects.js';

export default function WorkspaceSettingsTab() {
  const {
    theme,
    customOverrides,
    inspectorActive,
    toggleInspector,
    resetCustomOverrides,
    exportThemeConfig,
    importThemeConfig,
  } = useTheme();
  const { areBackgroundAnimationsEnabled, setBackgroundAnimationsEnabled } = useBackgroundAnimations();
  const { areGlassEffectsEnabled, setGlassEffectsEnabled } = useGlassEffects();
  const importInputRef = useRef(null);

  const overrideCount = Object.keys(customOverrides || {}).length;

  const handleExportTheme = () => {
    const config = exportThemeConfig();
    const blob = new Blob([config], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `linkx-theme-${theme}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleImportTheme = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importThemeConfig(String(reader.result || ''));
    reader.readAsText(file);
  };

  const handleSaveAsPreset = () => {
    const name = window.prompt('Name this preset:', 'My Theme');
    if (!name || !name.trim()) return;
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'preset';
    const preset = {
      id,
      name: name.trim(),
      description: `Saved ${new Date().toISOString().slice(0, 10)} from the "${theme}" theme.`,
      baseTheme: theme,
      overrides: customOverrides || {},
    };
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${id}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="workspace_context_settings_wrapper">
      {/* Theme Studio Picker Grid Section */}
      <section className="workspace_context_section" aria-label="Theme settings">
        <h2>Appearance & Theme</h2>
        <ThemePicker showPresets />
      </section>

      {/* Theme Studio: element picker, custom override management, portable export/import */}
      <section className="workspace_context_section" aria-label="Theme studio tools">
        <h2>Theme Studio</h2>
        <p className="workspace_context_hint">
          {overrideCount > 0
            ? `${overrideCount} custom color override${overrideCount === 1 ? '' : 's'} active.`
            : 'No custom color overrides yet.'}
        </p>
        <div className="workspace_context_button_row">
          <button
            type="button"
            className={`workspace_context_button ${inspectorActive ? 'is-active' : ''}`}
            onClick={toggleInspector}
          >
            {inspectorActive ? 'Exit Element Picker' : 'Launch Element Picker'}
          </button>
          <button type="button" className="workspace_context_button" onClick={handleExportTheme}>
            Export Theme
          </button>
          <button
            type="button"
            className="workspace_context_button"
            onClick={() => importInputRef.current?.click()}
          >
            Import Theme
          </button>
          <button type="button" className="workspace_context_button" onClick={handleSaveAsPreset}>
            Save current as preset…
          </button>
          <button
            type="button"
            className="workspace_context_button is-danger"
            onClick={resetCustomOverrides}
            disabled={overrideCount === 0}
          >
            Reset Overrides
          </button>
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportTheme}
          style={{ display: 'none' }}
        />
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
          <label className="workspace_context_switch">
            <input
              type="checkbox"
              checked={areGlassEffectsEnabled}
              onChange={(e) => setGlassEffectsEnabled(e.target.checked)}
            />
            <span>Glass Blur Effects</span>
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
