'use client';
import React, { useRef, useEffect } from "react";

const NODE_COUNT = 60;
const SPEED = 0.6;

export default function NetworkAnimation({ name }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const nodesRef = useRef([]);

  // Initialize nodes positions and velocities
  const initNodes = (w, h) => {
    nodesRef.current = Array.from({ length: NODE_COUNT }, () => {
      const size = 4 + Math.random() * 5;
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * SPEED,
        vy: (Math.random() - 0.5) * SPEED,
        size,
        color: `hsl(200, 80%, ${45 + size * 6}%)`,
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

      // Clear background
      ctx.fillStyle = "#edf4f6";
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
  }, []);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
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
          color: "rgba(0,0,0,0.15)",
          pointerEvents: "none", // clicks pass through
        }}
      >
        {name ? `Welcome ${name}` : "Linkx (Beta V1.0)"}
      </div>
    </div>
  );
}