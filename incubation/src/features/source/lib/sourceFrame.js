// The Source window's frame (header, session chip, footer), restyled to
// match the Settings, Configuration and Libraries windows (analyst trial,
// 2026-11-23).
//
// ONE SWITCH: set SOURCE_RESTYLED to false and the Source window is exactly
// as it was before the trial. Nothing else needs to change: the restyle is
// only the two classes below, and every rule for them lives in
// src/styles/features/source-restyle.css.
export const SOURCE_RESTYLED = true;

// The restyled first page (choose the input mode and the connection):
//   'flow'  one calm surface (SourceStartFlow.jsx, source-start-flow.css);
//   'board' the page before it: steps on the left, cards on the right.
// Only while SOURCE_RESTYLED is on. With 'flow', the pages after it follow
// its side panel and spacing too (SourceSteps.jsx).
export const SOURCE_FIRST_PAGE = 'flow';
export const SOURCE_FLOW = SOURCE_RESTYLED && SOURCE_FIRST_PAGE === 'flow';

// How that page ('flow') lines its parts up: 'left' or 'center' (its path is
// centred either way).
export const SOURCE_FLOW_ALIGN = 'left';

// Added to the window's root (.source_window_workspace, and the first
// screen's .source_window_choose).
export const SOURCE_FRAME_CLASS = SOURCE_RESTYLED ? ' is-restyled source_theme_scope' : '';
