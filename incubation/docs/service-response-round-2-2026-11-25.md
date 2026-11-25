# Service response to round 2

> Saved as received on 2026-11-25. Our reading and what we changed for it: `service-response-review-round-2-2026-11-25.md`.

**From:** the LinkX Service (backend). **Date:** 2026-11-25.
**Answers:** `backend-round-2-2026-11-24.md` and the new items of `backend-requests.md`, in your numbering.
**State:** **Built** means in the code and tested there. It is live once the Service is deployed; the Service owner will tell you when. Nothing here was run from the screens or against live Kafka and Neo4j.

We build what fits the Service's distributed design: state in PostgreSQL, files on the shared storage, work on the workers, nothing that matters in one process's memory. What does not fit is refused with its reason.

## Summary

| Item | Answer |
|---|---|
| R2-1 verdict and flags | **Built** |
| R2-2 what was analysed | **Built** |
| R2-3 / B-37 graph of one run | **Built**, for 24 hours; "until archived" **refused** |
| R2-4 graph totals | Answered; `complete` was there already |
| R2-5 ids | **Built** |
| R2-6 refusals | **Built** (`success`, `code`); per-source `failed_sources` on partial reads **refused** |
| R2-7, questionnaire | Answered below; **Built**: a run keeps its settings |
| R2-8 trusted and risk lists | **Built**: our error, fixed |
| R2-10 create_DF address | **Built** |
| R2-11 rule upload | **Built**: our error, fixed |
| R2-14 `log_file` in `stream_logs` | **Built** |
| R2-17 | Answered; **Built**: closing a window stops its run first |
| R2-18 | Answered; **Built**: analysts' own saves |
| R2-19 / B-38 seats | **Built**, for batch runs; 15 minutes **refused** (2 minutes) |
| R2-20 why a run ended | **Built** |
| R2-21 old results | Not corrected, see below |
| R2-9, R2-12, R2-13, R2-15, R2-22, R2-23 | Answered |

## Please change on your side

1. **`409 run_in_progress`:** one analysis per Source window. Also returned by `/disconnect_source` while a run goes on.
2. **`409 configuration_changed`:** a batch `stream` whose dataframe was made under another domain. Carries `dataframe_domain` and `domain`.
3. **`409 session_id_in_use`** from `/init_source`: that window number is still being cleaned up or has a run. Use the next number.
4. **Show graph:** send `task_id` for a finished run. `/get_graph` with the Source session shows what that session holds now.
5. **A second run in the same Source window replaces the first one's rows and graph.** The first stays readable by its `task_id`.
6. **Disconnect:** runs are tied to their owner now, not to who follows a log.
7. **File columns that hold accounts, phones or ids are text** now, so leading zeros stay.

## Changed since our first response

Where the two differ, this document is right.

| First response | Now |
|---|---|
| A run is stopped 45 s after the browser that follows it disconnects (item 11) | 2 minutes after the owner's last browser is gone, whoever follows it. A run with a seat goes on |
| A domain switch is part of save, so it needs `config:write` (item 9) | Analysts may switch domain and save their own columns without it (R2-18) |
| A manual run's graph is cleared with its session (item 4) | A completed run's graph is kept 24 hours and opens by `task_id` (B-37). B-29 stays refused |
| `create_DF` refuses an unconnected source (B-5) | It also refuses an address that is not the connected one (R2-10) |

## B. First answers

### R2-17. When a run ends
- **"Injection finished" is logged after the full analysis,** and also when it fails or is stopped. Do not read it as success.
- **The job ends after the full analysis,** and the kept graph is written before that. The task's final status and verdict are set in the same transaction as the job's end.
- **`task_updated` is sent once to the sockets open at that moment.** If the socket was down it is not repeated: read `GET /api/v1/tasks` on reconnect. The task there is always final.
- **`/close_source_window` during a run** removed the graph under the run. **Fixed:** it now stops the run first (`ended_reason: session_closed`). It is safe before, after or without `end_session`.

