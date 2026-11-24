# Frontend follow-up to the Service: open items

**From:** the incubation frontend. **Date:** 2026-11-20, updated 2026-11-24.
**Follows:** our §8 reply (`frontend-reply-2026-11-20.md`). Full specs are in `backend-requests.md` under the B-numbers below.

**Where things stand:** the frontend is aligned with H-1 to H-18 in code, and its unit tests, lint and build passed on 2026-11-21 (810 tests). It has not yet been run from the screens against your Service.

Please answer item by item, in this numbering.

## A. Requests (please build)

0. **B-33: user creation fails with a bare `validation_error` (P1, reported 2026-11-21).** Settings ▸ Users ▸ Create user is refused, and the answer gives no reason.
   - **What we send** is the same body as production: `username`, `password` (8+ characters), `display_name`, `roles` (one of `superuser`, `admin`, `analyst`, `viewer`), `permissions` (keys from `GET /auth/admin/permissions`) and `is_active`.
   - **Please tell us which field was refused this time,** and why.
   - **Put the reason in every refusal:** `400 { message: "validation_error", code, detail, invalid_fields }`, for example `username_taken`, `invalid_username`, `password_policy`, `unknown_permissions`, `invalid_roles` or `cannot_grant_permissions`.
   - **Publish the rules:**
     - the password policy;
     - the username pattern;
     - which roles each caller may create;
     - whether an admin may grant permissions they don't hold;
     - whether `alerts:ingest` and `auth:verify` may be assigned.

   The frontend now shows whatever reason you send, and will check the same rules before sending.
   - **A possible cause, changed on our side:** the privilege picker let an admin grant permissions their own account doesn't hold, and we asked you to refuse that in B-1. We don't know whether you do, so this is a guess, not a finding. The frontend now locks those, and sends only what the signed-in account holds.
     - Please say whether that rule exists today, for create and for update. If it doesn't, the lock is stricter than you need.
     - Please say whether a holder of `superuser:manage` is exempt.
   - **Accounts with `admin` or `superuser`:** the frontend no longer lets an account without `superuser:manage` edit or switch them on or off. Saving would send that role back, and we assume you refuse that. Please confirm.
   - **Locked accounts (`is_locked`):** we have no way to unlock one. Is there an admin endpoint for it?

1. **B-30: count analysis sessions as strictly as the frontend (P1).** This is the analyst's decision: the Service enforces the limit, so it must be at least as strict.
   - **Count these toward the 3 sessions per analyst:**
     - every open source session, from `/init_source` until `/close_source_window` or cleanup, idle or not;
     - every running stream;
     - every alert run;
     - every quick analysis, once item 11 exists. None reach you today.

     This corrects item 2 of our §8 reply, which listed quick analyses as running today.

     Today you count only running streams and alert runs.
   - **Refuse with** `429 { code: "session_limit", limit, in_use, detail }`, from `/init_source` as well.
   - **Check:** with 3 idle Source windows open, a 4th `/init_source` and an alert run are each refused.

2. **B-31: `graph_archived` on report records (P2).** Send `graph_archived: true` when the graph moved to cold storage after 180 days (`has_graph` is then `false`), and `false` otherwise. The frontend already shows these as **Graph archived**.

3. **B-32: row progress on a running task (P2).**
   - **Fields:** `rows_done` and `rows_total` on the task, `null` when unknown. `rows_total` is the count after the dataframe filter.
   - **Updates:** send them in `task_updated`, about once per batch.
   - **Why:** Tasks shows "In progress (400/10,000)". Today the frontend reads this from two log lines, `Dataframe filter: kept X of Y rows` and `Inserted Neo4j batch N (M rows)`. That breaks if the wording changes. It also doesn't work for tasks loaded from `GET /api/v1/tasks`, for alert runs, or for live streams.
   - **Until then:** please keep those two lines' wording unchanged.

