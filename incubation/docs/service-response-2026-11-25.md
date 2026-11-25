# Service response to the frontend follow-up (2026-11-24)

> Saved as received on 2026-11-25. Our reading of it is in `service-response-review-2026-11-25.md`.

**From:** the LinkX Service (backend). **Date:** 2026-11-25.
**Answers:** your open-items follow-up and the B-list, in your numbering.
**State:** everything marked **Built** is in the code and tested there (commits `7763d37` to `99b2fd3`). It is live once the Service is deployed; the Service owner will tell you when.

The Service sets priorities by its own distributed design (API, workers, database and graph on separate nodes). Where a request does not fit that, it is refused below with the reason and what to do instead.

## Summary

| Item | Answer |
|---|---|
| 0. B-33 user creation | **Built.** Per-user permissions refused |
| 1. B-30 count idle windows | **Refused** |
| 2. B-31 `graph_archived` | **Built** |
| 3. B-32 row progress | **Built** |
| 4. B-29 manual run as an alert's analysis | **Refused**; please drop the action |
| 5 to 7. Test-run questions | Answered; 6 and 7 stay as they are |
| 8. Phase 6 (A1) | **Yours to build**; prompt in the appendix |
| 9. B-1 scope | **Built** |
| 10. Other B-items | Table below |
| 11. B-35 quick runs | **Built**, narrowed |

## Please change on your side

These change what your screens send or may receive.

1. **User create and update: stop sending `permissions`.** Permissions come from roles.
2. **Reset, encrypted export and the session policy now need `config:write`.** Reading is not enough.
3. **Service-account secrets:** leave `client_secret` out and show the one we return.
4. **Encrypted export password:** at least 10 characters, 5 different ones, no space at either end. It is used exactly as typed.
5. **Service-account tokens** are never returned any more: you get `auth_token: "***"` (or `null`) and `auth_token_set`.
6. **`create_DF`** refuses an empty selection or an unconnected source, before a job is queued.
7. **Realtime streams end by themselves as `completed`** shortly before the worker's job timeout (by default after 1 h 50 min). Until now they failed at 2 hours.

## A. Requests

### 0. B-33: user creation
**The refused field was `permissions`.** Our schema did not accept it on a user. The refusal did carry the reason in `detail` ("Additional properties are not allowed ('permissions' was unexpected)"); it now also has `code` and `invalid_fields`.

**Every refusal** now has `{ message, code, detail, invalid_fields }`. Codes:

| Status | Codes |
|---|---|
| 400 | `missing_field`, `unknown_field`, `invalid_field`, `invalid_username`, `password_policy`, `invalid_roles`, `permissions_not_assignable`, `unknown_permissions`, `weak_secret` |
| 403 | `role_scope_exceeded`, `cannot_manage_account`, `cannot_grant_permissions`, `cannot_modify_system_service_account_*`, `cannot_delete_system_service_account` |
| 404 | `not_found` |
| 409 | `username_taken`, `client_id_taken`, `self_lockout` |

**The rules** are published for the signed-in caller at `GET /auth/admin/user-rules` (`users:manage`). Please read them from there:
- **Username:** `^[A-Za-z0-9_.@:-]{3,120}$`, unique ignoring case.
- **Password:** 8 to 1024 characters, no whitespace.
- **Roles:** `superuser`, `admin`, `manager`, `analyst`, `viewer`. A `superuser:manage` holder may give any of them; anyone else with `users:manage` may give only `analyst` and `viewer`.
- **User permissions:** not assignable. The exact set of the user's roles is accepted as redundant; anything else is `permissions_not_assignable`. Show `roles.permissions` read-only instead of the picker.
- **`alerts:ingest` and `auth:verify`:** service accounts only.

