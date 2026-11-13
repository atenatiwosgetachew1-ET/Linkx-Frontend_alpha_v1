// @vitest-environment jsdom
// Style picker reachability: renders every Source window page with the real
// stylesheets and checks that each visible element (text, control, icon) is
// matched by a Source-scoped rule whose colour comes from a CSS variable, the
// way the style picker (VisualElementPicker) looks them up. An element that
// fails could only be recoloured through global or parent tokens.
import React from 'react';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { resolveSourceDefaults } from '../lib/sourceConfig.js';
import { stateFreeSelector } from '../../../shared/theme/pickerSelectors.js';
import { DATAFRAME_STATUSES, defaultSourceState, SOURCE_MODES, SOURCE_STATUSES, STREAM_STATUSES, TOOL_STATUSES, UPLOAD_STATUSES } from '../lib/sourceModel.js';
import { WorkflowBody } from './steps/WorkflowBody.jsx';
import { ModeChooser } from './ModeChooser.jsx';
import { WorkflowTimeline, SourceWindowHeading, SessionBadge } from './sourceUi.jsx';

for (const f of ['src/styles/themes/tokens.css', 'src/styles/themes/nbe-daylight.css', 'src/main.css', 'src/styles/features/source.css', 'src/styles/features/loader.css', 'src/styles/features/window-controls.css']) {
  const s = document.createElement('style'); s.textContent = readFileSync(f, 'utf8'); document.head.appendChild(s);
}
const COLOR = /^(color|background|background-color|background-image|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|box-shadow|fill|stroke|accent-color|caret-color)$/;
const rules = [];
const flat = (list) => { for (const r of list) { if (r.selectorText) rules.push(r); else if (r.cssRules) flat(r.cssRules); } };
for (const sh of document.styleSheets) flat(sh.cssRules);
const declsOf = (r) => (r.cssText.match(/\{([\s\S]*)\}/)?.[1] || '').split(';').map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1)]);
const colorVarRules = rules.filter((r) => declsOf(r).some(([p, v]) => COLOR.test(p) && /var\(--/.test(v)));
const SCOPED = /source_window|_window_|\[class\*=/;
const ownColorVar = (el) => colorVarRules.some((r) => r.selectorText.split(',').some((part) => {
  if (!SCOPED.test(part) || /scrollbar/.test(part) || /\*\s*(::?[\w-]+)*\s*$/.test(part.trim())) return false;
  try { return el.matches(stateFreeSelector(part)); } catch { return false; }
}));
const report = new Map();
const audit = (label, ui) => {
  const { container } = render(<div className="workspace_window"><div className="workspace_window_body source_window_body">{ui}</div></div>);
  for (const el of container.querySelectorAll('.source_window_body *')) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const isControl = /^(INPUT|SELECT|TEXTAREA|BUTTON|svg)$/i.test(el.tagName);
    if (!hasText && !isControl && !el.className) continue;
    if (ownColorVar(el)) continue;
    const isIcon = el.tagName.toLowerCase() === 'svg';
    // Text and currentColor icons follow their parent's themable colour.
    if ((hasText || isIcon) && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName) && el.parentElement && ownColorVar(el.parentElement)) continue;
    if (el.type === 'file') continue; // visually hidden; the drop zone is styled
    if (!hasText && !isControl) continue; // pure layout wrapper
    const path = [];
    for (let n = el; n && !n.classList?.contains('source_window_body'); n = n.parentElement) {
      path.unshift(n.tagName.toLowerCase() + (typeof n.className === 'string' && n.className ? '.' + n.className.split(' ')[0] : ''));
    }
    const key = path.slice(-3).join(' > ');
    if (!report.has(key)) report.set(key, label + ' :: "' + (el.textContent || el.getAttribute('type') || '').trim().slice(0, 30) + '"');
  }
  cleanup();
};

const defaults = { ...resolveSourceDefaults({}), domain: 'bank', domains: [{ key: 'bank' }, { key: 'mf' }], search: { strictColumns: ['a'], fuzzyColumns: ['b'], dateColumn: '' } };
const b = (p) => ({ ...defaultSourceState.batch, ...p });
const handlers = { onSourceAction() {}, onToolAction() {}, onStorageSearch() {}, onElasticSearch() {}, onSwitchDomain() {} };
const wb = (mode, modeState, extra = {}) => <WorkflowBody mode={mode} modeState={modeState} windowId="w" sessionId="s" streamLogLines={[]} defaults={defaults} validationMessage="Validation" toolValidationMessage="Tool validation" toolOptions={['neo4j']} handlers={handlers} onPatchModeState={() => {}} onOpenConfiguration={() => {}} onOpenLibrary={() => {}} {...extra} />;
const info = { columns: ['x', 'y'], rules: ['r'], actions: [], totalRows: 1, totalColumns: 2, tool: 'neo4j' };

it('every visible Source element exposes a Source-scoped colour variable to the style picker', () => {
  audit('chooser', <ModeChooser sourceSessionId="s" onSelectMode={() => {}} onOpenConfiguration={() => {}} onCopySession={() => {}} />);
  audit('heading', <><header className="source_window_choose_header"><SourceWindowHeading icon="source" title="T" subtitle="S" tags={[{ label: 'Batch' }, { label: 'Step', tone: 'muted' }]}><SessionBadge sessionId="s" onCopySession={() => {}} /></SourceWindowHeading></header><WorkflowTimeline activeStep="dataframe" steps={[{ id: 'upload', label: 'U', value: 'u' }, { id: 'dataframe', label: 'D', value: 'd' }, { id: 'stream', label: 'S', value: 's' }]} accessibleSteps={new Set(['upload', 'dataframe'])} onStepChange={() => {}} /></>);
  audit('upload', wb('batch', b({ selectedFiles: ['a.csv'], selectedFileDetails: [{ name: 'a.csv', extension: 'csv', size: 10, lastModified: 1 }], uploadStatus: UPLOAD_STATUSES.UPLOADED, sourceStatus: SOURCE_STATUSES.UPLOADED })));
  audit('storage', wb('batch', b({ selectedConnectionType: 'storage', sourceStatus: SOURCE_STATUSES.CONNECTED, toolStatus: TOOL_STATUSES.FAILED, storageSearchStatus: 'done', storageSearchResults: [{ name: 'f', path: '/f', size: 1, date: 'd' }], selectedStorageFiles: [{ name: 'f', path: '/f', size: 1, date: 'd' }], storageSearchHasMore: true })));
  audit('storage-idle', wb('batch', b({ selectedConnectionType: 'storage' })));
  audit('search', wb('batch', b({ selectedConnectionType: 'search', sourceStatus: SOURCE_STATUSES.CONNECTED, searchMode: 'strict', elasticSearchStatus: 'done', elasticSearchResults: [{ name: 'r', size: 2 }] })));
  audit('broker', wb('batch', b({ selectedConnectionType: 'broker' })));
  audit('realtime', wb('realtime', { ...defaultSourceState.realtime }));
  audit('dataframe-map', wb('batch', b({ step: 'dataframe', dataframeStatus: DATAFRAME_STATUSES.READY, dataframeInfo: info, dataframeAction: 'Source / Target Mapping' })));
  audit('dataframe-link', wb('batch', b({ step: 'dataframe', dataframeStatus: DATAFRAME_STATUSES.READY, dataframeInfo: info })));
  audit('stream', wb('batch', b({ step: 'stream', streamStatus: STREAM_STATUSES.RUNNING }), { streamLogLines: [{ at: 't', level: 'info', message: 'x' }] }));
  expect([...report].map(([k, v]) => `${k}  (${v})`)).toEqual([]);
});
