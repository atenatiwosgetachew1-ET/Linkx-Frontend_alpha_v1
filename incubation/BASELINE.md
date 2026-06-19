# Incubation Baseline

Date: 2026-06-18

This is the frozen clean baseline for the Linkx frontend refactor incubation. The live production build in ../linkxDS2026 remains untouched.

## Baseline Guarantees

- Login/auth flow is present and working.
- Login page component matches the original app.
- Login CSS block matches the original app.
- Post-login page contains the Phase 1 workspace landing shell.
- Old workspace/source/graph/configuration logic is not active.
- Vite dev server is pinned to port 7153.
- Production build output for this sandbox is incubation/dist only.

## Active Source Files

- src/App.jsx
- src/app/App.jsx
- src/app/config.js
- src/main.jsx
- src/main.css
- src/index.css
- src/auth/AuthContext.jsx
- src/auth/authContext.js
- src/auth/useAuth.js
- src/auth/LoginPage.jsx
- src/services/authApi.js
- src/workspace/components/WorkspaceFrame.jsx
- src/workspace/components/WorkspaceHome.jsx
- src/workspace/components/WorkspaceContextPanel.jsx
- src/workspace/components/WorkspaceWindow.jsx
- src/workspace/components/WindowManager.jsx
- src/workspace/hooks/useWorkspace.js
- src/workspace/state/workspaceTypes.js
- src/workspace/state/workspaceReducer.js
- src/workspace/state/workspaceContext.js
- src/workspace/state/WorkspaceContext.jsx
- src/utils/backgroundAnimations.js
- src/utils/inputSecurity.js

## Active Public Assets

- public/site_images
- public/site_videos

## Generated Or Ignored

- dist
- node_modules
- .vite

## Structural Status Before Step 4

- The incubation app is login-only after authentication.
- Auth state and browser lifecycle are isolated under src/auth.
- Backend auth calls and response parsing are isolated under src/services/authApi.js.
- Environment parsing is isolated under src/app/config.js.
- Feature folders exist as empty incubation lanes and do not contain active old monolith logic.
- The old production bundle copy is not part of the incubation public assets.
- The favicon points to the incubation public asset path.
- The package still includes graph, socket, and 3D dependencies copied from the current app so future feature work can be restored deliberately. They are not active imports in the current login-only shell.

## Run

```bash
cd /var/www/linkx-frontend/incubation
npm run dev
```

Open:

```text
http://172.27.23.21:7153/
```

## Build Check

```bash
npm run build
```

## Next Step

Start Phase 2 by adding workspace state and placeholder window opening behavior, without restoring source, graph, chart, configuration, or settings backend calls yet.

## Plan 2 Structure Added

The incubation source tree now has the target modular skeleton:

- src/app
- src/auth
- src/shared
- src/workspace
- src/features/source
- src/features/graph
- src/features/chart
- src/features/configuration
- src/features/settings
- src/services
- src/styles

The active app entry lives at src/app/App.jsx. The root src/App.jsx is only a compatibility re-export for Vite/main.jsx.

## Plan 3 Auth/API Shell Added

Auth is now split into focused modules:

- src/auth/AuthContext.jsx: provider state and browser auth lifecycle
- src/auth/authContext.js: React context object
- src/auth/useAuth.js: consumer hook
- src/services/authApi.js: backend auth calls and response parsing
- src/app/config.js: environment-derived app configuration

Focused lint and build pass for the app/auth/auth service modules.

## Step 4.1 Workspace Frame Added

The authenticated incubation shell now has a minimal workspace frame:

- reusable frame component at src/workspace/components/WorkspaceFrame.jsx
- full background media layer
- central empty workspace canvas
- empty left and right reserved zones
- sign out remains available
- no source, graph, chart, configuration, settings, or window behavior is active


## Phase 1 Workspace Shell Completed

The authenticated incubation workspace now has the first stable shell:

- left launcher rail with compact and expanded modes
- sign out action anchored in the launcher rail
- center landing surface with upload prompt, source option placeholders, and footer links
- right context rail with Overview, Info, Filter, and Settings tabs
- graph-oriented placeholder panels for Info, Filter, and Settings based on the original graph side-panel responsibilities
- assistant chat placeholder with local-only input state and disabled submit behavior
- responsive safeguards for center options/footer and compact mobile layout
- tab accessibility links via role, id, aria-controls, and aria-labelledby

Security status:

- no source, graph, configuration, settings, or chat backend calls are active
- no frontend-created session/window IDs are introduced
- no sensitive token/session/config values are displayed
- placeholders remain disabled where backend behavior is not implemented

Verification:

- focused lint passed for active app/auth/workspace modules
- npm run build passed


## Phase 2.1 Workspace State Added

The incubation workspace now has a state foundation without enabling feature behavior:

- WorkspaceProvider wraps the authenticated workspace shell
- useWorkspace exposes read-only state and future-safe actions
- workspaceReducer tracks placeholder windows, active window id, context tab, and window index
- workspaceTypes defines window types, context tab ids, actions, and labels
- center and right panels read workspace counts/status only

Still excluded:

- launcher buttons do not open windows yet
- no source, graph, chart, configuration, settings, or chat backend calls are active
- no draggable/resizable window manager exists yet

Verification:

- focused lint passed for active app/workspace modules
- npm run build passed


## Phase 2.2 Window Manager Added

The incubation workspace now has visual placeholder window rendering:

- WindowManager renders the center landing area when no windows are open
- WindowManager renders placeholder windows from workspace state when windows exist
- WorkspaceWindow provides reusable title/status/close chrome
- close and focus handlers are wired to workspace state actions

Still excluded:

- launcher buttons do not open windows yet
- no draggable or resizable behavior is active
- no source, graph, chart, configuration, settings, or chat backend calls are active

Verification:

- focused lint passed for active workspace window manager modules
- npm run build passed


## Phase 2.3 Launcher Actions Added

The left launcher now opens placeholder windows through workspace state:

- Source, Graph, Chart, Configuration, and Settings launcher buttons call workspace.openWindow
- each launcher action sets an intended right-panel context tab
- Graph opens the Info tab; Configuration and Settings open the Settings tab
- existing window types are focused instead of duplicated
- launcher actions remain frontend-only placeholders

Still excluded:

- no source, graph, chart, configuration, settings, or chat backend calls are active
- placeholder windows do not contain real feature UI yet
- no draggable or resizable behavior is active

Verification:

- focused lint passed for active launcher/window modules
- npm run build passed
