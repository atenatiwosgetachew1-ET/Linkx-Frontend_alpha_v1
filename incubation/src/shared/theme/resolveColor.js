// The colour a CSS expression gives right now, for the theme tools. Tokens are
// often written as `var(--x)` or `color-mix(...)`; a colour input needs the
// colour itself. Returns "#rrggbb" or "rgba(r, g, b, a)", or '' when the
// expression is not one colour (a gradient, an angle, an unset variable).

let probeParent = null;
let probe = null;

const ensureProbe = () => {
  if (probe && probeParent?.isConnected) return true;
  if (typeof document === 'undefined' || !document.body) return false;
  probeParent = document.createElement('span');
  probeParent.setAttribute('aria-hidden', 'true');
  probeParent.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none';
  probe = document.createElement('span');
  probeParent.appendChild(probe);
  document.body.appendChild(probeParent);
  return true;
};

const toHex = (channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0');

// "rgb(1, 2, 3)", "rgba(1 2 3 / 0.5)" or "color(srgb 0.1 0.2 0.3 / 0.5)".
export const formatComputedColor = (computed) => {
  const text = String(computed || '').trim();
  let red; let green; let blue; let alpha = 1;
  const rgb = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
  const srgb = text.match(/^color\(\s*srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i);
  if (rgb) [red, green, blue] = [rgb[1], rgb[2], rgb[3]].map(Number);
  else if (srgb) [red, green, blue] = [srgb[1], srgb[2], srgb[3]].map((part) => Number(part) * 255);
  else return '';
  const rawAlpha = (rgb || srgb)[4];
  if (rawAlpha !== undefined) alpha = rawAlpha.endsWith('%') ? parseFloat(rawAlpha) / 100 : parseFloat(rawAlpha);
  if ([red, green, blue, alpha].some((part) => Number.isNaN(part))) return '';
  if (alpha >= 1) return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
  return `rgba(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)}, ${Math.round(alpha * 100) / 100})`;
};

export function resolveCssColor(expression) {
  const text = String(expression || '').trim();
  if (!text || /gradient\(|url\(/i.test(text)) return '';
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return text;
  if (!ensureProbe()) return '';
  probe.style.color = '';
  probe.style.color = text;
  if (!probe.style.color) return '';
  // An expression that fails (an unset variable) falls back to the inherited
  // colour: read it under two different parents and keep only a steady answer.
  probeParent.style.color = 'rgb(1, 2, 3)';
  const first = getComputedStyle(probe).color;
  probeParent.style.color = 'rgb(3, 2, 1)';
  const second = getComputedStyle(probe).color;
  if (first !== second) return '';
  return formatComputedColor(first);
}
