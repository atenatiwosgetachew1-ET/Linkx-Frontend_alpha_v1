import React, { createContext, useContext, useEffect, useState } from 'react';
import { THEME_COMPONENT_CATEGORIES } from './themeCategories.js';

export const THEMES = [
  { id: 'nbe-daylight', name: 'NBE Daylight', description: 'Bright golden & dark blue master skin (#f6efea / #131e2a / #FCC676)', previewColor: '#FCC676' },
  { id: 'dark', name: 'Deep Space', description: 'Classic dark sci-fi HUD with cyan accents (#131e2a)', previewColor: '#1c98a5' },
  { id: 'emerald-dark', name: 'Emerald Dark', description: 'Deep forest dark slate with emerald accents (#0a1c17)', previewColor: '#10b981' },
  { id: 'cyberpunk', name: 'Cyberpunk Neon', description: 'Neon dark violet with magenta accents (#0b071a)', previewColor: '#ff007f' },
  { id: 'solarized-dark', name: 'Solarized Dark', description: 'Deep solarized teal with amber accents (#002b36)', previewColor: '#b58900' },
  { id: 'light-clean', name: 'Daylight Clean', description: 'Bright slate layout with crisp teal accents (#f4f7fa)', previewColor: '#0d9488' },
  { id: 'solarized-light', name: 'Solarized Light', description: 'Warm solarized cream with blue & amber accents (#fdf6e3)', previewColor: '#268bd2' },
  { id: 'nbe-darknight', name: 'NBE Darknight', description: 'Midnight enterprise dark layout with sky blue & gold accents (#0f172a)', previewColor: '#38bdf8' },
];

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('linkx_theme_mode');
      if (savedTheme && THEMES.some((t) => t.id === savedTheme)) {
        return savedTheme;
      }
    }
    return 'nbe-daylight';
  });

  const [customOverrides, setCustomOverrides] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedOverrides = localStorage.getItem('linkx_theme_custom_overrides');
        return savedOverrides ? JSON.parse(savedOverrides) : {};
      } catch {
        return {};
      }
    }
    return {};
  });

  const [inspectorActive, setInspectorActive] = useState(false);

  const setTheme = (newTheme) => {
    if (THEMES.some((t) => t.id === newTheme)) {
      setThemeState(newTheme);
    }
  };

  const setCustomVariable = (varName, value) => {
    setCustomOverrides((prev) => {
      const updated = { ...prev };
      if (value === undefined || value === null) {
        delete updated[varName];
      } else {
        updated[varName] = value;
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem('linkx_theme_custom_overrides', JSON.stringify(updated));
      }
      return updated;
    });
  };

  const resetCustomOverrides = () => {
    setCustomOverrides({});
    if (typeof window !== 'undefined') {
      localStorage.removeItem('linkx_theme_custom_overrides');
      // Remove inline style properties from root element
      Object.keys(customOverrides).forEach((key) => {
        document.documentElement.style.removeProperty(key);
      });
    }
  };

  const exportThemeConfig = () => {
    return JSON.stringify({ theme, customOverrides }, null, 2);
  };

  const importThemeConfig = (jsonString) => {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed.theme && THEMES.some((t) => t.id === parsed.theme)) {
        setTheme(parsed.theme);
      }
      if (parsed.customOverrides && typeof parsed.customOverrides === 'object') {
        setCustomOverrides(parsed.customOverrides);
        if (typeof window !== 'undefined') {
          localStorage.setItem('linkx_theme_custom_overrides', JSON.stringify(parsed.customOverrides));
        }
      }
      return true;
    } catch (e) {
      console.error('Failed to import theme configuration:', e);
      return false;
    }
  };

  const toggleInspector = () => setInspectorActive((prev) => !prev);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('linkx_theme_mode', theme);

      // Apply custom variable overrides directly to documentElement style
      Object.entries(customOverrides).forEach(([key, val]) => {
        if (val) {
          document.documentElement.style.setProperty(key, val);
        } else {
          document.documentElement.style.removeProperty(key);
        }
      });
    }
  }, [theme, customOverrides]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        themes: THEMES,
        categories: THEME_COMPONENT_CATEGORIES,
        customOverrides,
        setCustomVariable,
        resetCustomOverrides,
        exportThemeConfig,
        importThemeConfig,
        inspectorActive,
        toggleInspector,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

