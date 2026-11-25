# Review of the Service's response of 2026-11-25

**Response:** `service-response-2026-11-25.md`. **Next:** `backend-round-2-2026-11-24.md` (ready to send).
**Method:** each answer read against our code. **Done 2026-11-25:** everything under "Safe now" (1 to 7), with tests that fail on the previous code; 1,138 tests, lint and build pass. Nothing was run in a browser or against the live Service, which the user says is deployed.

## 1. Verdict on each answer

| Item | Their answer | Ours |
|---|---|---|
| B-33 | Built; no per-user permissions | Good. The privilege picker and `permissions` must go |
| B-30 | Refused | Reasons hold (no worker used, 6-hour stale windows). This was the analyst's decision, so **the analyst confirms** |
| B-29 | Refused | Reasons hold. No such action exists in the screens: nothing to drop |
| B-31 | Built | Already read |
| B-32 | Built | Must be read; the log tally becomes the fallback |
| Q5 | Expected; `rules_not_applicable` | Good, and it uncovers old false "clean" results (R2-21) |
| Q6, Q7 | Stay empty | Accept; our wording is now wrong ("no nodes") |
| B-1 | Enforced | Good, but conflicts with realtime and domain switch for analysts (R2-18) |
| B-35 | Built, narrowed | Good; HDFS, Elastic and REST batches are out |
| Phase 6 | Ours to build | Large. Plan separately |

## 2. Problems found in our code by this answer

| # | Problem | Where | Depends on |
|---|---|---|---|
| P1 | A run is marked **Completed** at the log line "Injection finished", though the full analysis follows. If the Service then reports it failed or stopped, that is ignored, and a background run's session is released | `backgroundStreams.js`, `SourceWindowBody.jsx`, `taskRegistry.js` applyServerTask | R2-17 for the line; following the Service's final status is safe now |
| P2 | Realtime start saves the configuration, with the Neo4j endpoint and any typed password. For an analyst this may now be `403`. Same in production | `configurationApi.js` persistRealtimeToolConfiguration | R2-18 |
| P3 | Domain switch in the Source window has no `config:write` check | `SourceWindowBody.jsx` switchDomain | R2-18 for analysts; the check is safe now |
| P4 | `editable_fields: []` **unlocks** every session-policy field instead of none | `ConfigurationPanels.jsx` canEditPolicy | Safe now |
| P5 | Encrypted export is offered with `config:read` | `ConfigurationWindowBody.jsx` | Safe now |
| P6 | "Clean" can still come from the log's "No flags found", which a run where no rule ran may also write | `taskFlags.js` | R2-21 for the line; not trusting the log when the Service gives verdicts is safe now |
| P7 | "Session … returned no nodes and no relationships" is untrue for a run whose rows matched no rule | `GraphWindowBody.jsx` | Safe now |
| P8 | Icons may be 2,000,000 characters each; all of `presentation` is 1 MB | `conditionalFormatting.js` | With `presentation` |
| P9 | Service accounts suggest `banking`; the Service's key is `bank` | `serviceAccounts.js` | R2-22 |

## 3. Work for the frontend

**Safe now: done** (right before and after the Service is deployed)
1. P4, P5, P3, P7.
2. P1 and P6: follow the Service's final status and verdict when a run has a Service task.
3. Users: stop sending `permissions`, show the roles' permissions read-only, add `manager`, word the new codes. (Per-user permissions are refused today already.)
4. Export password: at least 12 characters today, which passes; add "5 different" and "no space at either end"; word `wrong_password_or_damaged`.
5. Read `rows_done` / `rows_total` and `rules_not_applicable` when present; show "analysing" after the rows are in. The log stays the fallback.
6. Word `empty_selection`, `source_not_connected`, `invalid_date`, `quick_limit`, `use_end_session`.
7. Source dates top-level on `create_DF`.

**After deployment: next** (the Service is deployed; not started)
8. Service accounts: no `client_secret` on create; `rotate-secret`; `PATCH` only; remove the fallbacks (B-3, B-9).
9. Job cancel on searches, dataframes and graphs (B-7).
10. Rules template (B-16).
11. Username, password and assignable roles from `GET /auth/admin/user-rules` (its `roles.permissions` is already read; the shape is guessed until confirmed).
12. `presentation` with version conflicts; stop sending the two keys; drop the browser copies after moving them once (P8).
13. Quick analysis panel (B-35): file, Kafka batch, Kafka or REST realtime.
14. GPU: drop `graph_gpu_allowed` (B-36).

**Own plan needed**
15. Phase 6: the Domains screen and the analyst session screen. It replaces parts of Configuration (sensitivity, thresholds, columns, mapping) and needs R2-18 first.

## 4. Decided by the analyst (2026-11-25)
- **B-30:** the number of windows is the frontend's; the Service manages sessions.
- **Unattended runs by seats** (R2-19, B-38). A run goes on without its owner only with a seat the Service grants: off by default, turned on per run, one per user. Without one it ends when its owner leaves, as before. Built on our side, and disabled until the Service has the seats. Kept from the version before it: "ended while you were away", an owner can stop a run an earlier page started, a locked screen is not a lost job. The wait for a job that does not answer is 45 seconds.
- **Not possible from our side alone:** the seats themselves; the graph and the live log of a run left behind (B-37, reattach).
- **Access level:** an existing account's level can be changed, within the roles the signed-in account may give. One's own level is fixed.
- **Safe now:** done. Round 2: a brief first, then sending.

## 5. Open after "Safe now"
- **Realtime for analysts (P2)** is unchanged and may be refused: R2-18.
- **A run with a Service task but no job** ends only when the Service says so; the task list is asked every 30 seconds meanwhile. If the Service never sends a final status, it stays "Analysing" until it is terminated.
- **P8, P9** go with items 12 and R2-22.
