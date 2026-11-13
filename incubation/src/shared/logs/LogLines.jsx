import React from 'react';

import { MAX_RENDERED_LOG_LINES, toLogLine } from './logLines.js';

// Stream / activity log lines as time | level | message, shared by the Tasks
// window activity log and the Source window stream log. Each window styles
// the lines through its own class prefix (`${classPrefix}_line`, `_time`,
// `_text`, `_level`, `_note`, `_empty`) so its theme tokens apply.
//
const LogLine = React.memo(function LogLine({ entry, classPrefix }) {
  const line = toLogLine(entry);
  return (
    <div className={`${classPrefix}_line is-${line.level}${line.flagged ? ' is-flagged' : ''}`}>
      <span className={`${classPrefix}_time`} title={line.stamp || undefined}>{line.time}</span>
      <span className={`${classPrefix}_text`}>
        {line.level !== 'info' ? <span className={`${classPrefix}_level`}>{line.level}</span> : null}
        {line.text}
      </span>
    </div>
  );
});

// Renders the newest `maxLines` lines (busy streams keep thousands), with a
// note when older ones are left out, or `emptyText` when there are none.
export default function LogLines({ lines, classPrefix, emptyText, maxLines = MAX_RENDERED_LOG_LINES }) {
  const rendered = lines.length > maxLines ? lines.slice(-maxLines) : lines;
  if (!rendered.length) return <p className={`${classPrefix}_empty`}>{emptyText}</p>;
  return (
    <>
      {rendered.length < lines.length ? (
        <p className={`${classPrefix}_note`}>
          Showing the last {maxLines.toLocaleString()} of {lines.length.toLocaleString()} lines. Download the log for all of them.
        </p>
      ) : null}
      {rendered.map((entry, index) => <LogLine key={index} entry={entry} classPrefix={classPrefix} />)}
    </>
  );
}
