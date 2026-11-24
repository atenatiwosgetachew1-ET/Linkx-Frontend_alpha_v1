// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { connectionById } from '../lib/sourceConnections.js';
import { BATCH_STORAGE_TIMELINE_STEPS } from '../lib/sourceModel.js';
import { SourceSteps } from './SourceSteps.jsx';

afterEach(cleanup);

const renderSteps = (props = {}) => {
  const onStepChange = vi.fn();
  render(<SourceSteps activeStep="dataframe" steps={BATCH_STORAGE_TIMELINE_STEPS} accessibleSteps={new Set(['upload', 'dataframe'])} connection={connectionById('storage')} domainLabel="Banking · Batch" onStepChange={onStepChange} {...props} />);
  return { onStepChange };
};

describe('SourceSteps', () => {
  it('names the source and how far along it is', () => {
    renderSteps();
    expect(screen.getByRole('heading', { name: 'Storage' })).toBeInTheDocument();
    expect(screen.getByText('Banking · Batch')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Step 2 of 3' })).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByRole('contentinfo')).toHaveTextContent('NextRun ingestion');
  });

  it('opens a step already reached, marks the current one and locks the rest', async () => {
    const { onStepChange } = renderSteps();
    expect(screen.getByRole('button', { name: /^Dataframe/ })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: /^Stream/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /^Storage/ }));
    expect(onStepChange).toHaveBeenCalledWith('upload');
  });

  it('says so on the last step', () => {
    renderSteps({ activeStep: 'stream', accessibleSteps: new Set(['upload', 'dataframe', 'stream']) });
    expect(screen.getByText('Last step')).toBeInTheDocument();
  });
});
