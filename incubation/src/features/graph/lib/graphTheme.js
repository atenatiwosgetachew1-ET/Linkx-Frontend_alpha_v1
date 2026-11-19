// The Graph canvas's theme, read from the CSS (shared by the on-screen
// canvas and the offscreen report snapshot).

// Theme tokens -> concrete colours (Cytoscape cannot read CSS variables or
// color-mix()). A probe element resolves each token through the cascade.
export const THEME_TOKENS = {
  nodeFill: '--graph-node-fill',
  nodeBorder: '--graph-node-border',
  label: '--graph-label',
  edge: '--graph-edge',
  selected: '--graph-selected',
  // Node badge colours (G3.6).
  glyphAlert: '--graph-alert-high',
  glyphPinned: '--graph-pinned',
  glyphFlag: '--graph-node-flag',
  glyphNote: '--graph-muted-text',
  glyphGroup: '--graph-group',
  glyphMerged: '--graph-merged',
};

export const readGraphTheme = (container) => {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  container.appendChild(probe);
  const theme = {};
  Object.entries(THEME_TOKENS).forEach(([name, cssVar]) => {
    probe.style.color = `var(${cssVar})`;
    theme[name] = getComputedStyle(probe).color || '#555555';
  });
  // Light or dark from the canvas background itself, so custom themes work:
  // dark canvases get production's white icons.
  probe.style.color = 'var(--graph-canvas-bg)';
  const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(getComputedStyle(probe).color);
  theme.mode = rgb && (Number(rgb[1]) * 299 + Number(rgb[2]) * 587 + Number(rgb[3]) * 114) / 1000 < 128 ? 'dark' : 'light';
  probe.remove();
  // A transparent fill keeps production's hollow nodes.
  const alpha = /rgba?\([^)]*,\s*([\d.]+)\)/.exec(theme.nodeFill)?.[1];
  theme.nodeFillOpacity = alpha === undefined ? 1 : Number(alpha);
  return theme;
};

// The canvas background colour (for snapshots).
export const readCanvasBackground = (container) => {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  container.appendChild(probe);
  probe.style.color = 'var(--graph-canvas-bg)';
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color && color !== 'rgba(0, 0, 0, 0)' ? color : '#ffffff';
};
