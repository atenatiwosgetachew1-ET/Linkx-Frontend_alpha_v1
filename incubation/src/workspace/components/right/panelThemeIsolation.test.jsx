// @vitest-environment jsdom
// What the element picker offers for the parts of the right panel: only the
// panel's own variables, one set per part, which no window reads.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import React from 'react';
import postcss from 'postcss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { GraphFilterPanel, GraphInfoPanel, GraphSettingsPanel } from '../../../features/graph/components/panel/GraphPanels.jsx';
import { clearGraphStores, getGraphStore } from '../../../features/graph/lib/graphStore.js';
import { useActiveGraph } from '../../../features/graph/lib/useActiveGraph.js';
import { createTask, resetTasks } from '../../../features/tasks/lib/taskRegistry.js';
import { NotificationProvider } from '../../../shared/notifications/NotificationContext.jsx';
import { SessionContext } from '../../../shared/session/sessionContext.js';
import { expandScopedVariable, stateFreeSelector } from '../../../shared/theme/pickerSelectors.js';
import { PanelPage } from './PanelParts.jsx';
import WorkspaceOverviewTab from './WorkspaceOverviewTab.jsx';

const src = resolve(process.cwd(), 'src');
const read = (path) => readFileSync(resolve(src, path), 'utf8');
const imports = (path) => [...read(path).matchAll(/import '(\.[^']+\.css)'/g)].map((match) => match[1].replace('../', ''));
const files = [...readdirSync(resolve(src, 'styles/themes')).filter((name) => name.endsWith('.css')).map((name) => `styles/themes/${name}`), ...imports('app/App.jsx').filter((path) => !path.includes('themes/'))];
const rules = [];
files.forEach((file) => postcss.parse(read(file)).walkRules((rule) => {
  if (rule.parent.type === 'atrule' && /keyframes/.test(rule.parent.name)) return;
  const selectors = rule.selectors.filter((part) => !/:root|^html$|-scrollbar/.test(part));
  if (!selectors.length) return;
  const declared = [];
  const used = [];
  rule.walkDecls((decl) => {
    if (decl.prop.startsWith('--')) declared.push([decl.prop, decl.value]);
    else [...decl.value.matchAll(/var\((--[\w-]+)/g)].forEach((match) => used.push(match[1]));
  });
  if (declared.length || used.length) rules.push({ selectors: selectors.map(stateFreeSelector), declared, used, file });
}));
const matches = (element, rule) => rule.selectors.some((selector) => {
  try { return element.matches(selector); } catch { return false; }
});

const scopeOf = (element) => {
  const scoped = new Map();
  for (let current = element; current && current !== document.documentElement; current = current.parentElement) {
    const here = new Map();
    rules.forEach((rule) => { if (rule.declared.length && matches(current, rule)) rule.declared.forEach(([name, value]) => here.set(name, value)); });
    for (let i = 0; i < current.style.length; i += 1) if (current.style[i].startsWith('--')) here.set(current.style[i], current.style.getPropertyValue(current.style[i]));
    here.forEach((value, name) => { if (!scoped.has(name)) scoped.set(name, value); });
  }
  return scoped;
};
// The root-level variables an element's own rules lead to.
const variablesOf = (element) => {
  const scoped = scopeOf(element);
  return [...new Set(rules.filter((rule) => rule.used.length && matches(element, rule)).flatMap((rule) => rule.used).flatMap((name) => expandScopedVariable(name, scoped)))];
};
// Sizes, the app's tooltip and the app's scrollbars are not the panel's colours.
const isShared = (name) => /^--(fs-|tooltip-|central-scrollbar-|settings-stats-columns$)/.test(name);

const GRAPH = { id: 'graph-1', type: 'graph', title: 'Graph 1', metadata: { graphLinkSource: 's-1', graphSearch: { keyword: 'a', includeLinked: true, keys: ['name'] } } };
const workspace = { windows: [GRAPH], activeWindow: GRAPH, updateWindowMetadata: vi.fn() };
function Tab({ name }) {
  const graph = useActiveGraph(workspace);
  if (name === 'overview') return <WorkspaceOverviewTab displayName="Analyst" workspace={workspace} canOpenAssistant />;
  if (name === 'info') return <GraphInfoPanel graph={graph} />;
  if (name === 'filter') return <GraphFilterPanel graph={graph} />;
  return <GraphSettingsPanel graph={graph} />;
}
const show = (name) => render(
  <NotificationProvider>
    <SessionContext.Provider value={{ configuration: { active_domain: 'bank' }, isSocketConnected: true }}>
      <aside className="workspace_zone workspace_zone_right"><div className="workspace_context_panel"><div className="workspace_context_tab_body"><Tab name={name} /></div></div></aside>
    </SessionContext.Provider>
  </NotificationProvider>,
).container.querySelector('.right_page');

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'nbe-daylight');
  const store = getGraphStore('graph-1');
  store.replace({ nodes: [{ id: 1, name: 'Abebe' }, { id: 2, name: 'Almaz' }], edges: [{ from: 1, to: 2 }] });
  store.setAlertReport({ summary: '2 alerts', total: 2, high: 1 });
  store.setSelection(['1']);
  createTask({ title: 'Run' });
});
afterEach(() => {
  cleanup();
  clearGraphStores();
  resetTasks();
});

describe('the right panel’s theme variables', () => {
  ['overview', 'info', 'filter', 'settings'].forEach((name) => {
    it(`${name}: every part leads to the panel’s own variables only`, () => {
      const page = show(name);
      const foreign = new Map();
      const seen = new Map();
      [...page.querySelectorAll('*')].forEach((element) => {
        const key = `${element.tagName}.${element.getAttribute('class') || ''}<${element.parentElement.getAttribute('class') || element.parentElement.tagName}`;
        if (seen.has(key)) return;
        seen.set(key, true);
        variablesOf(element).filter((variable) => !variable.startsWith('--right-page-') && !isShared(variable))
          .forEach((variable) => foreign.set(variable, key));
      });
      expect([...foreign]).toEqual([]);
    }, 60000);
  });

  it('a card, its title, its rows and a button share no variable', () => {
    const page = show('overview');
    const parts = ['.right_block', '.right_block h4', '.right_rows dt', '.right_rows dd', '.right_toggle', '.right_alert', '.right_assist_open', '.settings_pill', '.settings_masthead']
      .map((selector) => [selector, variablesOf(page.querySelector(selector)).filter((name) => name.startsWith('--right-page-') && name !== '--right-page-line-focus' && !name.startsWith('--right-page-scrollbar-'))]);
    parts.forEach(([selector, names]) => expect([selector, names.length > 0]).toEqual([selector, true]));
    parts.forEach(([selector, names], index) => parts.slice(index + 1).forEach(([other, others]) => {
      expect([selector, other, names.filter((name) => others.includes(name))]).toEqual([selector, other, []]);
    }));
  }, 60000);

  it('no window reads the panel’s colours, nor any other page the parts’', () => {
    const readers = [];
    files.filter((file) => !/right-panel/.test(file)).forEach((file) => postcss.parse(read(file)).walkDecls((decl) => {
      if (/var\(--right-page-/.test(decl.value)) readers.push(`${file}: ${decl.prop}`);
      if (/var\(--right-/.test(decl.value) && decl.prop.startsWith('--') && !decl.prop.startsWith('--right-')) readers.push(`${file}: ${decl.prop}`);
    }));
    expect(readers).toEqual([]);
  });
});
