// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { resolveSourceDefaults } from '../lib/sourceConfig.js';
import { SOURCE_MODES } from '../lib/sourceModel.js';
import { writeBackgroundAnimationPreference } from '../../../utils/backgroundAnimations.js';
import { SourceStartFlow } from './SourceStartFlow.jsx';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const connections = [
  { id: 'upload', label: 'Upload file', icon: 'upload' },
  { id: 'broker', label: 'Message broker', icon: 'kafka' },
];
const flow = (props = {}) => (
  <SourceStartFlow connections={connections} inputMode={SOURCE_MODES.BATCH} connectionType="upload" onInputMode={vi.fn()} onConnection={vi.fn()} onOpenConfiguration={vi.fn()} {...props} />
);

describe('SourceStartFlow', () => {
  it('draws the path from the choices', () => {
    const { rerender } = render(flow());
    expect(screen.getByRole('img', { name: 'Upload file, in batches, into analysis' })).toBeInTheDocument();
    rerender(flow({ inputMode: SOURCE_MODES.REALTIME, connectionType: 'broker' }));
    expect(screen.getByRole('img', { name: 'Message broker, live, into analysis' })).toBeInTheDocument();
  });

  it('moves its dots only with background animations on, following the option at once', () => {
    const { container } = render(flow());
    expect(container.firstChild).toHaveClass('is-still');
    act(() => writeBackgroundAnimationPreference(true));
    expect(container.firstChild).not.toHaveClass('is-still');
    act(() => writeBackgroundAnimationPreference(false));
    expect(container.firstChild).toHaveClass('is-still');
  });

  it('shows what the connection needs once the configuration is given', () => {
    const onSetUpConnection = vi.fn();
    const { rerender } = render(flow());
    expect(screen.queryByRole('complementary', { name: 'What you need' })).not.toBeInTheDocument();
    rerender(flow({ defaults: resolveSourceDefaults({ domain: 'bank' }), connectionType: 'broker', onSetUpConnection }));
    const needs = screen.getByRole('complementary', { name: 'What you need' });
    expect(needs).toHaveTextContent('Banking');
    expect(needs).toHaveTextContent('3 to fill in next');
    within(needs).getByRole('button', { name: 'Save in Configuration' }).click();
    expect(onSetUpConnection).toHaveBeenCalledWith('connections');
    // Only the graph tool is missing: its own tab.
    rerender(flow({ defaults: resolveSourceDefaults({ domain: 'bank' }), connectionType: 'upload', onSetUpConnection }));
    within(screen.getByRole('complementary', { name: 'What you need' })).getByRole('button', { name: 'Save in Configuration' }).click();
    expect(onSetUpConnection).toHaveBeenLastCalledWith('tools');
  });
});