**Your questions:**
- **Did an escalation rule exist?** For roles, yes. For accounts and service accounts it did not; it does now.
- **Is `superuser:manage` exempt?** Yes, except from `self_lockout`.
- **Accounts with `admin` or `superuser`:** confirmed, an account without `superuser:manage` may not change them. The same goes for `manager`. Everyone may edit their own name and password.
- **Sending an account's own roles back** is not a change, so the on/off switch works.
- **`is_locked`:** there are no locked accounts in the Service, only session locks, which the user unlocks. There is nothing to unlock. `is_active` is now in the user list.

**Service accounts:**
- A caller may give the service-only permissions and those they hold. `users:manage` and `superuser:manage` need a superuser.
- Creating an existing `client_id` is `409`; it no longer overwrites the account.
- Permissions such as `ai:session:read` and `rule_engine:read` are now accepted.

### 1. B-30: count idle Source windows. Refused
- An idle window uses no worker and no analysis capacity, which is what the limit protects.
- After a browser crash the Service cannot tell that a window is gone until the 6-hour cleanup. Stale windows would lock the analyst out.
- Three open windows would block alert analysis.

The Service keeps counting running streams and alert runs, and now quick runs, limit 3 per analyst, refused with `429 session_limit`. Your own limit on open windows can stay as a screen limit.

### 2. B-31: `graph_archived`. Built
On every report record and on the alert record: `true` only when the graph is in cold storage.

### 3. B-32: row progress. Built
- **Fields:** `rows_done` and `rows_total` on the task, `null` when unknown. `rows_total` is after the filter.
- **Updates:** in `task_updated`, at most about every 2 to 3 seconds. Also on `GET /api/v1/tasks` and for alert runs.
- **Meaning:** rows ingested. The full analysis runs after `rows_done` reaches `rows_total`, so show "analysing" until the task ends.
- **Live streams:** `rows_done` counts up and `rows_total` stays `null` until the run ends by itself.
- The two log lines keep their wording.

### 4. B-29: use a manual run as an alert's analysis. Refused
Nothing ties a manual run's data to the alert, yet its findings would reach the parent as the alert's analysis. Its graph is also cleared with its session, while an alert's graph is kept. Please drop the action. **Analyse** and **Save as evidence** cover it.

## B. Questions from the test run

5. **0 relationships from 2 rows: expected.** Link Analysis stores each row as a node; only a rule that matches creates a relationship. The filter does not drop any. Keeping 4 of 20 columns can also leave rules without their fields. **New:** the task carries `rules_not_applicable: { rule: [missing fields] }`, and a run where no rule could run is now `undetermined`. It was wrongly `clean` before.
6. **`*` with nodes only returns an empty graph, and stays so.** Those nodes are raw transaction rows: a clean run of 10,000 rows would flood the window. "No graph data" is right.
7. **`has_graph` is `false` for nodes only, and stays so,** for the same reason.

## C. Still waiting on

8. **Phase 6 (A1, Domains and analyst screens):** this is the only item of our task list still open, and it is on your side. The full prompt is in the appendix and its Service side is live: please build the screens and run its Verify steps. One addition: the section `presentation` (B-23/B-24 below).
9. **B-1:** enforced on the server for configuration, admin, analysis, alerts and evidence.
   - `config:write`: save, rule removal, reset, import, encrypted export, session policy (PATCH).
   - `users:manage`: users, service accounts, rule thresholds, score lineage, domain sensitivity, columns and mapping.
   - Refusal: `403 { message: "forbidden", permission }`.
   - Domain switch is part of save.
10. **Other B-items:**

