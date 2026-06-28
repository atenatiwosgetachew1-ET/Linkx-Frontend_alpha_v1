import { useCallback, useEffect, useState } from "react";

export const backgroundAnimationPreferenceKey = "linkx_enable_background_animations";
export const backgroundAnimationPreferenceEvent = "linkx_background_animation_preference_change";

export function readBackgroundAnimationPreference() {
  try {
    if (typeof window === "undefined" || typeof localStorage === "undefined") return false;

    const storedPreference = localStorage.getItem(backgroundAnimationPreferenceKey);
    if (storedPreference !== null) return storedPreference !== "false";

    return false;
  } catch {
    return false;
  }
}

export function writeBackgroundAnimationPreference(enabled) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(backgroundAnimationPreferenceKey, String(enabled));
    }
  } catch {
    // Ignore unavailable storage; still notify the current document.
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(backgroundAnimationPreferenceEvent, { detail: { enabled } })
    );
  }
}

export function useBackgroundAnimations() {
  const [areBackgroundAnimationsEnabled, setAreBackgroundAnimationsEnabled] = useState(readBackgroundAnimationPreference);

  useEffect(() => {
    const syncBackgroundPreference = (event) => {
      const enabled = typeof event?.detail?.enabled === "boolean"
        ? event.detail.enabled
        : readBackgroundAnimationPreference();

      setAreBackgroundAnimationsEnabled(enabled);
    };

    window.addEventListener("storage", syncBackgroundPreference);
    window.addEventListener(backgroundAnimationPreferenceEvent, syncBackgroundPreference);

    return () => {
      window.removeEventListener("storage", syncBackgroundPreference);
      window.removeEventListener(backgroundAnimationPreferenceEvent, syncBackgroundPreference);
    };
  }, []);

  const setBackgroundAnimationsEnabled = useCallback((enabled) => {
    const normalizedEnabled = !!enabled;
    setAreBackgroundAnimationsEnabled(normalizedEnabled);
    writeBackgroundAnimationPreference(normalizedEnabled);
  }, []);

  return { areBackgroundAnimationsEnabled, setBackgroundAnimationsEnabled };
}
