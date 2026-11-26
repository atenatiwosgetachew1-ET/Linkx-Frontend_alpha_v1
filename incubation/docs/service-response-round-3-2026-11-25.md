# Service response to round 3 (complete)

> Our copy of the Service's complete response of 2026-11-25, which replaces its earlier one. Sections 1 to 7 and 13 are written out here from it, with its reasons shortened; 8 to 11 are as received. Our answer to the earlier one: `frontend-reply-round-3-2026-11-25.md`. **The user confirmed on 2026-11-25 that the deployment it calls "Next" is live too.**

## 1. Status
| Item | Status |
|---|---|
| B-39, B-40, B-44 to B-48 | **Live** (`c48aa80`) |
| B-41 mapping for one dataframe, B-42 `settings_used`, B-43 override permissions | **Live** since the next deployment (`bb0e1e6`, `c5f609f`, `5481bc6`) |
| Two time-of-day errors on the Service's side (section 7) | **Live** with it |
| Hiding tasks, reports and evidence of other domains | **Refused for now** |

Agreed: all of D1 to D9 (D3: a required field cannot be removed; D4: for one dataframe, never stored; D6: columns only; D7: by role only). Alert runs, services and xVigilance use the domain's settings only. Evidence under an override: allowed, with the remark, for everyone with `evidence:create`.

## 2. Our seven questions
| # | Answer |
|---|---|
| 1 `missing_fields` | Yes: every successful `create_DF` has `missing_fields`, `source_columns` and `dataframe_mapping`, also without a mapping; so has a refusal of the mapping |
| 2 quick runs | A quick `create_DF` accepts `dataframe_mapping`, same permission. Source windows only is fine |
| 3 trusted entries of non-admins | Checked in production: none, nothing to remove |
| 4 alerts on `bank` | Not today; comes with the parent's contract. `settings_used.domain` says `bank`: show it with the alert's result |
| 5 `version_id: null` | "Only if nothing was saved yet", else `409 version_conflict`. Send it |
| 6 `warnings` | Groups: `[["ACCOUNTNO"], …]`, `[]` when nothing was lost |
| 7 a stored override that breaks the rule | Ignored at every load; `columns_origins` then shows the default's layer. Not deleted; `null` or the reset removes it |

## 3. Two security errors on the Service's side (B-40), fixed
1. `POST /account/configuration` did not protect the entity lists.
2. An alert run started from the account settings of the analyst who starts it.

**Now:** an account save without `users:manage` may change only the five self-service keys of R2-18 (the domain with `analysis:run`, the column lists with `columns:override` as well); a change elsewhere is `403 { permission, invalid_fields }`, or `endpoint_admin_only` with `fields`. Send changed keys only. An alert run takes only the Neo4j login from the analyst; its domain is `bank` until the parent names one. The owner is still checking `bank`'s history: change nothing there.

## 4. A mapping for one dataframe (B-41)
`POST /live_batch_files { id: "create_DF", …, dataframe_mapping: { "SOURCE COLUMN": "TARGET" } }`. Never stored; no effect on realtime runs; may only fill a field that would be missing; recorded in `settings_used` and the audit.

| When | Answer |
|---|---|
| No `mapping:override` | `403 { permission: "mapping:override" }` |
| Not an object of names, over 50 entries, or a name over 128 characters | `400 invalid_field`, `invalid_fields: ["dataframe_mapping"]` |
| The data does not allow it | the job fails with `code` `unknown_source`, `unknown_target`, `target_present` or `duplicate_target`, with `fields`, and in `results` `source_columns` and `missing_fields` |
| Done | the job's `results` has `columns`, `source_columns`, `missing_fields` and `dataframe_mapping` as applied |

- `columns` includes the mapped fields; `source_columns` does not. For a search, `source_columns` are the fetched columns, in lower case, with those the domain's mapping filled. A column outside the fetch columns cannot be a source.
- `missing_fields` is flat; of alternatives it names the first (`AMOUNTINBIRR` stands for `AMOUNT` too); it includes optional fields. `required_fields` marks the ones that matter most.
- `target_present` also covers what the Service fills itself: `AMOUNT` or `TRANSFERAMOUNT` → `AMOUNTINBIRR`; `SENDERACCOUNTID` → `ACCOUNTNO`; `RECEIVERACCOUNTID` → `BENACCOUNTNO`; `CREATEDDATE` → `TRANSACTIONDATE`. `TRANSACTIONTIME` is present when the date carries a time.
- `AMOUNT` and `AMOUNTINBIRR` in one mapping are `duplicate_target`. Source names ignore case. One code per answer.
- To make it again without a mapping, leave the key out or send `{}`.

## 5. `settings_used` (B-42)
```jsonc
"settings_used": {
  "domain": "microfinance",
  "versions": { "thresholds": 12, "preset": "baseline", "mapping": 4, "columns": null },
  "overridden": true,
  "overrides": {
    "columns": { "fetch_columns": { "added": ["FEE"], "removed": ["BRANCH"] } },
    "dataframe_mapping": { "PAYER ACC": "ACCOUNTNO" }
  },
  "overridden_by": "analyst name",
  "missing_fields": ["TRANSACTIONTIME"]
}
```
`overrides` holds only what was overridden; `overridden_by` is the person who made the dataframe.

