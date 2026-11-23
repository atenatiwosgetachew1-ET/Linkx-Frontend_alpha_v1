# Backend handoff: analysis tasks, evidence records and parent alert feedback

**For:** the backend team / backend agent of the LinkX link-analysis service.
**From:** the incubation frontend (`/var/www/linkx-frontend/incubation`).
**Updated:** 2026-11-19.
**Status:** proposal. The frontend is already built against the shapes below; where you change a shape, tell us and we adapt one adapter. Items are numbered **H-1…H-18** so answers can refer to them.

**How to use this file.** This file and `docs/backend-requests.md` (items **B-1…B-28**) together are the full list of what the frontend needs from the Service. This file covers analysis tasks, evidence records, the STR alert workflow, and session/connection confirmations. `backend-requests.md` covers security, configuration, the Source window and graph-file items. §5 lists the B-items that are still open.

**What the frontend already does (2026-11-19).**
- **Reports window:** three tabs (Alert reports, System reports, Service evidence) read through one adapter mapped to H-1.
- **Graph, Table and Chart windows:** evidence graphs, reports and PDFs (the Graph Report and the Evidence Report, with charts and tables).
- **Source window:** the dataframe filter (B-27 / B-28).
- **STR alert workflow** (§2c): the full procedure (arrival, assignment, Analyse, Extract results, Report back), with every notice. It runs today against a **mock parent-alert service** that uses exactly the shapes and events of H-3, H-4 and H-5. When you deliver them, the frontend switches from the mock to the live adapter with one setting (`VITE_PARENT_ALERTS=live`); no screen changes.

---

## 1. Context (read this first)

LinkX is a link-analysis **micro-service** inside a larger (parent) platform. It receives analysis work from four places:

| Requester | How it reaches LinkX | Involves a person? | Result goes to |
|---|---|---|---|
| **Analyst** | Interactive UI: Source window streams, quick-analysis panel | Yes | Audit record (task); optionally saved as evidence or used as alert feedback |
| **Parent service** | Forwards an alert (STR) **assigned to a specific LinkX user** for link analysis | Yes (the assignee) | **Feedback** sent back to the parent for that alert |
| **Sibling services** | Internal backend-to-backend calls with **service accounts** | No | Evidence record ("Service evidence") |
| **System** | Scheduled automated runs (xvigilance) | No | System reports |

**Case management lives in the parent.** LinkX does not own cases: it runs analyses and answers. It must not keep its own copy of case state or of who an alert is assigned to; it displays and enforces what the parent says.

**Target flow (one pipeline, no duplicated storage):**

```
Analyst (UI)    ──► Task ─┐
Parent alert    ──► Task ─┼─► Evidence record ──► Feedback to parent (parent alerts only)
System schedule ──► run  ─┤                       Reports window = views over evidence records
Sibling service ──► run  ─┘   (backend only; never shown as a UI task)
```

- **Task** = one execution (what ran, by whom, parameters, log, verdict). Analyst and parent-alert runs only.
- **Evidence record** = the stored result, exactly once, whoever asked.
- **Reports window** tabs (Alert reports / System reports / Service evidence) become **filters on one record shape**, not three different storages.

### What exists today (as the production frontend uses it)
- `GET /api/v1/reports/parent | /xvigilance | /evidence` with `limit, offset, status, score_band, min_fraud_score, q, start_date, end_date` → `{ data: [...], count }`. Records carry `id, status, external_reference_id, trace_id?, payload (JSON string or object: trace_id, has_graph, include_graph, nodes…), has_graph?, graph_available?, include_graph?, fraud_score?…`. Graph availability is currently guessed from ~10 different flags.
- `POST /api/v1/reports/xvigilance/state | /rewind`, `GET /api/v1/reports/xvigilance/health?limit=50`.
- Socket: the browser emits `str_report_register_receiver { session_id, socket_id }`; the backend emits `str_report_link_analysis { analysis session id, socket_emit list, wait_for_prepare?, defer_graph_open? }` and `notification { code: "str_report_prepare_receiver" }`. Production then opens a graph immediately, without recording it as work. **The incubation frontend does not port that pop-up** (analyst decision 2026-11-19). An STR is an alert report from the parent, recorded in Reports and worked through the procedure in §2c. Until H-3 to H-5 exist, `str_report_link_analysis` only raises a notice.
- Analysis jobs: `/jobs/:id` polling; stream logs over the socket (`log_stream_plug` / `stream_logs`); per-batch flag lines `[Info] Incremental analysis for batch <id> flags: {'FUND_FLOW': 9, ...}`.
- Earlier requests in `docs/backend-requests.md`: **B-20** (task list) and **B-21** (verdict in the log) are **superseded by H-2 and H-7** below.

