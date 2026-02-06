import React, { useRef, useEffect } from "react";

const NODE_COUNT = 60;
const SPEED = 0.6;

export default function MinimalLeftGlobe() {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const nodesRef = useRef([]);

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

      // single background paint (no clearRect)
      ctx.fillStyle = "#edf4f6";
      ctx.fillRect(0, 0, w, h);

      // group by color (minimize state changes)
      const buckets = {};
      for (const n of nodes) {
        (buckets[n.color] ??= []).push(n);

        n.x += n.vx;
        n.y += n.vy;

        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
      }

      for (const color in buckets) {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (const n of buckets[color]) {
          ctx.moveTo(n.x + n.size, n.y);
          ctx.arc(n.x, n.y, n.size, 0, Math.PI * 2);
        }
        ctx.fill();
      }

      // brand text
      ctx.font = "bold 18px sans-serif";
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText("Linkx (Beta V1.0)", w - 20, h - 20);

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        display: "block",
        background: "#fff",
      }}
    />
  );
}