| Item | Answer | What to know |
|---|---|---|
| B-2 | **Built** | Omitted, empty or `***` token keeps the stored one; `null` clears it |
| B-3 | **Built** | Created without a secret: `client_secret` is in the answer, once. `POST /auth/admin/service-accounts/:id/rotate-secret` |
| B-5 | **Built** | `400 empty_selection`, `400 source_not_connected` |
| B-6 | **Built** for the Source routes | `success` and `code` on every answer of `/init_source`, `/connect_to_source`, `/disconnect_source`, `/connect_to_tool`, `/disconnect_tool`, `/close_source_window`, `/upload_batch_files`, `/live_batch_files`. Existing fields unchanged. Failed `create_DF` jobs carry `code` and no raw error text |
| B-7 | **Built** | `POST /jobs/:id/cancel` for search, dataframe and graph jobs: `200` with `cancelled`, or `202` with `cancel_requested` (poll the job). An analysis is `409 use_end_session` |
| B-9 | **Built** | Service accounts: `PATCH` only. `config` is supported. Thresholds and score lineage accept `domain` and `domain_id`, GET and POST. Please remove the fallbacks |
| B-15 | **Built** | `editable_fields` is `[]` without `config:write` |
| B-16 | **Built** | `GET /api/v1/rules/template` (`config:read`) |
| B-17 | **Built** | Policy above. A wrong password on import: `code: wrong_password_or_damaged`. Old files made with trimmed passwords still open |
| B-18 | Answered before | H-11 to H-17 |
| B-19 | **Built** | `value.start_date` / `end_date` on search, and top-level on `create_DF` (send them on both). Either may be `null`. `400 invalid_date`. Elastic searches filter the rows the search returned |
| B-23, B-24 | **Built, in another place** | `GET` / `POST /domain-config` with `section: "presentation"`. See below |
| B-4, B-8, B-10, B-11, B-12, B-13, B-14, B-25, B-34 | Later | Not started. B-4 exists for `presentation` already (`version_id`) |
| B-26 | Refused | The Service holds no portraits |
| B-36 | Refused | The session configuration is per user, so it cannot turn GPU drawing off for everyone. Keep it a per-browser setting |

**B-23 and B-24.** Not in the session configuration: that is per user, travels with every configuration call, and its answers cut text over 512 characters, which would break embedded icons. Instead, one versioned copy per domain, shared by everyone:
- `GET /domain-config?domain=D&section=presentation` (`config:read`) returns `{ domain, section, version_id, actor_profile, formatting_rules, updated_by, updated_at }`.
- `POST /domain-config { domain, section: "presentation", actor_profile?, formatting_rules?, version_id? }` (`config:write`). A key left out is kept; `null` clears it.
- With `version_id`, a newer version is refused: `409 { code: "version_conflict", current }`.
- Shapes and bounds are yours. All of it together: at most 1 MB. `icon`: an embedded image or a path on this site.
- History: `GET /domain-config/history?domain=D&section=presentation`.
- Please stop sending these two keys in the configuration save, and drop the browser copies.

## D. 11. B-35: quick runs. Built, narrowed

**Send `quick: true`;** the Service sets the limits. Any limits you send are ignored.

| Input | How | Limit |
|---|---|---|
| File | upload, `create_DF` with top-level `quick: true`, then `stream` with `value.quick: true` | one file, 5 MB, 20,000 rows |
| Batch | Kafka batch topic only: `create_DF` (`kind: "address"`) and `stream` as above | last hour by Kafka message time, 20,000 rows |
| Realtime | `stream` with `value.quick: true` and `listen_realtime: true`; Kafka or REST | new messages for 15 minutes |

- **Refused** with `400 { code: "quick_limit", detail }`: HDFS, Elastic and REST batches (their time is per file or per day, or unknown), more than one file, any action but Link Analysis, or a `stream` on a dataframe not made as quick. Too many rows fails the `create_DF` job with the same code.
- **Realtime** ends by itself as `completed` with the full analysis. With no rows it completes `undetermined`.
- **The browser closing:** refused as asked. As for every run, one whose log or notifications the browser follows is stopped 45 s after that browser disconnects (`terminated`). Any other ends at its time limit.
- **Task:** `quick: true`, `window_start`, `window_end` (both `null` for a file).
- **Verdict:** `suspicious` or `undetermined`, never `clean`.
- **Session limit:** counts as one and frees it when it ends.
- **Your questions:** Kafka does batch and realtime, REST realtime only, HDFS neither. Until now a realtime stream could not end by itself. The session configuration's rule is enough to start.