---

## 2. Requests

### H-1. One evidence record shape for every requester (P0)
All three report endpoints return the **same shape**; keep the existing URLs for compatibility.

```jsonc
{
  "id": "ev_123",
  "requester_type": "parent" | "service" | "system" | "analyst",
  "requester_id": "parent system id | service-account client id | user id | null",
  "requester_name": "display name of the service account / user (optional)",
  "external_reference_id": "parent alert id (parent only)",
  "task_id": "task that produced it (analyst/parent) or null",
  "trace_id": "graph evidence id used by the graph fetch",
  "title": "short label, e.g. leading entity",
  "verdict": "clean" | "suspicious" | "undetermined",
  "flags": { "FUND_FLOW": 248, "LATE_NIGHT_TX": 2034 },   // final counts per rule
  "fraud_score": 87, "score_band": "high",
  "has_graph": true,                                      // ONE authoritative flag
  "status": "…",                                          // per requester type, see H-3 for parent
  "created_at": "ISO-8601", "updated_at": "ISO-8601",
  "payload": { }                                          // free-form, unchanged
}
```

- Add `requester_type` and `requester_id` filters (needed for the Service evidence tab: filter by service account, and "Service accounts | Analysts").
- **Replace the many graph flags with `has_graph`** (true only when the graph is actually retrievable).
- **Acceptance:** all three endpoints return this shape; `count` respects filters; `has_graph` matches what the graph fetch returns.

### H-2. Persist analysis tasks (P0, supersedes B-20)
`GET /api/v1/tasks?scope=mine|all&status=&origin=&limit=&offset=` → `{ data: [Task], count }`, newest first.

```jsonc
{
  "task_id": "…", "origin": "analyst" | "parent" | "system",
  "user_id": "…", "username": "…",
  "source_session_id": "…", "window_id": "…",
  "action": "Link Analysis", "rule": "…", "source": "col", "target": "col", "relationship": "…",
  "mode": "batch" | "realtime",
  "input": "short description of the data source",
  "dataframe": { "rows": 12500, "columns": 12, "tool": "neo4j" },
  "status": "queued" | "running" | "completed" | "terminated" | "failed",
  "verdict": "clean" | "suspicious" | "undetermined" | null,
  "flags": { "RULE": 123 },
  "external_reference_id": "parent alert id (origin parent)",
  "evidence_id": "evidence record id if saved / used as feedback",
  "log_file": "…", "message": "…",
  "started_at": "ISO", "ended_at": "ISO|null"
}
```

- **Sibling-service runs are not tasks** (not returned at all, or only with an explicit `origin=service` the UI never asks for).
- `scope=all` only for supervisors (H-9).
- Push task changes over the socket (`task_updated { task }`) so the Tasks window stays live without polling.
- Keep a stream running after `/close_source_window` while its job is active, or confirm the frontend must keep the source session open until the stream ends (what it does today).
- **Acceptance:** a run started in the UI appears in the list after a reload with its final status, verdict and flags.

### The STR alert procedure (read before H-3, H-4 and H-5)

**What an STR is here.** A suspicious transaction report forwarded by the parent service as an **alert assigned to one LinkX analyst**. The parent owns the case and the assignment; LinkX analyses and answers. In the frontend, the assigned analyst works it in **Reports ▸ Alert reports** through three steps:

