import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import {
  COLOR_BEHAVIORS, EDGE_STYLES, EDGE_WIDTH_RANGE, NODE_SHAPES, NODE_SIZES, buildNodeColor,
} from '../lib/graphEditing.js';
import { iconForTheme, resolveIconUrl, themeModeOf } from '../lib/graphIcons.js';
import { IconAlbum, LiveColor, Swatches } from './GraphAdjustBox.jsx';

// Customize popup (analyst decision 2026-11-16; replaces production's node /
// edge adjust boxes, which opened on a click): opened from the toolbar's
// Customize button for the selected nodes and / or links. Options on the
// left in sections, a live preview of the element on the right (held down,
// it shows the element as it is now); nothing changes on the graph until
// Apply, which applies only the options that were changed, to every selected
// element of that kind, as one undo step. With nodes and links selected,
// Node / Link tabs switch between them (Apply covers both).
//
// Node sections: Text (label, note); Paint: Fill and Border, each on its own
// (pick which one the picker and swatches paint; Fill can go back to the
// theme's and Border to the one worked out from the fill), the colour effect
// with Fill (Individual / Link: Link also colours the linked nodes and the
// links among them, as production); Form (shape, size 5-30 on a slider); and
// under the preview, Icon (the album or an upload, in a popover rising from
// the icon button; Remove). Link sections:
// Text (label); Paint (colour); Line (style, width).
//
// nodes / edges: the selected ids; nodeValues / edgeValues: the first
// selected one's values (nodeBoxValues / edgeBoxValues); nodeLook /
// edgeLook: how it is drawn now (fill / border / colour, or null for the
// theme's own); onApply({ node, edge }) with the changed fields of each;
// onClose().


const KINDS = { node: { one: 'node', many: 'nodes', title: 'Node' }, edge: { one: 'link', many: 'links', title: 'Link' } };
// Applied in this order: the colour effect before the fill, the border last.
const NODE_FIELDS = ['label', 'note', 'colorBehavior', 'icon', 'shape', 'size', 'fill', 'border'];
const EDGE_FIELDS = ['label', 'color', 'style', 'width'];
const THEME = { fill: 'var(--graph-node-fill)', border: 'var(--graph-node-border)', edge: 'var(--graph-edge)' };

const changesOf = (draft, initial, fields) => Object.fromEntries(fields
  .filter((field) => draft[field] !== initial[field])
  .map((field) => [field, draft[field]]));

// The node's fill and border as they will be drawn (null: the theme's).
const nodePaint = (draft, initial, look) => {
  const fillChanged = draft.fill !== initial.fill;
  const fill = fillChanged || !look ? draft.fill || null : look.fill;
  let border;
  if (draft.border) border = draft.border;
  else if (fillChanged || draft.border !== initial.border || !look) border = fill && fill.startsWith('#') ? buildNodeColor(fill).border : null;
  else border = look.border;
  return { fill, border };
};

/* ── Small pieces ───────────────────────────────────────────────────── */

// How far a slider is along, for its filled track (CSS --fill).
const rangeFill = (value, min, max) => `${Math.round(((Number(value) - min) / (max - min)) * 100)}%`;

const ShapeSign = ({ shape }) => (
  <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    {shape === 'box' ? <rect x="3" y="5" width="14" height="10" rx="2" /> : null}
    {shape === 'diamond' ? <path d="M10 2.5 17.5 10 10 17.5 2.5 10Z" /> : null}
    {shape === 'dot' ? <circle cx="10" cy="10" r="7" /> : null}
  </svg>
);

// A titled group of options.
const Section = ({ title, children }) => (
  <section className="graph_customize_section" aria-label={title}>
    <h4 className="graph_customize_section_head">{title}</h4>
    {children}
  </section>
);

const Field = ({ label, children }) => (
  <div className="graph_customize_field">
    <span className="graph_customize_field_label">{label}</span>
    {children}
  </div>
);

