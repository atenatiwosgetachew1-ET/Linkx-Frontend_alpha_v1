// @vitest-environment jsdom
// "Keep running while I'm away": the Service owns the seats (B-38).
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import UnattendedSwitch from './UnattendedSwitch.jsx';
import { SessionContext } from '../../../shared/session/sessionContext.js';
import { applyServerTask, createTask, finishTask, getTask, linkServerTask, markTaskRunning, resetTasks, setServerTaskOwner, updateTask } from '../lib/taskRegistry.js';
import { isTaskUnattended, resetSeats } from '../lib/unattendedSeats.js';

afterEach(() => {
  cleanup();
  resetTasks();
  resetSeats();
});

const refuse = (status, data = {}) => Object.assign(new Error('x'), { status, data });
const start = (serverId = 'T1') => {
  const id = createTask({ windowId: `w-${serverId}`, sourceSessionId: '1_9', title: 'Link Analysis' });
  markTaskRunning(id);
  if (serverId) linkServerTask(id, serverId);
  return id;
};
// get, post: what the Service answers (a function may throw).
const show = async (taskId, { get = () => ({ seats: { total: 4, available: 2 } }), post = () => ({}) } = {}) => {
  const apiFetch = vi.fn(async (path, options = {}) => (options.method === 'POST' ? post(path, options.body) : get()));
  render(<SessionContext.Provider value={{ apiFetch, socket: null }}><UnattendedSwitch taskId={taskId} /></SessionContext.Provider>);
  await act(async () => {});
  return { apiFetch, posts: () => apiFetch.mock.calls.filter(([, options]) => options?.method === 'POST') };
};
const toggle = () => screen.getByRole('switch', { name: 'Keep running while I’m away' });
const granted = (path, body) => ({ task: { task_id: 'T1', status: 'running', unattended: body.on }, seats: { total: 4, available: body.on ? 1 : 2 } });

describe('Keep running while I’m away', () => {
  it('is off by default, and on only when the Service grants it', async () => {
    const id = start();
    const service = await show(id, { post: granted });
    expect(toggle()).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('Off: it stops about 2 minutes after your last browser is gone. 2 of 4 seats free.');
    await userEvent.click(toggle());
    expect(service.posts()[0]).toEqual(['/api/v1/tasks/T1/unattended', expect.objectContaining({ body: { on: true } })]);
    await waitFor(() => expect(toggle()).toBeChecked());
    expect(isTaskUnattended(getTask(id))).toBe(true);
    await userEvent.click(toggle());
    await waitFor(() => expect(toggle()).not.toBeChecked());
  });

  it.each([
    ['no seat is free', { get: () => ({ seats: { total: 4, available: 0 } }) }, 'No seat is free now'],
    ['there are no seats (too few workers)', { get: () => { throw refuse(404, { code: 'not_offered' }); } }, 'No seats are offered now'],
    ['the Service does not offer it', { get: () => { throw refuse(404); } }, 'does not offer this yet'],
    ['the answer has no seats', { get: () => ({ message: 'success' }) }, 'does not offer this yet'],
    ['the Service cannot be asked', { get: () => { throw refuse(503); } }, 'could not be asked'],
  ])('cannot be turned on when %s', async (_name, service, text) => {
    const id = start();
    const { posts } = await show(id, service);
    expect(toggle()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(text);
    expect(posts()).toEqual([]);
  });

  it.each([
    ['refuses (the last seat went meanwhile)', () => { throw refuse(409, { code: 'unattended_no_seat' }); }, 'No seat is free now'],
    ['does not confirm it', () => ({ task: { task_id: 'T1', status: 'running' } }), 'did not confirm'],
    ['confirms another run', () => ({ task: { task_id: 'T9', status: 'running', unattended: true } }), 'did not confirm'],
  ])('stays off when the Service %s', async (_name, post, text) => {
    const id = start();
    await show(id, { post });
    await userEvent.click(toggle());
    expect(await screen.findByText(new RegExp(text))).toBeInTheDocument();
    expect(toggle()).not.toBeChecked();
    expect(isTaskUnattended(getTask(id))).toBe(false);
  });

  it('one run per user, also one an earlier page started; free again when it ends', async () => {
    setServerTaskOwner({ userId: '1' });
    const other = applyServerTask({ task_id: 'OLD', status: 'running', user_id: 1, unattended: true, source_session_id: '3_9' });
    const id = start();
    await show(id);
    expect(toggle()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(`You can keep one run going, and task #${getTask(other).number} is it.`);
    act(() => { finishTask(other, 'completed'); });
    expect(toggle()).toBeEnabled();
    setServerTaskOwner({});
  });

  it('another user’s run does not count, and is not offered', async () => {
    setServerTaskOwner({ userId: '1' });
    const foreign = applyServerTask({ task_id: 'B', status: 'running', user_id: 2, unattended: true });
    const id = start();
    await show(id);
    expect(toggle()).toBeEnabled();
    cleanup();
    await show(foreign);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    setServerTaskOwner({});
  });

  it('waits for the Service to accept the run, and goes when it ends', async () => {
    const id = start('');
    await show(id);
    expect(toggle()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('once the Service has accepted the run');
    act(() => { finishTask(id, 'completed'); });
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('realtime, quick and waiting runs get none', async () => {
    const texts = [];
    for (const fields of [{ mode: 'realtime' }, { quick: true }, { status: 'starting' }]) {
      const id = start();
      act(() => { updateTask(id, fields); });
      await show(id);
      expect(toggle()).toBeDisabled();
      texts.push(screen.getByRole('status').textContent);
      cleanup();
      resetTasks();
    }
    expect(texts).toEqual(['Only a batch run can keep going without you.', 'Only a batch run can keep going without you.', 'Available once the run has started.']);
  });

  it('says until when', async () => {
    const id = start();
    act(() => { applyServerTask({ task_id: 'T1', status: 'running', unattended: true, unattended_until: new Date(2026, 10, 25, 14, 30).toISOString() }); });
    await show(id);
    expect(toggle()).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent(/until 14:30/);
  });
});
