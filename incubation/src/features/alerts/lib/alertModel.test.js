import { describe, expect, it } from 'vitest';

import {
  INTAKE, RESPONSE, alertNotice, analyseBlocker, canSendFeedback, feedbackImage, feedbackPayload, feedbackSizeProblem, noticeTypesFor, toAlertRecord,
} from './alertModel.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const raw = (fields = {}) => ({
  id: 7, alert_id: 7, external_reference_id: 'STR-1', title: 'Rapid transfers', payload: { subject: 'Rapid transfers', reason: 'Moved on within hours.' },
  intake_status: 'complete', response_status: 'awaiting_analysis', assignee_user_id: 'u1', assignee_username: 'Me', assigned_by: 'Desk',
  flags: { FUND_FLOW: 3, BAD: 'x' }, created_at: '2026-11-19T08:00:00Z', ...fields,
});

describe('STR alert model (analysis-results-plan Phase 4)', () => {
  it('reads the H-1/H-3 record; whether it is mine; unknown states fall back', () => {
    const alert = toAlertRecord(raw(), { userId: 'u1' });
    expect(alert).toMatchObject({ id: '7', reference: 'STR-1', subject: 'Rapid transfers', mine: true, intake: INTAKE.COMPLETE, response: RESPONSE.AWAITING, flags: { FUND_FLOW: 3 } });
    expect(toAlertRecord(raw({ intake_status: 'odd', response_status: 'odd' }), { userId: 'u2' })).toMatchObject({ mine: false, intake: INTAKE.COMPLETE, response: RESPONSE.AWAITING });
  });

  it('who may act, and why not', () => {
    const mine = (fields) => toAlertRecord(raw(fields), { userId: 'u1' });
    expect(analyseBlocker(mine())).toBe('');
    expect(analyseBlocker(mine({ intake_status: 'receiving' }))).toBe('Its data is still arriving from the parent service.');
    expect(analyseBlocker(mine({ intake_status: 'incomplete' }))).toMatch(/arrived incomplete/);
    expect(analyseBlocker(toAlertRecord(raw(), { userId: 'u2' }))).toBe('Assigned to Me; only the assignee can analyse it.');
    expect(analyseBlocker(mine({ response_status: 'feedback_sent' }))).toBe('Feedback was already sent for this alert.');
    expect(canSendFeedback(mine({ response_status: 'analysed' }))).toBe(true);
    expect(canSendFeedback(mine({ response_status: 'awaiting_analysis' }))).toBe(false);
  });

  it('notices follow the changes: arrival, data, assignment, delivery', () => {
    const at = (fields, userId = 'u1') => toAlertRecord(raw(fields), { userId });
    expect(noticeTypesFor(null, at({}))).toEqual(['received']);
    expect(noticeTypesFor(null, at({}, 'u2'))).toEqual([]);
    expect(noticeTypesFor(at({ intake_status: 'receiving' }), at({}))).toEqual(['intake_complete']);
    expect(noticeTypesFor(at({ intake_status: 'receiving' }), at({ intake_status: 'incomplete' }))).toEqual(['intake_incomplete']);
    expect(noticeTypesFor(at({}), at({ assignee_user_id: 'u9' }))).toEqual(['reassigned_away']);
    expect(noticeTypesFor(at({ assignee_user_id: 'u9' }), at({}))).toEqual(['assigned']);
    expect(noticeTypesFor(at({ response_status: 'feedback_sending' }), at({ response_status: 'feedback_sent' }))).toEqual(['feedback_sent']);
    expect(noticeTypesFor(at({ response_status: 'feedback_sent' }), at({ response_status: 'acknowledged' }))).toEqual(['acknowledged']);
    expect(noticeTypesFor(at({ response_status: 'feedback_sending' }), at({ response_status: 'feedback_failed' }))).toEqual(['feedback_failed']);
    expect(alertNotice('analysis_completed', at({}), { flags: { FUND_FLOW: 2, X: 0 } }).message).toBe('STR-1: 1 rule flagged (FUND_FLOW 2). Extract the results and report them back.');
  });

  it('the feedback payload carries only the included fields (H-5, extended)', () => {
    const alert = toAlertRecord(raw({ task_id: 't1' }), { userId: 'u1' });
    const draft = {
      verdict: 'suspicious', flags: { FUND_FLOW: 3 }, findings: 'One\n\n Two ', comments: ' Looks layered. ',
      include: { graph: true, table: false, charts: true }, graphImage: PNG, counts: { nodes: 4, links: 5 },
      tables: [{ title: 'Entities', source: 's', columns: [{ label: 'Label' }], rows: [['a']], total: 1 }],
      charts: [{ title: 'Degree', level: 'Node', image: 'data:image/svg+xml;base64,AAAA' }],
    };
    expect(feedbackPayload(alert, draft)).toEqual({
      task_id: 't1', verdict: 'suspicious', flags: { FUND_FLOW: 3 },
      summary: { findings: ['One', 'Two'], analyst_comments: 'Looks layered.' },
      include: { graph: true, table: false, charts: true, summary: true },
      // Only JPEG or PNG pictures (H-5): the SVG chart goes without one.
      graph: { image: PNG, nodes: 4, links: 5 }, tables: [], charts: [{ title: 'Degree', level: 'Node', image: null }],
    });
  });

  it('keeps the feedback inside the Service limits (H-5)', () => {
    expect(feedbackImage(PNG)).toBe(PNG);
    expect(feedbackImage(`data:image/png;base64,${'A'.repeat(4.1 * 1024 * 1024)}`)).toBeNull(); // over 3 MB
    const alert = toAlertRecord(raw(), { userId: 'u1' });
    const rows = Array.from({ length: 2500 }, (_, index) => [String(index)]);
    const payload = feedbackPayload(alert, {
      verdict: 'clean', findings: Array.from({ length: 250 }, (_, index) => `F${index}`).join('\n'), include: { table: true },
      tables: Array.from({ length: 25 }, () => ({ title: 'T', source: 's', columns: [{ label: 'L' }], rows, total: rows.length })),
    });
    expect(payload.tables).toHaveLength(20);
    expect(payload.tables[0].rows).toHaveLength(2000);
    expect(payload.summary.findings).toHaveLength(200);
    expect(feedbackSizeProblem({ small: true })).toBe('');
  });

  it('alerts by alert_id; mine by user id, username or SSO subject; a report without an alert is not one (H-3)', () => {
    expect(toAlertRecord(raw({ id: 70, alert_id: 'al-7' }), {}).id).toBe('al-7');
    expect(toAlertRecord(raw({ assignee_user_id: null }), { userId: 'u1', username: 'Me' }).mine).toBe(true);
    expect(toAlertRecord(raw({ assignee_user_id: null, assignee_username: null, assignee_sub: 'sso-1' }), { sub: 'sso-1' }).mine).toBe(true);
    expect(toAlertRecord(raw({ assignee_user_id: null, assignee_username: null }), { userId: 'u1' }).mine).toBe(false);
    const legacy = toAlertRecord(raw({ alert_id: null }), { userId: 'u1' });
    expect(legacy.isAlert).toBe(false);
    expect(analyseBlocker(legacy)).toMatch(/without an alert/);
    expect(noticeTypesFor(null, legacy)).toEqual([]);
    // A supervisor (alerts:read_all) may analyse an alert that is not theirs (H-4).
    expect(analyseBlocker(toAlertRecord(raw(), { userId: 'u2' }), { supervisor: true })).toBe('');
  });
});
