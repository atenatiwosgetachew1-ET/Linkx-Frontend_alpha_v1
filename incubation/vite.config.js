import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import process from "node:process";

// Dev-only API prefix. In `vite dev` the app calls `/backend/*` on its own
// origin and Vite forwards it to VITE_API_URL, so the backend's CORS allow-list
// doesn't matter (VS Code may forward the dev server on any local port).
// Production builds still call VITE_API_URL directly (see src/app/config.js).
const DEV_API_PREFIX = "/backend";

// The G0 graph benchmark page (src/dev/graphBench) is dev-only. In a normal
// production build its import is dead code, but Vite would still emit its
// worker files; resolving it to an empty module keeps them out of dist.
// Build with VITE_GRAPH_BENCH=true to include it (e.g. to test on another PC).
const stripGraphBench = (enabled) => ({
  name: "linkx-strip-graph-bench",
  apply: "build",
  enforce: "pre",
  resolveId(id) {
    if (!enabled && id.includes("dev/graphBench/GraphBench")) return "\0linkx-empty-graph-bench";
    return null;
  },
  load(id) {
    return id === "\0linkx-empty-graph-bench" ? "export default null;" : null;
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = String(env.VITE_API_URL || "").trim();

  return {
    plugins: [react(), stripGraphBench(env.VITE_GRAPH_BENCH === "true")],
    base: "/",
    // Unit tests (Vitest): pure model/service modules, Node environment.
    test: {
      environment: "node",
      include: ["src/**/*.test.{js,jsx}"],
    },
    publicDir: "public",
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    server: {
      host: true,
      port: 7153,
      strictPort: true,
      watch: {
        usePolling: true,
        interval: 100,
      },
      proxy: apiTarget ? {
        [DEV_API_PREFIX]: {
          target: apiTarget,
          changeOrigin: true,
          ws: true, // Socket.IO (/backend/socket.io) shares the proxy
          rewrite: (path) => path.slice(DEV_API_PREFIX.length) || "/",
          configure: (proxy) => {
            // Server-to-server hop: drop the browser Origin so the backend
            // treats it as a same-origin request.
            proxy.on("proxyReq", (proxyReq) => proxyReq.removeHeader("origin"));
          },
        },
      } : undefined,
    },
  };
});