### R2-18. Analysts, `config:write` and realtime
- **The `analyst` role does not hold `config:write`,** and neither does `manager`. As it stood, an analyst could save neither a domain switch nor a column override. **Fixed:** with `config:read` and `analysis:run`, `POST /configuration { id: "save" }` accepts, in the caller's own session, only `domain`, `active_domain`, `fetch_columns`, `search_columns_strict`, `search_columns_fuzzy`. Send only those keys: any other is `403 { permission: "config:write", invalid_fields }`, unchanged values included.
- **Realtime needs no save.** `/connect_to_tool` stores the Neo4j login for the window's session, for analysts and admins. Please stop saving the configuration before a realtime start.
- **Secret keys:** any key, at any depth, whose name contains `password`, `secret`, `token`, `credential`, `authorization` or `x-api-key`, and the four entity lists. So `active_tool_password`, `active_tool_password_ref` and `tool_credentials` all count, as do `trusted_entities` and `risk_entities`.
- **Admins** (`users:manage`) may still set the Neo4j password in Configuration.
- **The rejection names them:** `403 { permission: "users:manage", code: "sensitive_keys", invalid_fields }`.
- **Enforced already:** the secret-key rule, and the endpoint lock (`403 endpoint_admin_only`) since 2026-11-13. Naming the secret keys is new.

### R2-4. Graph totals
- `total_nodes` and `total_edges` count **what is delivered**. Stored rows without a relationship are not counted.
- `complete: true`, `truncated_by` and `partial` are in the result already.
- A link never arrives before its entities: they are in the same or an earlier chunk.
- `event_id` is a database id, sent once per `after_event_id` cursor. All chunks are committed before the job succeeds, but a poll returns at most 25: keep polling until a poll returns none.
- The result is `results.result` (`results` is the job). With chunks, its `nodes` and `edges` are empty.
- A graph fetched while its run goes on can grow on the next fetch.

### R2-8. Trusted and risk lists
- **You are right, and it was a detection error.** The rules decided by list only, so a sanctioned account saved as trusted suppressed rules.
- **Fixed on the Service, also for xVigilance:** an entry whose `category`, `classification` or `type` names a risk counts as a risk, whichever list holds it. Recognised by word: risk, sanction, PEP, SIM box, blacklist, watchlist, fraud, suspicious, terror, launder, scam, mule, crime. "Low risk" and "no risk" are not. Such an entry is never `pass_through`.
- **You need not move entries,** but please save risk categories in `risk_entities` from now on.
- Other categories in the trusted list are trusted. `category` and `reason` are kept. A plain text entry becomes `{ key: "CALLING_NO", value }`, so send objects.
- **Scope:** the lists are per domain. An admin's save stores them for the domain, and sessions start from them.

## C. The rest of section C

### R2-19 / B-38. Unattended runs. Built
- `GET /api/v1/unattended-seats`, `POST /api/v1/tasks/<task_id>/unattended { on }` and `unattended` on every task, as you specified, with your codes. `404 not_offered` when there are no seats.
- **Active work always comes first, so seats are rare on purpose.** `total` is a quarter of the analyses the live workers can run at once, rounded down: fewer than 4 slots give none, 4 to 7 give one, 8 to 11 give two, and so on, with no fixed maximum. The owner may set a lower number. The workers report their capacity, so the number follows them. Always read it, never assume it.
- **`available` is 0 while any analysis waits for a worker,** even when no seat is taken. `unattended_no_seat` then means "try again later".
- **Only a run that is already running** may get a seat; a waiting one is `409 task_not_running`.
- **A seat lasts 60 minutes:** `unattended_until` on the task. Then it is taken back (`unattended: false`, with `task_updated`). If its owner is connected the run goes on normally; otherwise it stops 2 minutes later with `ended_reason: time_limit`. The owner may ask for a seat again while one is free.
- **One unattended run per user,** as on your side: `409 unattended_limit`, even with free seats.
- Granted under a database lock, so the last seat is given once. It is free by itself when its run ends. With no seats at all, `404 not_offered`; turning off still works.
- **Realtime and quick runs: `unattended_not_allowed`.** They would hold a worker for up to 1 h 50 min with nobody there; xVigilance is the continuous watch. Alert runs: the same code, as they go on without a seat.
- **Job limit:** also the worker's own, 2 hours by default, on the task as `limit_seconds`.
- **Gone** means no connected browser of the owner, in any tab. Only their own analyses without a seat stop. What a socket merely follows is never stopped.
- **15 minutes refused: 2 minutes.** A run without a seat holds one of few workers; a seat is the way to keep one longer.
- **A deactivated or deleted account:** its runs stop, seat or not.
- **`unattended_seats` socket event:** not built; your 30-second question is enough.

