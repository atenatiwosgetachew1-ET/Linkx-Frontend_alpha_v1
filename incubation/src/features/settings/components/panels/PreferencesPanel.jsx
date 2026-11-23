import React, { useEffect, useState } from 'react';

import { useGlassEffects } from '../../../../utils/glassEffects.js';
import { SETTINGS_STORAGE_KEYS } from '../../lib/settingsModel.js';
import { LiveThemeCustomizerStudio } from '../theme/ThemeStudio.jsx';
import { Masthead, Option, PageHero, SettingsPage, Stat, Stats } from '../SettingsPage.jsx';
import { DEFAULT_THEME_ID, THEMES } from '../../../../shared/theme/themeRegistry.js';

// The active theme (the <html> data-theme attribute), following its changes.
const readThemeId = () => document.documentElement.getAttribute('data-theme') || DEFAULT_THEME_ID;
function useActiveTheme() {
  const [themeId, setThemeId] = useState(readThemeId);
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeId(readThemeId()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return THEMES.find((theme) => theme.id === themeId) || { id: themeId, name: themeId, colorScheme: '' };
}

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

  const options = [
    { icon: 'layout', title: 'Remember window layout', description: 'Keep window positions and sizes between visits.', checked: rememberLayout, onChange: setRememberLayout },
    { icon: 'bell', title: 'Enable notifications', description: 'Show notices from the workspace.', checked: enableNotifications, onChange: setEnableNotifications },
    { icon: 'motion', title: 'Enable background animations', description: 'Animate the workspace background.', checked: areBackgroundAnimationsEnabled, onChange: setBackgroundAnimationsEnabled },
    { icon: 'glass', title: 'Enable glass blur effects', description: 'Blur what lies behind translucent panels.', checked: areGlassEffectsEnabled, onChange: setGlassEffectsEnabled },
  ];
  const onCount = options.filter((option) => option.checked).length;
  const theme = useActiveTheme();

  return (
    <SettingsPage>
      <Masthead>
        <PageHero
          eyebrow="Preferences"
          title="Workspace behaviour"
          meta="Local workspace behavior and visual preferences, kept in this browser."
          media={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
            </svg>
          )}
        />
        <Stats label="Preference figures" columns={4}>
          <Stat lead icon="check" label="Enabled" value={onCount.toLocaleString()} note={`of ${options.length} options`} />
          <Stat icon="sun" label="Theme" value={theme.name} note="active theme" />
          <Stat icon="layers" label="Scheme" value={theme.colorScheme === 'dark' ? 'Dark' : theme.colorScheme === 'light' ? 'Light' : 'Custom'} note="colour scheme" />
          <Stat icon="database" label="Kept in" value="This browser" note="not synced to the account" />
        </Stats>
      </Masthead>

      <div className="settings_options" role="group" aria-label="Preferences">
        {options.map((option) => <Option key={option.title} {...option} />)}
      </div>

      <LiveThemeCustomizerStudio />
    </SettingsPage>
  );
}
