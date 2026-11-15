import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  COLOR_BEHAVIORS, COLOR_SWATCHES, EDGE_STYLES, EDGE_WIDTH_RANGE, ICON_ALBUM, NODE_SHAPES, NODE_SIZES, albumIconPath,
} from '../lib/graphEditing.js';
import { iconForTheme, resolveIconUrl, subscribeIconThemes } from '../lib/graphIcons.js';
import { EVENT_TYPES, FONT_FACES } from '../lib/graphAnnotations.js';

// Production's node / edge adjust boxes (graphs_basic.html #nodeAdjustBox,
// #edgeAdjustBox): opened by clicking a node or an edge, beside it, kept
// inside the canvas. Node: label, icon (album or upload), note, colour
// (picker and swatches), size, colour effect, shape. Edge: label, colour,
// line style, width. Text fields apply when committed (Enter or leaving the
// field, production's "change"); the colour picker applies as it moves.
//
// Annotations have production's own boxes (GB:1113-1200): kind 'label'
// (text, font, size, colour), 'note' (comment box / text block: label and
// text), 'event' (label, date and time, event types) and 'object' (label,
// link, file, preview, open, clear).
//
// kind 'node' | 'edge' | 'label' | 'note' | 'event' | 'object'; values from
// nodeBoxValues / edgeBoxValues / annotationBoxValues; at { x, y } canvas
// pixels; onChange(field, value); onClose().
const OFFSET = 20; // production positionAdjustBox
const MARGIN = 10;

// Light or dark from the canvas background (as GraphCanvas), for the icons.
const themeModeOf = (element) => {
  if (!element) return 'light';
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = 'var(--graph-canvas-bg)';
  element.appendChild(probe);
  const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(getComputedStyle(probe).color);
  probe.remove();
  return rgb && (Number(rgb[1]) * 299 + Number(rgb[2]) * 587 + Number(rgb[3]) * 114) / 1000 < 128 ? 'dark' : 'light';
};

// A text field that reports on commit (Enter / blur), not per keystroke.
function CommitField({ value, onCommit, multiline = false, ...props }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const shared = {
    ...props,
    value: draft,
    onChange: (event) => setDraft(event.target.value),
    onBlur: commit,
  };
  return multiline
    ? <textarea {...shared} />
    : <input type="text" {...shared} onKeyDown={(event) => { if (event.key === 'Enter') commit(); }} />;
}

// The colour picker applies while it moves, at most once a frame.
function LiveColor({ value, onPick, label }) {
  const frame = useRef(0);
  const latest = useRef(value);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (
    <input
      type="color"
      className="graph_adjust_color"
      aria-label={label}
      title={label}
      value={value}
      onChange={(event) => {
        latest.current = event.target.value;
        if (frame.current) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          onPick(latest.current);
        });
      }}
    />
  );
}

function Swatches({ onPick }) {
  return (
    <div className="graph_adjust_swatches" role="group" aria-label="Colours">
      {COLOR_SWATCHES.map((color) => (
        <button key={color} type="button" className="graph_adjust_swatch" style={{ backgroundColor: color }} aria-label={`Colour ${color}`} title={color} onClick={() => onPick(color)} />
      ))}
    </div>
  );
}

function IconAlbum({ mode, onPick }) {
  const [, redraw] = useState(0);
  useEffect(() => subscribeIconThemes(() => redraw((value) => value + 1)), []);
  const upload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') onPick(reader.result);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };
  return (
    <div className="graph_adjust_album" role="listbox" aria-label="Icon album">
      {ICON_ALBUM.map((name) => (
        <button key={name} type="button" role="option" aria-selected="false" className="graph_adjust_album_icon" title={name} aria-label={name} onClick={() => onPick(albumIconPath(name))}>
          <img src={iconForTheme(resolveIconUrl(name), mode)} alt="" />
        </button>
      ))}
      <button type="button" className="graph_adjust_album_icon is-upload" title="Upload an image" aria-label="Upload an image" onClick={upload}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 16V4" /><path d="m6 10 6-6 6 6" /><path d="M4 20h16" /></svg>
      </button>
    </div>
  );
}

const Row = ({ label, children }) => (
  <div className="graph_adjust_field">
    <span>{label}</span>
    {children}
  </div>
);

