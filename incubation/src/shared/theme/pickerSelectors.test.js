import { describe, expect, it } from 'vitest';
import { expandScopedVariable, stateFreeSelector } from './pickerSelectors.js';

describe('stateFreeSelector', () => {
  it('drops state pseudos, including state-only :not() groups', () => {
    expect(stateFreeSelector('.a button:hover:not(:disabled)')).toBe('.a button');
    expect(stateFreeSelector('.a button:hover:not(:disabled):not(.is-selected)')).toBe('.a button:not(.is-selected)');
    expect(stateFreeSelector('.row:not(:hover, :focus)::before')).toBe('.row');
    expect(stateFreeSelector('input:checked + span')).toBe('input + span');
    expect(stateFreeSelector('::before')).toBe('*');
  });
});

describe('expandScopedVariable', () => {
  const scoped = new Map([
    ['--customize-accent', 'var(--settings-popup-accent)'],
    ['--users-line', 'var(--settings-popup-line)'],
    ['--rail', 'var(--users-line)'],
    ['--mix', 'color-mix(in srgb, var(--customize-accent) 14%, var(--graph-border))'],
    ['--graph-border', 'var(--settings-popup-border)'],
    ['--fixed', '#fff'],
    ['--loop', 'var(--loop)'],
  ]);
  it('keeps a root-level variable as it is', () => {
    expect(expandScopedVariable('--settings-accent', scoped)).toEqual(['--settings-accent']);
  });
  it('follows a scoped variable to the root-level ones behind it', () => {
    expect(expandScopedVariable('--customize-accent', scoped)).toEqual(['--settings-popup-accent']);
    expect(expandScopedVariable('--rail', scoped)).toEqual(['--settings-popup-line']);
    expect(expandScopedVariable('--mix', scoped)).toEqual(['--settings-popup-accent', '--settings-popup-border']);
  });
  it('yields nothing for a fixed or circular scoped value', () => {
    expect(expandScopedVariable('--fixed', scoped)).toEqual([]);
    expect(expandScopedVariable('--loop', scoped)).toEqual([]);
  });
});
