import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

import { COLOR_SWATCHES } from '../lib/graphEditing.js';
import { albumSets, getIconSets, subscribeIconSets } from '../lib/iconSets.js';
import { iconForTheme, resolveIconUrl, subscribeIconThemes } from '../lib/graphIcons.js';
import { EVENT_TYPES, FONT_FACES } from '../lib/graphAnnotations.js';

// Annotation boxes (production graphs_basic.html GB:1113-1200), opened by
// clicking an annotation, beside it, kept inside the canvas: kind 'label'
// (text, font, size, colour), 'note' (comment box / text block: label and
// text), 'event' (label, date and time, event types) and 'object' (label,
// link, file, preview, open, clear). Text fields apply when committed (Enter
// or leaving the field, production's "change"); the colour picker applies as
// it moves.
//
// Production's node / edge adjust boxes (#nodeAdjustBox, #edgeAdjustBox,
// opened by a click) were replaced by the Customize popup
// (GraphCustomizeBox.jsx, toolbar ▸ Customize; analyst decision 2026-11-16);
// it reuses the colour, swatch and icon pieces exported here.
//
// values from annotationBoxValues; at { x, y } canvas pixels;
// onChange(field, value); onClose().
const OFFSET = 20; // production positionAdjustBox
const MARGIN = 10;

// A text field that reports on commit (Enter / blur), not per keystroke.
export function CommitField({ value, onCommit, multiline = false, ...props }) {
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
export function LiveColor({ value, onPick, label }) {
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

export function Swatches({ onPick, value = '' }) {
  return (
    <div className="graph_adjust_swatches" role="group" aria-label="Colours">
      {COLOR_SWATCHES.map((color) => (
        <button key={color} type="button" className={`graph_adjust_swatch${value.toLowerCase() === color.toLowerCase() ? ' is-current' : ''}`} style={{ backgroundColor: color }} aria-label={`Colour ${color}`} title={color} onClick={() => onPick(color)} />
      ))}
    </div>
  );
}

export function IconAlbum({ mode, onPick, value = '' }) {
  const iconSets = useSyncExternalStore(subscribeIconSets, getIconSets);
  const sets = albumSets(iconSets);
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
      {/* The sets turned on in Libraries ▸ Icon sets: the built-in one, then
          the analyst's own, each under its name when there are several. */}
      {sets.map((set) => (
        <React.Fragment key={set.id}>
          {sets.length > 1 ? <div className="graph_adjust_album_title" role="presentation">{set.name}</div> : null}
          {set.icons.map((icon) => (
            <button key={icon.id} type="button" role="option" aria-selected={value === icon.src} className={`graph_adjust_album_icon${value === icon.src ? ' is-current' : ''}`} title={icon.name} aria-label={icon.name} onClick={() => onPick(icon.src)}>
              <img src={set.builtIn ? iconForTheme(resolveIconUrl(icon.name), mode) : icon.src} alt="" />
            </button>
          ))}
        </React.Fragment>
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

  // Beside the element, inside the canvas (production positionAdjustBox).
  useLayoutEffect(() => {
    const box = ref.current;
    const stage = box?.parentElement;
    if (!box || !stage) return;
    const maxLeft = stage.clientWidth - box.offsetWidth - MARGIN;
    const maxTop = stage.clientHeight - box.offsetHeight - MARGIN;
    box.style.left = `${Math.max(MARGIN, Math.min(at.x + OFFSET, maxLeft))}px`;
    box.style.top = `${Math.max(MARGIN, Math.min(at.y + OFFSET, maxTop))}px`;
  }, [at.x, at.y, kind]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title = {
    label: 'Label', note: values.title || 'Note', event: 'Event Frame', object: 'Object',
  }[kind];
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
