// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  annotationBoxKind, annotationBoxValues, annotationNode, attachmentPreview, attachmentPreviewKind, documentIconDataUri, hasAttachment,
  keepsLabel, normalizeExternalLink, oleIconRepair, openAttachment, themeLineEdge, themeLineOrder, toDateTimeLocalValue,
} from './graphAnnotations.js';
import { toCyEdge, toCyNode } from './graphElements.js';

afterEach(() => vi.restoreAllMocks());

describe('new annotations (production GA:3000-3250)', () => {
  it('label: text shape, Georgia 18, theme colour', () => {
    expect(annotationNode('add_label', 'Suspect', { dark: false })).toMatchObject({
      label: 'Suspect', shape: 'text', font: { color: '#1f2d3d', size: 18, face: 'Georgia' }, annotationType: 'label', borderWidth: 1.2, margin: 8, note: '',
    });
    expect(annotationNode('add_label', 'x', { dark: true }).font.color).toBe('#8fa4bd');
  });

  it('comment box and text block keep the text as their note', () => {
    expect(annotationNode('add_comment_box', 'Check this')).toMatchObject({
      shape: 'box', color: { background: '#fff9e6', border: '#b8860b' }, font: { color: '#4d3b00', size: 14 }, annotationType: 'comment_box', note: 'Check this',
    });
    expect(annotationNode('add_text_block', 'Note', { dark: true })).toMatchObject({ annotationType: 'text_block', note: 'Note', font: { color: '#c8d5e1', size: 13 } });
  });

  it('event frame: border 2 and empty date / types', () => {
    expect(annotationNode('add_event_frame', 'Meeting')).toMatchObject({
      annotationType: 'event_frame', borderWidth: 2, dashes: [8, 4], eventDateTime: '', eventTypes: [], color: { background: '#f8f8f8', border: '#555555' },
    });
  });

  it('OLE object: the document icon as an image, empty attachment', () => {
    const node = annotationNode('add_ole_object', 'Contract');
    expect(node).toMatchObject({ shape: 'image', image: documentIconDataUri('#4f6c86'), borderWidth: 0, borderWidthSelected: 0, annotationType: 'ole_object', attachmentAutoOpen: true, attachmentLink: '' });
    expect(node.size).toBeUndefined(); // production's size never reached the node
    expect(oleIconRepair(node)).toBeNull();
    expect(oleIconRepair({ shape: 'dot' })).toMatchObject({ shape: 'image', size: 34 });
  });
});

describe('theme lines (GA:3192)', () => {
  it('orders left to right, then top to bottom, then by id', () => {
    const at = { a: { x: 5, y: 0 }, b: { x: 1, y: 9 }, c: { x: 1, y: 2 }, n10: { x: 0, y: 0 }, n9: { x: 0, y: 0 } };
    expect(themeLineOrder(['a', 'b', 'c', 'n10', 'n9'], (id) => at[id])).toEqual(['n9', 'n10', 'c', 'b', 'a']);
  });

  it('draws dashed, grey, without arrow, curved', () => {
    const edge = { from: 'a', to: 'b', ...themeLineEdge() };
    expect(edge).toMatchObject({ label: 'Theme', edge_kind: 'theme_line', arrows: '', width: 2 });
    expect(toCyEdge('k', edge).data).toMatchObject({ arrow: 'none', lineStyle: 'dashed', dashPattern: [8, 6], color: '#6b7280', width: 2, label: 'Theme', curve: 0.18 });
  });
});

describe('drawing annotations', () => {
  it('annotation labels show even with labels off; a box fits its text; a text node is text only', () => {
    expect(keepsLabel({ annotationType: 'label' })).toBe(true);
    expect(keepsLabel({ shape: 'text' })).toBe(true);
    expect(keepsLabel({ label: 'x' })).toBe(false);
    const comment = toCyNode('c', annotationNode('add_comment_box', 'Two words'), { showLabels: false });
    expect(comment.data).toMatchObject({ label: 'Two words', boxed: 1, fontSize: 14, fontColor: '#4d3b00', borderPx: 1.2 });
    expect(comment.data.boxWidth).toBeGreaterThan(comment.data.boxHeight);
    const label = toCyNode('l', annotationNode('add_label', 'Hi'), { showLabels: false });
    expect(label.data).toMatchObject({ label: 'Hi', textOnly: 1, fontFamily: 'Georgia', fontSize: 18 });
    expect(toCyNode('o', annotationNode('add_ole_object', 'Doc')).data).toMatchObject({ imageOnly: 1, diameter: 50 });
    expect(toCyNode('n', { label: 'plain' }, { showLabels: false }).data.label).toBe('');
  });
});

describe('annotation boxes and attachments', () => {
  it('picks the box and its values per type', () => {
    expect(annotationBoxKind({ annotationType: 'text_block' })).toBe('note');
    expect(annotationBoxKind({ annotationType: 'generic' })).toBeNull();
    expect(annotationBoxValues({ annotationType: 'comment_box', label: 'L', note: 'N' })).toEqual({ title: 'Comment Box', label: 'L', note: 'N' });
    expect(annotationBoxValues({ annotationType: 'label', label: 'L', font: { color: 'red' } })).toEqual({ label: 'L', face: 'Georgia', size: 18, color: '#1f2d3d' });
    const local = toDateTimeLocalValue('2026-11-15T10:30:00.000Z');
    expect(local).toMatch(/^2026-11-15T\d\d:30$/);
    expect(annotationBoxValues({ annotationType: 'event_frame', eventDateTime: '2026-11-15T10:30:00.000Z', eventTypes: ['email'] })).toMatchObject({ datetime: local, types: ['email'] });
    expect(toDateTimeLocalValue('nonsense')).toBe('');
  });

  it('links: web and mail only (production also opened javascript:)', () => {
    expect(normalizeExternalLink('www.example.com/a')).toBe('https://www.example.com/a');
    expect(normalizeExternalLink('//cdn.example.com')).toBe('https://cdn.example.com/');
    expect(normalizeExternalLink('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(normalizeExternalLink('javascript:alert(1)')).toBe('');
    expect(normalizeExternalLink('')).toBe('');
  });

  it('previews image / audio / video from the type or the extension', () => {
    expect(attachmentPreviewKind('audio/mpeg', '')).toBe('audio');
    expect(attachmentPreviewKind('', 'https://x.org/clip.MP4?x=1')).toBe('video');
    expect(attachmentPreviewKind('', 'report.pdf')).toBe('');
    expect(attachmentPreview({ attachmentDataUrl: 'data:image/png;base64,AAA', attachmentName: 'a.png' })).toEqual({ kind: 'image', source: 'data:image/png;base64,AAA' });
    expect(attachmentPreview({ attachmentLink: 'example.com/p.jpg' })).toEqual({ kind: 'image', source: 'https://example.com/p.jpg' });
    expect(attachmentPreview({ attachmentLink: 'javascript:alert(1)//.png' })).toBeNull();
  });

  it('opens the file first, else the link', () => {
    const clicks = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { clicks.push({ href: this.href, download: this.download }); });
    expect(hasAttachment({})).toBe(false);
    expect(openAttachment({})).toBe(false);
    expect(openAttachment({ attachmentDataUrl: 'data:text/plain;base64,QQ==', attachmentName: 'a.txt', attachmentLink: 'x.org' })).toBe(true);
    expect(clicks[0]).toEqual({ href: 'data:text/plain;base64,QQ==', download: 'a.txt' });
    expect(openAttachment({ attachmentLink: 'x.org' })).toBe(true);
    expect(clicks[1].href).toBe('https://x.org/');
  });
});
