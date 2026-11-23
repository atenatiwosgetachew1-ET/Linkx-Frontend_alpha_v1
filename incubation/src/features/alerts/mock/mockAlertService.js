// A mock parent-alert service (analyst decision 2026-11-19): STR alerts
// arriving, their data completing (or not), assignment, a link analysis run
// and the feedback delivery, with the record shapes and events asked of the
// Service (backend handoff H-3, H-4, H-5). It lets the frontend workflow be
// built and checked before the Service has it. Never used unless the mock
// is switched on (VITE_MOCK_PARENT_ALERTS, or the development switch in
// Reports).
//
// speed: a multiplier on the delays (0 = at once, for tests).

const DAY = 24 * 60 * 60 * 1000;

// A small deterministic random source (the same alert, the same graph).
const seeded = (seed) => {
  let value = [...String(seed)].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7) || 1;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
};

const FIRST = ['Abebe', 'Chaltu', 'Dawit', 'Eyerus', 'Fikru', 'Genet', 'Hailu', 'Iman', 'Kebede', 'Lulit', 'Meron', 'Nahom', 'Rahel', 'Selam', 'Tesfaye', 'Yonas'];
const LAST = ['Alemu', 'Bekele', 'Desta', 'Gebre', 'Haile', 'Mekonnen', 'Tadesse', 'Worku'];

// The alert's transaction graph: people, their accounts and the payments
// between the accounts (a hub, a pass-through chain and some noise).
export const mockAlertGraph = (alertId) => {
  const random = seeded(alertId);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const people = Array.from({ length: 9 }, (_, index) => ({
    id: `p${index}`, label: `${pick(FIRST)} ${pick(LAST)}`, node_identity: 'Person',
    full_name: `${pick(FIRST)} ${pick(LAST)} ${pick(LAST)}`, phone: `09${Math.floor(10000000 + random() * 89999999)}`,
  }));
  const accounts = people.map((person, index) => ({
    id: `a${index}`, label: `ACC-${1000 + Math.floor(random() * 9000)}`, node_identity: 'Account', bank: pick(['CBE', 'Awash', 'Dashen', 'Abyssinia']),
  }));
  const edges = people.map((person, index) => ({ id: `own${index}`, from: person.id, to: accounts[index].id, relationship: 'OWNS' }));
  const start = Date.now() - 30 * DAY;
  let n = 0;
  const pay = (from, to, amount, dayOffset) => {
    n += 1;
    const date = new Date(start + dayOffset * DAY + Math.floor(random() * DAY));
    edges.push({ id: `tx${n}`, from: accounts[from].id, to: accounts[to].id, relationship: 'PAYMENT', AMOUNT: Math.round(amount), TRANSACTIONDATE: date.toISOString().slice(0, 16) });
  };
  // The hub (a0) collects from many, then passes on through a chain.
  [1, 2, 3, 4, 5].forEach((from, index) => pay(from, 0, 9000 + random() * 900, 2 + index));
  [0, 6, 7, 8].forEach((from, index, chain) => { if (chain[index + 1] !== undefined) pay(from, chain[index + 1], 40000 - index * 600, 9 + index); });
  for (let i = 0; i < 6; i += 1) pay(Math.floor(random() * 9), Math.floor(random() * 9), 500 + random() * 4000, Math.floor(random() * 28));
  return { nodes: [...people, ...accounts], edges: edges.filter((edge) => edge.from !== edge.to) };
};

// What the mock "analysis" finds in that graph.
const mockFlags = (graph) => {
  const payments = graph.edges.filter((edge) => edge.relationship === 'PAYMENT');
  const incoming = new Map();
  payments.forEach((edge) => incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1));
  return {
    FUND_FLOW: payments.filter((edge) => edge.AMOUNT >= 30000).length,
    STRUCTURING: payments.filter((edge) => edge.AMOUNT >= 9000 && edge.AMOUNT < 10000).length,
    RAPID_MOVEMENT: Math.max(0, ...incoming.values()) >= 4 ? 1 : 0,
  };
};

