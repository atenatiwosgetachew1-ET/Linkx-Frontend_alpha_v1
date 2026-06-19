# Linkx Incubation Frontend

This folder is a development sandbox for modularizing and hardening the frontend without touching the current production build in ../linkxDS2026.

## Run

From this folder:

```bash
npm run dev
```

The dev server is pinned to port 7153:

```text
http://localhost:7153
http://<host-ip>:7153
```

## Rules

- Keep ../linkxDS2026 as the stable working build until the incubation app is ready.
- New refactor work should happen here first.
- Do not copy node_modules into this folder; dependency resolution can use the parent install, or run npm install here later if isolation is needed.
- Split features by domain: source, graph, chart, configuration, settings/admin, auth/session, workspace/windows, shared UI, and services.
- Keep generated output out of the incubation baseline: dist, node_modules, and .vite are ignored.
- Restore behavior in layers: app shell first, shared workspace primitives next, then one feature domain at a time.

## Phase 1 Status

Phase 1 contains the authenticated workspace shell only. The launcher, center landing area, right context tabs, and assistant input are structural placeholders. Real feature windows and backend feature calls start in later phases.
