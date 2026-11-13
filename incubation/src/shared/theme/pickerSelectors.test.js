import { describe, expect, it } from 'vitest';
import { stateFreeSelector } from './pickerSelectors.js';

describe('stateFreeSelector', () => {
  it('drops state pseudos, including state-only :not() groups', () => {
    expect(stateFreeSelector('.a button:hover:not(:disabled)')).toBe('.a button');
    expect(stateFreeSelector('.a button:hover:not(:disabled):not(.is-selected)')).toBe('.a button:not(.is-selected)');
    expect(stateFreeSelector('.row:not(:hover, :focus)::before')).toBe('.row');
    expect(stateFreeSelector('input:checked + span')).toBe('input + span');
    expect(stateFreeSelector('::before')).toBe('*');
  });
});