1. **Analyse:** run link analysis on the alert's data. This records a task (Tasks window, origin "STR alert") and opens the alert's graph in a Graph window.
2. **Extract results:** gather four fields from that Graph window and its linked Table and Chart windows, or from the defaults when none are open:
   - **Graph:** a picture of it;
   - **Table:** the tables;
   - **Charts:** the chart pictures;
   - **Summary of findings:** verdict, rule flags, key findings and the **analyst's comments**.

   Each field can be included or left out.
3. **Report back:** send the feedback to the parent for that alert, then follow its delivery until it is acknowledged (or fails, and is retried).

The analyst gets a notice, with an "Open in Reports" action, at each stage:
- a new alert arrives;
- its data completes, or arrives incomplete;
- it is assigned to them, or reassigned away;
- its analysis starts, finishes or fails;
- the feedback is sent, acknowledged or fails.

A new or newly assigned alert also counts on the Reports launcher badge.

**The mock the frontend runs today** (`src/features/alerts/mock/mockAlertService.js`) produces exactly the records and events below. Please match them, or tell us what differs.

### H-3. Parent alerts: arrival, assignment and response status (P0)
Parent alert records (H-1, `requester_type: "parent"`) additionally carry:

```jsonc
{
  // Arrival: the alert's data as the parent sends it
  "intake_status": "receiving" | "complete" | "incomplete",
  "expected_records": 340, "received_records": 120,      // optional, shown while receiving
  "intake_note": "40 of 200 records did not arrive",      // why it is incomplete
  // Assignment (the parent's; LinkX never changes it)
  "assignee_user_id": "…", "assignee_username": "…",
  "assigned_at": "ISO", "assigned_by": "parent user / desk name",
  // Response
  "response_status": "awaiting_analysis" | "analysing" | "analysed" | "feedback_sent" | "acknowledged" | "feedback_failed",
  "response_note": "reason when feedback_failed",
  "task_id": "the alert's latest analysis task",
  "verdict": "clean" | "suspicious" | "undetermined" | null, "flags": { "RULE": 3 },
  "trace_id": "graph evidence id of the analysis (H-1)", "has_graph": true,
  "feedback_sent_at": "ISO|null", "acknowledged_at": "ISO|null",
  "parent_case_status": "…"   // optional read-only mirror for display
}
```

- **New response state `analysed`:** the run finished and feedback is not yet sent. The frontend also shows its own transient "Sending feedback" while the H-5 request is in flight; you do not need that state.
- **Only `intake_status: "complete"` alerts can be analysed.** The frontend blocks Analyse while `receiving` or `incomplete`, and says why.
- **Lists:** `GET /api/v1/reports/parent?assignee=me` (the default view, "Assigned to me") and `?assignee=all` (supervisors, "All alerts").
- **Socket events** to the assignee's browser sessions. The payload is `{ alert }` in the shape above.
  - `parent_alert_assigned`: a new alert, or one newly assigned to this user.
  - `parent_alert_reassigned`: sent to both the previous and the new assignee.
  - `parent_alert_updated`: any other change (data arriving or completing, response status, acknowledgement).

  The frontend works out what changed by comparing with the record it holds. One generic update event is enough, as long as it carries the full record. Users who were offline see the current state on their next list load.
- **Acceptance:**
  1. Assigning an alert in the parent makes it appear in the assignee's "Assigned to me" list, and raises `parent_alert_assigned` within seconds.
  2. Its data completing raises `parent_alert_updated` with `intake_status: "complete"`.

### H-4. Start link analysis for an alert (P0)
`POST /api/v1/reports/parent/:id/analysis` returns `{ task: Task, source_session_id, trace_id?, alert? }`.

