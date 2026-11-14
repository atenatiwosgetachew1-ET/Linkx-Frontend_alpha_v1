import { useEffect, useRef } from 'react';

const DEFAULT_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];

export function useIdleTimeout({
  enabled = true,
  warningMs = 12 * 60 * 1000,
  lockMs = 15 * 60 * 1000,
  timeoutMs = 30 * 60 * 1000,
  isLocked = false,
  // Changing it restarts the idle clock (production idleResetSeq: unlock,
  // logout and a fresh session start counting from now).
  resetKey = 0,
  onWarn,
  onLock,
  onTimeout,
}) {
  const lastActivityRef = useRef(Date.now());
  const hasWarnedRef = useRef(false);
  // Keep latest callbacks without re-subscribing listeners on every render.
  const callbacksRef = useRef({ onWarn, onLock, onTimeout });
  callbacksRef.current = { onWarn, onLock, onTimeout };

  useEffect(() => {
    if (!enabled) return undefined;
    // Unlocked (or reset): count from now, otherwise the time spent locked
    // re-locks the workspace on the next tick.
    if (!isLocked) {
      lastActivityRef.current = Date.now();
      hasWarnedRef.current = false;
    }

    const handleActivity = () => {
      if (!isLocked) {
        lastActivityRef.current = Date.now();
        hasWarnedRef.current = false;
      }
    };

    DEFAULT_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, handleActivity, { passive: true });
    });

    const intervalId = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastActivityRef.current;

      if (!isLocked) {
        if (elapsed >= warningMs && !hasWarnedRef.current) {
          hasWarnedRef.current = true;
          callbacksRef.current.onWarn?.();
        }
        if (elapsed >= lockMs) {
          callbacksRef.current.onLock?.();
        }
      } else {
        if (elapsed >= timeoutMs) {
          callbacksRef.current.onTimeout?.();
        }
      }
    }, 5000);

    return () => {
      DEFAULT_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, handleActivity);
      });
      clearInterval(intervalId);
    };
  }, [enabled, isLocked, warningMs, lockMs, timeoutMs, resetKey]);
}
