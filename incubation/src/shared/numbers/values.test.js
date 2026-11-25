import { describe, expect, it } from 'vitest';

import { compareValues, looksLikeId, parseAmount, parseJsonExact, sameValue } from './values.js';

const order = (values, sort) => [...values].sort((a, b) => compareValues(a, b, sort));

describe('parseAmount', () => {
  it.each([[2500, 2500], ['2500', 2500], ['2,500.75', 2500.75], ['-1,234,567', -1234567], ['2 500', 2500], ['(500)', -500], ['+5', 5], [' 0.5 ', 0.5], ['0', 0]])('%j is %j', (value, number) => {
    expect(parseAmount(value)).toBe(number);
  });
  it.each(['1.234,56', '2500,00', '25,00', '1 000,50', 'ETB 500', '$1,200', '0x10', '1e3', '', ' ', 'abc', '1,2345', '(-5)', NaN, Infinity, true, null, undefined, {}])('%j is not a number', (value) => {
    expect(parseAmount(value)).toBeNull();
  });
});

describe('sameValue', () => {
  it('never takes two accounts for one', () => {
    expect(sameValue('0012345', '12345')).toBe(false);
    expect(sameValue('1000123456789012345', '1000123456789012346')).toBe(false);
    expect(sameValue('1E3', '1000')).toBe(false);
    expect(sameValue('0x10', '16')).toBe(false);
  });
  it('still reads a number however it is written', () => {
    expect(sameValue('2,500', 2500)).toBe(true);
    expect(sameValue('2500.00', '2500')).toBe(true);
    expect(sameValue('ATM', 'atm')).toBe(true);
    expect(sameValue('0012345', '0012345')).toBe(true);
  });
  it('knows an id', () => {
    expect(['0012', '1234567890123456', 2 ** 53 + 2].map(looksLikeId)).toEqual([true, true, true]);
    expect(['0', '0.5', '12', 12].map(looksLikeId)).toEqual([false, false, false, false]);
  });
});

describe('compareValues', () => {
  it('orders numbers, dates, amounts with a unit and text', () => {
    expect(order(['250', '9', '1,000,000'])).toEqual(['9', '250', '1,000,000']);
    expect(order(['2026-03-01', '2026-01-05', '2026-12-31'])).toEqual(['2026-01-05', '2026-03-01', '2026-12-31']);
    expect(order(['31/01/2026', '02/12/2025', '15/06/2024'])).toEqual(['15/06/2024', '02/12/2025', '31/01/2026']);
    expect(order(['2,500.00 ETB', '900.00 ETB', '10,000.00 ETB'])).toEqual(['900.00 ETB', '2,500.00 ETB', '10,000.00 ETB']);
    expect(order(['item 10', 'item 9'])).toEqual(['item 9', 'item 10']);
    expect(order(['1000123456789012346', '1000123456789012345'])).toEqual(['1000123456789012345', '1000123456789012346']);
  });
  it('keeps blanks last in both directions, and is consistent', () => {
    expect(order([null, 2, '', 1])).toEqual([1, 2, null, '']);
    expect(order([null, 2, 1], 'desc')).toEqual([2, 1, null]);
    const mixed = ['10', 'x', 9, '2026-01-01', 'ETB 5', '0012', '7'];
    const sorted = order(mixed);
    for (let i = 0; i < sorted.length; i += 1) for (let j = i; j < sorted.length; j += 1) expect(compareValues(sorted[i], sorted[j])).toBeLessThanOrEqual(0);
  });
});

describe('parseJsonExact', () => {
  it('keeps long whole numbers exactly, as text', () => {
    expect(parseJsonExact('{"a":9007199254740993,"b":[1000123456789012345],"c":-9007199254740993}')).toEqual({ a: '9007199254740993', b: ['1000123456789012345'], c: '-9007199254740993' });
  });
  it('leaves everything else as JSON has it', () => {
    const text = '{"s":"id 9007199254740993","q":"\\"9007199254740993","f":0.12345678901234567,"e":12345678901234567890e2,"n":1234567890123456,"t":true,"z":null}';
    expect(parseJsonExact(text)).toEqual(JSON.parse(text));
    expect(() => parseJsonExact('{"a":9007199254740993')).toThrow();
  });
});
