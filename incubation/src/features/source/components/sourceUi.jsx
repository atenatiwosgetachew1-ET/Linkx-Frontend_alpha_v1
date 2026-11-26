import React from 'react';

export function SourceModeIcon({ type }) {
  const icons = {
    source: (
      <>
        <path d="M7 7h4" />
        <path d="M13 7h4" />
        <path d="M9 3v4" />
        <path d="M15 3v4" />
        <path d="M8 17h8a3 3 0 0 0 3-3V9H5v5a3 3 0 0 0 3 3Z" />
        <path d="M12 17v4" />
      </>
    ),
    batch: (
      <>
        <ellipse cx="12" cy="6" rx="6.5" ry="2.7" />
        <path d="M5.5 6v5c0 1.5 2.9 2.7 6.5 2.7s6.5-1.2 6.5-2.7V6" />
        <path d="M5.5 11v5c0 1.5 2.9 2.7 6.5 2.7s6.5-1.2 6.5-2.7v-5" />
      </>
    ),
    realtime: (
      <>
        <path d="M6.5 16.5a7.8 7.8 0 0 1 0-9" />
        <path d="M9.5 14a3.9 3.9 0 0 1 0-4" />
        <path d="M17.5 7.5a7.8 7.8 0 0 1 0 9" />
        <path d="M14.5 10a3.9 3.9 0 0 1 0 4" />
        <circle cx="12" cy="12" r="1.6" />
      </>
    ),
    upload: (
      <>
        <path d="M12 15V4" />
        <path d="M8 8l4-4 4 4" />
        <path d="M5 16v2.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V16" />
      </>
    ),
    // Elasticsearch mark (cap, bar, base): flat solid shapes filled with the
    // themed icon colour (currentColor), so hover/selected/theme still apply.
    elastic: (
      <g fill="currentColor" stroke="none">
        <path d="M4.5 9.2a8.5 8.5 0 0 1 16 0Z" />
        <rect x="3" y="10.4" width="15" height="3.2" rx="1.6" />
        <path d="M20.5 14.8a8.5 8.5 0 0 1-16 0Z" />
      </g>
    ),
    // Product marks for the data sources and the tool, simplified to flat
    // solid glyphs in the themed icon colour (currentColor) so they follow
    // hover / selected / theme like every other Source icon.
    // ClickHouse: four tall bars and a short centred bar.
    clickhouse: (
      <g fill="currentColor" stroke="none">
        <rect x="3" y="3" width="2.6" height="18" rx="0.4" />
        <rect x="7.4" y="3" width="2.6" height="18" rx="0.4" />
        <rect x="11.8" y="3" width="2.6" height="18" rx="0.4" />
        <rect x="16.2" y="3" width="2.6" height="18" rx="0.4" />
        <rect x="20.6" y="9.8" width="2.6" height="4.4" rx="0.4" />
      </g>
    ),
    // Apache Kafka: the node graph (three stacked nodes, two linked right).
    kafka: (
      <>
        <path d="M8 6.2v11.6M8 12l8.4-4.4M8 12l8.4 4.4" strokeWidth="1.6" />
        <g fill="currentColor" stroke="none">
          <circle cx="8" cy="4.2" r="2.2" />
          <circle cx="8" cy="12" r="3" />
          <circle cx="8" cy="19.8" r="2.2" />
          <circle cx="17.6" cy="7" r="2.2" />
          <circle cx="17.6" cy="17" r="2.2" />
        </g>
      </>
    ),
    // Apache Hadoop (HDFS): elephant silhouette facing left.
    hadoop: (
      <g fill="currentColor" stroke="none">
        <path d="M10.2 6.6h7.3c2.9 0 5 2.1 5 4.9 0 1.6-.6 2.9-1.6 3.8v4.1h-2.3v-3.1h-1.4v3.1h-2.3v-3.1h-3.3v3.1H9.3v-3.4c-.8-.5-1.4-1.2-1.8-2" />
        <circle cx="7.4" cy="10.4" r="4" />
        <path d="M3.4 10.6h2.5v5.2c0 .8.4 1.2 1 1.2v1.7c-2 0-3.5-1.1-3.5-3.3z" />
      </g>
    ),
    // Apache Hive: honeycomb cells.
    hive: (
      <g fill="currentColor" stroke="none">
        <path d="M7.5 3.2l3.9 2.25v4.5L7.5 12.2 3.6 9.95v-4.5z" />
        <path d="M16.5 3.2l3.9 2.25v4.5l-3.9 2.25-3.9-2.25v-4.5z" />
        <path d="M12 11l3.9 2.25v4.5L12 20l-3.9-2.25v-4.5z" />
      </g>
    ),
    // Neo4j: a graph of nodes (one large, three linked).
    neo4j: (
      <>
        <path d="M9 14l7.6-7.4M9 14l9 3.4M9 14l-3.6-8.4" strokeWidth="1.6" />
        <g fill="currentColor" stroke="none">
          <circle cx="9" cy="14" r="4.2" />
          <circle cx="17.2" cy="6" r="2.4" />
          <circle cx="18.8" cy="17.6" r="2.4" />
          <circle cx="5" cy="4.8" r="2" />
        </g>
      </>
    ),
    storage: (
      <>
        <path d="M3.5 6.5h6.2l2.1 2.2h8.7v9.8h-17z" />
        <path d="M3.5 10h17" />
      </>
    ),
    broker: (
      <>
        <circle cx="6" cy="7" r="2.4" />
        <circle cx="18" cy="7" r="2.4" />
        <circle cx="12" cy="18" r="2.4" />
        <path d="M8.1 8.3l2.9 7.4" />
        <path d="M15.9 8.3l-2.9 7.4" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.2" />
        <path d="M15.1 15.1 20 20" />
      </>
    ),
    cloud: (
      <>
        <path d="M7.2 18h9.8a4 4 0 0 0 .2-8 5.8 5.8 0 0 0-11.1-1.9A4.9 4.9 0 0 0 7.2 18Z" />
      </>
    ),
    library: (
      <>
        <path d="M4 19.5V5a2 2 0 0 1 2-2h12v15H6a2 2 0 0 0-2 2Z" />
        <path d="M4 19.5A2 2 0 0 0 6 21h12v-3" />
        <path d="M9 7h6" />
        <path d="M9 11h4" />
      </>
    ),
    configure: (
      <>
        <path d="M4 7h7" />
        <path d="M15 7h5" />
        <circle cx="13" cy="7" r="2" />
        <path d="M4 12h3" />
        <path d="M11 12h9" />
        <circle cx="9" cy="12" r="2" />
        <path d="M4 17h9" />
        <path d="M17 17h3" />
        <circle cx="15" cy="17" r="2" />
      </>
    ),
    table: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="1.8" />
        <path d="M4 9h16" />
        <path d="M4 14h16" />
        <path d="M9 4v16" />
        <path d="M15 4v16" />
      </>
    ),
    tool: (
      <>
        <path d="M14.7 6.3a4 4 0 0 0-5 5L4.5 16.5a2.1 2.1 0 0 0 3 3l5.2-5.2a4 4 0 0 0 5-5l-2.6 2.6-3-3z" />
      </>
    ),
    bolt: (
      <>
        <path d="M13 2 5 13h6l-1 9 8-12h-6z" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="11" height="11" rx="1.8" />
        <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
      </>
    ),
    clear: (
      <>
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
      </>
    ),
    link: (
      <>
        <path d="M10 13a5 5 0 0 0 7.1 0l1.4-1.4a5 5 0 0 0-7.1-7.1L10.6 5.3" />
        <path d="M14 11a5 5 0 0 0-7.1 0l-1.4 1.4a5 5 0 0 0 7.1 7.1l.8-.8" />
      </>
    ),
  };

  return (
    <svg className="source_window_mode_icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {icons[type] || icons.batch}
    </svg>
  );
}