// One choice out of a few, as a row of buttons.
function Segments({ label, options, value, onPick, render, tiles = false }) {
  return (
    <div className={`graph_customize_segments${tiles ? ' is-tiles' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          aria-label={option.name || option.label}
          title={option.name || option.label}
          className={`graph_customize_segment${value === option.value ? ' is-current' : ''}`}
          onClick={() => onPick(option.value)}
        >
          {render ? render(option) : option.label}
        </button>
      ))}
    </div>
  );
}

/* ── Preview ────────────────────────────────────────────────────────── */

const PREVIEW = { width: 260, height: 230 };
const previewDiameter = (size) => size * 3 + 6;

// The node's outline in the preview, centred on (cx, cy).
function NodeShape({ shape, cx, cy, d, fill, stroke, strokeWidth = 2.5, clip }) {
  const style = { fill, stroke, strokeWidth };
  if (shape === 'box') {
    return <rect x={cx - d * 0.62} y={cy - d * 0.4} width={d * 1.24} height={d * 0.8} rx={4} style={style} clipPath={clip} />;
  }
  if (shape === 'diamond') {
    const r = d / 2;
    return <path d={`M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`} style={style} clipPath={clip} />;
  }
  return <circle cx={cx} cy={cy} r={d / 2} style={style} clipPath={clip} />;
}

function NodePreview({ draft, initial, look, mode }) {
  const clipId = useId().replace(/:/g, '');
  const paint = nodePaint(draft, initial, look);
  const fill = paint.fill || THEME.fill;
  const stroke = paint.border || THEME.border;
  // "Link" colour effect: the linked nodes and links take the fill too.
  const spread = draft.fill && draft.fill !== initial.fill && draft.colorBehavior === 'link';
  const ghost = spread ? { fill: draft.fill, stroke: buildNodeColor(draft.fill).border } : { fill: THEME.fill, stroke: THEME.border };
  const edge = spread ? draft.fill : THEME.edge;
  const d = previewDiameter(draft.size);
  const cx = PREVIEW.width / 2;
  const cy = 98;
  const icon = draft.icon ? iconForTheme(resolveIconUrl(draft.icon), mode) : '';
  const neighbours = [[40, 40], [222, 58], [214, 178]];
  return (
    <svg className="graph_customize_canvas" viewBox={`0 0 ${PREVIEW.width} ${PREVIEW.height}`} role="img" aria-label="Node preview">
      {neighbours.map(([x, y]) => <line key={`${x}-${y}`} x1={cx} y1={cy} x2={x} y2={y} className="graph_customize_ghost_edge" style={{ stroke: edge }} />)}
      {neighbours.map(([x, y]) => <circle key={`n${x}-${y}`} cx={x} cy={y} r={11} className="graph_customize_ghost" style={{ fill: ghost.fill, stroke: ghost.stroke }} />)}
      <g className="graph_customize_subject">
        <NodeShape shape={draft.shape} cx={cx} cy={cy} d={d} fill={fill} stroke={stroke} />
        {icon ? (
          <>
            <clipPath id={clipId}><NodeShape shape={draft.shape} cx={cx} cy={cy} d={d} /></clipPath>
            <image href={icon} x={cx - d * 0.34} y={cy - d * 0.34} width={d * 0.68} height={d * 0.68} clipPath={`url(#${clipId})`} preserveAspectRatio="xMidYMid meet" />
          </>
        ) : null}
        {draft.label ? <text x={cx} y={cy + d / 2 + 16} className="graph_customize_label">{draft.label.length > 28 ? `${draft.label.slice(0, 27)}…` : draft.label}</text> : null}
      </g>
    </svg>
  );
}