## Please report back

1. B-33: create, edit and switch a user on and off; say which refusals you saw.
2. `GET /auth/admin/user-rules`, secret rotation and the masked token on screen.
3. Row progress and `rules_not_applicable` on a filtered run.
4. Job cancel on a search and on a `create_DF`.
5. `presentation`: save, reload in another browser, and a version conflict.
6. Quick runs: a file, a Kafka batch and a realtime run to its end.
7. The parent-alert run-through you owe from the screens.
8. Phase 6 (A1): the result of each of its 4 Verify steps, with the screenshots, or when you plan to build it.
9. Any answer that does not match this document, with the request, status and body.

Please answer each as **OK**, **Problem** or **Not done yet**.

---

# Appendix: Phase 6 prompt

**Task:** build the admin "Domains" screen and update the analyst session screen for the Service's domain-centric configuration. The Service side is live. Every route below exists and is enforced in production.

## Model (what the screens must convey)
- Each **domain** has its own configuration: sensitivity, thresholds, columns and column mapping. The known domains are `bank`, `microfinance`, `insurance`, `cdr` and `social_media`. Use the frontend's existing domain list if it has one.
- An **admin** (`users:manage`) adjusts a domain. That adjusted configuration is the default for **every** user and service account of the domain.
- **Analysts** may override only their own **columns**. They may not change endpoints, credentials or the column mapping.
- Every value has an **origin**. Show it next to the value as a small badge, so people can see why a value is what it is:
  - columns: `profile`, `admin` or `override`
  - mapping: `profile`, `admin` or `service_account`

## Rules for every screen
1. **After any save or reset, re-render from the response's `state` (or refetch).** Never keep local edited state as the truth, because the Service normalises, validates and merges.
2. **Never post secret keys.** Omit any key whose name contains `password`, `secret`, `token`, `credential` or `authorization` (including masked `***` values and `domain_connections.*.auth_token`). If a non-admin posts one, the save is rejected.
3. Errors:
   - **400 `validation_error`** includes `errors: [{field, message}]`. Show each message next to its field.
   - **403 `domain_not_granted`** (with `domain` and `allowed_domains`). Say "You don't have access to this domain".
   - **403 `endpoint_admin_only`** (with `fields`). Say "Managed by an administrator" and name the fields.
   - **404 `feature_disabled`**. Hide that tab.
4. Use Service-side permissions to show or hide controls. Use `config:read` for viewing and `users:manage` for editing. The Service enforces both anyway.

## 1. Admin "Domains" screen (`users:manage`)
Show a domain picker at the top, then these tabs. Every request takes `domain=<id>`.

### Sensitivity
- **Load:** `GET /domain-config?domain=D&section=sensitivity` returns:
  - `preset` (the active preset)
  - `available_presets`, `managed_keys`
  - `modified_since_applied` (keys changed after the preset was applied; show them as a warning list)
  - `thresholds`
- **Apply a preset:** `POST /domain-config {"domain": D, "section": "sensitivity", "preset": "<name>"}`. Ask for confirmation first, because this changes detection for everyone on the domain.
- **Reset:** apply the `baseline` preset.

### Thresholds
- **Load:** `GET /rule-thresholds?domain=D` returns `results.config`, plus `updated_by` and `updated_at`.
- **Save:** `POST /rule-thresholds {"domain": D, "<key>": <value>, ...}` with the changed keys only. Unknown keys get a 400.
- **History:** `GET /rule-thresholds/history?domain=D&limit=50` returns a list of `{version_id, config, updated_by, created_at}`.

### Columns
- **Load:** `GET /domain-config?domain=D&section=columns` returns:
  - `columns` (each of `fetch_columns`, `search_columns_strict` and `search_columns_fuzzy` maps to a list of names)
  - `origins`, `admin`, `profile`, `versions`, `enforced`
