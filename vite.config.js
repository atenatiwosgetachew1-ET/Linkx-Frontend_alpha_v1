import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
//import basicSsl from "@vitejs/plugin-basic-ssl";

/**
 * The build output directory and URL base path are derived from
 * VITE_BUILD_PATH (explicit override) or VITE_THEME.
 *
 *   VITE_THEME=nbe  →  outDir "linkxDS2026",  base "/linkxDS2026/"   (default / legacy)
 *   VITE_THEME=cdr  →  outDir "linkxCDR2026", base "/linkxCDR2026/"
 *
 * Override with VITE_BUILD_PATH to use any custom directory name.
 */
const THEME_BUILD_PATHS = {
  nbe: "linkxDS2026",
  cdr: "linkxCDR2026",
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const themeId = (env.VITE_THEME || "nbe").trim().toLowerCase();
  const buildPath = env.VITE_BUILD_PATH || THEME_BUILD_PATHS[themeId] || "linkxDS2026";

  return {
    plugins: [
      react(),
      //basicSsl(),
    ],
    esbuild: {
      // Strip verbose client logging from production bundles. These calls log
      // large graph/response objects on hot paths; with DevTools open they cause
      // severe frame drops. console.warn/error are kept for real diagnostics.
      pure: ["console.log", "console.info", "console.debug"],
    },
    build: {
      outDir: buildPath,
      emptyOutDir: false,
    },
    server: {
      host: true,        // allows access from outside container
      watch: {
        usePolling: true, // enables Docker-compatible watching
        interval: 100     // how often to check for changes
      }
    },
    base: `/${buildPath}/`,
  };
});
