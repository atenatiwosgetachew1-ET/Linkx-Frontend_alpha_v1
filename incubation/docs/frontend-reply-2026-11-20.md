# Frontend reply to the Service's alignment note

**From:** the incubation frontend. **Date:** 2026-11-20.
**Answers:** "Frontend alignment: what the Service changed…", §8, in the same numbering.

**Status words:**
- **OK** means the frontend was changed to match your note and its unit tests pass (786 tests, lint, build).
- **Not checked live** means we haven't yet run it from the screens against your Service.

None of this has been run from the screens yet. Items 1–7 are the run-through we still owe you.

## What the frontend changed (for reference)

- **H-1:**
  - `has_graph` is the only graph flag. A record without it is "unknown" and is checked once.
  - `trace_id` comes first.
  - `title` is used as the leading entity.
  - Service evidence has a "Requested by" filter (All / Service accounts / Analysts), sent as `requester_type`.
- **H-2 / H-7:**
  - Tasks load from `GET /api/v1/tasks` and stay live with `task_updated`.
  - A run started in the browser is tied to its task by the stream answer's `task_id`, or by `task.task_id` from H-4.
  - The verdict and flags come from the task. A rule with a `null` count shows without a number. Log lines are only a fallback for a Service that doesn't send flags.
  - The lifecycle shows as chips (Expires soon / Expired / Archived), with **Reconfirm**.
  - "All tasks" is shown only with `tasks:read_all`. There is an "Archived" toggle (`archived=true`).
- **H-3 to H-5:**
  - The live alert service is now the default.
  - An alert is addressed by `alert_id`. Records without one (old imports) are listed but offer no workflow.
  - "Mine" matches `assignee_user_id`, `assignee_username` or `assignee_sub`.
  - "All alerts" is shown only with `alerts:read_all`.
  - Analyse is blocked unless `intake_status` is `complete`, and shows `intake_note`.
  - A failed run shows its `response_note`.
  - The alert graph opens from the run's session (`source_session_id`), or from `trace_id` once it is saved as evidence.
  - Every refusal code is shown in words.
  - `already_sent` is handled.
  - `502 delivery_failed` takes the returned `alert` and says the Service keeps retrying.
  - Feedback stays inside your limits: 20 tables × 2,000 rows, 20 charts, 200 findings, 4,000 characters of comments, JPEG or PNG pictures ≤ 3 MB (others are left out), and a body ≤ 10 MB (refused before sending, with the reason).
  - `feedback_sent` reads "awaiting acknowledgement (may come later, or not at all)".
- **H-6:** **Save as evidence** on a completed task:
  - It has a title, a summary and "keep the graph".
  - On `graph_unavailable` it offers **Save without the graph**.
  - Afterwards it offers **Open in Reports** (Service evidence ▸ Analysts).
- **H-8:** a `429 session_limit` from a stream start or an alert run shows your `detail`. Coded 429 and 403 answers no longer raise the generic "Slow down" / "Not allowed" notice.
- **H-9 / H-16:**
  - Every action is gated on `actor.permissions` only. The old "admin passes everything" rule is gone.
  - Analyse needs `analysis:run`, Send needs `alerts:feedback`, Save needs `evidence:create`.
- **§4e:** the permission checkboxes come from `GET /auth/admin/permissions`. Keys this UI doesn't group appear under "Other", and a `null` description shows the key.
- **H-10:**
  - A saved password without a `password_ref` is sent as `""`.
  - `password_required` reads "Enter the Neo4j password: none is saved for this host yet."
- **B-27 / B-28:**
  - The preview also sends `source` and `target`.
  - `preview_not_available` shows "a live source cannot be previewed".
  - `invalid_dataframe_filter` shows your `detail` (stream and preview).

## Answers to §8

1. **H-18 dataframe filter.** OK in code: the shape, the preview, `invalid_dataframe_filter` with `detail`, and `preview_not_available`. Not checked live: whether the counts match the stream, and the log line.
2. **H-8 analysis limit.** OK: `429 session_limit` is handled from both places and shows `detail`.
   **Problem: the counts don't match, and the analyst's decision is that the Service must be the stricter one.** The frontend counts four things: open Source windows (idle or not), background streams, running quick analyses and alert runs. The Service counts only running streams and alert runs. Please count the same four things: **B-30** in `backend-requests.md`, including a refusal from `/init_source`.
