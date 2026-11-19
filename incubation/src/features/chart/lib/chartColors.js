// Chart colour schemas (production charts_adjuster.js, kept exactly): a
// value is placed between the chart's min and max (t from 0 to 1) and
// coloured by the schema; with colour off, by grey brightness (55..210).

export const COLOR_SCHEMAS = Object.freeze({
  Viridis: (t) => `hsl(${260 - t * 220}, 70%, 48%)`,
  Inferno: (t) => `hsl(${30 + t * 250}, 85%, ${35 + t * 20}%)`,
  Magma: (t) => `hsl(${280 - t * 260}, 80%, ${30 + t * 25}%)`,
  Coolwarm: (t) => `hsl(${200 - t * 200}, 72%, 52%)`,
  Sunset: (t) => `hsl(${30 + t * 180}, 80%, ${45 + t * 10}%)`,
  Emerald: (t) => `hsl(${140 - t * 40}, 65%, ${40 + t * 25}%)`,
  Ocean: (t) => `hsl(${200 + t * 40}, 70%, ${35 + t * 20}%)`,
  Pastel: (t) => `hsl(${360 * t}, 60%, 70%)`,
  Cubehelix: (t) => `hsl(${300 - t * 240}, ${50 + t * 30}%, ${40 + t * 20}%)`,
  Grayscale: (t) => `hsl(0, 0%, ${30 + t * 50}%)`,
});
export const SCHEMA_NAMES = Object.freeze(Object.keys(COLOR_SCHEMAS));
export const DEFAULT_SCHEMA = 'Viridis';

export const grayscale = (t) => {
  const intensity = 55 + Math.round(t * (210 - 55));
  return `rgb(${intensity},${intensity},${intensity})`;
};

// The [min, max] of the finite values (a flat range is widened by 1, as
// production's safeMinMax).
export const valueRange = (values) => {
  let min = Infinity;
  let max = -Infinity;
  values.forEach((value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    if (value < min) min = value;
    if (value > max) max = value;
  });
  if (min === Infinity) return [0, 1];
  return min === max ? [min, max + 1] : [min, max];
};

export const colorForValue = (value, [min, max], { colorful = false, schema = DEFAULT_SCHEMA } = {}) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '#cccccc';
  const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  return colorful ? (COLOR_SCHEMAS[schema] || COLOR_SCHEMAS[DEFAULT_SCHEMA])(t) : grayscale(t);
};

// A node's own colour, for its bars while it is selected on the graph
// (production: the selected node's highlight, else background, else border).
export const nodeOwnColor = (node, fallback) => {
  const color = node?.color;
  if (typeof color === 'string' && color.trim()) return color;
  if (color && typeof color === 'object') {
    return color.highlight?.background || color.background || color.border || fallback;
  }
  return fallback;
};
