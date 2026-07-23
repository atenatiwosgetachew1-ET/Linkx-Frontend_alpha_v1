import React, { createContext, useContext, useEffect, useState } from 'react';

export const THEMES = [
  { id: 'dark', name: 'Deep Space', description: 'Classic dark sci-fi HUD with cyan accents', previewColor: '#5a8fc2' },
  { id: 'cyberpunk', name: 'Cyber Neon', description: 'Vibrant electric cyan & neon blue glow', previewColor: '#00f0ff' },
  { id: 'matrix', name: 'Emerald Matrix', description: 'Tactical green high-contrast interface', previewColor: '#00ff66' },
  { id: 'obsidian', name: 'Obsidian Void', description: 'Stealth deep dark violet & purple glow', previewColor: '#a855f7' },
  { id: 'gold', name: 'Solar Flare', description: 'Amber tactical command interface', previewColor: '#ffaa00' },
  { id: 'light', name: 'Bright Slate', description: 'High legibility bright workspace theme', previewColor: '#37618c' },
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
    return 'dark';
  });

  const setTheme = (newTheme) => {
    if (THEMES.some((t) => t.id === newTheme)) {
      setThemeState(newTheme);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('linkx_theme_mode', theme);
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
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