function EdgePreview({ draft, initial, look }) {
  const markerId = useId().replace(/:/g, '');
  const colour = draft.color !== initial.color || !look ? draft.color : look.color || THEME.edge;
  const width = Math.max(1, Number(draft.width) || 1) * 1.6;
  const dashes = EDGE_STYLES.find((entry) => entry.value === draft.style)?.dashes;
  const from = { x: 52, y: 138 };
  const to = { x: 208, y: 92 };
  const r = 16;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const start = { x: from.x + Math.cos(angle) * r, y: from.y + Math.sin(angle) * r };
  const end = { x: to.x - Math.cos(angle) * (r + 2), y: to.y - Math.sin(angle) * (r + 2) };
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  return (
    <svg className="graph_customize_canvas" viewBox={`0 0 ${PREVIEW.width} ${PREVIEW.height}`} role="img" aria-label="Link preview">
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse" markerUnits="strokeWidth">
          <path d="M0 0 10 5 0 10Z" style={{ fill: colour }} />
        </marker>
      </defs>
      <g className="graph_customize_subject">
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          style={{ stroke: colour, strokeWidth: width, strokeDasharray: dashes ? dashes.map((value) => value * Math.max(1, width / 2)).join(' ') : 'none' }}
          strokeLinecap={draft.style === 'dotted' ? 'round' : 'butt'}
          markerEnd={look?.arrow === false ? undefined : `url(#${markerId})`}
        />
        {draft.label ? (
          <text x={mid.x} y={mid.y} dy={-12} className="graph_customize_label is-edge" transform={`rotate(${(angle * 180) / Math.PI} ${mid.x} ${mid.y})`}>
            {draft.label.length > 24 ? `${draft.label.slice(0, 23)}…` : draft.label}
          </text>
        ) : null}
      </g>
      <circle cx={from.x} cy={from.y} r={r} className="graph_customize_ghost" style={{ fill: THEME.fill, stroke: THEME.border }} />
      <circle cx={to.x} cy={to.y} r={r} className="graph_customize_ghost" style={{ fill: THEME.fill, stroke: THEME.border }} />
    </svg>
  );
}

/* ── Options ────────────────────────────────────────────────────────── */

// Fill or Border: which one the picker and swatches paint. Each card shows
// its colour on a small node (a filled disc, a ring).
function PaintTarget({ target, value, shown, current, onPick }) {
  const fill = target === 'fill';
  return (
    <button
      type="button"
      role="radio"
      aria-checked={current}
      aria-label={fill ? 'Fill' : 'Border'}
      className={`graph_customize_paint${current ? ' is-current' : ''}`}
      onClick={onPick}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="graph_customize_paint_sample">
        {fill
          ? <circle cx="12" cy="12" r="8.5" style={{ fill: shown || THEME.fill, stroke: 'color-mix(in srgb, currentColor 25%, transparent)', strokeWidth: 1 }} />
          : <circle cx="12" cy="12" r="8" style={{ fill: 'none', stroke: shown || THEME.border, strokeWidth: 3.2 }} />}
      </svg>
      <span className="graph_customize_paint_text">
        <strong>{fill ? 'Fill' : 'Border'}</strong>
        <small>{value ? value.toUpperCase() : fill ? 'Theme' : 'Auto'}</small>
      </span>
    </button>
  );
}

function NodeOptions({ draft, initial, look, set }) {
  const [paintTarget, setPaintTarget] = useState('fill');
  const paint = nodePaint(draft, initial, look);
  const onFill = paintTarget === 'fill';
  const value = onFill ? draft.fill : draft.border;
  const pickerValue = value || (onFill ? '#9ca3af' : paint.border?.startsWith('#') ? paint.border : '#6b7280');
  const paintWith = (color) => set(onFill ? 'fill' : 'border', color);
  return (
    <>
      <Section title="Text">
        <input type="text" className="graph_customize_input" aria-label="Node label" placeholder="Label" value={draft.label} onChange={(event) => set('label', event.target.value)} />
        <textarea className="graph_customize_input" aria-label="Note" placeholder="Write a note…" rows={2} value={draft.note} onChange={(event) => set('note', event.target.value)} />
      </Section>
      <Section title="Paint">
        <div className="graph_customize_paints" role="radiogroup" aria-label="Paint">
          <PaintTarget target="fill" value={draft.fill} shown={paint.fill} current={onFill} onPick={() => setPaintTarget('fill')} />
          <PaintTarget target="border" value={draft.border} shown={paint.border} current={!onFill} onPick={() => setPaintTarget('border')} />
        </div>
        <div className="graph_customize_colour">
          <LiveColor label={onFill ? 'Fill colour' : 'Border colour'} value={pickerValue} onPick={paintWith} />
          <Swatches value={value} onPick={paintWith} />
          <button
            type="button"
            className={`graph_customize_chip${value ? '' : ' is-current'}`}
            aria-pressed={!value}
            title={onFill ? "Use the theme's fill" : 'Work the border out from the fill'}
            onClick={() => paintWith('')}
          >
            {onFill ? 'Theme' : 'Auto'}
          </button>
        </div>
        {onFill ? (
          <Field label="Colour effect">
            <Segments label="Colour effect" options={COLOR_BEHAVIORS} value={draft.colorBehavior} onPick={(next) => set('colorBehavior', next)} />
          </Field>
        ) : null}
      </Section>
      <Section title="Form">
        <Segments
          tiles
          label="Node shape"
          options={NODE_SHAPES}
          value={draft.shape}
          onPick={(next) => set('shape', next)}
          render={(option) => (
            <>
              <ShapeSign shape={option.value} />
              <span>{option.label}</span>
            </>
          )}
        />
        <Field label={`Size · ${draft.size}`}>
          <div className="graph_customize_range">
            <input
              type="range"
              aria-label="Node size"
              min={NODE_SIZES[0]}
              max={NODE_SIZES[NODE_SIZES.length - 1]}
              step={1}
              value={draft.size}
              style={{ '--fill': rangeFill(draft.size, NODE_SIZES[0], NODE_SIZES[NODE_SIZES.length - 1]) }}
              onChange={(event) => set('size', Number(event.target.value))}
            />
          </div>
        </Field>
      </Section>
    </>
  );
}