- **Who may run it:** only the current assignee (or a supervisor, H-9); otherwise `403 { code: "not_assignee" }`. An alert whose data is not complete is refused with `409 { code: "intake_not_complete" }`.
- **What it does:** creates a task with `origin: "parent"` and `external_reference_id` (H-2), and sets `response_status: "analysing"`. It returns the updated `alert` when convenient.
- **Progress** goes over the socket to the assignee, as `parent_alert_analysis`:

  ```jsonc
  { "alert_id": "…", "task_id": "…", "phase": "progress", "line": "[Info] Applying rules: FUND_FLOW, …" }
  { "alert_id": "…", "task_id": "…", "phase": "completed", "flags": { "FUND_FLOW": 2, "STRUCTURING": 5 }, "trace_id": "…" }
  { "alert_id": "…", "task_id": "…", "phase": "failed", "message": "user-safe reason" }
  ```

  On `completed`, set `response_status: "analysed"`, with `flags`, `trace_id` and `has_graph: true` on the alert. The frontend then fetches the graph by `trace_id`, exactly as for Service evidence (`POST /get_graph` with the evidence payload), and opens it in a Graph window bound to the alert.
- **Replaces the unannounced `str_report_link_analysis` graph pop-up.** If the parent still pushes that event, include `external_reference_id` (and `task_id` when known), so the frontend can attach it to the alert instead of opening a bare graph.
- **Acceptance:** the run shows in Tasks, linked to the alert. Its progress lines show in the task. Its graph opens from the alert and from the task.

### H-5. Send the findings back to the parent (P0)
`POST /api/v1/reports/parent/:id/feedback`. The analyst chooses what goes in; fields left out are sent as `null` / `[]`.

```jsonc
{
  "task_id": "…",                                   // the analysis the findings come from
  "verdict": "clean" | "suspicious" | "undetermined",
  "flags": { "FUND_FLOW": 2 },
  "summary": {
    "findings": ["Abebe Alemu is the most connected entity, linked to 6 others.", "…"],   // one line each
    "analyst_comments": "free text, at most 4 000 characters"
  },
  "include": { "graph": true, "table": true, "charts": true, "summary": true },
  "graph": { "image": "data:image/jpeg;base64,…", "nodes": 18, "links": 25 },          // or null
  "tables": [{ "title": "Entities", "source": "…", "columns": ["Label", "ID", "Type", "Links", "Flags"], "rows": [["…"]], "total": 18 }],
  "charts": [{ "title": "Degree Centrality", "level": "Node", "image": "data:image/jpeg;base64,…" }]
}
```

- **Sizes the frontend sends:**
  - images are JPEG or PNG data URLs, roughly 100 to 600 KB each;
  - a table has at most 2 000 rows;
  - a typical request is under 5 MB.

  Please accept at least 10 MB on this endpoint, or tell us your limit so the frontend can warn first.
- **Who may send it:** only the current assignee (or a supervisor). A reassigned alert is refused with `409 { code: "reassigned" }`.
- **What it does:** creates or updates the evidence record (H-1) and delivers it to the parent. It answers `{ alert }` with `response_status: "feedback_sent"`. Later, raise `parent_alert_updated` with `"acknowledged"` when the parent confirms, or with `"feedback_failed"` and `response_note` when delivery fails. A synchronous delivery failure may instead answer `502 { code: "delivery_failed", message }`. The frontend shows it and offers **Retry**.
- **Idempotent** per `(alert id, task id)`: a retry must not deliver twice.
- **Please answer:**
  - How is feedback delivered (callback, queue, socket, the parent polling)?
  - Does the parent always acknowledge?
  - Can findings be corrected and sent again after `acknowledged`? Today the frontend locks the alert once the feedback is sent.

### H-6. Save an analyst's run as evidence (P1)
`POST /api/v1/reports/evidence { task_id, summary?, include_graph }` → evidence record with `requester_type: "analyst"`, `requester_id: <user id>`.

- Shown in the Service evidence tab under the "Analysts" filter (H-1 filters).
- Only the task's owner (or a supervisor).

### H-7. Verdict and flags in job results (P0, supersedes B-21)
- Include the final `flags` dict and `verdict` in `/jobs/:id`, in H-2 tasks and in H-1 records.
- Confirm the per-batch log counts are **cumulative** (the frontend shows the latest value per rule; if they are per batch it must add them up).
- Confirm a run with no flags logs `flags: {}` (or all zeros), so "Clean" is certain, and that the summary line format is stable.

