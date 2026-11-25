# Round 2 for the Service: reply, questions and requests

**From:** the incubation frontend. **Date:** 2026-11-25 (first draft 2026-11-24).
**Follows:** your response of 2026-11-25 to our follow-up.
**Status:** **answered 2026-11-25** (`service-response-round-2-2026-11-25.md`).

Please answer item by item in this numbering, as **Built**, **Refused**, **Later** or an answer. Anything you agree to build gets a number from B-39 (B-38 is R2-19).

## A. Reply to your response

| Your item | Our answer |
|---|---|
| B-30 refused | Accepted. The Service manages sessions; how many windows are open is the screen's own limit |
| B-29 refused | Accepted. No such action is in the screens |
| Questions 6 and 7 (nodes only) | Accepted. Our text will say that no rule matched, rather than "no nodes" |
| B-26, B-36 refused | Accepted. GPU drawing stays per browser |
| B-23, B-24 in `/domain-config` | Accepted. We will keep the total under 1 MB |
| B-31 | Already read: shows **Graph archived** |
| B-6, B-5 | Our client already treats `success: false` as refused; the new codes get their own wording |
| B-19 | Sent on search already; `create_DF` still to do |
| B-35 | Accepted as narrowed, without a seat of its own (R2-19) |

**Your 9 "report back" points: all "Not done yet".** In the code now, not yet run against your deployment: points 1 and 3 in part (no `permissions` sent, your codes worded, `user-rules` read for `roles.permissions`, `rows_done` / `rows_total` and `rules_not_applicable` shown). **Please send the exact shape of `GET /auth/admin/user-rules`.**

## B. Please answer first

These can make a result wrong, or stop an analyst from working.

| # | Topic |
|---|---|
| R2-17 | When does a run really end: "Injection finished", or after the full analysis? |
| R2-18 | Can an analyst start a realtime run, or switch domain, at all? |
| R2-4 | Do `total_nodes` / `total_edges` count what is delivered? |
| R2-8 | Can a sanctioned account be treated as trusted? |
| Q1, Q2 | Which configuration does Analyze run with? |

## C. New, from your response

### R2-17. When a run really ends (Question + task, P1)
- **You say** the full analysis runs after `rows_done` reaches `rows_total`.
- **Production** takes the log line "Injection finished for action …" as the end: the task becomes Completed, and a background run's session is then released. Incubation did too; it now waits for the job's end or the task's own final status.
- **Please say** when that line is logged: before or after the full analysis, for batch, realtime and quick runs. Could it be logged for a run that then fails?
- **Please say** what a `/close_source_window` does if it arrives between that line and the end of the analysis.
- **Now that we wait:** does the queued job end after the full analysis, or after the rows? And is `task_updated` (or the task on `GET /api/v1/tasks`) always sent with the final status and verdict, even when the socket was down?

### R2-18. Analysts, `config:write` and realtime (Question, P1)
Two things in your response conflict with what realtime needs:
- **Save needs `config:write`,** and a domain switch is part of save.
- **Phase 6:** a save by a non-admin that holds a key named `password`, `secret`, `token` or `credential` is rejected, and changed endpoints are `403 endpoint_admin_only`.

Today a realtime start (production and incubation) **saves the configuration to the window's session**, with the Neo4j URL, user, database and, when typed, `active_tool_password`. Without that save the run cannot find Neo4j.

**Please say:**
- Does the `analyst` role hold `config:write`? If not, how does an analyst save their own column override (Phase 6), or switch domain from the Source window?
- How should a realtime run get its Neo4j credentials, for an analyst and for an admin? Is `/connect_to_tool` enough now?
- Which keys count as secret in `POST /configuration`? Do `active_tool_password`, `active_tool_password_ref` and `tool_credentials` (whose name holds "credential") all count? Admins set the Neo4j password in Configuration today: may they still?
- Does the rejection name the keys (`invalid_fields`)?
- Is Phase 6's enforcement on already in the deployed Service, or with this deployment?

### R2-19. Unattended runs, by seats (Task, P1) — B-38
**Decided on our side (analyst, 2026-11-25).** A run may go on without its owner's browser (sleeping PC, lost network, closed tab, idle sign-out) **only with a seat that the Service grants**. The Service owns the seats; the analyst asks for one on purpose, run by run; **one run per user**. Without a seat, a run ends when its owner leaves.

| Run | Its owner's browser is gone |
|---|---|
| **With a seat** | Goes on to its end, or to the Service's maximum time. A realtime run goes on to its own limit, then finishes properly (`completed`, with the full analysis on the rows read) |
| **Without a seat** | Stops, as today. We ask for **15 minutes** instead of 45 s before that, for dropped networks; the number is yours |
| **STR alert** | Goes on; no seat needed |
| **Account deactivated, or access removed** | The Service stops it, seat or not |