// The node's icon, under the preview: the button opens the album popover.
function IconPicker({ draft, set, mode, album, onAlbum }) {
  const icon = draft.icon ? iconForTheme(resolveIconUrl(draft.icon), mode) : '';
  return (
    <Section title="Icon">
      <div className="graph_customize_icon_row">
        <button
          type="button"
          className={`graph_customize_icon${album ? ' is-open' : ''}`}
          aria-label="Choose an icon"
          aria-expanded={album}
          aria-haspopup="dialog"
          title="Choose an icon"
          onClick={(event) => onAlbum(album ? null : event.currentTarget)}
        >
          {icon ? <img src={icon} alt="" /> : <span aria-hidden="true">+</span>}
        </button>
        <span className="graph_customize_hint">{draft.icon ? 'Click to change' : 'None · pick or upload'}</span>
        {draft.icon ? (
          <button type="button" className="graph_customize_chip is-danger" aria-label="Remove icon" onClick={() => set('icon', '')}>Remove</button>
        ) : null}
      </div>
    </Section>
  );
}

function EdgeOptions({ draft, set }) {
  return (
    <>
      <Section title="Text">
        <input type="text" className="graph_customize_input" aria-label="Link label" placeholder="Label" value={draft.label} onChange={(event) => set('label', event.target.value)} />
      </Section>
      <Section title="Paint">
        <div className="graph_customize_colour">
          <LiveColor label="Link colour" value={draft.color} onPick={(color) => set('color', color)} />
          <Swatches value={draft.color} onPick={(color) => set('color', color)} />
        </div>
      </Section>
      <Section title="Line">
        <Segments
          label="Line style"
          options={EDGE_STYLES.map((entry) => ({ value: entry.value, label: entry.value[0].toUpperCase() + entry.value.slice(1) }))}
          value={draft.style}
          onPick={(value) => set('style', value)}
        />
        <Field label={`Width · ${draft.width}`}>
          <div className="graph_customize_range">
            <input
              type="range"
              aria-label="Link width"
              min={EDGE_WIDTH_RANGE.min}
              max={EDGE_WIDTH_RANGE.max}
              step={0.5}
              value={draft.width}
              style={{ '--fill': rangeFill(draft.width, EDGE_WIDTH_RANGE.min, EDGE_WIDTH_RANGE.max) }}
              onChange={(event) => set('width', Number(event.target.value))}
            />
          </div>
        </Field>
      </Section>
    </>
  );
}

/* ── The icon album popover ─────────────────────────────────────────── */

