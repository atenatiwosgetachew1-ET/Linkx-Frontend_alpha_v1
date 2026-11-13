import React, { useEffect, useState } from 'react';

import { useGlassEffects } from '../../../../utils/glassEffects.js';
import { SETTINGS_STORAGE_KEYS } from '../../lib/settingsModel.js';
import { LiveThemeCustomizerStudio } from '../theme/ThemeStudio.jsx';

export function PreferencesPanel({ areBackgroundAnimationsEnabled, setBackgroundAnimationsEnabled }) {
  const [rememberLayout, setRememberLayout] = useState(() => localStorage.getItem(SETTINGS_STORAGE_KEYS.rememberLayout) !== 'false');
  const [enableNotifications, setEnableNotifications] = useState(() => localStorage.getItem(SETTINGS_STORAGE_KEYS.enableNotifications) !== 'false');
  const { areGlassEffectsEnabled, setGlassEffectsEnabled } = useGlassEffects();

  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEYS.rememberLayout, String(rememberLayout));
  }, [rememberLayout]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEYS.enableNotifications, String(enableNotifications));
  }, [enableNotifications]);

  return (
    <section className="settings_section">
      <div className="settings_section_header">
        <div>
          <h3>Preferences</h3>
          <p>Local workspace behavior and visual preferences.</p>
        </div>
      </div>
      <div className="settings_toggle_list">
        <label className="settings_toggle_row">
          <input type="checkbox" checked={rememberLayout} onChange={(event) => setRememberLayout(event.target.checked)} />
          <span>Remember window layout</span>
        </label>
        <label className="settings_toggle_row">
          <input type="checkbox" checked={enableNotifications} onChange={(event) => setEnableNotifications(event.target.checked)} />
          <span>Enable notifications</span>
        </label>
        <label className="settings_toggle_row">
          <input type="checkbox" checked={areBackgroundAnimationsEnabled} onChange={(event) => setBackgroundAnimationsEnabled(event.target.checked)} />
          <span>Enable background animations</span>
        </label>
        <label className="settings_toggle_row">
          <input type="checkbox" checked={areGlassEffectsEnabled} onChange={(event) => setGlassEffectsEnabled(event.target.checked)} />
          <span>Enable glass blur effects</span>
        </label>
      </div>

      <LiveThemeCustomizerStudio />
    </section>
  );
}