**Please build (B-38, full contract in `backend-requests.md`)**
1. `GET /api/v1/unattended-seats` -> `{ seats: { total, available } }`.
2. `POST /api/v1/tasks/<task_id>/unattended { on }` -> `{ task, seats }`, granted or refused by you, at once and for one run per user.
3. `unattended: true | false` on the task, in `task_updated` and `GET /api/v1/tasks`.
4. A run with a seat is **not stopped by a disconnect**, a closed tab, a token's end, an idle timeout or a logout. "Gone" means no connected browser of the owner, not who follows the log.
5. The seat is free again when the run ends or it is turned off.

**The load stays yours to bound:** the number of seats is the most unattended runs there can ever be. Please also set a maximum time for one, and choose whether realtime runs may have a seat (`unattended_not_allowed` if not).

**Still needed with it**
- **B-37:** the graph kept with the task, for a limited time (we suggest 24 hours). Today a run that ends while its owner is away has a verdict, but its graph cannot be opened.
- **Reattach:** the log of a running task by `task_id`, without making the run depend on that browser.
- **R2-20:** why a run ended, and its limits.
- **Close the session** of a run that ended while its owner was away, once its graph is kept.

**What the screens do now**
- A switch "Keep running while I'm away" on a running task (Tasks, and the Source window's stream step), off by default. It is enabled only while you answer with a free seat, and turns on only when you confirm `task.unattended: true`. **Until you build B-38 it stays disabled, and every run ends when its owner leaves.**
- Leaving: `end_session` for every run without a seat. The session of the run with one is not closed, and `/auth/idle-timeout` sends `cleanup: false` while there is one.
- Signing out asks: keep the run with a seat going, or stop it.
- The next sign-in says how the runs ended. Their owner can stop one that goes on (`end_session` with the task's `source_session_id` and `log_file`).
- A seat you take back (`unattended: false`) is told to the analyst.

**Please answer**
- What does `cleanup: false` on `/auth/idle-timeout` keep? Does `/auth/logout` end runs or clear source sessions, and will it leave a run with a seat alone?
- With whose rights does a run with a seat go on when its owner's token ends?
- Do idle lock (`423`) and `/auth/lock` affect running jobs?
- After a reload the main session may be a new one: may its owner still turn the seat off and send `end_session` for a run of the old one?
- Today's 45 s: which subscriptions count as following (log, source session's notifications, main session's), and per browser, tab or user?

### R2-20. Why a run ended (Task, P2)
- **Please add** `ended_reason` to the task: `finished`, `time_limit`, `quick_limit`, `user`, `browser_disconnected`, `session_closed`, `worker_lost`, `cancelled`.
- **Why:** a realtime run that ended at 1 h 50 min is `completed`, the same as one that read everything. And is its verdict, which covers only the rows read so far, ever `clean`?
- **Please send** the limit itself (seconds) on the task, so the screen can say when it will end.

### R2-21. Results recorded before the fix (Question, P1)
- A run where no rule could run was recorded `clean`. Are the stored tasks, alerts and evidence corrected, or marked? Can such a record have been sent to the parent?
- The log of such a run: does it say "No flags found"? (Incubation no longer reads Clean from the log; production has no verdict.)

### R2-22. Domain names (Question, P2)
- You list `bank`; the service-account screens and storage targets also use `banking` (and `mfi`, `telecom`, `social`). Which key is canonical in service accounts and their catalog? Are aliases accepted or refused?

### R2-23. Small points on what you built (Questions, P3)
- **B-7:** does cancelling `create_DF` remove a half-made dataframe? Does closing the window cancel its jobs?
- **B-19:** Elastic filters the rows the search returned: do the total and "load more" count before or after the filter? Which column and time zone decide the day? Is `end_date` inclusive?
- **B-32:** are `rows_done` / `rows_total` sent for Store data and Source / Target Mapping?
- **`rules_not_applicable`:** for an alert run too? Named by the canonical field or by the source column?
- **User permissions:** does removing per-user permissions change accounts that hold custom ones today? How many are there?
- **`manager`:** what does this role hold, and does it hold `config:write`?

## D. Carried over, reworded after your response

### R2-1. One verdict and flag shape (Question + task, P1)
- **Settled:** a run where no rule could run is `undetermined`; a quick run is never `clean`.
- **Still needed:** on every finished task and alert, `verdict` always one of `suspicious`, `clean`, `undetermined`, and `flags` always `{rule: count}`. Today: can `flags` be a list, `null` or `{}`; can `verdict` be `null` on a completed run, or `suspicious` without flags; what do Store data and Source / Target Mapping runs get?
- **And:** a run where some rules could run and others could not (`rules_not_applicable` not empty): may it be `clean`? We think it should be `undetermined`, or `clean` with the skipped rules shown beside it.
- **Until then:** "Clean" is shown only when you say `clean` for a completed run, with any skipped rules beside it. The log no longer counts. A run without a verdict reads "Not determined".

### R2-2. Record on the task what was analysed (Task, P1)
- **Settled:** rows, `rules_not_applicable`, quick limits and window.
- **Still needed** on tasks and `task_updated`: `rule`, `source`, `target`, `relationship`, `dataframe_filter`, `filter_result`, `domain`, and the versions of the thresholds, mapping and configuration used (you keep versions now).

### R2-3. Graph of one run, not of a session (Task, P1; B-37)
- **You say** a manual run's graph is cleared with its session. When exactly: at `/close_source_window`, at a second run in the same session, or at the cleanup?
- **Question:** after two runs in one session, does `/get_graph { id: "relationship" }` return the newest run, or both?
- **Please build** B-37: `task_id` on `/get_graph`.

### R2-4. Graph chunks: whole or not (Question + task, P1)
- **New, from your answer 6:** `*` leaves out nodes without relationships. Do `total_nodes` / `total_edges` count only what is delivered, or the stored rows too? The screens compare the two and mark a graph **Incomplete** when short; with stored rows counted, every graph would be marked.
- May a link arrive before its entities? May an `event_id` be sent again? Can the last chunks appear after `status` is success? Where is the whole graph: `results.result` or `result`? Does a running job's graph grow?
- **Please build:** totals of what is delivered, and `complete: true`.

### R2-5. Ids: text, exact, unique (Question + task, P1)
- Are node and link ids numbers or text? Can one exceed 2^53 (16 digits or more)? Is a link id unique within a graph, and stable? Do account numbers keep leading zeros through ingestion?
- **Please build:** ids and account numbers always as JSON strings; a unique id on every link.

### R2-6. Refusals with HTTP 200; partly read sources (Question + task, P2)
- **Settled for the Source routes** by B-6. Are those refusals 4xx now, or still 200 with `success: false`?
- **Still needed** for `/configuration`, `/graph_link`, `/get_graph` and rule upload and removal.
- **And** `failed_sources` with a reason for each when only some sources could be read.

### R2-7. Domain or configuration change while jobs are out (Question, P1)
- Please answer in the questionnaire (Q1 to Q20). We understand every job is queued on a worker with its configuration at that moment.
- **Until then:** while a dataframe is being made, a run is queued, running or ending, or a finished run is on screen, a change touches nothing in that window. It applies when the analyst goes back to prepare the next job: the source reconnects and an old domain's dataframe is made again. If Analyze keeps the dataframe's configuration, we will stop dropping it.

### R2-8. Trusted / risk lists and categories (Question, P1)
- **The problem:** classified entities are saved in `trusted_entities` and `risk_entities`. Any category other than exactly "Risk" (Sanction, PEP, SIM_BOX…) goes into `trusted_entities`. Production does the same.
- **Please say:** do the rules decide by list, or by each entry's `category` / `pass_through`? Could a sanctioned account be treated as trusted today? Which categories exist, and which list does each belong to? Are plain-text entries and the `reason` field kept? Are these lists per user (session configuration) or per domain?
- **Until then: not changed.** We need your answer before moving entries between lists.

### R2-9. Which configuration a realtime run reads (Question, P1)
- The main session's, or the window's own copy? Taken at the tool connect, at the save before it, or at the start? See R2-18 for who may save it.

### R2-10. Which broker and topic `create_DF` reads (Question, P2)
- The connected one, or the one sent? You now refuse an unconnected source (B-5); what if the two differ?

### R2-11. Rule upload form fields (Question, P2)
- Which form fields does rule upload read? Until 2026-11-24 the frontend also posted the trusted and risk lists, as the text `[object Object]`. **Did any upload store that text, or replace the session's lists?** Please check stored configurations for it.

### R2-12. Configuration save: replace or merge (Question, P2)
- Phase 6 says the Service merges. For every key of `POST /configuration`, or only columns and mapping? What does an empty list do (clear, or inherit)? B-4 is later: until then, does the last save win?

### R2-13. Dataframe filter: lists, types, dates (Question, P2)
- The limit on list values (we allow 50, 200 characters each); how `equals` and `in` compare (does `0012345` equal `12345`?); how dates are read and in which time zone; what happens to a value that cannot be read.

### R2-14. Whose log lines (Question, P3)
- **Mostly settled** by B-32. Please put `log_file` or `task_id` in every `stream_logs` payload. Can lines arrive after unplug, or from an earlier run?

### R2-15. Python-style answers (Question, P3)
- Does `/get_graph` ever answer with a Python `repr` instead of JSON? If so, which route? Please make it JSON.

## Questionnaire: which configuration does a job run with?

For R2-7, R2-9, R2-10 and R2-12. Please fill in the tables; "not sure" is a useful answer. Where the code decides it, please name the file or function.

### Part 1. When each job takes its configuration
For each job, write one of: **queued** (copied into the job when it is sent), **started** (read when a worker picks it up), **live** (read again while it runs), **dataframe** (kept from `create_DF`), **connect** (kept from the source or tool connection), **none**.

| Job | Domain | Thresholds and sensitivity (domain) | Rules (uploaded) | Column mapping | Trusted / risk entities | Source (broker, topic, storage) | Tool (Neo4j) | Which session's copy (main or `<window>_<session>`) |
|---|---|---|---|---|---|---|---|---|
| Source connect | | | | | | | | |
| Tool connect | | | | | | | | |
| `create_DF` | | | | | | | | |
| Batch `stream` | | | | | | | | |
| Realtime `stream` | | | | | | | | |
| Quick run (file, Kafka batch, realtime) | | | | | | | | |
| STR alert run | | | | | | | | |
| `/get_graph` by session | | | | | | | | |
| `/get_graph` by evidence | | | | | | | | |

### Part 2. What happens in these cases
| # | Case | Your answer |
|---|---|---|
| Q1 | Dataframe made under domain A. Domain switched to B. Batch Analyze sent now. Which domain's rules, mapping and lists does it use, and on which dataframe? | |
| Q2 | Same domain. Dataframe made, then an admin saves a threshold (`/rule-thresholds`, now per domain) or a mapping. Analyze sent now. Old or new? And a trusted entity saved in the session's configuration? | |
| Q3 | Analyze is queued, not started. A threshold is changed and saved. Old or new? | |
| Q4 | A batch run is half way. A threshold or a trusted entity is changed and saved. Does any later batch use the new one? | |
| Q5 | A realtime run is going. The same change. Does it ever pick it up, or only after a restart? | |
| Q6 | A run is going. The session's source or tool is disconnected or reconnected. Does the run continue, fail, or read from the new connection? | |
| Q7 | A run is going in window 1. Window 2 of the same main session switches the domain. Is window 1's run affected in any way? | |
| Q8 | Connected to broker A. The default becomes broker B. `create_DF` is sent with A's address. Which is read? And if it is sent with B's? | |
| Q9 | A run finished under domain A (Neo4j A). The session is now on B (Neo4j B). Which Neo4j does `/get_graph` read? | |
| Q10 | A rule is deleted or uploaded again while a run using it is queued or running. Which version runs? | |
| Q11 | A worker dies and the job is retried. Does the retry use the first configuration or the current one? | |
| Q12 | An admin changes the domain's thresholds, mapping or sensitivity while other analysts have dataframes and runs. Which of their next jobs use the change, and are the open screens told? | |
| Q13 | `save` with a `<window>_<session>` id: does it change that session only, or the main one too? | |

### Part 3. What we may rely on
| # | Question | Yes / No / detail |
|---|---|---|
| Q14 | Can a change ever reach a job that was already sent? If so, which settings? | |
| Q15 | Does switching the domain delete or invalidate the session's dataframe? | |
| Q16 | Thresholds, columns, mapping and `presentation` have versions now. Can a task carry the versions it ran with (R2-2)? Does the session's configuration have one? | |
| Q17 | Must the tool be reconnected for a realtime run to use a newly saved configuration, or is `save` enough? | |
| Q18 | Must the source be reconnected after its address, topic or storage path is changed and saved? | |
| Q19 | Is it safe for the frontend to keep a dataframe across a domain switch (Q1), or must it be made again? | |
| Q20 | Could a job refuse to start when the session's configuration is no longer the one its dataframe was made under (`409 { code: "configuration_changed" }`)? | |

### What we will do with the answers
- **Q1 and Q19, kept from the dataframe:** we stop dropping the dataframe on a domain switch, and label it with its domain.
- **Q1, taken when queued:** the drop stays, as it is now.
- **Q2, old threshold:** we tell the analyst to make the dataframe again after a save that changes rules, mapping or entities.
- **Q6, not safe:** nothing to change; the frontend already leaves connections alone while a job is out.
- **Q9, the new Neo4j:** we block loading a run's graph after a domain switch, until B-37 (R2-3).
- **Q14, yes:** we show that setting as live on the running task.
- **Q16, yes:** Tasks and report covers show the version.
- **Q17, `save` is enough:** we stop reconnecting the tool before a realtime start.

## Worth passing on: production has these too
Success read from refused answers (R2-6), sorting and searching by the leading number, "graph looks clean" from a limited view, equal weights raising alerts, and the trusted list (R2-8).

## Struck after your response
- **R2-16** (correction to question 7): your answer 7 settles it.
- From R2-1: runs where no rule ran, and quick runs. From R2-2: row progress. From R2-6: the Source routes. From R2-14: row progress read from the log.
