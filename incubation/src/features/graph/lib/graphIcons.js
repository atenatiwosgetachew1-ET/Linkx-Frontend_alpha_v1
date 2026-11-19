// Node icons (production graph_icons, now in incubation/public/graph_icons).
//
// The backend sends icons as `image` / `iconPath` in several forms:
// "../graph_icons/Person.svg", "graph_icons/Person.svg", "Person Male.svg"
// or "Person". All resolve to this app's /graph_icons/ folder; data images
// are kept; anything else (external URLs) is dropped, so a graph never makes
// the browser call a third-party host.
//
// Dark mode: production fetches built-in icons and recolours them white
// (graphs_adjuster.js recolorSvgForDarkMode ~2423); the same is done here,
// cached per icon.

const ICON_PATH_RE = /(?:^|\/)graph_icons\/([^/?#]+?)(?:\.svg)?$/i;
const BARE_NAME_RE = /^[\w .()-]+?(?:\.svg)?$/i;

const iconsBase = () => `${(import.meta.env?.BASE_URL || '/').replace(/\/?$/, '/')}graph_icons/`;

export const resolveIconUrl = (raw) => {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(value)) return value;
  const fromPath = ICON_PATH_RE.exec(value);
  const name = fromPath ? fromPath[1] : (BARE_NAME_RE.test(value) && !value.includes('/') ? value.replace(/\.svg$/i, '') : '');
  if (!name) return '';
  return `${iconsBase()}${encodeURIComponent(name)}.svg`;
};

export const isBuiltinIcon = (url) => String(url || '').startsWith(iconsBase());

/* ── Dark-mode recolouring ──────────────────────────────────────────── */

const darkCache = new Map(); // url -> data URI
const pending = new Set();
const listeners = new Set();

export const recolorSvgForDarkMode = (svgText) => {
  if (typeof svgText !== 'string' || !svgText.includes('<svg') || svgText.includes('<style')) return svgText;
  return svgText.replace(/<svg\b[^>]*>/i, (openTag) => `${openTag}<style>path,rect,circle,ellipse,polygon,line,polyline{fill:#ffffff !important;stroke:#ffffff !important;}</style>`);
};

const svgToDataUrl = (svgText) => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svgText)}`;

// The icon to draw in this theme; schedules the dark version on first use
// and notifies when it is ready (the canvas restyles then).
export const iconForTheme = (url, mode) => {
  if (mode !== 'dark' || !isBuiltinIcon(url)) return url;
  const cached = darkCache.get(url);
  if (cached) return cached;
  if (!pending.has(url) && typeof fetch === 'function') {
    pending.add(url);
    fetch(url)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error('icon'))))
      .then((text) => {
        darkCache.set(url, svgToDataUrl(recolorSvgForDarkMode(text)));
        listeners.forEach((listener) => listener());
      })
      .catch(() => {})
      .finally(() => pending.delete(url));
  }
  return url;
};

export const subscribeIconThemes = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Light or dark from the canvas background (as GraphCanvas), for the icons.
export const themeModeOf = (element) => {
  if (!element) return 'light';
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = 'var(--graph-canvas-bg)';
  element.appendChild(probe);
  const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(getComputedStyle(probe).color);
  probe.remove();
  return rgb && (Number(rgb[1]) * 299 + Number(rgb[2]) * 587 + Number(rgb[3]) * 114) / 1000 < 128 ? 'dark' : 'light';
};
