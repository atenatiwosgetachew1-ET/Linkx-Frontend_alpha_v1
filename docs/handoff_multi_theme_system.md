# Linkx Multi-Theme System — Handoff Document

**Date:** 2026-10-13  
**Scope:** Build-time theme switching for multi-deployment support  

---

## What Was Done

The Linkx frontend was refactored to support **multiple visual themes** from a single codebase. Previously, all brand colors, text, asset paths, and build output directories were hardcoded. Now everything is driven by a `VITE_THEME` environment variable set at build time.

### Two themes are available

| Theme ID | Build Command | Output Directory | URL Path | Visual Style |
|----------|--------------|------------------|----------|-------------|
| `nbe` (default) | `npm run build` | `linkxDS2026/` | `/linkxDS2026/` | Gold/amber accents on dark navy chrome |
| `cdr` | `npm run build:cdr` | `linkxCDR2026/` | `/linkxCDR2026/` | Sky-blue accents on dark navy chrome |

---

## How the Theme System Works

### Architecture

```
VITE_THEME env var (build-time)
        │
        ▼
  src/themes/index.js ──── resolves theme by ID
        │
        ├── src/themes/nbe.js   (brand config: name, tagline, assets, colors)
        └── src/themes/cdr.js   (brand config: name, tagline, assets, colors)
        │
        ▼
  Two injection points at runtime:
  ┌──────────────────────────────────────────────────────────┐
  │ 1. main.jsx sets  data-brand="nbe|cdr"  on <html>       │
  │    → CSS [data-brand="cdr"] overrides kick in            │
  │                                                          │
  │ 2. JSX components import theme from './themes'           │
  │    → theme.name, theme.tagline, theme.logo, etc.         │
  └──────────────────────────────────────────────────────────┘
```

### Theme config structure (`src/themes/nbe.js` / `cdr.js`)

Each theme file exports an object with:

```js
{
  id: "nbe",                    // used as data-brand attribute value
  name: "Linkx",                // displayed in sidebar, login, footer, notices
  tagline: "Web Analyzer",     // displayed alongside name
  copyright: "© 2026 Linkx...",// login footer
  footerNotice: "...",         // legal notice
  vigilanceLabel: "...",       // settings tab label

  // Asset paths (relative to Vite BASE_URL)
  favicon: "site_images/...",
  logo: "site_images/...",
  backgroundImage: "site_images/...",
  backgroundVideo: "site_videos/...",

  // Color palette (documented, but injected via CSS not JS)
  colors: {
    chrome: "#314961",         // primary UI chrome
    chromeDark: "#142e47",     // dark variant
    // ... etc
  },
}
```

### CSS variable system

Brand-specific colors are defined as CSS custom properties in `src/main.css`:

```css
/* Default (NBE) values in :root */
:root {
  --chrome-bg: #314961;
  --chrome-bg-dark: #142e47;
  --sidebar-bg: #19212e;
  --logo-gradient: linear-gradient(90deg, #ae794f, #7f4f23);
  --login-shell-bg: #041327;
  /* ... more */
}

/* CDR overrides — activated when data-brand="cdr" is on <html> */
[data-brand="cdr"] {
  --chrome-bg: #1b6ca8;
  --chrome-bg-dark: #0f3b5e;
  --sidebar-bg: #0d2137;
  --logo-gradient: linear-gradient(90deg, #4aafe6, #1b6ca8);
  --login-shell-bg: #06182c;
  /* ... more */
}
```

All component styles reference `var(--chrome-bg)` etc. instead of hardcoded hex values.

### Build path routing

`vite.config.js` reads `VITE_THEME` and maps it to a build output directory:

```
nbe  →  outDir: "linkxDS2026",  base: "/linkxDS2026/"
cdr  →  outDir: "linkxCDR2026", base: "/linkxCDR2026/"
```

This can be further overridden with `VITE_BUILD_PATH` if needed.

---

## Files Created