export function createMockAlertService({ userId = 'me', username = 'You', speed = 1 } = {}) {
  const timers = new Set();
  let listener = null;
  let counter = 142;
  const records = new Map();
  const failOnce = new Set();
  const later = (ms, run) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, Math.round(ms * speed));
    timers.add(timer);
  };
  const now = () => new Date().toISOString();
  const send = (event) => listener?.(event);
  const save = (record, reason) => {
    records.set(String(record.id), record);
    send({ type: 'upsert', alert: { ...record }, reason });
    return record;
  };
  const base = (id, reference, subject, reason, fields = {}) => ({
    id, alert_id: id, external_reference_id: reference, requester_type: 'parent', title: subject, report_type: 'STR', source_system: 'Parent service (mock)',
    status: 'pending', mock: true, trace_id: `mock-${id}`, has_graph: true,
    payload: { subject, reason, amount: 45000 + (id.length * 1337) % 90000, currency: 'ETB' },
    intake_status: 'complete', response_status: 'awaiting_analysis',
    assignee_user_id: userId, assignee_username: username, assigned_by: 'Compliance desk (mock)', assigned_at: now(),
    created_at: now(), updated_at: now(), ...fields,
  });

  const seed = () => {
    save(base('mock-141', 'STR-2026-0141', 'Rapid transfers through a new account', 'Several deposits collected in a newly opened account were moved on within hours.'), 'seed');
    save(base('mock-139', 'STR-2026-0139', 'Deposits just under the reporting limit', 'Repeated cash deposits slightly below the reporting threshold across branches.', {
      intake_status: 'receiving', expected_records: 340, received_records: 120,
    }), 'seed');
    failOnce.add('mock-139');
    save(base('mock-137', 'STR-2026-0137', 'Payments to a flagged merchant', 'Card payments to a merchant on the watch list.', {
      response_status: 'acknowledged', verdict: 'suspicious', flags: { FUND_FLOW: 3 }, task_id: 'mock-task-137',
      feedback_sent_at: new Date(Date.now() - 2 * DAY).toISOString(), acknowledged_at: new Date(Date.now() - 2 * DAY + 3600000).toISOString(),
      created_at: new Date(Date.now() - 3 * DAY).toISOString(),
    }), 'seed');
    save(base('mock-135', 'STR-2026-0135', 'Unusual cross-border remittances', 'Remittances to several new beneficiaries abroad.', {
      assignee_user_id: 'other-analyst', assignee_username: 'A. Bekele',
    }), 'seed');
    // The arriving alert's data completes a little later.
    later(6000, () => {
      const record = records.get('mock-139');
      if (record?.intake_status === 'receiving') save({ ...record, intake_status: 'complete', received_records: 340, updated_at: now() }, 'intake_complete');
    });
    // A new alert arrives after a while.
    later(20000, () => api.simulate.newAlert());
  };

  const api = {
    kind: 'mock',
    // onEvent({ type: 'upsert', alert, reason } | { type: 'analysis', alertId,
    // phase: 'progress' | 'completed' | 'failed', line?, flags?, graph?, message? })
    start(onEvent) {
      listener = onEvent;
      seed();
      return () => api.stop();
    },
    stop() {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      listener = null;
    },
    async list() {
      return [...records.values()].map((record) => ({ ...record }));
    },
    // H-4: POST /api/v1/reports/parent/:id/analysis
    async startAnalysis(alertId) {
      const record = records.get(String(alertId));
      if (!record) throw Object.assign(new Error('Alert not found.'), { status: 404 });
      if (String(record.assignee_user_id) !== String(userId)) throw Object.assign(new Error('Only the assignee can analyse this alert.'), { status: 403, data: { code: 'not_assignee' } });
      const taskId = `mock-task-${alertId}-${Date.now().toString(36)}`;
      save({ ...record, response_status: 'analysing', task_id: taskId, updated_at: now() }, 'analysis_started');
      const graph = mockAlertGraph(alertId);
      const flags = mockFlags(graph);
      const lines = [
        '[Info] Dataframe created from the alert: 9 people, 9 accounts.',
        `[Info] Ingesting ${graph.edges.length} relationships…`,
        '[Info] Applying rules: FUND_FLOW, STRUCTURING, RAPID_MOVEMENT',
        `[Info] Incremental analysis for batch 1 flags: ${JSON.stringify(flags).replace(/"/g, "'")}`,
      ];
      lines.forEach((line, index) => later(700 * (index + 1), () => send({ type: 'analysis', alertId: String(alertId), taskId, phase: 'progress', line })));
      later(700 * (lines.length + 1), () => {
        const current = records.get(String(alertId));
        if (!current || current.task_id !== taskId) return;
        save({ ...current, response_status: 'analysed', flags, verdict: '', updated_at: now() }, 'analysis_completed');
        send({ type: 'analysis', alertId: String(alertId), taskId, phase: 'completed', flags, graph, traceId: current.trace_id });
      });
      return { task: { task_id: taskId, origin: 'parent', external_reference_id: String(alertId) }, source_session_id: `alert-${alertId}`, alert: { ...records.get(String(alertId)) } };
    },
    // H-5: POST /api/v1/reports/parent/:id/feedback
    async sendFeedback(alertId, body) {
      const record = records.get(String(alertId));
      if (!record) throw Object.assign(new Error('Alert not found.'), { status: 404 });
      if (String(record.assignee_user_id) !== String(userId)) throw Object.assign(new Error('The alert was reassigned; you can no longer send its feedback.'), { status: 409, data: { code: 'reassigned' } });
      await new Promise((resolve) => { later(1200, resolve); });
      if (failOnce.has(String(alertId))) {
        failOnce.delete(String(alertId));
        save({ ...record, response_status: 'feedback_failed', response_note: 'The parent service did not answer in time (mock delivery failure).', updated_at: now() }, 'feedback_failed');
        throw Object.assign(new Error('The parent service did not answer in time (mock delivery failure).'), {
          status: 502,
          data: { code: 'delivery_failed', detail: 'The parent service did not answer in time (mock delivery failure).', retrying: true, alert: { ...records.get(String(alertId)) } },
        });
      }
      const sent = save({ ...record, response_status: 'feedback_sent', verdict: body.verdict, flags: body.flags, response_note: '', feedback_sent_at: now(), updated_at: now() }, 'feedback_sent');
      later(4000, () => {
        const current = records.get(String(alertId));
        if (current?.response_status === 'feedback_sent') save({ ...current, response_status: 'acknowledged', acknowledged_at: now(), updated_at: now() }, 'acknowledged');
      });
      return { outcome: 'delivered', alert: { ...sent } };
    },
    // Development controls (Reports ▸ Alert reports, mock on).
    simulate: {
      newAlert() {
        counter += 1;
        const id = `mock-${counter}`;
        const incomplete = counter % 2 === 1;
        save(base(id, `STR-2026-0${counter}`, incomplete ? 'Structured withdrawals at ATMs' : 'Circular transfers between related accounts', 'Forwarded by the parent service for link analysis.', {
          intake_status: 'receiving', expected_records: 200, received_records: 40,
        }), 'received');
        later(5000, () => {
          const record = records.get(id);
          if (record?.intake_status !== 'receiving') return;
          save(incomplete
            ? { ...record, intake_status: 'incomplete', received_records: 160, intake_note: '40 of 200 records did not arrive', updated_at: now() }
            : { ...record, intake_status: 'complete', received_records: 200, updated_at: now() }, incomplete ? 'intake_incomplete' : 'intake_complete');
        });
        return id;
      },
      reassign(alertId) {
        const record = records.get(String(alertId));
        if (!record) return;
        save({ ...record, assignee_user_id: 'other-analyst', assignee_username: 'A. Bekele', assigned_at: now(), updated_at: now() }, 'reassigned');
      },
    },
  };
  return api;
}
