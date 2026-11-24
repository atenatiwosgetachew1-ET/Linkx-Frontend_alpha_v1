import React from 'react';

import { PanelGlyph, PanelHead } from './SourceNeeds.jsx';

// The workflow pages' side panel, in the first page's panel style (analyst
// request 2026-11-23): the source in a ring that closes step by step, the
// steps, then what comes next. Takes the place of WorkflowTimeline
// (sourceUi.jsx) while the first page is 'flow' (lib/sourceFrame.js).
const ICONS = {
  // Connecting or uploading; the dataframe; the stream.
  upload: 'M12 3v11M7.5 9.5L12 14l4.5-4.5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  connect: 'M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v5',
  dataframe: 'M4 4h16v16H4zM4 10h16M10 4v16',
  stream: 'M3 12h4l3-8 4 16 3-8h4',
};
const TICK = 'M6 12.5l4 4 8-9';
const LOCK = 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3';

export function SourceSteps({ activeStep, steps, accessibleSteps, connection, domainLabel, capacity = null, onStepChange }) {
  const activeIndex = Math.max(steps.findIndex((step) => step.id === activeStep), 0);
  const number = activeIndex + 1;
  const next = steps[number];
  return (
    <aside className="source_window_flow_needs is-steps" aria-label="Source workflow timeline">
      <PanelHead
        icon={connection.icon}
        eyebrow={domainLabel}
        title={connection.label}
        state={`Step ${number} of ${steps.length}`}
        share={Math.round((number / steps.length) * 100)}
        progress={{ 'aria-label': `Step ${number} of ${steps.length}`, 'aria-valuemin': 0, 'aria-valuemax': steps.length, 'aria-valuenow': number }}
      />

      <ol className="source_window_flow_needs_list source_window_flow_steps">
        {steps.map((step, index) => {
          const locked = !accessibleSteps.has(step.id);
          const active = step.id === activeStep;
          const done = !locked && index < activeIndex;
          return (
            <li key={step.id}>
              <button
                type="button"
                className={'source_window_flow_need source_window_flow_step' + (active ? ' is-active' : done ? ' is-ok' : locked ? ' is-locked' : '')}
                disabled={locked}
                aria-current={active ? 'step' : undefined}
                onClick={() => onStepChange(step.id)}
              >
                <PanelGlyph className="source_window_flow_need_icon" d={ICONS[step.id] || ICONS.connect} />
                <strong className="source_window_flow_step_name">{step.label}</strong>
                <small className="source_window_flow_step_note">{step.value}</small>
                <span className="source_window_flow_need_mark" aria-hidden="true">
                  {done ? <PanelGlyph d={TICK} /> : locked ? <PanelGlyph d={LOCK} /> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <footer className="source_window_flow_needs_foot">
        <p className="source_window_flow_needs_next">
          <span className="source_window_flow_needs_next_label">{next ? 'Next' : 'Last step'}</span>
          {next ? next.value : steps[activeIndex].value}
        </p>
        {capacity}
      </footer>
    </aside>
  );
}
