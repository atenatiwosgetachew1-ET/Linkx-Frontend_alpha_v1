// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { WORKSPACE_WINDOW_TYPES } from '../state/workspaceTypes.js';

// Each body counts its mounts.
const mounts = {};
vi.mock('./WorkspaceWindowBody.jsx', () => ({
  default: function Body({ windowItem }) {
    useEffect(() => { mounts[windowItem.id] = (mounts[windowItem.id] || 0) + 1; }, [windowItem.id]);
    return <div data-testid={`body-${windowItem.id}`}>{windowItem.title}</div>;
  },
}));
// jsdom has no scrolling.
Element.prototype.scrollIntoView = () => {};
const { default: WindowDock } = await import('./WindowDock.jsx');

afterEach(() => {
  cleanup();
  Object.keys(mounts).forEach((key) => delete mounts[key]);
});

const windows = [
  { id: 'graph-1', type: WORKSPACE_WINDOW_TYPES.GRAPH, title: 'Graph 1' },
  { id: 'chart-1', type: WORKSPACE_WINDOW_TYPES.CHART, title: 'Chart 1' },
  { id: 'table-1', type: WORKSPACE_WINDOW_TYPES.TABLE, title: 'Table 1' },
];
const workspaceOf = (activeId) => ({ windows, activeWindow: windows.find((item) => item.id === activeId), focusWindow: () => {}, closeWindow: () => {}, reorderWindows: () => {}, updateWindowCustomTitle: () => {} });

describe('WindowDock', () => {
  it('a Chart window stays mounted (hidden) once shown; other windows mount with their tab', () => {
    const view = render(<WindowDock workspace={workspaceOf('graph-1')} />);
    expect(screen.queryByTestId('body-chart-1')).not.toBeInTheDocument();
    view.rerender(<WindowDock workspace={workspaceOf('chart-1')} />);
    expect(screen.getByTestId('body-chart-1').parentElement).toHaveStyle({ display: 'contents' });
    expect(screen.queryByTestId('body-graph-1')).not.toBeInTheDocument();
    view.rerender(<WindowDock workspace={workspaceOf('table-1')} />);
    expect(screen.getByTestId('body-chart-1').parentElement).toHaveStyle({ display: 'none' });
    expect(screen.getByTestId('body-table-1').parentElement).toHaveStyle({ display: 'contents' });
    view.rerender(<WindowDock workspace={workspaceOf('chart-1')} />);
    view.rerender(<WindowDock workspace={workspaceOf('graph-1')} />);
    view.rerender(<WindowDock workspace={workspaceOf('chart-1')} />);
    expect(mounts['chart-1']).toBe(1);
    expect(mounts['graph-1']).toBe(2);
    expect(mounts['table-1']).toBe(1);
  });
});
