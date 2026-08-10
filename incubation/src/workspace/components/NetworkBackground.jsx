import React, { useRef, useEffect, useCallback } from 'react';

/**
 * NetworkBackground — Animated node & edge graph overlay.
 * Renders on a <canvas> at the lowest z-index behind all workspace content.
 * All colors are driven by CSS variables so the Theme Studio can control them.
 */
export default function NetworkBackground() {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const nodesRef = useRef([]);
  const resizeRef = useRef(null);

  const getColor = useCallback((varName, fallback) => {
    const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return val || fallback;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // --- Configuration ---
    const NODE_COUNT = 65;
    const CONNECTION_DIST = 160;
    const NODE_MIN_R = 1.2;
    const NODE_MAX_R = 2.8;
    const SPEED_FACTOR = 0.18;

    // --- Resize handler ---
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // --- Initialize nodes ---
    const initNodes = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      const nodes = [];
      for (let i = 0; i < NODE_COUNT; i++) {
        nodes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * SPEED_FACTOR,
          vy: (Math.random() - 0.5) * SPEED_FACTOR,
          r: NODE_MIN_R + Math.random() * (NODE_MAX_R - NODE_MIN_R),
          pulse: Math.random() * Math.PI * 2,
          pulseSpeed: 0.008 + Math.random() * 0.012,
        });
      }
      nodesRef.current = nodes;
    };

    resize();
    initNodes();

    const handleResize = () => {
      resize();
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      nodesRef.current.forEach((n) => {
        if (n.x > w) n.x = Math.random() * w;
        if (n.y > h) n.y = Math.random() * h;
      });
    };

    resizeRef.current = handleResize;
    window.addEventListener('resize', handleResize);

    // --- Animation loop ---
    let frameCount = 0;
    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      const nodes = nodesRef.current;

      // Read colors from CSS vars every 60 frames (~1 second) for perf
      let nodeColor, edgeColor, glowColor;
      if (frameCount % 60 === 0 || frameCount === 0) {
        nodeColor = getColor('--network-node-color', 'rgba(252, 198, 118, 0.55)');
        edgeColor = getColor('--network-edge-color', 'rgba(174, 135, 79, 0.12)');
        glowColor = getColor('--network-glow-color', 'rgba(252, 198, 118, 0.08)');
        canvas._nodeColor = nodeColor;
        canvas._edgeColor = edgeColor;
        canvas._glowColor = glowColor;
      } else {
        nodeColor = canvas._nodeColor;
        edgeColor = canvas._edgeColor;
        glowColor = canvas._glowColor;
      }
      frameCount++;

      ctx.clearRect(0, 0, w, h);

      // Update positions
      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;
        node.pulse += node.pulseSpeed;

        // Bounce off edges
        if (node.x < 0 || node.x > w) node.vx *= -1;
        if (node.y < 0 || node.y > h) node.vy *= -1;
        node.x = Math.max(0, Math.min(w, node.x));
        node.y = Math.max(0, Math.min(h, node.y));
      }

      // Draw edges
      ctx.lineWidth = 0.6;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECTION_DIST) {
            const opacity = 1 - dist / CONNECTION_DIST;
            ctx.globalAlpha = opacity;
            ctx.strokeStyle = edgeColor;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw nodes
      ctx.globalAlpha = 1;
      for (const node of nodes) {
        const pulseScale = 1 + 0.25 * Math.sin(node.pulse);
        const r = node.r * pulseScale;

        // Glow
        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 3, 0, Math.PI * 2);
        ctx.fillStyle = glowColor;
        ctx.fill();

        // Core dot
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = nodeColor;
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', handleResize);
    };
  }, [getColor]);

  return (
    <canvas
      ref={canvasRef}
      className="workspace_network_bg"
      aria-hidden="true"
    />
  );
}
