import { describe, expect, it } from 'vitest';

import { CHART_STATE_VERSION, normalizeChartState, toneStep } from './chartState.js';

describe('normalizeChartState', () => {
  it('colour by the schema is on at first', () => {
    const state = normalizeChartState({ cards: [{ metric: 'degree' }] });
    expect(state.v).toBe(CHART_STATE_VERSION);
    expect(state.global.colorful).toBe(true);
    expect(state.cards[0].colorful).toBe(true);
  });

  it('a state saved before (off was only the old default) comes back coloured', () => {
    const state = normalizeChartState({ global: { colorful: false }, cards: [{ metric: 'degree', colorful: false }] });
    expect(state.global.colorful).toBe(true);
    expect(state.cards[0].colorful).toBe(true);
  });

  it('turned off by the analyst (current state): stays off', () => {
    const state = normalizeChartState({ v: CHART_STATE_VERSION, global: { colorful: false }, cards: [{ metric: 'degree', colorful: false }, { metric: 'pagerank' }] });
    expect(state.global.colorful).toBe(false);
    expect(state.cards.map((card) => card.colorful)).toEqual([false, true]);
  });

  it("each card's tone step is kept; older cards get their old place; the count moves on", () => {
    const state = normalizeChartState({ v: CHART_STATE_VERSION, toneCount: 7, cards: [{ metric: 'degree', tone: 0.3 }, { metric: 'pagerank' }, { metric: 'kcore', tone: 4 }] });
    expect(state.cards.map((card) => card.tone)).toEqual([0.3, 0.5, 1]);
    expect(state.toneCount).toBe(7);
    expect(normalizeChartState({ cards: [{ metric: 'degree' }, { metric: 'kcore' }] }).toneCount).toBe(2);
    expect([0, 1, 2, 3].map(toneStep).every((step) => step >= 0 && step < 1)).toBe(true);
    expect(Math.abs(toneStep(0) - toneStep(1))).toBeGreaterThan(0.3);
  });

  it('charts no longer offered (Katz, Local Eccentricity, Edge Embeddedness / Similarity) leave saved boards', () => {
    const state = normalizeChartState({ cards: [{ metric: 'katz' }, { metric: 'degree' }, { metric: 'edgeSimilarity' }] });
    expect(state.cards.map((card) => card.metric)).toEqual(['degree']);
  });
});
