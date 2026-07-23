import { useEffect, useRef } from 'react';

const DEFAULT_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];

export function useIdleTimeout({
  enabled = true,
  warningMs = 12 * 60 * 1000,
  lockMs = 15 * 60 * 1000,
  timeoutMs = 30 * 60 * 1000,
  isLocked = false,
  onWarn,
  onLock,
  onTimeout,
}) {
  const lastActivityRef = useRef(Date.now());
  const hasWarnedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;

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
          onWarn?.();
        }
        if (elapsed >= lockMs) {
          onLock?.();
        }
      } else {
        if (elapsed >= timeoutMs) {
          onTimeout?.();
        }
      }
    }, 5000);

    return () => {
      DEFAULT_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, handleActivity);
      });
      clearInterval(intervalId);
    };
  }, [enabled, isLocked, warningMs, lockMs, timeoutMs, onWarn, onLock, onTimeout]);
}