export function StatusPill({ label, status = 'idle' }) {
  return (
    <span className={'source_window_status_pill is-' + status}>
      <span>{label}</span>
      <strong>{status.replace('-', ' ')}</strong>
    </span>
  );
}

export function Field({ label, children, className = '' }) {
  return (
    <label className={'source_window_field' + (className ? ' ' + className : '')}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function RequiredBadge({ filled }) {
  return (
    <em className={'source_window_required_badge' + (filled ? ' is-filled' : '')}>
      {filled ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><polyline points="5 12.5 10 17 19 7" /></svg>
      ) : (
        <span className="source_window_required_badge_dot" aria-hidden="true" />
      )}
      {filled ? 'Done' : 'Required'}
    </em>
  );
}

// The "?" on a field the run does not need (its default is used when empty).
const OPTIONAL_FIELD_TIP = 'Optional: left empty, the default is used.';

export function DataframeField({ label, icon = 'table', required = false, filled = false, children }) {
  const isMissing = required && !filled;
  return (
    <label className={'source_window_field source_window_dataframe_field' + (isMissing ? ' is-required-missing' : '')}>
      <span className="source_window_dataframe_field_label">
        <SourceModeIcon type={icon} />
        <strong>{label}</strong>
        {required ? <RequiredBadge filled={filled} /> : <i className="linkx_tooltip_anchor" role="img" aria-label={OPTIONAL_FIELD_TIP} data-tooltip={OPTIONAL_FIELD_TIP}>?</i>}
      </span>
      {children}
    </label>
  );
}

// Left side of the Source window header: icon tile, title with context
// tags (mode / step), and a one-line subtitle.
export function SourceWindowHeading({ icon, title, subtitle, tags = [], children }) {
  return (
    <>
      <span className="source_window_header_icon" aria-hidden="true">
        <SourceModeIcon type={icon} />
      </span>
      <div className="source_window_header_text">
        <div className="source_window_header_title_row">
          <h2>{title}</h2>
          {tags.map((tag) => (
            <span key={tag.label} className={'source_window_header_tag' + (tag.tone ? ' is-' + tag.tone : '')}>
              {tag.label}
            </span>
          ))}
        </div>
        <p>{subtitle}</p>
        {children}
      </div>
    </>
  );
}

export function SessionBadge({ sessionId, onCopySession }) {
  const displaySessionId = sessionId || 'Pending';

  return (
    <dl>
      <div className="source_window_session_chip">
        <dt>Session</dt>
        <dd>{displaySessionId}</dd>
        <span className="source_window_session_actions">
          <button
            type="button"
            aria-label="Copy window ID"
            className="source_window_tooltip_anchor"
            data-tooltip="Copy window ID"
            disabled={!sessionId}
            onClick={() => onCopySession(sessionId)}
          >
            <SourceModeIcon type="copy" />
          </button>
          <button
            type="button"
            aria-label="Link to Graph Window"
            className="source_window_tooltip_anchor"
            data-tooltip="Link to Graph Window"
            disabled
          >
            <SourceModeIcon type="link" />
          </button>
        </span>
      </div>
    </dl>
  );
}

export function WorkflowTimeline({ activeStep, steps, accessibleSteps, onStepChange }) {
  const activeIndex = steps.findIndex((s) => s.id === activeStep);
  const currentNumber = Math.max(activeIndex, 0) + 1;
  const progressPercent = steps.length ? Math.round((currentNumber / steps.length) * 100) : 0;

  return (
    <aside className="source_window_timeline" aria-label="Source workflow timeline">
      <div className="source_window_timeline_progress">
        <div className="source_window_timeline_progress_head">
          <span>Progress</span>
          <strong>{currentNumber}<small>/{steps.length}</small></strong>
        </div>
        <div
          className="source_window_timeline_progress_track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={currentNumber}
          aria-label={`Step ${currentNumber} of ${steps.length}`}
        >
          <span style={{ width: progressPercent + '%' }} />
        </div>
      </div>

      <div className="source_window_timeline_steps">
        {steps.map((step, index) => {
          const isLocked = !accessibleSteps.has(step.id);
          const isActive = activeStep === step.id;
          const isFulfilled = accessibleSteps.has(step.id) && index < activeIndex;
          const isPassed = index < activeIndex;

          const stateClass = isActive
            ? 'is-active'
            : isFulfilled
            ? 'is-fulfilled'
            : 'is-inactive';

          return (
            <React.Fragment key={step.id}>
            {index > 0 && (
              <span
                className={'source_window_timeline_connector' + (index - 1 < activeIndex ? ' is-passed' : '') + (index === steps.length - 1 ? ' is-stretch' : '')}
                aria-hidden="true"
              />
            )}
            <button
              type="button"
              className={`${stateClass}${isLocked ? ' is-locked' : ''}${isPassed ? ' is-passed' : ''}`}
              disabled={isLocked}
              aria-current={isActive ? 'step' : undefined}
              onClick={() => onStepChange(step.id)}
            >
              <span className="source_window_timeline_marker" aria-hidden="true">
                {isFulfilled ? (
                  <svg viewBox="0 0 24 24" focusable="false"><polyline points="5 12.5 10 17 19 7" /></svg>
                ) : isLocked && !isActive ? (
                  <svg viewBox="0 0 24 24" focusable="false"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                ) : (
                  index + 1
                )}
              </span>
              <strong>{step.label}</strong>
              <small>{step.value}</small>
            </button>
            </React.Fragment>
          );
        })}
      </div>
    </aside>
  );
}

// Collapses / expands a page toolbar (Storage and Elastic connection forms)
// to give the result list the vertical space.
export function ToolbarToggle({ collapsed, onToggle, controlsId, label = 'connection form' }) {
  const text = collapsed ? `Show ${label}` : `Hide ${label}`;
  return (
    <button
      type="button"
      className={'source_window_toolbar_toggle linkx_tooltip_anchor' + (collapsed ? ' is-collapsed' : '')}
      aria-expanded={!collapsed}
      aria-controls={controlsId}
      aria-label={text}
      data-tooltip={text}
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <polyline points="6 15 12 9 18 15" />
      </svg>
    </button>
  );
}
