import { useCallback, useEffect, useState } from "react";

// Keep in sync with the boot script in index.html.
export const glassEffectsPreferenceKey = "linkx_enable_glass_effects";
export const glassEffectsPreferenceEvent = "linkx_glass_effects_preference_change";

export function readGlassEffectsPreference() {
  try {
    return localStorage.getItem(glassEffectsPreferenceKey) === "true";
  } catch {
    return false;
  }
}

function applyGlassEffects(enabled) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.glass = enabled ? "on" : "off";
}

export function writeGlassEffectsPreference(enabled) {
  try {
    localStorage.setItem(glassEffectsPreferenceKey, String(enabled));
  } catch {
    // Ignore unavailable storage; still apply to the current document.
  }
  applyGlassEffects(enabled);
  window.dispatchEvent(new CustomEvent(glassEffectsPreferenceEvent, { detail: { enabled } }));
}

export function useGlassEffects() {
  const [areGlassEffectsEnabled, setAreGlassEffectsEnabled] = useState(readGlassEffectsPreference);

  useEffect(() => {
    const sync = (event) => {
      const enabled = typeof event?.detail?.enabled === "boolean"
        ? event.detail.enabled
        : readGlassEffectsPreference();
      applyGlassEffects(enabled);
      setAreGlassEffectsEnabled(enabled);
    };
    window.addEventListener("storage", sync);
    window.addEventListener(glassEffectsPreferenceEvent, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(glassEffectsPreferenceEvent, sync);
    };
  }, []);

  const setGlassEffectsEnabled = useCallback((enabled) => {
    const normalized = !!enabled;
    setAreGlassEffectsEnabled(normalized);
    writeGlassEffectsPreference(normalized);
  }, []);

  return { areGlassEffectsEnabled, setGlassEffectsEnabled };
}