function AnnotationFields({ kind, values, onChange }) {
  if (kind === 'label') {
    const font = (patch) => onChange('font', { face: values.face, size: values.size, color: values.color, ...patch });
    return (
      <>
        <Row label="Label"><CommitField aria-label="Label text" placeholder="Label text" value={values.label} onCommit={(value) => onChange('label', value)} /></Row>
        <Row label="Font">
          <div className="graph_adjust_inline">
            <select aria-label="Font family" value={values.face} onChange={(event) => font({ face: event.target.value })}>
              {FONT_FACES.map((face) => <option key={face} value={face}>{face}</option>)}
            </select>
            <input
              type="number"
              aria-label="Font size"
              min={8}
              max={96}
              value={values.size}
              onChange={(event) => {
                if (event.target.value !== '') font({ size: Math.max(8, parseInt(event.target.value, 10) || 18) });
              }}
            />
            <LiveColor label="Font colour" value={values.color} onPick={(color) => font({ color })} />
          </div>
        </Row>
      </>
    );
  }
  if (kind === 'note') {
    return (
      <>
        <Row label="Label"><CommitField aria-label="Label" placeholder="Label" value={values.label} onCommit={(value) => onChange('label', value)} /></Row>
        <Row label="Text"><CommitField multiline aria-label="Text" placeholder="Write note details..." value={values.note} onCommit={(value) => onChange('note', value)} /></Row>
      </>
    );
  }
  if (kind === 'event') {
    const types = new Set(values.types);
    return (
      <>
        <Row label="Label"><CommitField aria-label="Event frame label" placeholder="Event frame label" value={values.label} onCommit={(value) => onChange('label', value)} /></Row>
        <Row label="Date & Time">
          <input type="datetime-local" aria-label="Date and time" value={values.datetime} onChange={(event) => onChange('eventDateTime', event.target.value)} />
        </Row>
        <Row label="Event Types">
          <div className="graph_adjust_checks">
            {EVENT_TYPES.map((type) => (
              <label key={type.value}>
                <input
                  type="checkbox"
                  checked={types.has(type.value)}
                  onChange={(event) => {
                    const next = EVENT_TYPES.map((entry) => entry.value).filter((value) => (value === type.value ? event.target.checked : types.has(value)));
                    onChange('eventTypes', next);
                  }}
                />
                {type.label}
              </label>
            ))}
          </div>
        </Row>
      </>
    );
  }
  // Object attachment.
  const pickFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') onChange('attachmentFile', { dataUrl: reader.result, name: file.name || 'attachment', mime: file.type || '' });
    };
    reader.readAsDataURL(file);
  };
  return (
    <>
      <Row label="Label"><CommitField aria-label="Object label" placeholder="Object label" value={values.label} onCommit={(value) => onChange('label', value)} /></Row>
      <Row label="Attached Link">
        <div className="graph_adjust_inline">
          <CommitField aria-label="Attached link" placeholder="https://example.com or www.example.com" value={values.link} onCommit={(value) => onChange('attachmentLink', value)} />
          <button type="button" className="graph_window_button is-compact" aria-label="Open link" title="Open the link in a new tab" onClick={() => onChange('openLink')}>›</button>
        </div>
      </Row>
      <Row label="Attach File"><input type="file" aria-label="Attach file" onChange={pickFile} /></Row>
      <Row label="Attached Name"><input type="text" aria-label="Attached name" placeholder="No attachment" value={values.name} readOnly /></Row>
      {values.preview ? (
        <div className="graph_adjust_preview">
          {values.preview.kind === 'image' ? <img src={values.preview.source} alt={values.name || 'Image preview'} /> : null}
          {values.preview.kind === 'audio' ? <audio controls preload="metadata" src={values.preview.source} aria-label="Audio preview" /> : null}
          {values.preview.kind === 'video' ? <video controls preload="metadata" src={values.preview.source} aria-label="Video preview" /> : null}
        </div>
      ) : null}
      <div className="graph_adjust_buttons">
        <button type="button" className="graph_window_button is-compact" onClick={() => onChange('openFile')}>Open / Download File</button>
        <button type="button" className="graph_window_button is-compact" onClick={() => onChange('clearAttachment')}>Clear</button>
      </div>
    </>
  );
}