3. **H-11 lock and unlock.** OK in code: sign-out while locked sends `/auth/unlock` with `reason: "logout_unlock"` first. Not checked live: whether the loop is gone.
4. **H-12 terminate while starting.** OK in code:
   - A Terminate during "Starting stream…" ends the local task.
   - If the start answer then arrives as accepted, the frontend sends `end_session` once more.
   - The task now takes `terminated` from `task_updated`.

   Not checked live.
5. **H-13 token renewal.** OK in code: every running stream re-plugs on the new socket's `connect`, with the exact `log_file` from the stream answer. Not checked live.
6. **Session ownership.** The frontend only uses session ids you returned. It doesn't listen for `subscription_refused`, so we'd see a mix-up only as missing log lines. We'll send the request and session id if one appears.
7. **Parent alert flow from the UI.** Built against your contract; not checked live. The pieces:
   - assignee list;
   - Analyse starts the run, and its task appears;
   - the verdict and flags show when it finishes;
   - Send findings, through to `acknowledged`;
   - Save as evidence, shown under Analysts with its graph.

   We'll run it against `scripts/mock_parent_alert.py` and report each step.
8. **xVigilance and Risk Scoring.** OK: the frontend never shows "Reported to Risk Scoring" (neither the incubation app nor production reads `reported_to`). Nothing to change until we show delivery status; when we do, we'll show it only for `status: delivered`.
9. **Phase 6 (Domains, analyst screens).** Not done yet. `docs/phase6_frontend_prompt.md` is in the Service's repository, not ours. Please send it.
10. **B-items.** Still needed, in this order:
    1. B-1 server RBAC on every mutation (partly answered by H-16; please confirm it covers configuration and admin routes).
    2. B-2 never return secrets.
    3. B-6 structured error contract (the H-4 to H-6 `code`s are the model; please extend them to the Source routes).
    4. B-7 job cancellation.
    5. B-5 `create_DF` guards.
    6. B-9 one endpoint per resource.
    7. B-4 optimistic concurrency.
    8. B-10 full configuration after save and domain switch.
    9. B-23 and B-24 keep `actor_profile` and `formatting_rules` in the configuration.
    10. B-26 profile portraits readable by the report.
    11. B-25 `.lxg` export and import.
    12. B-11 configuration changes over the socket.
    13. B-12 connection status.
    14. B-8 search paging.
    15. B-19 hybrid search date range.
    16. B-3 server-generated client secrets.
    17. B-13 audit context.
    18. B-14 to B-17 (low).

    B-18 is answered by H-11 to H-17. **New:** B-29, adopt a manual run as an alert's analysis ("Use as feedback for alert…", Phase 5). Please do it, or say it should not be offered.
11. **Anything else.**
    - **Archived graphs (H-1):** yes, please add `graph_archived` (**B-31**). The frontend already reads it and shows "Graph archived".
    - **A run with nodes but no relationships (tested 2026-11-20):** a batch Link Analysis with a dataframe filter. The questions:
      - **0 relationships from 2 rows:** the log says "Dataframe filter: kept 2 of 10000 rows, 4 of 20 columns", then "Inserted Neo4j batch 1 (2 rows)", then "Ownership metadata stamped: nodes 3, relationships 0". Is 0 relationships expected for 2 inserted rows?
      - **The run's session sent no relationship list,** so the Graph window waited forever. The frontend now loads a finished run's graph with `/get_graph { id: "relationship", relationship: "*" }` straight away. Please confirm `*` returns a session's nodes even when it has no relationships.
      - **The run was saved as evidence with `include_graph: true`,** but the record came back without a graph to open. Is `has_graph` `false` for a snapshot with nodes and no relationships? If so, please count nodes alone as a graph.
    - **The old pop-up (`str_report_link_analysis` with `external_reference_id`):** the frontend doesn't attach it to an alert yet. The H-4 flow doesn't need it.
    - **Wording:** the incubation UI says "Service". Production `src/App.jsx` still says "backend" in places. That's a separate change, if production is to be touched.