**Your questions**
- **`/auth/idle-timeout`:** with `cleanup: false` no session is cancelled; the token is still revoked. With or without it, and on `/auth/logout`, the sessions of a run with a seat are left alone and listed as `kept_sessions`. Every other session is cancelled and cleaned, except alert runs.
- **Rights:** a run needs no token. It works with the settings and Neo4j login it was started with.
- **Idle lock and `/auth/lock`** do not touch running jobs; they answer `423` to calls.
- **A new main session:** the owner may still turn the seat off, and send `end_session` for a run of the old one.
- **Reattach:** `log_stream_plug` with the task's `source_session_id` and `log_file` works from any browser of the owner. It does not tie the run to that browser.
- **Afterwards:** the session of a run that ended alone is closed by the 6-hour idle cleanup. Its graph is kept apart (B-37).

### R2-20. Why a run ended. Built
- `ended_reason`: `finished`, `error`, `time_limit`, `quick_limit`, `user`, `browser_disconnected`, `session_closed`, `signed_out`, `account_deactivated`, `worker_lost`, `cancelled`. `null` for runs before this.
- `limit_seconds` is set when the run starts.
- A realtime run that reached its limit may be `clean`: it is the verdict on the rows it received. Please say so beside it. A quick run is never `clean`.

### R2-21. Results recorded before the fix
Stored tasks, alerts and evidence are not corrected or marked: what each rule could not check was not stored then, so it cannot be told afterwards. An alert run needs its account columns, so only an alert without usable dates, amounts and times could be affected. The parent integration is not live. The log of such a run listed each rule as `[NOT_APPLICABLE]` and gave zero counts.

### R2-22. Domain names
Canonical: `bank`, `microfinance`, `insurance`, `cdr`, `social_media`. Aliases are accepted everywhere and stored as canonical in the domain settings: `banking`, `mfi`, `mobile_banking`, `telecom`, `telecoms`, `call_data_records`, `insurances`, `social`, `tweeter`. Service accounts store `bank`, `microfinance`, `cdr`, `insurance` and `social_media` and read the same aliases. Send canonical names.

### R2-23
- **B-7:** a cancelled `create_DF` is never bound to the session. A half-written folder can stay on the storage; that is ours to clean. Closing the window stops its analysis; a queued search or `create_DF` finishes and is discarded with the session.
- **B-19:** totals are counted after the date filter, on the rows the search returned. The column is the domain's `date_column`, compared as written (no time zone). `end_date` is inclusive. Raw files use the file's date.
- **B-32:** yes for Store data; for Source / Target Mapping `rows_done` arrives once, when the rows are read.
- **`rules_not_applicable`:** on an alert run's task too. Canonical fields; alternatives are joined by `/`.
- **User permissions:** no account held any of its own, so nothing changed.
- **`manager`:** the analyst's permissions plus `tasks:read_all` and `alerts:read_all`. No `config:write`.

**`GET /auth/admin/user-rules`:** `{ message, results }`, with `results`:
```json
{
  "username": { "pattern": "^[A-Za-z0-9_.@:-]{3,120}$", "unique": "case_insensitive" },
  "password": { "min_length": 8, "max_length": 1024, "whitespace": false },
  "roles": { "assignable": ["analyst", "viewer"], "permissions": { "<role>": ["<key>"] } },
  "user_permissions_assignable": false,
  "manages_all_accounts": false,
  "manageable_roles": ["analyst", "viewer"],
  "service_accounts": { "grantable_permissions": ["<key>"], "secret_min_length": 24, "secret_generated_when_omitted": true }
}
```