### H-8. Analysis session limit (P1, confirmation)
- The frontend allows at most **3 analysis sessions per analyst**: open Source windows + background streams + running quick analyses (+ parent-alert runs).
- Confirm **sibling-service requests do not consume these sessions** (they are internal backend work).
- Does the backend enforce a limit itself (per user / global)? If yes, return a clear error (`429 { code: "session_limit", limit, in_use }`) so the UI can explain it.

### H-9. Permissions (P1)
Existing permission seen in production: `reports:read`, `analysis:run`. Proposed additions:

| Permission | Allows |
|---|---|
| `alerts:feedback` | Start analysis (H-4) and send feedback (H-5) on alerts assigned to you |
| `alerts:read_all` | See all parent alerts (`assignee=all`) and act as supervisor |
| `tasks:read_all` | `GET /api/v1/tasks?scope=all` |
| `evidence:create` | Save own runs as evidence (H-6) |

Return them in the existing permissions payload so the UI can hide actions; the backend must still enforce them.

### H-10. Neo4j connection lost when switching sessions (P0, bug to investigate)
**Reported:** the Neo4j connection stopped working suddenly. The frontend connect code (`/connect_to_tool` payload, password handling) has not changed, so we suspect the backend's **session switching** logic: the connection, or the saved credentials, are dropped or attached to the wrong session when the active session changes. This is a suspicion, not a confirmed cause; please check it.

What the frontend sends and expects:
- `POST /connect_to_tool` with `{ tool_name, url, username, password, database, source_id, session_id }`. `source_id` and `session_id` are both the **Source window's session id**, not the login session.
- When the analyst does not type the password, the config gives a masked `***` plus `password_ref` (`active_tool_password_ref` / `tool_password_ref` / `password_ref`), and the frontend sends that `password_ref` with the masked password.
- Success is `message: "Connected!"`. Streaming (`/live_batch_files`, `id: "stream"`) then expects the connection to still exist for that `session_id`; otherwise it returns `neo4j_not_connected_for_session`.

Please check:
1. **Switching sessions:** after the active/login session changes (re-login, token refresh, session config reload, a second Source window), are existing per-session Neo4j connections kept, or closed or overwritten? Is the connection keyed by the Source window's `session_id`, or by something that changes when the session switches?
2. **`password_ref` after a switch:** does the session config sent after a switch still contain a valid `password_ref` for the saved tool password? If the ref is missing or no longer resolves, the analyst sees "Enter the real Neo4j password" or "Please enter the Neo4j password again".
3. **Saved realtime credentials:** do persisted realtime credentials (`neo4j_credential_persistence_failed` path) survive the switch?
4. **Concurrent sessions:** two Source windows connected at once (two `session_id`s) must not share or replace each other's connection.
5. **Backend restart:** after a restart, does the backend return `neo4j_not_connected_for_session` (which the UI explains), not a generic 500?

**Frontend update (2026-11-14):** we found and fixed a frontend cause with the same symptom. After a Configuration save (new tool URL, new password, Clear, reset or import), Source windows that were already open kept the **old** URL and the **old** `password_ref`, so `/connect_to_tool` got stale details. Please re-test on the fixed frontend before digging; if it still fails, points 1–5 still need checking.

Expected outcome:
- A connection made for a `session_id` stays valid until it is explicitly disconnected (`/disconnect_tool`) or the session ends.
- If a connection is lost anyway, the backend returns the documented error so the UI can ask the analyst to reconnect.
- Please tell us the root cause and whether any frontend change is needed.

---

## 2b. Session, connection and streaming (H-11…H-16)

Found in a full audit of how the windows work together (2026-11-14). The frontend side is fixed. **Every call below is already made by the deployed production frontend (`src/App.jsx`)**: the incubation frontend now makes it the same way. Nothing here asks the backend to change the production flow; the requests are to keep it, confirm it, or answer reliably.

### H-11. Lock / unlock / logout / idle-timeout (P0, confirm)
The incubation frontend used to lock and unlock only in the browser. Every request after an unlock then answered `423`, which locked the screen again (a loop). It now makes production's calls:

