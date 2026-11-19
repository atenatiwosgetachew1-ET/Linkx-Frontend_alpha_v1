// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { MAX_CARDS, placeBoxes, placeCards, readProfileCards, withCapturedCards, withProfileCards } from './graphSnap.js';
import { framePicture } from '../../chart/lib/chartSnaps.js';

const profile = (rows = 3) => ({ portrait: '', fields: Array.from({ length: rows }, (_, index) => ({ label: `F${index}`, value: 'v' })) });
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('graph snap', () => {
  it('without cards (or a picture to draw on) the view is kept as it was', async () => {
    expect(await withProfileCards('data:image/png;base64,VIEW', { cards: [] })).toBe('data:image/png;base64,VIEW');
    expect(await withProfileCards('', { cards: [{ at: { x: 1, y: 1 }, profile: profile() }] })).toBe('');
    expect(MAX_CARDS).toBe(4);
  });

  it('cards: beside their nodes (right, else left), inside the picture, never covering each other (moved ones flagged)', () => {
    const stage = { width: 1200, height: 700 };
    // Four nodes close together: the cards must still not overlap.
    const places = placeCards([0, 1, 2, 3].map((index) => ({ at: { x: 400 + index * 10, y: 300 + index * 10 }, profile: profile() })), stage);
    expect(places).toHaveLength(4);
    places.forEach((place, index) => {
      expect(place.x).toBeGreaterThanOrEqual(8);
      expect(place.y).toBeGreaterThanOrEqual(8);
      expect(place.x + place.width).toBeLessThanOrEqual(stage.width - 8);
      expect(place.y + place.height).toBeLessThanOrEqual(stage.height - 8);
      places.slice(index + 1).forEach((other) => expect(overlap(place, other)).toBe(false));
    });
    expect(places[0].moved).toBe(false);
    expect(places.slice(1).some((place) => place.moved)).toBe(true);
    // A node near the right edge: its card to its left.
    const [edge] = placeCards([{ at: { x: 1150, y: 300 }, profile: profile() }], stage);
    expect(edge.x + edge.width).toBeLessThanOrEqual(1150);
  });

  it('nothing on a page without a picture', async () => {
    expect(await framePicture('')).toBeNull();
  });

  it('boxes of measured sizes (the live cards): the first where wanted, the others out of its way', () => {
    const stage = { width: 900, height: 500 };
    const boxes = [{ at: { x: 200, y: 200 }, width: 320, height: 140 }, { at: { x: 210, y: 205 }, width: 260, height: 100 }];
    const [a, b] = placeBoxes(boxes, stage);
    expect([a.x, a.moved]).toEqual([218, false]);
    expect(overlap(a, b)).toBe(false);
    expect(b.moved).toBe(true);
  });

  it('reads the cards as the canvas lays them out: boxes relative to the canvas, words with their fonts and colours, the lines', () => {
    document.body.innerHTML = `
      <div id="root">
        <div class="graph_profile_cards">
          <svg class="graph_profile_links"><line x1="50" y1="60" x2="80" y2="90"></line></svg>
          <section class="graph_profile" data-node-id="7">
            <div class="graph_profile_portrait"><img class="graph_profile_portrait_art" src="https://example.org/a.jpg"></div>
            <span class="graph_profile_kicker">Actor profile</span>
            <dl class="graph_profile_fields"><div class="graph_profile_field"><dt>Full name</dt><dd>Abebe Kebede</dd></div></dl>
          </section>
          <section class="graph_profile" data-node-id="8" style="left:-10000px"></section>
        </div>
      </div>`;
    const rect = (left, top, width, height) => () => ({ left, top, width, height, right: left + width, bottom: top + height });
    const card = document.querySelector('[data-node-id="7"]');
    const hidden = document.querySelector('[data-node-id="8"]');
    Object.defineProperty(card, 'offsetWidth', { value: 260 });
    Object.defineProperty(hidden, 'offsetWidth', { value: 260 });
    card.getBoundingClientRect = rect(120, 80, 260, 110);
    hidden.getBoundingClientRect = rect(-10000, 0, 260, 110);
    card.querySelector('.graph_profile_portrait').getBoundingClientRect = rect(128, 88, 94, 94);
    card.querySelector('.graph_profile_kicker').getBoundingClientRect = rect(232, 88, 80, 12);
    card.querySelector('dt').getBoundingClientRect = rect(232, 104, 64, 14);
    card.querySelector('dd').getBoundingClientRect = rect(302, 104, 70, 14);
    document.querySelector('.graph_profile_links').getBoundingClientRect = rect(100, 50, 600, 400);
    const captured = readProfileCards(document.getElementById('root'), { left: 100, top: 50 });
    // The card out of sight (being measured) is left out.
    expect(captured.cards.map((entry) => entry.id)).toEqual(['7']);
    const [only] = captured.cards;
    expect(only.box).toEqual({ x: 20, y: 30, width: 260, height: 110 });
    expect(only.portrait).toMatchObject({ box: { x: 28, y: 38, width: 94, height: 94 }, src: 'https://example.org/a.jpg' });
    expect(only.texts.map((entry) => [entry.text, entry.box.x, entry.box.y])).toEqual([['Actor profile', 132, 38], ['Full name', 132, 54], ['Abebe Kebede', 202, 54]]);
    expect(captured.links).toEqual([expect.objectContaining({ x1: 50, y1: 60, x2: 80, y2: 90 })]);
    document.body.innerHTML = '';
  });

  it('drawing read cards: the view kept as it was when there is nothing to draw', async () => {
    expect(await withCapturedCards('data:image/png;base64,VIEW', { captured: { cards: [], links: [] } })).toBe('data:image/png;base64,VIEW');
  });
});
