'use client';
import React, { useRef, useEffect } from "react";

const NODE_COUNT = 30;
const SPEED = 0.6;
const EDGE_DISTANCE = 150;
const LIGHT_NODE_ALPHA = 0.58;
const DARK_NODE_ALPHA = 0.28;
const LIGHT_EDGE_ALPHA = 0.38;
const DARK_EDGE_ALPHA = 0.32;

const BG_LIGHT = "#fbfaf7";
/** Dark animation backdrop — slightly deeper than app chrome for depth */
const BG_DARK = "#1c1408";

/** Light theme: warm golden-brown node fills around #ae794f. */
const LIGHT_NODE_RGB_A = { r: 0xae, g: 0x79, b: 0x4f }; // #ae794f
const LIGHT_NODE_RGB_B = { r: 0xd4, g: 0xb0, b: 0x72 }; // #d4b072

/** Dark theme only: node fills interpolate between these (inclusive). */
const NODE_RGB_A = { r: 0x0a, g: 0x1b, b: 0x2b }; // #0a1b2b
const NODE_RGB_B = { r: 0x08, g: 0x0f, b: 0x16 }; // #080f16

function randomNodeColorBetweenEndpoints(a, b) {
  const t = Math.random();
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bValue = Math.round(a.b + (b.b - a.b) * t);
  return { r, g, b: bValue };
}

function rgba({ r, g, b }, alpha) {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function NetworkAnimation({ name, themeMode = "light" }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const nodesRef = useRef([]);
  const themeRef = useRef(themeMode);

  useEffect(() => {
    themeRef.current = themeMode;
  }, [themeMode]);

  // Initialize nodes positions and velocities
  const initNodes = (w, h) => {
    const dark = themeRef.current === "dark";
    nodesRef.current = Array.from({ length: NODE_COUNT }, () => {
      const size = 4 + Math.random() * 5;
      const color = dark
        ? randomNodeColorBetweenEndpoints(NODE_RGB_A, NODE_RGB_B)
        : randomNodeColorBetweenEndpoints(LIGHT_NODE_RGB_A, LIGHT_NODE_RGB_B);
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * SPEED,
        vy: (Math.random() - 0.5) * SPEED,
        size,
        color,
      };
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initNodes(canvas.width, canvas.height);
    };

    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const nodes = nodesRef.current;

      // Clear background (follows app light / dark theme)
      ctx.fillStyle = themeRef.current === "dark" ? BG_DARK : BG_LIGHT;
      ctx.fillRect(0, 0, w, h);

      // Move nodes
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
      }

      const isDark = themeRef.current === "dark";
      const edgeAlpha = isDark ? DARK_EDGE_ALPHA : LIGHT_EDGE_ALPHA;
      const nodeAlpha = isDark ? DARK_NODE_ALPHA : LIGHT_NODE_ALPHA;

      // Draw very thin edges between nearby nodes.
      ctx.lineWidth = 0.35;
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distance = Math.hypot(dx, dy);
          if (distance > EDGE_DISTANCE) continue;

          const fade = 1 - distance / EDGE_DISTANCE;
          ctx.strokeStyle = isDark
            ? `rgba(170, 140, 104, ${edgeAlpha * fade})`
            : `rgba(174, 121, 79, ${edgeAlpha * fade})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // Draw slightly transparent nodes.
      for (const n of nodes) {
        ctx.fillStyle = rgba(n.color, nodeAlpha);
        ctx.beginPath();
        ctx.moveTo(n.x + n.size, n.y);
        ctx.arc(n.x, n.y, n.size, 0, Math.PI * 2);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [themeMode]);

  const overlayColor =
    themeMode === "dark" ? "rgba(216, 229, 240, 0)" : "rgba(0,0,0,0.15)";

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        backgroundColor: themeMode === "dark" ? BG_DARK : BG_LIGHT,
      }}
    >
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          display: "block",
        }}
      />

      {/* Dynamic text overlay */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          right: 20,
          fontWeight: "bold",
          fontSize: "18px",
          color: overlayColor,
          pointerEvents: "none", // clicks pass through
        }}
      >
        {name ? `Welcome ${name}` : "Linkx (Beta V1.0)"}
      </div>
    </div>
  );
}