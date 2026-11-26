import React from 'react';

// What the data's runs were made with, beside a window's other flags: shown
// for an override and for what was not recorded (shared/runSettings.js).
export default function RunRemarkFlag({ remark }) {
  if (!remark?.marked) return null;
  return (
    <span className={`graph_window_flag linkx_tooltip_anchor${remark.kind === 'overridden' ? ' is-warning' : ''}`} role="note" data-tooltip-placement="bottom" data-tooltip={remark.text}>
      {remark.label}
    </span>
  );
}