| Where | Field |
|---|---|
| Task (list, single, `task_updated`) | `settings_used`, or `null` = not recorded |
| `GET /api/v1/tasks?overridden=true` or `false` | a task without `settings_used` is in neither |
| Evidence and report records | `settings_used` (a copy on evidence) and `domain` |
| Alert | `settings_used` of its run; never overridden |
| `/get_graph` by `task_id` and by evidence | `settings_used` |
| `/get_graph` by session (the `202`) | `task_id` and `task_ids` |

1. By session, `task_ids` is new: a session can hold the rows of several runs. `task_id` is set when it is one run, else `null`: then look at the tasks in `task_ids` and show the remark if one is overridden; "not recorded" only when the list is empty or a task has no `settings_used`.
2. A column override is recorded only where it has an effect: dataframes made by search.
3. `versions.thresholds` and `preset` are set again when the run starts. Nothing else changes after queueing.
4. `missing_fields` is `null` for realtime and alert runs.
5. A dataframe made before this deployment gives "not recorded".

A copy on evidence stays when its graph is archived. `clean` under a mapping stays `clean`. In the feedback to the parent, and a filter on reports: **Later**. The Service has no MCP server; its AI routes never read a run's result.

## 6. Override permissions and columns (B-43)
| Item | Answer |
|---|---|
| Permissions | `columns:override` and `mapping:override`, for `analyst`, `manager`, `admin`, `superuser`. No new sign-in needed |
| A changed column list without it | `403 { permission: "columns:override", invalid_fields }`, on `POST /configuration` and `POST /account/configuration`. Echoes pass |
| A required field removed | `400 required_field_removed`, `fields` as groups. A field the default itself does not fetch is not asked for |
| One list back to the default | `null` for it, on both routes |
| All of one's own in a domain | `POST /account/configuration/reset { section: "columns", domain }`; another `section` is `400 invalid_field`. It restores the account: an open session keeps its own copy, send `null` there too |
| `columns_default` | beside `columns_origins`, per list, in every loaded configuration |
| Without the permission, an older override | not deleted |

C1: 5 profile, then admin; a copy kept in a session never wins. 6 `409 configuration_changed` with `changed: ["column_mapping"]`. 7 an alert run takes only the Neo4j login. 9 a sent mapping is ignored. 11 an export holds the session's columns, one's own included; an import can make column overrides. 12 please do not send the mapping or lists with a rule upload. C3: no switch per user; an override is kept per user and per domain, and stays when it comes to equal the default; `columns_origins` and `column_mapping_origins` are in every loaded configuration. C3b confirmed.

## 7. Time of day, results change
Files with a date and a separate time column lost the time, and files with a date only were given `00:00:00`: such rows could be flagged `LATE_NIGHT_TX`. Now the time column is used when the date carries none; with no time anywhere `LATE_NIGHT_TX` and `RAPID_WITHDRAWAL` are in `rules_not_applicable` (`TRANSACTIONTIME`), and `TRANSACTIONTIME` is in `missing_fields` (not checked on very large dataframes). Earlier runs keep their flags; a new run on the same file can differ.

## 8. Quick analysis

| Item | Answer |
|---|---|
| R3-1 (B-39) | **Exists:** a live quick run ingests and analyses each message, with provisional `flags` in `task_updated`, then the full analysis at the end. **Live:** the log line `Live analysis batch <n> flags: {…}`, beside `Realtime incremental analysis for <batch>: {…}` |
| R3-2 | Right: none, for Kafka and REST. The source must be connected |
| R3-3, 1 | `quick_limit` |
| R3-3, 2 | It fails with `no_data` |
| R3-3, 3 | Yes. The graph is cleared, the verdict is `undetermined` |
| R3-3, 4 | `window_start` at the start, `window_end` at the end. A run that is stopped has no `window_end` |
| R3-3, 5 | It used to run without rules and ends `undetermined`. **Live (B-48):** `400 rule_not_available` with `rule`, for any run |
| R3-4 | **Live (B-40):** WANGIRI |

## 9. Domains screen

### C4
1. Name and values: `{ name: { key: value } }`. Only `bank` and `microfinance` have presets.
2. Values: **Exists** (`available_presets`). `dry_run: true`: **Live (B-44)**, answers `changed: { key: [now, after] }` and saves nothing.
3. It replaces the keys in `managed_keys`, also those changed by hand. It touches no other key.
4. Yes; its number is `threshold_version_id`.
5. Yes, on its own route. Not part of a preset. **Live (B-44):** `GET /config/score-lineage/history?domain=D&limit=50`.

