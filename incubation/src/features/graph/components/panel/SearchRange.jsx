import React from 'react';

// Two handles on one line, 0 to `range.max`. Moving one writes the range
// (onChange); letting go of it searches (onCommit). `range` null: `hint`
// says why there is none.
export default function SearchRange({ range, from, to, hint, label, onChange, onCommit }) {
  const steps = range?.steps || 1;
  const low = range ? range.stepOf(from) : 0;
  const high = range ? range.stepOf(to) : 1;
  const show = (value) => value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  const common = { type: 'range', min: 0, max: steps, step: 1, disabled: !range, onPointerUp: onCommit, onKeyUp: (event) => { if (/^(Arrow|Page|Home|End)/.test(event.key)) onCommit(); } };
  // Both at the top end: the lower one stays reachable.
  const lowOnTop = low >= steps;
  return (
    <div className={`right_range${range ? '' : ' is-disabled'}`} role="group" aria-label="Range">
      <div className="right_range_head">
        <span>{label}</span>
        {range ? <strong>{show(from)} – {show(to)}</strong> : null}
      </div>
      <div className="right_range_track" style={{ '--range-from': low / steps, '--range-to': high / steps }}>
        <input {...common} className={lowOnTop ? 'is-on-top' : undefined} aria-label="From" aria-valuetext={range ? show(from) : undefined} value={low} onChange={(event) => onChange(range.valueAt(Math.min(Number(event.target.value), high)), to)} />
        <input {...common} aria-label="To" aria-valuetext={range ? show(to) : undefined} value={high} onChange={(event) => onChange(from, range.valueAt(Math.max(Number(event.target.value), low)))} />
      </div>
      {range ? <div className="right_range_ends" aria-hidden="true"><span>0</span><span>{show(range.max)}</span></div> : <small className="right_hint">{hint}</small>}
    </div>
  );
}
