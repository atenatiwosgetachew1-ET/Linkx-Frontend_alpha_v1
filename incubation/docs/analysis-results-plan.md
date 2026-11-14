# Plan: analysis tasks, results and parent alert feedback

Frontend plan for the incubation app. The backend side is in
`docs/backend-handoff-analysis-results.md` (requests **H-1…H-9**).

## Principles
- **Case management is the parent's.** LinkX runs analyses and answers; it never keeps its own case state or assignment.
- **One pipeline:** Request → Task (the run) → Evidence record (the result, stored once) → Delivery.
- **Tasks window** = analyst activity: UI runs (Source windows, quick panel) and parent-alert runs. Sibling-service and system runs are backend work and never appear there.
- **Reports window** = results, read through one record shape with three views: **Alert reports**, **System reports**, **Service evidence** (renamed from "Service evedences").
- **Every analyst run is recorded** (task = audit record). A run becomes evidence or alert feedback **only by an explicit action**.
- **The parent owns assignment.** LinkX shows "Assigned to me", restricts feedback to the assignee, never reassigns.

| Requester | Task in UI | Result | Who acts |
|---|---|---|---|
| Analyst | Yes | Task; optional evidence / feedback | Analyst |
| Parent alert (assigned) | Yes (`origin: parent`) | Feedback to parent + evidence record | Assignee |
| Sibling service (internal) | No | Service evidence | Nobody (read-only) |
| System (xvigilance) | No | System reports | Nobody (read-only) |

## Phases

### Phase 0: Backend contract
- [x] Handoff written (`backend-handoff-analysis-results.md`).
- [ ] Answers to its open questions (user identity, feedback delivery, reassignment, sessions, retention).

### Phase 1: Reports window (done 2026-11-14, except the report PDF)
Ported from production `Reports` (src/App.jsx) into `src/features/reports/`:
1. [x] Workspace window, theme tokens (`--reports-*`) and picker category "Reports Window"; 403 shows Access denied.
2. [x] One adapter (`toReportRecord`) mapping today's records to the H-1 shape.
3. [x] Three tabs: Alert reports, System reports, Service evidence (renamed), with the production server filters (status, score band / `min_fraud_score=90`, `q`, dates, 50 per page) and client filters (search, status groups, band, dates, four sorts).
4. [x] Table at parity: type, source, anomaly, score (or centrality %), band pill or "Flagged", reason, status pill, date; archived rows (>180 days) dimmed; Vigilance run highlight (also fixes production's undefined `runId`).
5. [x] Footer: record range (Filtered), Refresh, list PDF with the leading entities summary (CDR wording), Previous / Next.
6. [x] Detail: type / source / status cards, payload metrics, score evidence (Volume vs Financial bonus), payload JSON with Copy.
7. [x] Evidence graph: trace id rules, availability check (`/get_graph`, queued jobs), one fetch reused, Open graph states; opens a Graph window by trace id (`metadata.evidence`).
8. [ ] **Download report** (evidence PDF): production renders it in a hidden `graphs_basic` iframe (`generate_evidence_report`), so it lands with Phase 2. The button is shown, disabled, with the reason.

### Phase 2: Graph and Chart windows (dependency of Phases 1, 3, 4)
> Detailed plan: **`docs/graph-chart-plan.md`** (no iframes; phases G0–G6). It supersedes step 6 below.
6. Port the Graph window, render evidence graphs from the Reports cache (`features/reports/lib/evidenceGraphs.js`), and wire the Reports **Download report** through the hidden graph renderer. Then port the Graph window (`/graph_link`, evidence graph fetch by `trace_id`) and the Chart window, opened from Tasks and from Reports.

### Phase 3: Tasks become permanent (needs H-2, H-7)
7. Load the Tasks window from `GET /api/v1/tasks`; live updates via `task_updated`; keep the in-memory registry as the live layer.
8. Origin on tasks (analyst / parent) with an origin filter; verdict and flags from the backend instead of parsing the log, with the log parser as fallback.

### Phase 4: Parent alerts (needs H-3, H-4, H-5, H-9)
9. Alert reports: **Assigned to me** (default) / **All** (supervisors); response status Awaiting analysis → Analysing → Feedback sent → Acknowledged (or Feedback failed).
10. **Run link analysis** on an alert → task with `origin: parent` and the alert's reference id; replaces the unannounced `str_report_link_analysis` graph pop-up (the event attaches to the alert's task instead).
11. **Send feedback** (assignee only): verdict, flags, summary, include graph; disabled with a reason after reassignment.
12. Assignment notifications (`parent_alert_assigned` / `reassigned`) and a badge on the Reports launcher; also on sign-in.

### Phase 5: Manual runs to results (needs H-6)
13. On the Tasks verdict line: **Save as evidence** and **Use as feedback for alert…** (lists the user's assigned alerts).
14. Clean unsaved runs stay in Tasks history only.

## Done criteria per phase
Tests (unit + component), theme tokens and picker coverage, `npm run lint`, `npx vitest run`, `npm run theme:check`, `npm run build`, and a production-parity check against `src/App.jsx` (`Reports`).

## Order of work now
1. Phase 1 (Reports window with the adapter and the three views).
2. Phase 2 (Graph / Chart windows).
3. Phases 3–5 as the backend delivers H-2…H-9.
