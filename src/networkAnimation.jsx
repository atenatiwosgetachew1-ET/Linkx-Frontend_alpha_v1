'use client';
import React, { useRef, useEffect } from "react";

const NODE_COUNT = 60;
const SPEED = 0.6;

const BG_LIGHT = "#edf4f6";
/** Dark animation backdrop — slightly deeper than app chrome for depth */
const BG_DARK = "#08121c";

/** Dark theme only: node fills interpolate between these (inclusive). */
const NODE_RGB_A = { r: 0x0a, g: 0x1b, b: 0x2b }; // #0a1b2b
const NODE_RGB_B = { r: 0x08, g: 0x0f, b: 0x16 }; // #080f16

function randomNodeColorBetweenEndpoints() {
  const t = Math.random();
  const r = Math.round(NODE_RGB_A.r + (NODE_RGB_B.r - NODE_RGB_A.r) * t);
  const g = Math.round(NODE_RGB_A.g + (NODE_RGB_B.g - NODE_RGB_A.g) * t);
  const b = Math.round(NODE_RGB_A.b + (NODE_RGB_B.b - NODE_RGB_A.b) * t);
  const h = (n) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
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
        ? randomNodeColorBetweenEndpoints()
        : `hsl(200, 80%, ${45 + size * 6}%)`;
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
      const buckets = {};
      for (const n of nodes) {
        (buckets[n.color] ??= []).push(n);
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
      }

      // Draw nodes
      for (const color in buckets) {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (const n of buckets[color]) {
          ctx.moveTo(n.x + n.size, n.y);
          ctx.arc(n.x, n.y, n.size, 0, Math.PI * 2);
        }
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