### C5
1. Not exactly. `bank`, `microfinance` and `cdr` accept a closed set: the keys of the answer. `insurance` and `social_media` start empty and accept numeric keys.
2. **Live (B-44):** `keys: { key: { type, min, max, default } }` and `closed` (no other key is accepted). `type` is `integer`, `number`, `boolean` or `list`. Labels stay yours.
3. It marked nothing as `modified_since_applied`, which compares values. It stored every key as the admin's, so later profile changes no longer reach them. It did not fail.
4. With the owner (section 3).

### C6
**Live (B-44):** `version_id` in the GET of sensitivity, thresholds, score lineage, columns and mapping (`null` = nothing saved yet; send `null` too, it means "only if nothing was saved"). Send it back with a save or reset: an old one is `409 version_conflict { current }`, where `current` is the GET. Without it the save goes through as before. Sensitivity uses the thresholds' version, because a preset rewrites them. Saves of one domain go one after the other. `versions` is `{ profile, admin: { version_id, updated_by, updated_at } | null }`.

### C7
1. **Live (B-44):** `canonical_fields`, `required_fields` and `unmapped_required` in `section=mapping`. Required fields are groups of alternatives, for example `[["ACCOUNTNO"], ["AMOUNTINBIRR", "AMOUNT"]]`.
2. Yes. At the data, a column that already has the target's name wins, then the first mapped source found.
3. Same pattern as columns. Case is kept as written and ignored when matching.
4. Unusable in lists. A stored **column list** with one invalid name is ignored as a whole, and the next layer is used; in the **mapping** only that row is skipped. Names with spaces work in a dataframe mapping (section 4).
5. Not refused: the data may have the field itself. **Live (B-44):** `warnings` in the answer of a save, with the groups that just lost their last source (`[]` when none).

### C8
1. `sensitivity`: `{ version_id, domain, preset, threshold_version_id, updated_by, created_at }`. `columns` and `mapping`: `{ version_id, domain, section, config, updated_by, created_at }`, where `config` is the admin's whole layer.
2. No. The admin sets the values again.
3. `limit` up to 200; no paging.

### C9
1. `state` is the GET of that section, for sensitivity, columns, mapping and reset. Thresholds and score lineage answer `{ domain, config, updated_by }`. **Live (B-44):** `state` there too.
2. Saved but not applied. All are applied today.
3. Only `sensitivity`. The same for every domain.
4. Keep your five.
5. Anyone with `config:read`, for any domain. They hold no secrets.

## 10. Domain access and endpoints

### C10
| # | Answer |
|---|---|
| 0 | **Confirmed.** Enforced since 2026-11-13. A user without a list has every domain, new ones too |
| 1 | Beside the actor in `GET /auth/me`: `allowed_domains` and `domain_access_enforced`. Not in the sign-in answer |
| 2 | At the next request. No event |
| 3 | The session keeps its domain. Waiting and running runs go on. **Live (B-45):** a new search, `create_DF`, filter preview or stream in it is refused; `end_session` is not |
| 4 | Refused, `400`. Deactivate the account instead |
| 5 | **Refused for now.** Only sessions and runs. Alerts are assigned by the parent, and evidence is shared by design; hiding records needs its own design |
| 6 | Configuration load, save, switch and reset, account configuration, `presentation` save. **Live (B-45):** search, `create_DF`, filter preview, stream |
| 7 | Holders of `users:manage`, for accounts they may manage. It has no effect on admins, who are never restricted |
| 8 | No. Their `registered_domains` decide |
| 9 | **Live (B-45):** `domains` in the user list (`null` = all) |

### C11
1. Storage host or port, and Neo4j host or port. Not Kafka, REST, a path or a database name.
2. **Live (B-46):** `credentials_cleared` in the answer of a save, a list of the dropped keys, for example `domain_connections.bank.auth_token`. Absent when none was.

## 11. "Later" items

| Item | Answer |
|---|---|
| B-11 | **Live (B-47), for domain settings:** the socket event `domain_config_changed { domain, section, version_id }` to every connected user. `section` is `thresholds`, `sensitivity`, `lineage`, `columns` or `mapping`. Session configuration: later |
| B-4 | **Later.** A session's configuration belongs to one user, so the risk is their own second tab |
| B-13 | **Live (B-47), for domain settings:** before and after in the audit (`admin.domain_config.changed`). Reasons and request ids: later |
| B-10 | **Exists** for save, switch, reset and import: the full normalised configuration. Please tell us if one is not |

## 13. What the Service asks us to run
Round 1 (points 1, 3, 4, 6, 7, 8), round 2 (2 to 7), the quick runs, and the Domains page with `version_conflict`, `dry_run`, `credentials_cleared` and `domain_config_changed`. And:
1. `create_DF` of a file with other column names: `missing_fields`, then again with `dataframe_mapping`, and the run's `settings_used`.
2. One refusal each: `target_present`, `unknown_source`, `required_field_removed`.
3. A search with an overridden column list: the task under `?overridden=true`, and its evidence.
4. A file with a date only: `LATE_NIGHT_TX` and `RAPID_WITHDRAWAL` under `rules_not_applicable`; the same file with a time column: not there.
