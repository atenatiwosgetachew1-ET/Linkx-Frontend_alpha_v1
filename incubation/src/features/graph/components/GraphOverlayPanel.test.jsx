// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import GraphOverlayPanel, { GraphOverlayDock } from './GraphOverlayPanel.jsx';

afterEach(cleanup);
if (!window.PointerEvent) window.PointerEvent = class extends MouseEvent {};

function Card(props) {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <GraphOverlayDock>
      <GraphOverlayPanel label="Card" title="Card" summary="2 items" collapsed={collapsed} onToggleCollapsed={() => setCollapsed((value) => !value)} {...props}>
        <p>Body</p>
      </GraphOverlayPanel>
    </GraphOverlayDock>
  );
}

const layout = (panel) => {
  const dock = panel.parentElement;
  Object.defineProperty(dock, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(dock, 'clientHeight', { configurable: true, value: 600 });
  Object.defineProperty(panel, 'offsetLeft', { configurable: true, get: () => 480 });
  Object.defineProperty(panel, 'offsetTop', { configurable: true, get: () => 20 });
};

describe('GraphOverlayPanel', () => {
  it('a dragged card keeps its place when it is expanded or collapsed', async () => {
    render(<Card />);
    const panel = screen.getByRole('region', { name: 'Card' });
    layout(panel);
    fireEvent.pointerDown(panel.querySelector('header'), { button: 0, clientX: 600, clientY: 30 });
    fireEvent.pointerMove(document, { clientX: 300, clientY: 230 });
    fireEvent.pointerUp(document);
    expect(panel).toHaveClass('is-moved');
    // Re-renders used to rewrite className and drop the moved state.
    await userEvent.click(screen.getByRole('button', { name: 'Expand Card' }));
    expect(panel).toHaveClass('is-moved');
    expect(panel).not.toHaveClass('is-collapsed');
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Card' }));
    expect(panel).toHaveClass('is-moved');
    expect(panel.style.left).not.toBe('');
  });

  it('a press that does not travel is not a drag', () => {
    render(<Card />);
    const panel = screen.getByRole('region', { name: 'Card' });
    layout(panel);
    fireEvent.pointerDown(panel.querySelector('header'), { button: 0, clientX: 600, clientY: 30 });
    fireEvent.pointerMove(document, { clientX: 601, clientY: 31 });
    fireEvent.pointerUp(document);
    expect(panel).not.toHaveClass('is-moved');
  });

  it('with a bubble: folded to it (not dragged), × folds back, no fold button; open, it drags and folding sends it back', async () => {
    render(<Card bubble={<span>node</span>} />);
    const panel = screen.getByRole('region', { name: 'Card' });
    layout(panel);
    expect(panel).toHaveClass('is-bubble');
    expect(screen.getByRole('button', { name: 'Expand Card' })).toHaveAccessibleDescription(/Card.*2 items.*Click to open/);
    await userEvent.click(screen.getByRole('button', { name: 'Expand Card' }));
    expect(panel).not.toHaveClass('is-collapsed');
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(panel.querySelector('.graph_overlay_fold')).toBeNull();
    expect(panel.querySelector('.graph_overlay_resize')).not.toBeNull();
    fireEvent.pointerDown(panel.querySelector('header'), { button: 0, clientX: 600, clientY: 30 });
    fireEvent.pointerMove(document, { clientX: 300, clientY: 230 });
    fireEvent.pointerUp(document);
    expect(panel).toHaveClass('is-moved');
    expect(panel.style.left).not.toBe('');
    // Folded: back in the stack, and the bubble does not drag.
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Card' }));
    expect(panel).toHaveClass('is-bubble');
    expect(panel).not.toHaveClass('is-moved');
    expect(panel.style.left).toBe('');
    expect(panel.style.top).toBe('');
    fireEvent.pointerDown(panel.querySelector('.graph_overlay_bubble'), { button: 0, clientX: 600, clientY: 30 });
    fireEvent.pointerMove(document, { clientX: 300, clientY: 230 });
    fireEvent.pointerUp(document);
    expect(panel).not.toHaveClass('is-moved');
    // The next unfold starts in the stack.
    await userEvent.click(screen.getByRole('button', { name: 'Expand Card' }));
    expect(panel).not.toHaveClass('is-moved');
  });

  it('a dragged open card resizes from its top-left corner, keeping its bottom-right corner', async () => {
    render(<Card bubble={<span>node</span>} />);
    const panel = screen.getByRole('region', { name: 'Card' });
    layout(panel);
    Object.defineProperty(panel, 'offsetWidth', { configurable: true, get: () => parseFloat(panel.style.width) || 300 });
    Object.defineProperty(panel, 'offsetHeight', { configurable: true, get: () => parseFloat(panel.style.height) || 300 });
    Object.defineProperty(panel, 'offsetLeft', { configurable: true, get: () => parseFloat(panel.style.left) || 480 });
    Object.defineProperty(panel, 'offsetTop', { configurable: true, get: () => parseFloat(panel.style.top) || 20 });
    await userEvent.click(screen.getByRole('button', { name: 'Expand Card' }));
    fireEvent.pointerDown(panel.querySelector('header'), { button: 0, clientX: 600, clientY: 30 });
    fireEvent.pointerMove(document, { clientX: 300, clientY: 230 });
    fireEvent.pointerUp(document);
    expect(panel.style.left).toBe('180px');
    expect(panel.style.top).toBe('220px');
    fireEvent.pointerDown(panel.querySelector('.graph_overlay_resize'), { button: 0, clientX: 180, clientY: 220 });
    fireEvent.pointerMove(document, { clientX: 130, clientY: 200 });
    expect(panel.style.width).toBe('350px');
    expect(panel.style.height).toBe('320px');
    expect(panel.style.left).toBe('130px');
    expect(panel.style.top).toBe('200px');
    // Not past the canvas's left / top edge.
    fireEvent.pointerMove(document, { clientX: -900, clientY: -900 });
    expect(panel.style.left).toBe('0px');
    expect(panel.style.top).toBe('0px');
    expect(panel.style.width).toBe('480px');
    expect(panel.style.height).toBe('520px');
    fireEvent.pointerUp(document);
  });

  it('opens at its corner (out of the stack) with the grip facing into the canvas; a top-right card grows down and to the left', async () => {
    render(<Card bubble={<span>node</span>} corner="top-right" />);
    const panel = screen.getByRole('region', { name: 'Card' });
    layout(panel);
    Object.defineProperty(panel, 'offsetWidth', { configurable: true, get: () => parseFloat(panel.style.width) || 300 });
    Object.defineProperty(panel, 'offsetHeight', { configurable: true, get: () => parseFloat(panel.style.height) || 300 });
    expect(panel).not.toHaveClass('is-at-top-right');
    await userEvent.click(screen.getByRole('button', { name: 'Expand Card' }));
    expect(panel).toHaveClass('is-at-top-right');
    const grip = panel.querySelector('.graph_overlay_resize');
    expect(grip).toHaveClass('is-bottom-left');
    fireEvent.pointerDown(grip, { button: 0, clientX: 480, clientY: 320 });
    fireEvent.pointerMove(document, { clientX: 430, clientY: 380 });
    expect(panel.style.width).toBe('350px');
    expect(panel.style.height).toBe('360px');
    fireEvent.pointerUp(document);
    // Dragged, it leaves its corner; folded and reopened, it is back there.
    fireEvent.pointerDown(panel.querySelector('header'), { button: 0, clientX: 600, clientY: 30 });
    fireEvent.pointerMove(document, { clientX: 300, clientY: 230 });
    fireEvent.pointerUp(document);
    expect(panel).toHaveClass('is-moved');
    expect(panel).not.toHaveClass('is-at-top-right');
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Card' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand Card' }));
    expect(panel).toHaveClass('is-at-top-right');
  });

  it('a dragged card resized from its bottom-right grip keeps its top-left corner', async () => {
    render(<Card bubble={<span>node</span>} corner="top-left" />);
    const panel = screen.getByRole('region', { name: 'Card' });
    layout(panel);
    Object.defineProperty(panel, 'offsetWidth', { configurable: true, get: () => parseFloat(panel.style.width) || 300 });
    Object.defineProperty(panel, 'offsetHeight', { configurable: true, get: () => parseFloat(panel.style.height) || 300 });
    Object.defineProperty(panel, 'offsetLeft', { configurable: true, get: () => parseFloat(panel.style.left) || 0 });
    Object.defineProperty(panel, 'offsetTop', { configurable: true, get: () => parseFloat(panel.style.top) || 0 });
    await userEvent.click(screen.getByRole('button', { name: 'Expand Card' }));
    expect(panel.querySelector('.graph_overlay_resize')).toHaveClass('is-bottom-right');
    fireEvent.pointerDown(panel.querySelector('header'), { button: 0, clientX: 100, clientY: 10 });
    fireEvent.pointerMove(document, { clientX: 200, clientY: 110 });
    fireEvent.pointerUp(document);
    expect(panel.style.left).toBe('100px');
    fireEvent.pointerDown(panel.querySelector('.graph_overlay_resize'), { button: 0, clientX: 400, clientY: 400 });
    fireEvent.pointerMove(document, { clientX: 2000, clientY: 2000 });
    // Up to the canvas's right / bottom edge; left / top stay.
    expect(panel.style.width).toBe('700px');
    expect(panel.style.height).toBe('500px');
    expect(panel.style.left).toBe('100px');
    expect(panel.style.top).toBe('100px');
    fireEvent.pointerUp(document);
  });

  it('Escape folds an open bubble card when allowed, but not from a typed-in field', async () => {
    const { rerender } = render(<Card bubble={<span>node</span>} escapeFolds />);
    const panel = screen.getByRole('region', { name: 'Card' });
    await userEvent.click(screen.getByRole('button', { name: 'Expand Card' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panel).toHaveClass('is-bubble');
    rerender(<Card bubble={<span>node</span>} escapeFolds={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Expand Card' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panel).not.toHaveClass('is-collapsed');
  });
});