export default function GraphAdjustBox({ kind, values, at, onChange, onClose }) {
  const ref = useRef(null);
  const [album, setAlbum] = useState(false);
  const [mode, setMode] = useState('light');

  // Beside the element, inside the canvas (production positionAdjustBox).
  useLayoutEffect(() => {
    const box = ref.current;
    const stage = box?.parentElement;
    if (!box || !stage) return;
    const maxLeft = stage.clientWidth - box.offsetWidth - MARGIN;
    const maxTop = stage.clientHeight - box.offsetHeight - MARGIN;
    box.style.left = `${Math.max(MARGIN, Math.min(at.x + OFFSET, maxLeft))}px`;
    box.style.top = `${Math.max(MARGIN, Math.min(at.y + OFFSET, maxTop))}px`;
  }, [at.x, at.y, album, kind]);
  useLayoutEffect(() => setMode(themeModeOf(ref.current)), []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const iconUrl = kind === 'node' ? resolveIconUrl(values.icon) : '';
  const title = {
    node: 'Node', edge: 'Link', label: 'Label', note: values.title || 'Note', event: 'Event Frame', object: 'Object',
  }[kind];
  if (kind !== 'node' && kind !== 'edge') {
    return (
      <section ref={ref} className="graph_adjust_box is-annotation" aria-label={`${title} adjustments`} onContextMenu={(event) => event.preventDefault()}>
        <header className="graph_adjust_header">
          <strong className="graph_adjust_title">{kind === 'object' ? 'Object Attachment' : kind === 'label' ? 'Label Adjustment' : title}</strong>
          <button type="button" className="graph_adjust_close" aria-label="Close adjustments" title="Close" onClick={onClose}>×</button>
        </header>
        <AnnotationFields kind={kind} values={values} onChange={onChange} />
      </section>
    );
  }

  return (
    <section ref={ref} className="graph_adjust_box" aria-label={`${title} adjustments`} onContextMenu={(event) => event.preventDefault()}>
      <header className="graph_adjust_header">
        <CommitField className="graph_adjust_label" aria-label={`${title} label`} placeholder="No Label" value={values.label} onCommit={(value) => onChange('label', value)} />
        <button type="button" className="graph_adjust_close" aria-label="Close adjustments" title="Close" onClick={onClose}>×</button>
      </header>
      {kind === 'node' ? (
        <>
          <div className="graph_adjust_row">
            <button
              type="button"
              className={`graph_adjust_icon${album ? ' is-open' : ''}`}
              aria-label="Choose an icon"
              aria-expanded={album}
              title="Choose an icon"
              onClick={() => setAlbum((open) => !open)}
            >
              {iconUrl ? <img src={iconForTheme(iconUrl, mode)} alt="" /> : <span aria-hidden="true">+</span>}
            </button>
            <CommitField multiline className="graph_adjust_note" aria-label="Note" placeholder="Write a Note..." value={values.note} onCommit={(value) => onChange('note', value)} />
          </div>
          {album ? <IconAlbum mode={mode} onPick={(path) => onChange('icon', path)} /> : null}
          <div className="graph_adjust_row">
            <LiveColor label="Node colour" value={values.color} onPick={(color) => onChange('color', color)} />
            <div className="graph_adjust_column">
              <Swatches onPick={(color) => onChange('color', color)} />
              <div className="graph_adjust_sizes" role="group" aria-label="Sizes">
                {NODE_SIZES.map((size) => (
                  <button key={size} type="button" className="graph_adjust_size" style={{ width: 6 + size / 3, height: 6 + size / 3 }} aria-label={`Size ${size}`} title={`Size ${size}`} onClick={() => onChange('size', size)} />
                ))}
              </div>
            </div>
            <div className="graph_adjust_column">
              <select aria-label="Colour effect" title="Color changing behaviour" value={values.colorBehavior} onChange={(event) => onChange('colorBehavior', event.target.value)}>
                {COLOR_BEHAVIORS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <select aria-label="Node shape" title="Change Node shape" value={values.shape} onChange={(event) => onChange('shape', event.target.value)}>
                {NODE_SHAPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          </div>
        </>
      ) : (
        <div className="graph_adjust_row">
          <LiveColor label="Link colour" value={values.color} onPick={(color) => onChange('color', color)} />
          <div className="graph_adjust_column">
            <Swatches onPick={(color) => onChange('color', color)} />
          </div>
          <div className="graph_adjust_column">
            <select aria-label="Line style" title="Change Edge style" value={values.style} onChange={(event) => onChange('style', event.target.value)}>
              {EDGE_STYLES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <label className="graph_adjust_width">
              <span>Width</span>
              <input
                type="number"
                aria-label="Link width"
                title="Adjust Edge Weight"
                min={EDGE_WIDTH_RANGE.min}
                max={EDGE_WIDTH_RANGE.max}
                value={values.width}
                onChange={(event) => {
                  if (event.target.value !== '') onChange('width', event.target.value);
                }}
              />
            </label>
          </div>
        </div>
      )}
    </section>
  );
}