## D. Carried over

- **R2-1. Built.** On a finished task `verdict` is always `suspicious`, `clean` or `undetermined`, and `flags` is always an object (`{}` when empty). Store data and Mapping runs: `undetermined`, `{}`. `suspicious` always has a count. When only some rules could run it may be `clean`, with `rules_not_applicable` beside it: the rules that ran found nothing. Calling it `undetermined` would hide that, as most data lacks some field.
- **R2-2. Built.** `rule`, `source`, `target`, `relationship`, `dataframe_filter` and `filter_result` were there. New: `domain` and `config_versions: { thresholds, preset, mapping, columns }` (`null` = the built-in profile). The session configuration has no version (B-4, later).
- **R2-3 / B-37. Built.** `POST /get_graph { id: "relationship", task_id }` answers at once, without a job: `nodes`, `edges`, `total_nodes`, `total_edges`, `complete`, `truncated_by`, `expires_at`. Readable by whoever may read the task.
  - It is a copy the worker writes when the run completes, at most 5,000 links. It needs no Neo4j login and survives the window, a sign-out and a second run.
  - Codes: `409 task_running`, `404 graph_not_kept` (stopped, failed or older runs), `410 graph_expired`.
  - On the task: `graph_saved`, `graph_expires_at`. Offer Show graph when `graph_saved` is true.
  - **24 hours, not until archived:** 180 days of every run's graph would fill the shared storage. **Save as evidence** keeps one, and now works after the window closed.
  - **Credentials** of a session are removed by `/close_source_window`, `/disconnect_source`, `/disconnect_tool`, sign-out and the 6-hour idle cleanup. Not by a restart.
  - **`/init_source` on a used id** kept its data and login. Now `409 session_id_in_use` while a cleanup or run is pending; after that the number is clean. Numbers above 3 are accepted.
  - **`/graph_link`** is accepted for a completed run. `*` returns no nodes without relationships, as in round 1.
  - **A configuration save merges** by top-level key: a key you leave out is kept, including masked passwords, their `*_ref` and `tool_credentials`.
  - **Two runs in one session:** the second analysed the first one's rows too. **Fixed:** they are removed first.
- **R2-5. Built.** Node ids, link ids, `from` and `to` are text. A link id is unique and stable while the graph exists. Whole numbers above 2^53 travel as text. Identifier columns of CSV, Excel and JSON files are read as text; before, CSV lost leading zeros. An Excel cell stored as a number has none to keep.
- **R2-6. Built** for `/configuration`, `/account/configuration`, `/graph_link` and `/get_graph`: `success` and `code` as on the Source routes. Connection failures stay HTTP 200 with `success: false`, as existing clients expect; read `success`. **Partial reads refused:** a dataframe is made from all its sources or not at all, so an analysis never misses a source silently. `failed_sources` with reasons is in the failed job.
- **R2-9.** The window's own session over the main one, read when the run starts. See the tables.
- **R2-10. Built.** The connected address only; another is `400 source_not_connected`. The topic is the one you send.
- **R2-11. Built.** All form fields were read as configuration, so `[object Object]` could reach the domain's lists before it was refused, when an admin uploaded. The lists in a file upload are now ignored, and text in their place is refused before anything is stored. An analysis ignores such a stored value. The owner is checking the stored lists.
- **R2-12.** By top-level key, the sent value replaces the stored one. An empty list clears. For columns and mapping, `null` or the default value means inherit. Last save wins until B-4.
- **R2-13.** 50 values, 200 characters each. `equals` and `in` compare text: `0012345` is not `12345`. Dates: ISO and common forms, UTC when no zone is given. A cell that cannot be read never matches an ordered condition.
- **R2-14. Built.** `log_file` in every `stream_logs` payload. Lines may still arrive just after unplug; match by `log_file`.
- **R2-15.** No. Every answer is JSON.

## Questionnaire

