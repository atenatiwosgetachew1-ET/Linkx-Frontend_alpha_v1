import { describe, expect, it } from 'vitest';
import { formatComputedColor } from './resolveColor.js';

describe('formatComputedColor', () => {
  it('reads the forms a browser reports a colour in', () => {
    expect(formatComputedColor('rgb(174, 135, 79)')).toBe('#ae874f');
    expect(formatComputedColor('rgba(174, 135, 79, 0.5)')).toBe('rgba(174, 135, 79, 0.5)');
    expect(formatComputedColor('rgb(174 135 79 / 50%)')).toBe('rgba(174, 135, 79, 0.5)');
    expect(formatComputedColor('color(srgb 1 0.5 0 / 0.14)')).toBe('rgba(255, 128, 0, 0.14)');
    expect(formatComputedColor('color(srgb 0.0745 0.1176 0.1647)')).toBe('#131e2a');
    expect(formatComputedColor('linear-gradient(red, blue)')).toBe('');
  });
});