| When | Request (body) | Production ref |
|---|---|---|
| Idle lock | `POST /auth/lock { id: "lock_session", reason: "idle_lock" }` | App.jsx ~17351 |
| Unlock | `POST /auth/unlock { id: "unlock_session", reason: "idle_lock" }`; a token in `results.token` / `token` / `access_token` is verified and used; then `POST /init { id: "init", existing_session, socket_id }` and its configuration is re-applied | ~11880–11943 |
| Unlock refused | the frontend signs out (`/auth/logout` with `reason: "unlock_failed"`) | ~17275–17295 |
| Sign out while locked | `POST /auth/unlock { reason: "logout_unlock" }` **first**, then `POST /auth/logout { id: "logout", reason }` | ~17216–17255 |
| Idle timeout | `POST /auth/idle-timeout { id: "idle_timeout", reason: "max_idle_expired", cleanup: true }`, then logout | ~17374 |

`404`/`405` from these endpoints are tolerated (treated as "not implemented"). Please confirm:
1. All five endpoints exist in the deployed backend with these bodies.
2. After `/auth/unlock`, the same `existing_session` is accepted by `/init` and keeps its source sessions, configuration and running streams.
3. Which status the backend returns for an unlock it refuses (wrong user, lock expired). Anything non-2xx except 404/405 signs the user out.

### H-12. A stream ended while its start request is still in flight (P1)
The user can press Terminate (Tasks) or close the Source window during "Starting stream…". The frontend now sends `POST /live_batch_files { id: "end_session", session_id, value: { window_id, session_id, log_file } }` **again** as soon as the start answer arrives, if that answer accepted the stream. Please confirm:
1. `end_session` is idempotent: a second call for an already-ended stream answers success or "No streaming found", never an error that leaves the stream half-closed.
2. An `end_session` that arrives **before** the start is fully registered either cancels it or is safe to repeat (the frontend repeats it once).

### H-13. Socket re-created on token renewal (P1)
Auto-login tokens last about 30 minutes, and a new socket is opened with the new token. The frontend then re-emits, on the **new** socket id:
- `log_stream_plug { session_id, filename }` for every running stream;
- `notification_subscribe { session_id }` for the main session and each open Source window session;
- `str_report_register_receiver { session_id, socket_id }` for the main session.

Production emits the same events on connect (App.jsx ~12246, ~12284; log plugs ~12400). Please confirm:
1. A stream started under the old socket and the old token keeps running and can be re-plugged from the new socket by the same user.
2. The old socket's subscriptions are dropped on disconnect, so lines are not delivered twice.

### H-14. Close and sign-out cleanup (P1, confirm)
- Closing a Source window sends production's `POST /close_source_window { id: "close_source_window", session_id, window_id, reason }` and unplugs the log.
- **Beyond production:** if a stream is running, the user chooses Stop or Keep running. **Stop** first sends the same `end_session` as production's Terminate button; **Keep running** sends `close_source_window` only after the stream ends.
- Sign-out and closing the browser tab send `end_session` with `keepalive` for running streams.

Please confirm `close_source_window` after `end_session` is valid, and that the backend's own cleanup for a lost browser (no `end_session` arrives) has a timeout we can document.

### H-15. Configuration shape (P2, confirm)
- **Secrets:** the frontend accepts a secret field either as a masked string (`"***"`) with `*_password_ref` beside it, or as an object `{ value | masked, password_ref }`, and normalises both like production (`normalizeLoadedConfiguration`). Please keep `/init`, `/configuration load` and the post-save response in one of these two shapes.
- **Saves:** like production, a configuration save carries the session's **current** `domain` / `active_domain`. A domain switch remains its own request (`{ id: "save", session_id, domain }`). Please confirm that a regular save with an unchanged domain does not re-project storage targets.
- **Password changes:** when the tool password changes, is the previous `password_ref` invalidated at once? Open Source windows in **this** browser now pick up the new ref, but other browsers or sessions keep the old one until they reload.