| File | Purpose |
|------|---------|
| `src/themes/index.js` | Theme resolver — reads `VITE_THEME`, exports active theme |
| `src/themes/nbe.js` | NBE theme configuration (original gold/amber) |
| `src/themes/cdr.js` | CDR theme configuration (sky-blue + navy) |
| `.env.cdr` | Environment variable template for CDR deployment |
| `Dockerfile.cdr` | Production Docker build for CDR |
| `docker-compose.cdr.yml` | Docker Compose for CDR deployment |
| `deploy/nginx/cdr-host-https.conf` | Nginx config serving `/linkxCDR2026/` |

## Files Modified

| File | Changes |
|------|---------|
| `vite.config.js` | `outDir` and `base` now derive from `VITE_THEME` |
| `src/main.jsx` | Sets `data-brand` attribute on `<html>`, sets dynamic page title |
| `src/main.css` | ~55 hardcoded hex colors extracted to CSS variables; added `[data-brand="cdr"]` design tokens and full component overrides replacing all golden/amber button gradients, icon fills, card borders, and tab states with sky-blue and dark-navy styling |
| `src/App.jsx` | Brand text (`"Linkx"`, `"Web Analyzer"`, copyright, etc.) replaced with `theme.*` references; asset paths and notification sources made dynamic; `IframeEmbed` now resolves `temp_placeholders` dynamically using origin + theme base path (`linkxDS2026` or `linkxCDR2026`) |
| `src/auth/LoginPage.jsx` | Logo, background image/video, brand name, tagline, and footer text replaced with `theme.*` references |
| `package.json` | Added `dev:cdr` and `build:cdr` npm scripts |

---

## How to Build & Deploy

### Development

```bash
npm run dev          # NBE theme (default)
npm run dev:cdr      # CDR theme
```

### Production build

```bash
npm run build        # → linkxDS2026/
npm run build:cdr    # → linkxCDR2026/
```

### Deploying CDR to a new server

1. Edit `.env.cdr` — replace `CDR_SERVER_IP` and `CDR_PARENT_PROJECT_IP`
2. Edit `deploy/nginx/cdr-host-https.conf` — replace `CDR_BACKEND_IP`
3. Edit `docker-compose.cdr.yml` — replace `CDR_BACKEND_IP`
4. Run: `docker compose -f docker-compose.cdr.yml up --build -d`

Or manually:
```bash
npm run build:cdr
# Copy linkxCDR2026/ to /var/www/linkx-frontend/ on the new server
# Install cdr-host-https.conf as the nginx site config
# Ensure site_images/, site_videos/, thumbnails/ etc. are in linkxCDR2026/
```

---

## How to Add a New Theme in the Future

1. **Create theme config** — copy `src/themes/cdr.js` → `src/themes/mytheme.js`, change `id`, colors
2. **Register it** — add `import mytheme from "./mytheme.js"` and `mytheme` to the `themes` map in `src/themes/index.js`
3. **Add CSS overrides** — add a `[data-brand="mytheme"]` block in `src/main.css` with the color variable overrides
4. **Add build path** — add `mytheme: "linkxMyTheme"` to `THEME_BUILD_PATHS` in `vite.config.js`
5. **Add npm script** (optional) — add `"build:mytheme": "VITE_THEME=mytheme vite build"` to `package.json`
6. **Build** — `VITE_THEME=mytheme npx vite build`

---

## Important Notes

- The **default behavior with no `VITE_THEME` set is identical to the original codebase** — it builds to `linkxDS2026/` with the NBE gold/amber palette. Nothing breaks for existing deployments.
- The theme system operates **entirely at build time**. There is no runtime theme-switching UI. Each deployment is built for one specific theme.
- Both light mode and dark mode are supported for each brand. The `[data-brand="cdr"][data-theme="dark"]` selector handles dark-mode CDR overrides.
- Static assets (images, videos, thumbnails, libraries, temp files) must be **copied into the new build output directory** after building, since Vite only copies `public/` contents. The existing `linkxDS2026/` assets can be reused for both themes since they share the same logo.