- **Editor:** one list editor per key. Show the profile default next to the admin value.
- **Save:** `POST /domain-config {"domain": D, "section": "columns", "columns": {"fetch_columns": [...], "search_columns_fuzzy": null}}`. `null` means "inherit the profile". Names must match `^[A-Za-z0-9_.-]{1,128}$`, with at most 200 per list.
- **Reset:** `POST /domain-config/reset {"domain": D, "section": "columns", "keys": ["fetch_columns"]}`. Omit `keys` to reset the whole section.
- **History:** `GET /domain-config/history?domain=D&section=columns`.

### Mapping (source column → canonical field)
- **Load:** `GET /domain-config?domain=D&section=mapping` returns:
  - `column_mapping` (the effective `{source: canonical}`)
  - `origins`, `admin_adjustments`, `profile`, `versions`, `enforced`
- **Table:** one row per source column, with columns for source, canonical target, origin badge and actions.
  - **Edit target:** set `{SRC: "TARGET"}`.
  - **Remove** (drop a profile entry): set `{SRC: null}`.
  - **Revert to profile** (drop the admin adjustment): set `{SRC: "__inherit__"}`.
  - **Add row:** set a new source and target.
- **Save:** `POST /domain-config {"domain": D, "section": "mapping", "column_mapping": {SRC: "TARGET" | null | "__inherit__"}}`. Send only the changed rows; the Service merges them.
- **Reset:** `POST /domain-config/reset {"domain": D, "section": "mapping", "sources": [..]}`. Omit `sources` to go back to the profile entirely.
- **History:** `GET /domain-config/history?domain=D&section=mapping`.
- **Warning text:** "The mapping decides which source field is the account, amount or date in analyses. Changes apply to all users and service accounts of this domain."

### Domain access (per user; put it on the user admin page or as a tab)
- **Load:** `GET /auth/admin/users/<id>/domains` returns `domains` (a list, or `null` for all domains), `unrestricted` and `enforced`.
- **Save:** `PUT /auth/admin/users/<id>/domains {"domains": ["bank", "microfinance"]}`. Send `{"domains": null}` to lift the restriction.
- Show "All domains" when the value is `null` or the user is an admin.

## 2. Analyst session screen
- **Domain selector:** take `allowed_domains` from `GET /auth/me`. `null` means all domains; otherwise offer only the listed ones. Handle 403 `domain_not_granted` anyway.
- **Columns editor:** the plain keys `fetch_columns`, `search_columns_strict` and `search_columns_fuzzy` in the config are the edit channel.
  - Post the edited lists with the normal save (`POST /account/configuration`, or `POST /configuration` for a session). The Service works out which values are overrides.
  - Setting a list back to the admin default removes the override.
  - Show the `columns_origins` badge for each key (`admin`/`profile` = default; `override` = the user's own).
  - Add a "Reset to domain default" action. It posts the admin default value, which the state response provides.
- **Read-only for analysts:**
  - storage, tool and Kafka endpoints (`domain_connections.*`, `tool_credentials.url/username/database`)
  - Hive/Hadoop ports
  - `column_mapping` (show it with its `column_mapping_origins` badges and the label "Managed by an administrator")
  - Don't send those fields back changed; echoing them unchanged is fine.
- **Endpoint changes:** when an admin changes a storage or tool host without entering a new secret, the stored secret is dropped. Tell the admin "Changing the host clears the saved credential; enter it again".

## Verify
1. As an admin:
   - Apply a preset; edit, reset and view the history of columns and mapping on `microfinance`.
   - Confirm that every view re-renders from the response and that the origin badges change (`profile` → `admin` → `profile`).
2. As an analyst granted only `bank`:
   - The selector shows only bank.
   - A column override shows `override` and survives a reload.
   - Resetting it shows the default again.
   - Endpoint and mapping fields are read-only.
3. Check the network tab: no request body contains secret keys or `***`.
4. Screenshots of each tab, plus the analyst screen.
