import React, { useEffect, useRef } from 'react';

import { useBackgroundAnimations } from '../../utils/backgroundAnimations.js';

const NODE_COUNT = 65;
const CONNECTION_DIST = 160;
const CONNECTION_DIST_SQ = CONNECTION_DIST * CONNECTION_DIST;
const NODE_MIN_R = 1.2;
const NODE_MAX_R = 2.8;
const SPEED_FACTOR = 0.18;
const FRAME_INTERVAL_MS = 1000 / 30;
const ALPHA_BUCKETS = 8;
const TWO_PI = Math.PI * 2;

function readColors() {
  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    node: read('--network-node-color', 'rgba(252, 198, 118, 0.55)'),
    edge: read('--network-edge-color', 'rgba(174, 135, 79, 0.12)'),
    glow: read('--network-glow-color', 'rgba(252, 198, 118, 0.08)'),
  };
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return undefined;
    const onChange = (event) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * NetworkBackground — node & edge graph behind the workspace.
 * Colors come from CSS variables so the Theme Studio can control them.
 * Animates only when background animations are enabled, motion is allowed
 * and the tab is visible; otherwise a single static frame is drawn.
 */
// `paused`: hold a still frame (e.g. while a Graph window is active, so the
// background does not compete with the graph for frames).
function NetworkBackground({ paused = false }) {
  const canvasRef = useRef(null);
  const { areBackgroundAnimationsEnabled } = useBackgroundAnimations();
  const prefersReducedMotion = usePrefersReducedMotion();
  const shouldAnimate = areBackgroundAnimationsEnabled && !prefersReducedMotion && !paused;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');

    let width = canvas.offsetWidth;
    let height = canvas.offsetHeight;
    let colors = readColors();
    let frameId = null;
    let lastFrameTime = 0;
    const buckets = Array.from({ length: ALPHA_BUCKETS }, () => []);

    const nodes = Array.from({ length: NODE_COUNT }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * SPEED_FACTOR,
      vy: (Math.random() - 0.5) * SPEED_FACTOR,
      r: NODE_MIN_R + Math.random() * (NODE_MAX_R - NODE_MIN_R),
      pulse: Math.random() * TWO_PI,
      pulseSpeed: 0.008 + Math.random() * 0.012,
    }));

    const step = (delta) => {
      for (const node of nodes) {
        node.x += node.vx * delta;
        node.y += node.vy * delta;
        node.pulse += node.pulseSpeed * delta;
        if (node.x < 0 || node.x > width) node.vx *= -1;
        if (node.y < 0 || node.y > height) node.vy *= -1;
        node.x = Math.max(0, Math.min(width, node.x));
        node.y = Math.max(0, Math.min(height, node.y));
      }
    };

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      for (const bucket of buckets) bucket.length = 0;
      for (let i = 0; i < NODE_COUNT; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < NODE_COUNT; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < CONNECTION_DIST_SQ) {
            const opacity = 1 - Math.sqrt(distSq) / CONNECTION_DIST;
            const index = Math.min(ALPHA_BUCKETS - 1, Math.floor(opacity * ALPHA_BUCKETS));
            buckets[index].push(a.x, a.y, b.x, b.y);
          }
        }
      }

      ctx.lineWidth = 0.6;
      ctx.strokeStyle = colors.edge;
      for (let k = 0; k < ALPHA_BUCKETS; k++) {
        const segments = buckets[k];
        if (segments.length === 0) continue;
        ctx.globalAlpha = (k + 0.5) / ALPHA_BUCKETS;
        ctx.beginPath();
        for (let s = 0; s < segments.length; s += 4) {
          ctx.moveTo(segments[s], segments[s + 1]);
          ctx.lineTo(segments[s + 2], segments[s + 3]);
        }
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      ctx.fillStyle = colors.glow;
      ctx.beginPath();
      for (const node of nodes) {
        const r = node.r * (1 + 0.25 * Math.sin(node.pulse)) * 3;
        ctx.moveTo(node.x + r, node.y);
        ctx.arc(node.x, node.y, r, 0, TWO_PI);
      }
      ctx.fill();

      ctx.fillStyle = colors.node;
      ctx.beginPath();
      for (const node of nodes) {
        const r = node.r * (1 + 0.25 * Math.sin(node.pulse));
        ctx.moveTo(node.x + r, node.y);
        ctx.arc(node.x, node.y, r, 0, TWO_PI);
      }
      ctx.fill();
    };

    const stop = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
    };

    const tick = (time) => {
      frameId = requestAnimationFrame(tick);
      const elapsed = time - lastFrameTime;
      if (elapsed < FRAME_INTERVAL_MS) return;
      // Normalize to the original 60fps tuning; clamp to avoid jumps after stalls.
      step(Math.min(elapsed, 100) / (1000 / 60));
      lastFrameTime = time;
      render();
    };

    const start = () => {
      if (!shouldAnimate || document.hidden || frameId !== null) return;
      lastFrameTime = performance.now();
      frameId = requestAnimationFrame(tick);
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = canvas.offsetWidth;
      height = canvas.offsetHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const node of nodes) {
        if (node.x > width) node.x = Math.random() * width;
        if (node.y > height) node.y = Math.random() * height;
      }
      render();
    };

    const handleVisibility = () => (document.hidden ? stop() : start());

    // Panel collapse/expand animates the canvas size every frame; CSS stretches the
    // old bitmap meanwhile and the backing store is reallocated once it settles.
    let resizeTimer = null;
    const scheduleResize = () => {
      if (canvas.offsetWidth === width && canvas.offsetHeight === height) return;
      clearTimeout(resizeTimer);
      cancelAnimationFrame(colorsFrame);
      resizeTimer = setTimeout(resize, width === 0 ? 0 : 150);
    };
    const resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(canvas);

    // Theme switches / Theme Studio overrides change CSS vars on <html>.
    let colorsFrame = null;
    const themeObserver = new MutationObserver(() => {
      if (colorsFrame !== null) return;
      colorsFrame = requestAnimationFrame(() => {
        colorsFrame = null;
        colors = readColors();
        if (frameId === null) render();
      });
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-theme', 'class'],
    });

    document.addEventListener('visibilitychange', handleVisibility);
    resize();
    start();

    return () => {
      stop();
      clearTimeout(resizeTimer);
      cancelAnimationFrame(colorsFrame);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [shouldAnimate]);

  return <canvas ref={canvasRef} className="workspace_network_bg" aria-hidden="true" />;
}

export default React.memo(NetworkBackground);