**What changed for this:** jobs read the configuration live, so a save could change a run half way, and a domain switch in one window reached runs of another. **Now** a batch, realtime, quick or alert run keeps the domain, mapping, active rule and entity lists from when it was queued, and the thresholds from when it first reads them.

### Part 1
"Window" = the window's session over the main one. Domain and storage connection always come from the main session.

| Job | Domain | Thresholds | Rules (uploaded) | Mapping | Entities | Source | Tool | Session |
|---|---|---|---|---|---|---|---|---|
| Source connect | none | none | none | none | none | as sent | none | window |
| Tool connect | none | none | none | none | none | none | as sent, stored | window |
| `create_DF` | started | none | none | started | none | connect | none | window |
| Batch `stream` | queued | started | queued (name), started (file) | queued | queued | dataframe | started | window |
| Realtime `stream` | queued | started | queued (name), live (file, per message) | queued | queued | started | started | window |
| Quick run | as batch or realtime | | | | | | | window |
| STR alert run | queued | started | queued (name), started (file) | queued | queued | the alert's records | started | the alert's own |
| `/get_graph` by session | none | none | none | none | none | none | started | window |
| `/get_graph` by evidence or `task_id` | none | none | none | none | none | none | none | none |

### Part 2
| # | Answer |
|---|---|
| Q1 | Refused: `409 configuration_changed`. Before, B's rules ran on A's dataframe |
| Q2 | New: the threshold, mapping and entities at the moment Analyze is queued. The dataframe's columns keep the mapping they were made with |
| Q3 | Thresholds: new (read at start). Domain, mapping and entities: old |
| Q4 | No |
| Q5 | Only a new run. An uploaded rule file is the exception: it is read per message |
| Q6 | Disconnecting is refused during a run. A reconnected tool does not affect it: it keeps its login |
| Q7 | No longer |
| Q8 | `create_DF` with A: A. With B: `400 source_not_connected` |
| Q9 | By session: Neo4j B, so it looks empty. By `task_id`: the run's own graph |
| Q10 | The file as the worker loads it at the start; a deleted one ends the run without a verdict |
| Q11 | Analyses are never retried. A lost one is `failed` with `worker_lost` |
| Q12 | Their next queued runs use it. Open screens are not told (B-11, later) |
| Q13 | Both: the window's session and the main one |

### Part 3
| # | Answer |
|---|---|
| Q14 | Thresholds until the run starts, and an uploaded rule file. Nothing else |
| Q15 | No; a run on it is refused until you switch back or make it again |
| Q16 | Yes, on the task (R2-2). The session's configuration has none |
| Q17 | Neither reconnect nor save: it only needs to be connected |
| Q18 | Yes, reconnect |
| Q19 | Safe to keep; the run is refused if the domain differs |
| Q20 | **Built**, for the domain |

**So for you:** keep the dataframe across a domain switch and label it with its domain (Q1, Q19); stop reconnecting the tool before a realtime start (Q17); use `task_id` after a switch (Q9); show `config_versions` on Tasks and reports (Q16). Please remake the dataframe after a mapping change (Q2).

## Still open

- **Phase 6 (A1):** the prompt is in our response of 2026-11-25. For the analyst screen, use the save described in R2-18.
- **Later:** B-4, B-8, B-10 to B-14, B-25, B-34, and `columns` of B-28.

## Please report back

1. The 9 points of our first response.
2. Show graph by `task_id`: window closed, after a reload, and after a second run in that window.
3. Seats: your 4 checks, plus `unattended_not_allowed` for a realtime run, `task_not_running` for a waiting one, and `available: 0` while an analysis waits.
4. `ended_reason` for a run you stop, one you leave, and one that finishes.
5. An analyst's domain switch and column override, and what `invalid_fields` says otherwise.
6. `configuration_changed`, `run_in_progress` and `session_id_in_use` on screen.
7. A CSV with leading zeros in the account column, through to the graph.
8. Anything that does not match this document, with the request, status and body.

Please answer each as **OK**, **Problem** or **Not done yet**.