// Over the popup (so the options do not grow a scrollbar), rising from the
// icon button: below it, or above when there is no room; inside the canvas.
const ALBUM_WIDTH = 300;
const ALBUM_HEIGHT = 262;
const albumPlace = (button, stage) => {
  const at = button.getBoundingClientRect();
  const box = stage.getBoundingClientRect();
  const width = Math.min(ALBUM_WIDTH, box.width - 16);
  const centre = at.left + at.width / 2 - box.left;
  const left = Math.max(8, Math.min(centre - 26, box.width - width - 8));
  const below = at.bottom - box.top + 10;
  const above = box.height - (at.top - box.top) + 10;
  const fitsBelow = below + ALBUM_HEIGHT <= box.height - 8;
  return {
    left, width, arrow: centre - left, ...(fitsBelow || at.top - box.top < ALBUM_HEIGHT ? { top: below } : { bottom: above }),
  };
};

// The album popover for another popup (conditional formatting): placed from
// its icon button within `stage` (the popup's backdrop).
export function IconAlbumPopover({ anchor, stage, ...props }) {
  const [place, setPlace] = useState(null);
  useLayoutEffect(() => {
    if (anchor && stage) setPlace(albumPlace(anchor, stage));
  }, [anchor, stage]);
  return place ? <AlbumPopover place={place} {...props} /> : null;
}