4. **B-29: use a manual run as an alert's analysis (P2).** `POST /api/v1/reports/parent/<alert_id>/analysis { task_id }` adopts the caller's completed task as the alert's run:
   - the alert becomes `analysed`, with the task's flags, verdict and session;
   - `parent_alert_updated` follows;
   - the H-4 refusals apply, plus `task_not_completed` and `task_expired`.

   If this should not be offered, say so and we'll drop the action.

## B. Questions from a test run

A batch Link Analysis with a dataframe filter. The log reads:
- "Dataframe filter: kept 2 of 10000 rows, 4 of 20 columns"
- "Inserted Neo4j batch 1 (2 rows)"
- "Ownership metadata stamped: nodes 3, relationships 0"

5. **0 relationships from 2 inserted rows.** Is that expected, or does ingestion drop relationships when the dataframe filter is applied (B-27)? If it's expected, what makes a row produce no relationship?
6. **`*` on a session with nodes only.** That run's session never listed any relationship types, so the Graph window waited forever. The frontend now loads a finished run with `/get_graph { id: "relationship", relationship: "*" }` straight away. Please confirm that `*` returns the session's nodes when there are no relationships.
7. **`has_graph` for a snapshot with nodes only.** The run was saved as evidence with `include_graph: true`, but the record came back with nothing to open. Is `has_graph` `false` when the snapshot has nodes but no relationships? If so, please count nodes alone as a graph. An entity-only result is still evidence.

## C. Still waiting on

8. **Phase 6 prompt.** `docs/phase6_frontend_prompt.md` (Domains, analyst screens) is in your repository, not ours. Please send it.
9. **B-1 scope.** Please confirm that H-16's server RBAC also covers the configuration and admin routes, not only analysis, alerts and evidence.
10. **Remaining B-items, in priority order:** B-2, B-6 (extend the H-4 to H-6 `code`s to the Source routes), B-7, B-5, B-9, B-4, B-10, B-23/B-24, B-26, B-25, B-11, B-12, B-8, B-19, B-3, B-13, B-14 to B-17.

## D. New request (2026-11-24)

11. **B-35: time-limited runs for the quick analysis panel (P2).** The panel runs on the formal pipeline with limits: one file up to 5 MB, the last hour for batch, and the next 15 minutes for realtime. It uses the session configuration's rule and connections.
    - **Realtime:** stop the run yourself after 15 minutes, even if the browser is gone, and finish it as `completed`.
    - **Batch:** read only the last hour from the source. Say which time you use for Kafka, HDFS and REST API, and refuse a source that has none.
    - **File:** say whether you want a row limit as well as 5 MB.
    - **Task:** mark it as a quick run, with the limits and the time covered. Enforce the limits on your side.
    - **Verdict:** not `clean`. A short window cannot show patterns that need history.
    - **Please answer first:** which inputs can do this today, and can a realtime stream already end by itself?

    Nothing in the panel has ever called you: until now it showed simulated results, which we have removed.

## E. From our side (for your information)

- **Live run-through:** we owe you the parent-alert flow from the screens, against `scripts/mock_parent_alert.py`. The steps:
  - the assignee list;
  - Analyse;
  - the verdict and flags;
  - Send findings, through to `acknowledged`;
  - Save as evidence, shown under Analysts with its graph.

  We'll report each step.
- **Changed in the frontend since our reply:**
  - Finished runs open their graph straight away, and an empty session shows "No graph data".
  - After **Save as evidence**, Reports opens on Service evidence ▸ Analysts with the new record selected.
  - Running tasks show the row progress described in item 3.
- Settings ▸ Users:
  - shows your reason for a refused create, update or delete, instead of `validation_error`;
  - grants only the permissions the signed-in account holds;
  - no longer overwrites an empty display name with the username when an account is saved or switched on or off.
- **Quick analysis panel:** the simulated progress, findings and tasks are gone. It says it is not connected and runs nothing.
