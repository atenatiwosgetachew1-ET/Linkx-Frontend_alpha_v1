import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { THEME_COMPONENT_CATEGORIES } from './themeCategories.js';
import { THEME_PRESETS } from './presets/index.js';
import {
  DEFAULT_THEME_ID,
  OVERRIDES_STORAGE_KEY,
  THEME_STORAGE_KEY,
  THEMES,
  isKnownTheme,
  readStoredOverrides,
} from './themeRegistry.js';
import { createLogger } from '../../shared/logger.js';

const log = createLogger('theme');


const ThemeContext = createContext();
const EMPTY_OVERRIDES = Object.freeze({});

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    return isKnownTheme(savedTheme) ? savedTheme : DEFAULT_THEME_ID;
  });

  // Overrides are scoped per theme so tuning one theme never leaks into another.
  const [overridesByTheme, setOverridesByTheme] = useState(() => readStoredOverrides(
    isKnownTheme(localStorage.getItem(THEME_STORAGE_KEY)) ? localStorage.getItem(THEME_STORAGE_KEY) : DEFAULT_THEME_ID
  ));
  const customOverrides = useMemo(() => overridesByTheme[theme] || EMPTY_OVERRIDES, [overridesByTheme, theme]);

  const setThemeOverrides = useCallback((themeId, updater) => {
    setOverridesByTheme((prev) => {
      const current = prev[themeId] || EMPTY_OVERRIDES;
      const next = typeof updater === 'function' ? updater(current) : updater;
      if (next === current) return prev;
      const result = { ...prev };
      if (!next || Object.keys(next).length === 0) delete result[themeId];
      else result[themeId] = next;
      return result;
    });
  }, []);

  const [inspectorActive, setInspectorActive] = useState(false);

  const setTheme = useCallback((newTheme) => {
    if (isKnownTheme(newTheme)) setThemeState(newTheme);
  }, []);

  const themeRef = useRef(theme);
  themeRef.current = theme;

  const setCustomVariable = useCallback((varName, value) => {
    setThemeOverrides(themeRef.current, (prev) => {
      const updated = { ...prev };
      if (value === undefined || value === null) delete updated[varName];
      else updated[varName] = value;
      return updated;
    });
  }, [setThemeOverrides]);

  const applyPreset = useCallback((preset) => {
    if (!preset) return;
    const targetTheme = isKnownTheme(preset.baseTheme) ? preset.baseTheme : themeRef.current;
    setThemeState(targetTheme);
    setThemeOverrides(targetTheme, { ...(preset.overrides || {}) });
  }, [setThemeOverrides]);

  const resetCustomOverrides = useCallback(() => setThemeOverrides(themeRef.current, {}), [setThemeOverrides]);

  const overridesRef = useRef(overridesByTheme);
  overridesRef.current = overridesByTheme;

  const exportThemeConfig = useCallback(
    () => JSON.stringify({ theme: themeRef.current, customOverrides: overridesRef.current[themeRef.current] || {} }, null, 2),
    []
  );

  const importThemeConfig = useCallback((jsonString) => {
    try {
      const parsed = JSON.parse(jsonString);
      const targetTheme = isKnownTheme(parsed.theme) ? parsed.theme : themeRef.current;
      setThemeState(targetTheme);
      if (parsed.customOverrides && typeof parsed.customOverrides === 'object') {
        setThemeOverrides(targetTheme, { ...parsed.customOverrides });
      }
      return true;
    } catch (e) {
      log.error('Failed to import theme configuration:', e);
      return false;
    }
  }, [setThemeOverrides]);

  const toggleInspector = useCallback(() => setInspectorActive((prev) => !prev), []);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  // Apply only the CSS variables that changed since the previous render.
  const appliedOverridesRef = useRef({});
  useEffect(() => {
    const rootStyle = document.documentElement.style;
    const previous = appliedOverridesRef.current;
    Object.keys(previous).forEach((key) => {
      if (!customOverrides[key]) rootStyle.removeProperty(key);
    });
    Object.entries(customOverrides).forEach(([key, val]) => {
      if (val && previous[key] !== val) rootStyle.setProperty(key, val);
    });
    appliedOverridesRef.current = customOverrides;
  }, [customOverrides]);

  // Debounced persistence: color pickers fire many changes per second.
  const persistOverrides = useCallback(() => {
    localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(overridesRef.current));
  }, []);

  useEffect(() => {
    const timer = setTimeout(persistOverrides, 300);
    return () => clearTimeout(timer);
  }, [overridesByTheme, persistOverrides]);

  useEffect(() => {
    window.addEventListener('pagehide', persistOverrides);
    return () => {
      window.removeEventListener('pagehide', persistOverrides);
      persistOverrides();
    };
  }, [persistOverrides]);

  const value = useMemo(() => ({
    theme,
    setTheme,
    themes: THEMES,
    categories: THEME_COMPONENT_CATEGORIES,
    customOverrides,
    setCustomVariable,
    resetCustomOverrides,
    presets: THEME_PRESETS,
    applyPreset,
    exportThemeConfig,
    importThemeConfig,
    inspectorActive,
    toggleInspector,
  }), [
    theme, setTheme, customOverrides, setCustomVariable, resetCustomOverrides, applyPreset,
    exportThemeConfig, importThemeConfig, inspectorActive, toggleInspector,
  ]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