function AlbumPopover({ place, mode, value, onPick, onClose }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    (ref.current?.querySelector('.is-current') || ref.current?.querySelector('[role="option"]'))?.focus();
  }, []);
  useEffect(() => {
    const onDown = (event) => {
      if (ref.current?.contains(event.target) || event.target.closest?.('.graph_customize_icon')) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);
  const above = place.bottom != null;
  return (
    <div
      ref={ref}
      className={`graph_customize_album${above ? ' is-above' : ''}`}
      role="dialog"
      aria-label="Choose an icon"
      style={{
        left: place.left, width: place.width, top: place.top, bottom: place.bottom, '--album-arrow': `${place.arrow}px`,
      }}
    >
      <header className="graph_customize_album_head">
        <strong>Icons</strong>
        <span>Pick one, or upload an image</span>
        <button type="button" className="graph_customize_close" aria-label="Close icons" title="Close" onClick={onClose}>×</button>
      </header>
      <IconAlbum mode={mode} value={value} onPick={onPick} />
    </div>
  );
}

export default function GraphCustomizeBox({ nodes, edges, nodeValues, edgeValues, nodeLook = null, edgeLook = null, onApply, onClose }) {
  const ref = useRef(null);
  const titleId = useId();
  const [kind, setKind] = useState(nodes.length ? 'node' : 'edge');
  const [nodeDraft, setNodeDraft] = useState(nodeValues);
  const [edgeDraft, setEdgeDraft] = useState(edgeValues);
  const [mode, setMode] = useState('light');
  // Held down: the preview shows the element as it is now.
  const [comparing, setComparing] = useState(false);
  // The icon album popover: where it sits (null: closed).
  const [album, setAlbum] = useState(null);
  const albumRef = useRef(album);
  albumRef.current = album;
  const stageRef = useRef(null);
  const openAlbum = (button) => setAlbum(button && stageRef.current ? albumPlace(button, stageRef.current) : null);
  const closeAlbum = useCallback(() => setAlbum(null), []);
  useLayoutEffect(() => setMode(themeModeOf(ref.current)), []);
  useLayoutEffect(() => {
    ref.current?.querySelector('.graph_customize_options input, .graph_customize_options textarea')?.focus();
  }, [kind]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      // Escape closes the icon album first.
      if (albumRef.current) {
        setAlbum(null);
        ref.current?.querySelector('.graph_customize_icon')?.focus();
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const nodeChanges = nodes.length && nodeValues ? changesOf(nodeDraft, nodeValues, NODE_FIELDS) : {};
  const edgeChanges = edges.length && edgeValues ? changesOf(edgeDraft, edgeValues, EDGE_FIELDS) : {};
  const changed = Object.keys(nodeChanges).length + Object.keys(edgeChanges).length;
  const ids = kind === 'node' ? nodes : edges;
  const words = KINDS[kind];
  const apply = () => {
    if (!changed) return;
    onApply({ node: nodeChanges, edge: edgeChanges });
    onClose();
  };
  const reset = () => {
    setNodeDraft(nodeValues);
    setEdgeDraft(edgeValues);
  };
  const setNode = (field, value) => setNodeDraft((current) => ({ ...current, [field]: value }));
  const shownNode = comparing ? nodeValues : nodeDraft;
  const shownEdge = comparing ? edgeValues : edgeDraft;
  const kindChanged = Object.keys(kind === 'node' ? nodeChanges : edgeChanges).length > 0;

  return (
    <div ref={stageRef} className="graph_customize_backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !albumRef.current) onClose(); }}>
      <section ref={ref} className="graph_customize" role="dialog" aria-modal="true" aria-labelledby={titleId} onContextMenu={(event) => event.preventDefault()}>
        <header className="graph_customize_header">
          <div className="graph_customize_heading">
            <strong id={titleId}>Customize {words.one}</strong>
            <span title={ids.length > 1 ? 'Changes apply to all of them' : undefined}>{ids.length} selected</span>
          </div>
          {nodes.length && edges.length ? (
            <div className="graph_customize_tabs" role="tablist" aria-label="Customize">
              {['node', 'edge'].map((entry) => (
                <button
                  key={entry}
                  type="button"
                  role="tab"
                  aria-selected={kind === entry}
                  className={`graph_customize_tab${kind === entry ? ' is-current' : ''}`}
                  onClick={() => { setAlbum(null); setKind(entry); }}
                >
                  {KINDS[entry].title}
                  <span className="graph_customize_tab_count">{entry === 'node' ? nodes.length : edges.length}</span>
                </button>
              ))}
            </div>
          ) : null}
          <button type="button" className="graph_customize_close" aria-label="Close" title="Close (Esc)" onClick={onClose}>×</button>
        </header>
        <div className="graph_customize_body">
          <div className="graph_customize_options">
            {kind === 'node' ? (
              <NodeOptions draft={nodeDraft} initial={nodeValues} look={nodeLook} set={setNode} />
            ) : <EdgeOptions draft={edgeDraft} set={(field, value) => setEdgeDraft((current) => ({ ...current, [field]: value }))} />}
          </div>
          <figure className={`graph_customize_preview${comparing ? ' is-comparing' : ''}`}>
            {/* Held down (pointer, or Space / Enter), it shows the element as it is now. */}
            <div
              className={`graph_customize_stage${kindChanged ? ' can-compare' : ''}`}
              tabIndex={kindChanged ? 0 : -1}
              aria-label={kindChanged ? 'Preview: hold to compare with the current look' : 'Preview'}
              onPointerDown={(event) => { if (kindChanged) { event.preventDefault(); setComparing(true); } }}
              onPointerUp={() => setComparing(false)}
              onPointerLeave={() => setComparing(false)}
              onPointerCancel={() => setComparing(false)}
              onKeyDown={(event) => { if (kindChanged && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); setComparing(true); } }}
              onKeyUp={() => setComparing(false)}
              onBlur={() => setComparing(false)}
            >
              {kind === 'node'
                ? <NodePreview draft={shownNode} initial={nodeValues} look={nodeLook} mode={mode} />
                : <EdgePreview draft={shownEdge} initial={edgeValues} look={edgeLook} />}
            </div>
            <figcaption className="graph_customize_caption" aria-live="polite">
              {!kindChanged ? 'Preview' : comparing ? 'Old look' : 'Click and hold on the preview to compare'}
            </figcaption>
            {kind === 'node' ? <IconPicker draft={nodeDraft} mode={mode} album={Boolean(album)} onAlbum={openAlbum} set={setNode} /> : null}
          </figure>
        </div>
        <footer className="graph_customize_footer">
          <span className="graph_customize_hint">{changed ? `${changed} ${changed === 1 ? 'change' : 'changes'} to apply` : 'Nothing changed yet'}</span>
          <button type="button" className="graph_customize_button" disabled={!changed} onClick={reset}>Reset</button>
          <button type="button" className="graph_customize_button" onClick={onClose}>Cancel</button>
          <button type="button" className="graph_customize_button is-primary" disabled={!changed} onClick={apply}>Apply</button>
        </footer>
      </section>
      {album && kind === 'node' ? (
        <AlbumPopover
          place={album}
          mode={mode}
          value={nodeDraft.icon}
          onClose={closeAlbum}
          onPick={(path) => {
            setNodeDraft((current) => ({ ...current, icon: path }));
            setAlbum(null);
            ref.current?.querySelector('.graph_customize_icon')?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