### H-16. Permissions in the actor payload (P1, confirm)
The frontend now hides or disables actions with production's permission names (App.jsx 446–468):
- `config:read`, `config:write`
- `source:create`, `source:connect`, `source:disconnect`
- `graph:create`, `graph:read`, `graph:link`
- `batch:upload`, `batch:query`
- `analysis:run`

Please confirm `/auth/me` (and `/auth/verify`) return them all, under the same keys as today, for every role. A permission missing from the payload now hides the action. The backend must still enforce every one of them.

### H-17. Graph windows: link and session lifetime (P1, confirm)
The incubation Graph window uses production's graph protocol unchanged:
- `POST /graph_link { id: "link" | "unlink", source_id, graph_window_id }`, with `graph_window_id` the window number as production sends it;
- `graph_status_subscribe` / `graph_status_unsubscribe` and `status` events;
- `POST /get_graph { id: "relationship", source_id, relationship }` with `include_chunks` job polling.

Please confirm:
1. **Linking while streaming only.** Production blocks a link unless the source is starting or streaming. Is that a backend rule, or only a UI rule?
2. **Finished sessions.** The Tasks window lets an analyst open the graph of a run that has already finished; it cannot be linked any more. That window subscribes to the session's status and calls `/get_graph` relationship for it. Does the backend keep answering both for a session whose stream finished normally (not terminated), and for how long?
3. **Terminate and close.** After `end_session` (terminate) or `close_source_window`, the frontend unlinks the linked Graph windows (production behaviour). Should it also send `/graph_link unlink` for them, or does the backend drop those links itself?

---

### H-18. Dataframe filter before ingestion (P1, see B-27 / B-28)
The Source window lets the analyst strip columns and keep or remove rows before ingestion. The filter travels as `value.dataframe_filter` on `POST /live_batch_files { id: 'stream' }` (**B-27**). A preview can be asked with `preview_DF_filter` (**B-28**). The full contract and acceptance tests are in `backend-requests.md`. Please also record the filter on the H-2 task, so an audit shows what was excluded.

## 3. Open questions (please answer in writing)

1. **User identity:** how does a parent user id map to a LinkX user (same SSO subject, username, or a mapping table)? Assignment (H-3) depends on it.
2. **Feedback delivery and acknowledgement** (H-5): mechanism, retries, can it be corrected after sending?
3. **Reassignment during a run:** we propose the running task continues, the previous assignee loses the right to send feedback, and the new assignee can reuse that task. OK?
4. **Sibling services and sessions** (H-8): confirmed outside the 3-session cap?
5. **System reports:** do xvigilance runs produce H-1 records directly (`requester_type: "system"`), or stay as today?
6. **Retention:** how long are tasks and evidence kept (audit/regulatory requirement)?

## 4. Priority and order
1. **P0:**
   - H-10 first (it blocks analysts now; re-test on the fixed frontend first);
   - H-11 (the lock loop);
   - then H-1, H-2 and H-7 (tasks and records);
   - then H-3, H-4 and H-5 (the STR procedure; the frontend is ready and waiting on them).
2. **P1:** H-6, H-8, H-9, H-12, H-13, H-14, H-16, H-17, H-18 (with B-27).
3. **P2:** H-15, B-28.

Until these land, the frontend:
- keeps tasks in memory, as today;
- reads the current report endpoints, mapped to H-1 in one adapter;
- runs the STR procedure on its mock.

Each switch is a single change.

## 5. Also open in `docs/backend-requests.md`
Items there that the frontend still waits on:
- **Security and contract (P0/P1):** B-1 to B-12. These are server-side RBAC, secrets, concurrency, error contract, job cancellation and so on.
- **Domain configuration:** B-23 (keep `actor_profile`), B-24 (keep `formatting_rules`).
- **Graph files and reports:** B-25 (encrypted `.lxg` graph files), B-26 (actor profile portraits readable by the report, same origin or CORS).
- **Source window:** B-27 (apply `dataframe_filter` before ingestion), B-28 (preview it).
- **Superseded by this file:** B-20 → H-2, B-21 → H-7, B-22 → this file as a whole.
