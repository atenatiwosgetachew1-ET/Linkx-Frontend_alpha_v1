# Backend requests from the incubation frontend review

**Date:** 2026-11-13. These come from a review of the incubation frontend: the Source, Settings and Configuration windows.

**What this list contains:**
- Problems the frontend cannot fix, or can only work around unsafely, because the server owns the rule, the data or the state.
- Each item gives the current behaviour, the problem, the request, and how to verify the change.

**Status 2026-11-20 (the Service's alignment note):** B-20, B-21 and B-22 are covered by H-2, H-7 and the handoff; B-27 and B-28 are done (the optional `columns` part of B-28 is not). The remaining items are ranked in `frontend-reply-2026-11-20.md` §10. B-29 is new.

**What is out of scope:** the frontend has its own phased plan in `frontend-hardening-plan.md`. Items there that depend on this list are marked **[needs B-n]**.

**Endpoints in use today** (the current contract, matching the production monolith `src/App.jsx`):
- **Session and auth:**
  - `POST /init`
  - `POST /auth/login`
  - `GET /auth/me`
  - `GET` and `PATCH /auth/session-policy`
- **Configuration:**
  - `POST /configuration` with `{id: load | load_default | save | remove_rule, session_id, configuration | domain | rule_name}`
  - `POST /configuration/lxac/verify`
  - `POST /configuration/export/encrypted`
  - `POST /configuration/import/encrypted`
- **Source windows:**
  - `POST /init_source`
  - `POST /connect_to_source`
  - `POST /disconnect_source`
  - `POST /connect_to_tool`
  - `POST /disconnect_tool`
  - `POST /upload_batch_files`
  - `POST /live_batch_files` with `{id: search | create_DF | stream | end_session}` (`stream` may carry `dataframe_filter`, B-27; `preview_DF_filter` proposed, B-28)
  - `GET /jobs/:id`
- **Admin:**
  - `/auth/admin/users[/:id]`
  - `/auth/admin/service-accounts[/:id]`
  - `GET /api/v1/rules/catalog`
  - `/admin/cleanup/session`
  - `GET /admin/audit/cleanup`
- **Detection and vigilance:**
  - `/rule-thresholds[/history]`
  - `/config/score-lineage`
  - `/api/v1/reports/xvigilance/{health,state,rewind}`

---

## P0 — Security and data integrity

### B-1. Enforce RBAC on the server for every mutation
**Today:** permissions are checked only in the UI.
- **Users:** a non-superuser admin can pick the `superuser` role and grant themselves `users:manage` or "all privileges".
- **Configuration:**
  - `load_default` (Reset) needs only `config:read` in the UI.
  - Encrypted import, the domain switch (`{id:'save', domain}`) and `PATCH /auth/session-policy` have no server-side permission guarantee that the frontend can rely on.

**Request:**
- Reject role or permission escalation. An actor may only assign roles and permissions they hold themselves. `superuser` is assignable only by holders of `superuser:manage`.
- Require `config:write` for `save`, `remove_rule`, `load_default`, the domain switch and encrypted import.
- Require `config:write` (or a dedicated `session:policy`) for the session-policy PATCH.
- Block self-lockout: an admin may not deactivate or delete themselves, or remove their own `users:manage`.
- Return `403 {code:"forbidden", permission:"<perm>"}`.

**Verify:** call each endpoint with a token that lacks the permission and confirm it returns 403. A non-superuser admin cannot create a superuser, and an admin cannot deactivate their own account.

### B-2. Never return secrets; accept an "unchanged" secret
**Today:**
- **Service-account tokens:** each domain's `auth_token` comes back from `GET /auth/admin/service-accounts`. Either the bearer token is visible in the browser, or a mask (`***`) is returned. In the second case the frontend sends the mask back on save and overwrites the real token.
- **Tool password:** `active_tool_password` is masked, with a `*_password_ref`, which works. But a raw `active_tool_password` / `neo4j_password` can still arrive in the configuration when no ref exists.

**Request:**
- **Responses:** never return raw secrets. Return `{auth_token_set: true}`, or the mask plus a `*_ref`.
- **Saves:** treat an omitted secret, or the mask value, as "keep the current secret". Treat an explicit `null` as "clear".
- **Configuration:** never include raw tool passwords.

**Verify:** after GET then save without touching the token, the stored token is unchanged. The token never appears in any response body.

### B-3. Generate client secrets on the server
**Today:**
- **Generation:** the browser generates the client secret on create and on rotate. It uses `crypto.getRandomValues`; if that is unavailable, it fails open and produces all zeros.
- **Rotate request:** `PATCH {client_secret}`.

**Request:**
- **Create:** `POST /auth/admin/service-accounts` without `client_secret` generates one and returns it once.
- **Rotate:** add `POST /auth/admin/service-accounts/:id/rotate-secret`, which returns the new secret once.
- **Strength:** enforce minimum secret strength on any client-supplied secret.

**Verify:** a create without a secret returns a strong secret exactly once, and a later GET does not include it.

### B-4. Optimistic concurrency for configuration and admin edits
**Today:** it is last write wins. Two admins, or a stale tab, silently overwrite each other's configuration, user, role or service-account changes.

**Request:**
- Return a `version` (or an `ETag`) with the configuration, users and service accounts.
- Accept `If-Match` / `version` on save.
- Reply `409 {code:"version_conflict", current:{...}}` on a mismatch.

**Verify:** two saves made from the same version produce one success and one 409.

### B-5. Server-side guards on `create_DF`
**Today:** the frontend can send `create_DF` in invalid states:
- an empty `value` array;
- `kind:"address"` for a broker that was never connected;
- `kind:"hdfs"` or `kind:"hybrid"` after a disconnect.

The frontend is fixing its own state leak, but the server should not accept these.

**Request:** reject empty `value` arrays, and reject kinds whose source connection is not active for that `session_id`. Return `400 {code:"source_not_connected"}` or `400 {code:"empty_selection"}`.

---

## P1 — Contract clarity (removes fragile frontend heuristics)

### B-6. Structured, user-safe error and success contract
**Today:**
- **Status from English text:** the frontend infers status from English strings: `"Connection established!"`, `"Dataset uploaded!"`, `"Result out of bound!"`, `"Failed!"`, `"Connected!"`.
- **Success check:** `{message:"Failed!", results:{...}}` is treated as success because `results` is set.
- **Raw error bodies:** some errors come back as an HTML or proxy page, or as raw stack text. Search diagnostics expose internal paths (`base_path`, `errors`).

**Request:**
- **Every JSON response includes:**
  - `success: boolean`
  - `code` (a stable machine code, e.g. `connected`, `uploaded`, `out_of_bounds`, `source_not_connected`)
  - `message` (user-safe, no paths, ids or stack traces)
  - optional `field`
  - optional `detail` (debug only)
- **Errors:** never send HTML or plain text with a 4xx/5xx from the API. Return JSON even for proxy or timeout errors where possible.
- **Diagnostics:** hide raw diagnostics behind a debug flag or admin role.

**Verify:** every endpoint listed at the top returns `success` and `code` in both success and failure cases.

### B-7. Job cancellation
**Today:** there is no cancel endpoint.
- **Cancel is cosmetic:** the UI's "Esc or click here to cancel" only stops the browser waiting. Queued search, `create_DF` and upload jobs keep running.
- **Domain switch:** a cancelled domain switch still switches on the server, so the UI and the backend end up on different domains.

**Request:**
- Add `POST /jobs/:id/cancel`. Workers stop at the next checkpoint, and `GET /jobs/:id` then reports `cancelled`.
- Make the domain switch synchronous and idempotent, or return the job id so it can be cancelled too.

**Verify:** a cancelled job reaches `cancelled` and produces no dataframe or search result.

### B-8. Search pagination fields
**Today:** the frontend computes the next `offset` from the number of results it keeps. When rows are filtered out (for example rows without a name), pages drift: rows are duplicated or skipped.

**Request:** add `next_offset` (raw), `total` (or `total_estimate`) and `has_more` to `/live_batch_files {id:"search"}` responses, for both raw and hybrid searches. Never return nameless rows.

### B-9. One definitive endpoint per resource (remove fallbacks)
**Today:** the frontend copies production fallbacks that hide real errors:
- `PATCH` → `PUT` → `PUT /auth/service-accounts/:id` on 404 or 405. A 404 because the account was deleted turns into a PUT, which may upsert it.
- Service-account `config` is retried without `config` whenever an error message contains "config".
- `/rule-thresholds?domain_id=cdr` and `/config/score-lineage?domain_id=cdr` fall back to the unscoped endpoint on any error, including for POSTs. This risks duplicate writes.

**Request:**
- Confirm the single supported method and path for each of these.
- Support the `domain_id` query on rule-thresholds and score-lineage, for both GET and POST, on all deployed backends.
- If `config` is not supported on service accounts, return `400 {code:"unknown_field", field:"config"}`.

Once confirmed, the frontend removes the fallbacks.

### B-10. Domain switch and configuration save return the full configuration
**Today:**
- **Domain registry:** the save and switch responses omit `domain_connections` / `registered_domains`. The frontend keeps the old registry or re-loads it. This happens in `preserveDomainRegistry`.
- **Save response:** a save sometimes returns no configuration at all, so the frontend reloads after an arbitrary 1 s delay.

**Request:** `save`, the domain switch, `load_default` and import always return the complete normalised configuration, registry included.

### B-11. Push configuration and connection changes over the socket
**Today:**
- **Other windows go stale:** a domain switch or configuration save in one window, browser tab or by another admin is not pushed. Other windows only notice after reloading.
- **Connections stay on the old domain:** after a domain switch, existing source connections still point at the old domain's endpoints. The frontend now disconnects and reconnects them itself.

**Request:**
- Emit `configuration_changed {session_id, version, active_domain}` on the session's socket room.
- On a domain switch, invalidate active source connections for the session and emit `source_connection_closed {source_session_id, reason:"domain_changed"}`. Alternatively, document that the client must reconnect.

### B-12. Connection status endpoint
**Today:** the frontend cannot ask whether a source or tool is connected. After a cancel, a crash or a reload, the UI can disagree with the server.

**Request:** add `GET /connect_to_source/status?session_id=` and the equivalent for the tool, returning `{source:{connected, address_type, address_masked}, tool:{connected}}`.

---

## P2 — Nice to have

### B-13. Audit context for admin mutations
Accept an `X-Request-Id` header and an optional `reason` on user, role, secret, cleanup and configuration mutations. Log the actor, target, before/after diff, request id and reason to the audit log. Expose them via `/admin/audit/*`.

### B-14. Lightweight vigilance health polling
The frontend polls `/api/v1/reports/xvigilance/health?limit=50` every 10 s. Support `ETag`/`If-None-Match` (304), or push health over the socket.

### B-15. Session policy: editable fields per role
`/auth/session-policy` returns `editable_fields`. Make it reflect the caller's permissions, so read-only users get `[]`.

### B-16. Rule template download
The "Get the latest rule template" link points to `temp_rules/Linkx_Rules_Template.zip`, which no deployment serves (it 404s in production too). Serve it from the backend, for example `GET /api/v1/rules/template`, or provide the file.

### B-17. LXAC export password policy
Enforce minimum strength for the export password on the server, and document whether passwords are trimmed. The frontend will stop trimming.

### B-18. Streaming contract confirmation
**Background:** the frontend is about to wire these:
- `/live_batch_files {id:"stream"}` and `{id:"end_session"}`
- the `log_stream_plug` / `stream_logs` socket events
- `/graph_link`
- `/close_source_window`

**Request:** confirm the payloads and job and status semantics, especially that `end_session` actually stops the stream.

### B-19. Date range for the Elastic (hybrid) search
**Background:** the Elastic Search page now asks for a record date range (start and end, either optional) instead of a single date. Today `/live_batch_files {id:"search"}` only filters on `value.date` (one day).

**Request:** accept `value.start_date` and `value.end_date` (`YYYY-MM-DD`, inclusive, either may be `null` for an open range) for hybrid and raw searches.

**Frontend behaviour until then:**
- A one-day range is also sent as `value.date`, so it filters today.
- Open or multi-day ranges are sent only as `start_date`/`end_date`, and are ignored by the current backend (results are not date-filtered).

**Also:** confirm `end_session` returns `message: "success"` only when a stream was stopped. The frontend now treats any other reply (e.g. "No streaming found") as not stopped.

### B-20. Analysis task list (Tasks window)
> **Superseded by H-2** in `docs/backend-handoff-analysis-results.md`.

**Background:** the new Tasks window records every analysis run (Source window streams and quick-panel analyses), with status, parameters, log and timings. "Show results" now opens it, and it opens the run's Graph or Chart. Streams can keep running in the background after their Source window is closed. The list is held in the browser only, so it is lost on reload, and a reload also ends background streams (the page sends `end_session` on `pagehide`).

**Request:**
1. `GET /jobs?session_id=<main session id>` returning the analysis jobs of the signed-in analyst's session, newest first:
   `{ job_id, source_session_id, window_id, action, rule, source, target, relationship, mode, status (queued|running|completed|terminated|failed), log_file, started_at, ended_at, message }`.
2. Keep a stream's ingestion running after `/close_source_window` when the stream is still active, or confirm the frontend must keep the source session open until the stream ends (what it does today: `/close_source_window` is sent when a background stream finishes).
3. Confirm the analysis-session limit the backend enforces, if any. The frontend allows at most 3 at once: open Source windows + background streams + running quick analyses.

**Frontend behaviour until then:** tasks are in memory only. A background stream's backend source session stays open until its stream completes, fails or is terminated, and `/close_source_window` is sent then.

### B-21. Analysis verdict in the stream log
> **Superseded by H-7** in `docs/backend-handoff-analysis-results.md`.

**Background:** the Tasks window shows each run's verdict next to its actions: **Clean**, **Suspicious** with the flagged rules and their counts, **Analysing** while it runs, or **Not determined** when the run was stopped or failed. It reads the backend's per-batch summary lines (`src/features/tasks/lib/taskFlags.js`):
`[Info] Incremental analysis for batch <id> flags: {'FUND_FLOW': 9, 'LATE_NIGHT_TX': 417, ...}` and the identical `[Info] Live analysis batch <n> flags: {...}`.
The counts are treated as running totals (they only grow from batch to batch), so the latest value per rule is shown.

**Please confirm:**
1. The counts are cumulative for the run (not per batch). If they are per batch, the frontend must add them up instead.
2. A run with no flags logs `flags: {}` (or all zeros), so it can be shown as **Clean** with certainty rather than "no flags reported".
3. The summary line format is stable. Better still, include the final `flags` dict in the job result (`/jobs/:id`) and in B-20's job list.

### B-22. Analysis tasks, evidence records and parent alert feedback
Tracked as a separate handoff: `docs/backend-handoff-analysis-results.md` (H-1…H-9: one evidence record shape, persisted tasks, parent alert assignment, start analysis and send feedback for an alert, save runs as evidence, verdict and flags in job results, session limit, permissions). Frontend plan: `docs/analysis-results-plan.md`.

### B-23. Keep the actor profile mapping (`actor_profile`) in the domain configuration
**New frontend feature (2026-11-16, not in production):** clicking a node in a Graph window shows an **actor profile** card: a portrait beside the person's details (Full name, ID, Acc No., Tel, Address). Which node property fills each part is set per domain in **Configuration ▸ Rules ▸ Profile mapping fields**, so every graph of a domain shows the same card.

**Today:** the frontend already sends the mapping with `POST /configuration {id: 'save', configuration}` as a new top-level key, `actor_profile`. As far as the frontend knows, the server does not keep unknown keys: after the save, the reloaded configuration has no `actor_profile`. As a stopgap, the frontend keeps a copy in the browser (`localStorage` `linkx_actor_profile_v1`, per domain). That copy does not follow the analyst to another browser or device, and other analysts never see it.

**Request:**
- Store `actor_profile` with the domain's configuration on `save`, and return it on `load` (and, once B-10 is done, in the save response).
- Keep it per domain, like `column_mapping`: switching domain loads that domain's mapping.
- `load_default` (Reset) may drop it or return the default below.
- Shape (all strings are node property names, as they appear in the graph's node data; empty means not set):
  ```json
  "actor_profile": {
    "enabled": true,
    "portrait_property": "PHOTO_URL",
    "fields": [
      { "field": "fullName",      "property": "FULL_NAME",  "shown": true },
      { "field": "idNumber",      "property": "ID_NUMBER",  "shown": true },
      { "field": "accountNumber", "property": "ACCOUNT_NO", "shown": true },
      { "field": "phone",         "property": "MSISDN",     "shown": true },
      { "field": "address",       "property": "",           "shown": false }
    ]
  }
  ```
  - `field` is one of `fullName`, `idNumber`, `accountNumber`, `phone`, `address`. The frontend ignores unknown ones, so more can be added later.
  - `portrait_property` points to a node property holding an `https://` or `data:image/` link. The frontend shows nothing else as a picture.
  - Treat the property names as plain text, at most 120 characters each.
- Permissions: the same as the rest of the configuration (`config:write` to save, B-1).

**Later (not blocking):** the node data has no portrait or identity fields today. If the backend can add them to graph nodes (for example a portrait link and the ID number from the customer record), the mapping can point at them.

**Verify:**
1. Save a configuration with `actor_profile`, then `load` it: the same object comes back.
2. Switch domain and back: each domain keeps its own `actor_profile`.
3. Save without `actor_profile`: an existing one is kept, not wiped.

**Frontend once done:** drop the browser copy (`linkx_actor_profile_v1`). The configuration's value is already used whenever the configuration has one.

### B-24. Keep the domain's formatting rules (`formatting_rules`) in the configuration
**New frontend feature (2026-11-16, not in production):** conditional formatting in the Graph windows. These are rules of the form "when a node or link matches these conditions, draw it like this", re-applied as the view changes and view only (the graph data is never changed).
- **Per graph:** each Graph window keeps its own rules in its window settings. These need nothing from the backend.
- **Per domain:** the domain's shared rules are edited in **Configuration ▸ Rules ▸ Formatting rules**. Every Graph window of the domain applies them below its own rules, unless that window turns them off.

**Today:** the frontend sends the domain's rules with `POST /configuration {id: 'save', configuration}` as a new top-level key, `formatting_rules`. As with `actor_profile` (B-23), the server is not expected to keep unknown keys. The frontend therefore also keeps a copy in the browser (`localStorage` `linkx_domain_formatting_v1`, per domain). That copy does not reach other browsers, devices or analysts.

**Request:**
- Store `formatting_rules` with the domain's configuration on `save`, and return it on `load` (and in the save response once B-10 is done).
- Keep it per domain, like `column_mapping` and `actor_profile`.
- A save without the key keeps the existing value.
- `load_default` may drop it.
- Shape: an ordered array, at most 50 rules. Order matters: when two rules set the same style, the earlier one wins.
  ```json
  "formatting_rules": [
    {
      "id": "rule_m3x1_1",
      "name": "PEP customers",
      "on": true,
      "target": "node",
      "match": "all",
      "conditions": [
        { "key": "CATEGORY", "op": "eq", "value": "PEP", "value2": "" },
        { "key": "@degree", "op": "gte", "value": "5", "value2": "" }
      ],
      "style": { "fill": "#e74c3c", "size": 30, "shape": "diamond" }
    },
    {
      "id": "rule_m3x1_2",
      "name": "Large transfers",
      "on": true,
      "target": "edge",
      "match": "any",
      "conditions": [{ "key": "AMOUNT", "op": "gt", "value": "100000", "value2": "" }],
      "style": { "color": "#c0392b", "width": 4, "lineStyle": "dashed" }
    }
  ]
  ```
  - **Rule fields:**
    - `target`: `node` or `edge`.
    - `match`: `all` or `any`.
    - at most 12 `conditions` per rule.
    - `id`: a free string (max 80) that the frontend generates.
  - **Condition fields:**
    - `key`: a node or link property name, or a built-in fact: `@type`, `@degree`, `@alerted`, `@pinned`.
    - `op`: one of `eq`, `neq`, `contains`, `starts`, `in`, `gt`, `gte`, `lt`, `lte`, `between`, `before`, `after`, `dateBetween`, `exists`, `empty`.
    - `value` and `value2`: plain strings, max 200 each.
  - **Style fields** (all optional):
    - nodes: `fill`, `border`, `labelColor` (`#rrggbb`), `size` (5–60), `shape` (`dot` / `box` / `diamond`), `icon` (an icon path or an image data URL), `hide` (`true`);
    - links: `color` (`#rrggbb`), `width` (0.5–12), `lineStyle` (`solid` / `dashed` / `dotted` / `dashdot`), `hide`.
  - The frontend normalizes and bounds every field on load, so the server may store the array as given. A size limit on the whole key is welcome: an `icon` may be an uploaded image.
- **Permissions:** `config:write` to save, as for the rest of the configuration (B-1).

**Verify:**
1. Save a configuration with `formatting_rules`, then `load` it: the same array comes back, in the same order.
2. Switch domain and back: each domain keeps its own rules.
3. Save without the key: the existing rules are kept.

**Frontend once done:** drop the browser copy (`linkx_domain_formatting_v1`). The configuration's value is already used whenever the configuration has one.

### B-25. Encrypted LinkX graph files (`.lxg`): export and import through the server
**New frontend feature (2026-11-17, not in production):** the Graph window's toolbar has **Import graph** and **Export ▸ Export JSON** (G4.1). Export writes production's plain JSON shape (`{ graphData: { type: 'Graph', nodes, edges }, networkOptions }`), so files move between production and this frontend. Import reads only `.json` (analyst decision 2026-11-17: HTML graph files are no longer read). It is size-bounded and cleaned in the browser.

Evidence graphs are sensitive. A plain JSON file left in Downloads, on a share or on a USB stick can be read by anyone, and edited without trace. The analyst asked for a protected LinkX format of our own, done the way encrypted configurations (`.lxac`, `/configuration/export/encrypted`) already are: encrypted and checked by the server, so keys never sit in the browser.

**Request:**
- **Export:** `POST /graph/export/encrypted` with JSON `{ graph: { nodes, edges }, settings, meta: { title, source_window, exported_at } }` returns an encrypted file (`application/octet-stream`, name `LinkxGraph_<ts>.lxg`). The file must be:
  - encrypted at rest (e.g. AES-256-GCM with a server-held key);
  - authenticated, so a file changed outside LinkX is rejected;
  - stamped with who exported it, when, and from which domain / session, for the audit trail.
- **Verify:** `POST /graph/lxg/verify` (multipart `file`) returns `{ valid: true, meta }` or `{ valid: false, error }`, as `/configuration/lxac/verify` does. This lets the frontend show what a file holds before replacing a graph.
- **Import:** `POST /graph/import/encrypted` (multipart `file`) returns `{ graph: { nodes, edges }, settings, meta }`, or a clear error (`not_lxg_file`, `tampered`, `forbidden`, `expired` if expiry is supported).
- **Limits:** the frontend caps imports at 50 MB, 100 000 nodes and 300 000 links; the server may enforce the same or lower.
- **Permissions:** suggest `graph:create` to export and import. Optionally, restrict opening to the same domain or organisation. Log both actions in the activity log.

**Verify:**
1. Export a graph, import it back: the same nodes, links and positions return.
2. Change one byte of the file: import and verify reject it as tampered.
3. Open the file in a text editor: no node data is readable.
4. A user without the permission gets `forbidden`, and the attempt is logged.

**Frontend once done:**
- Export menu: add **Export encrypted (.lxg)**.
- Import: accept `.lxg` (verified first, with its meta shown in the confirmation).
- Plain JSON stays for exchanging files with production, unless the analysts decide to hide it behind a permission.

### B-26. Actor profile portraits readable by the report (same origin or CORS)
**New frontend feature (2026-11-17, not in production):** the graph report's Profiles cards (Export ▸ Generate report…) show each entity's actor profile with its portrait. The portrait is the node property chosen in Configuration ▸ Profile mapping fields (an image link, or an embedded `data:image/...`). To put a picture into the PDF, the browser must read its pixels. It can only do that for an image from the same origin, or one served with CORS headers. Otherwise the card shows the placeholder silhouette. The on-screen actor profile card is not affected, since it only displays the image.

**Request (either is enough):**
- **Preferred:** serve portraits through the API on the same origin, e.g. `GET /media/portrait/<id>`. It should use the user's session, check that they may see that entity, and log the access. Graph nodes then carry that path in the mapped property.
- **Or:** have the image host send `Access-Control-Allow-Origin` for the LinkX frontend origin (not `*` for personal data), along with the image's `Content-Type`.
- **Limits:** JPEG or PNG; about 1 MB at most (the report scales them to 320 × 400 px).

**Verify:**
1. Map a portrait property, open a graph whose top entities have portraits, and generate the report: the photos appear in the Profiles cards.
2. A portrait the user may not see returns 403, and its card shows the placeholder.

**Frontend once done:** nothing further. `loadPortrait` already loads with `crossOrigin="anonymous"` and no referrer, and falls back to the placeholder after 5 s or on any error.

### B-27. Apply the analyst's dataframe filter before ingestion (`dataframe_filter` on `stream`)
> **Done** (2026-11-20).

**New frontend feature (2026-11-19, not in production):** the Source window's Dataframe page has **Filter dataframe…** in its "Actions and Dataframe information" card. Before starting the stream, the analyst can:
- strip columns (they are not ingested or analysed);
- keep or remove rows by conditions;
- clean up (trim spaces, drop rows with empty values in chosen columns, drop duplicate rows).

The browser only knows the dataframe's column names (`create_DF` returns no values), so it cannot filter the data itself. It sends the filter as a specification with the stream request, and the Service must apply it.

**What the frontend sends:** the existing `POST /live_batch_files { id: 'stream', session_id, value: { …, dataframe_filter } }`. `dataframe_filter` is present only when the analyst set a filter:

```jsonc
{
  "version": 1,
  "drop_columns": ["NOTE"],                       // columns not ingested
  "row_filter": {                                  // or null
    "match": "all" | "any",                        // AND / OR across conditions
    "action": "remove" | "keep",                   // remove matching rows, or keep only them
    "conditions": [
      { "column": "CHANNEL", "operator": "in", "values": ["ATM", "test"] },
      { "column": "AMOUNT", "operator": "between", "values": ["100", "5,000"] },
      { "column": "DATE", "operator": "is_empty" },
      { "column": "NAME", "operator": "contains", "value": "ltd" }
    ]
  },
  "trim_whitespace": true,
  "drop_empty": ["ACCOUNT"],                       // rows with an empty value here are removed
  "drop_duplicates": true                          // across the kept columns
}
```

- **Operators:**
  - `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with` take `value`;
  - `in` and `not_in` take `values` (at most 50);
  - `gt`, `gte`, `lt` and `lte` take `value`;
  - `between` takes `values: [low, high]`, inclusive;
  - `is_empty` and `not_empty` take nothing.
- **Comparisons:**
  - text compares case-insensitively, after trimming when `trim_whitespace` is on;
  - ordered operators take a number (thousands commas allowed) or an ISO date `YYYY-MM-DD[THH:MM[:SS]]`;
  - "empty" means null, NaN or a blank string.
- **Order of application:** trim, then strip columns, then drop rows with empty values, then the row conditions, then drop duplicates.
- **Validation the frontend already does** (please enforce it too):
  - every column named exists;
  - at least one column is kept;
  - the action's own columns (mapping source and target) are not stripped;
  - at most 20 conditions;
  - values are at most 200 characters.
- **Realtime:** apply the same filter to every incoming batch.
- **The source data is never changed:** the filter applies to what this stream ingests.

**Request:**
1. Read and apply `value.dataframe_filter` in the `stream` handler, before ingestion, the mapping and the rules.
2. Reject a bad filter with a clear message before ingesting anything: `400 { message: "invalid_dataframe_filter", detail: "<what is wrong>" }`. The frontend shows it in the Dataframe page.
3. Report the effect in the stream log and in the job result: `[Info] Dataframe filter: kept <rows> of <total> rows, <columns> of <total> columns`. Also include `filter: { total_rows, kept_rows, kept_columns }` in `/jobs/:id`.
4. Record the filter with the run (H-2 task record, `dataframe_filter`), so an audit shows what was excluded from the analysis.

**Verify:**
1. Strip a column and remove rows where `CHANNEL is one of ATM`. The ingested data has neither the column nor those rows, and the log line gives the counts.
2. A filter naming a column that does not exist is refused with `invalid_dataframe_filter`, and nothing is ingested.
3. A stream without `dataframe_filter` behaves exactly as today.

**Frontend once done:** nothing further. The filter and its validation are already built (`src/features/source/lib/dataframeFilter.js`, `DataframeFilterDialog.jsx`).

### B-28. Preview a dataframe filter's effect (`preview_DF_filter`, P2)
> **Done** (2026-11-20). The optional `columns` part is not built yet.

**Same feature as B-27.** The filter popup has a **Count rows** button, so the analyst can see how many rows a filter keeps before starting the stream. Until the Service answers it, the popup says "The Service cannot preview a filter yet; it is applied when the stream starts".

**Request:** `POST /live_batch_files { id: 'preview_DF_filter', session_id, value: { session_id, dataframe_filter } }`. It is the same filter as B-27, counted on the session's dataframe without ingesting anything. It returns:

```jsonc
{ "message": "success", "results": { "total_rows": 12500, "kept_rows": 9800, "kept_columns": 11 } }
```

- Same validation and error as B-27 (`invalid_dataframe_filter`).
- **Realtime (broker) dataframes:** answer `{ message: "preview_not_available", detail: "live source" }`. The popup then shows the message.
- **Optional, for later:** `columns: [{ name, type, empty, distinct_sample: [...] }]`. This would let the popup offer value pickers instead of free text.

**Verify:** the counts match what B-27 then ingests for the same filter.

**Frontend once done:** nothing further. `previewDataframeFilter` in `src/services/sourceApi.js` already reads `kept_rows` / `total_rows` / `kept_columns`, and treats 404 / 405 / 501, or an answer without counts, as "not available yet".

### B-29. Use a manual run as an alert's analysis ("Use as feedback for alert…", P2)
**Background:** analysis-results-plan Phase 5 has two actions on a finished manual run in Tasks. **Save as evidence** is H-6 and is built. The second, **Use as feedback for alert…**, lets the analyst attach a run they already made to one of their assigned STR alerts, so the alert can go straight to Extract results and Report back without running again. The Service has no way to do this: H-5 refuses a `task_id` that is not the alert's latest run (`stale_task`), and only H-4 runs create an alert's run.

**Request:** `POST /api/v1/reports/parent/<alert_id>/analysis { task_id }`. It adopts the caller's completed task as the alert's run:
- the alert becomes `analysed`, with the task's `flags`, `verdict` and session;
- `parent_alert_updated { alert }` follows;
- the same refusals as H-4, plus `409 task_not_completed` and `409 task_expired`.

Or say this should not be offered.

**Frontend until then:** the action is not shown.

### B-30. Count analysis sessions as the frontend does (H-8, P1)
**Analyst decision 2026-11-20:** the Service's limit must be at least as strict as the frontend's, since the Service is what enforces it.
- **The frontend counts** toward the 3 sessions per analyst:
  - every open Source window, idle or not (each holds a source session on the Service);
  - every background stream;
  - every running quick analysis (none exist on the Service yet: B-35);
  - every alert run.
- **The Service counts today:** running streams and alert runs only.

**Request:** count the same things: open source sessions (`/init_source` until `/close_source_window` or cleanup), running streams and alert runs, plus quick analyses once B-35 exists.
- Refuse with `429 { code: "session_limit", limit, in_use, detail }`.
- Return it from `/init_source` too, so opening a fourth Source window is refused.

**Verify:** with 3 Source windows open and idle, a 4th `/init_source` and an alert run are each refused with `session_limit` (and a quick analysis, once B-35 exists).

**Frontend:** already counts this way (`getSessionUsage`, `src/features/tasks/lib/taskRegistry.js`). `429 session_limit` is shown with its `detail`.

### B-31. Say when a graph is archived (`graph_archived`, H-1, P2)
**Analyst decision 2026-11-20:** a graph moved to cold storage after 180 days is shown as **archived**, not as "no graph".

**Request:** every report record carries `graph_archived: true` when its graph was archived (`has_graph` is then `false`); `false` otherwise.

**Frontend:** reads `graph_archived` already. The evidence detail shows a disabled **Graph archived** button that explains it.


### B-32. Row progress on a running task (`rows_done` / `rows_total`, H-2, P2)
**Background:** a running task in Tasks now shows **In progress (400/10,000)**: rows analysed out of rows to analyse. The Service has no progress field, so the frontend reads two stream log lines:
- `Dataframe filter: kept <rows> of <total> rows, …` gives the total;
- `Inserted Neo4j batch <n> (<rows> rows)` adds to the done count.

This is fragile:
- a change in wording silently removes the count;
- it only works where the log is streamed into this browser: not for a task loaded from `GET /api/v1/tasks`, another device, or an alert run;
- live (continuous) streams write no such line.

**Request:**
1. Put `rows_done` and `rows_total` on the task, `null` when unknown. `rows_total` is the row count after the dataframe filter.
2. Send them in `task_updated`, at most about once per batch.

**Until then:** please keep those two log lines' wording stable.

**Frontend once done:** read the task fields first; keep the log reading only as a fallback (`src/features/source/lib/rowProgress.js`).

### B-33. Say why a user create or update is refused (`/auth/admin/users`, P1)
**Reported 2026-11-21:** creating a user from Settings ▸ Users fails with a bare `validation_error`. The frontend sends the same body as production `src/App.jsx`:
- `username`: 3–120 characters;
- `password`: at least 8 characters, no whitespace or control characters;
- `display_name`;
- `roles`: one of `superuser`, `admin`, `analyst`, `viewer`;
- `permissions`: keys from `GET /auth/admin/permissions`;
- `is_active`.

The answer carries no reason, so neither the analyst nor we can tell which field is wrong.

**Request:**
1. Put the reason in the refusal: `400 { message: "validation_error", code, detail, invalid_fields: [...] }`. Example codes: `username_taken` (or `409`), `invalid_username`, `password_policy` (with the rule in `detail`), `unknown_permissions` (list them), `invalid_roles`, `cannot_grant_permissions`.
2. Publish the rules the frontend must check before sending:
   - the password policy;
   - the username pattern;
   - the roles each caller may create;
   - whether an admin may grant permissions they don't hold;
   - whether service-only keys (`alerts:ingest`, `auth:verify`) may be assigned.
3. Say which field this particular refusal was about.

4. Say whether an escalation rule exists today. We asked for one in B-1, and you have not confirmed it: an actor may grant (and remove) only permissions it holds, on create and on update. The frontend already behaves as if it does; that may or may not explain this refusal. Say whether `superuser:manage` holders are exempt. Confirm that an account without `superuser:manage` may not change an `admin` or `superuser` account.
5. Is there an admin endpoint to unlock an account (`is_locked`)?

**Frontend:**
- Shows whatever `detail`, `code` or `invalid_fields` the Service sends, worded (`getUserAdminErrorMessage`, `src/services/apiErrors.js`).
- Since 2026-11-21:
  - grants only permissions the signed-in account holds (others are locked in the picker);
  - locks Edit and the on/off switch for `admin`/`superuser` accounts without `superuser:manage`;
  - no longer sends the username as the display name of an account that has none.
- Will tighten its checks once the rules are published.

### B-34. Keep icon sets on the Service, shared by everyone (`/libraries/icon_sets`, P2)
**Reported 2026-11-23 (analyst request).** Libraries ▸ Icon sets lets an analyst make sets of node icons by uploading images, and offers them in the Graph window's icon album beside the built-in set.

**Today (frontend only, no backend involved):**
- The built-in set is static files (`public/graph_icons`, 103 icons), organised by category in the frontend.
- Custom sets are kept in the browser (`localStorage`, key `linkx.graph.icon_sets.v1`): up to 20 sets, 200 icons a set, 100 KB an image, 3 MB in all.
- A custom icon is put on a node as a `data:image/…` value in the node's `image`, exactly as the existing "Upload an image" does. So a graph that uses one is self-contained: saving, exporting or opening it elsewhere needs nothing from the library.
- A set moves between browsers as a file (`*.lxicons.json`: `{ kind: "linkx-icon-set", version: 1, name, description, icons: [{ name, src }] }`).

**The gap:** a set exists only in the browser it was made in. Two analysts do not see each other's sets, a cleared browser loses them, and there is no one to decide which sets an organisation uses. The tab is therefore labelled **Device**; the plan (`libraries-plan.md` §3) has it as **System**.

**Request:**
1. Store icon sets on the Service, per deployment (not per session):
   - `GET /libraries/icon_sets` → `{ sets: [{ id, name, description, enabled, updated_at, updated_by, icons: [{ id, name, url, bytes }] }] }`. Needs `config:read`.
   - `POST /libraries/icon_sets` `{ name, description }` → the new set. Needs `config:write`.
   - `PATCH /libraries/icon_sets/{id}` `{ name?, description?, enabled? }`.
   - `DELETE /libraries/icon_sets/{id}`.
   - `POST /libraries/icon_sets/{id}/icons` (multipart, one or more files) → the icons added, and for each file refused, why.
   - `PATCH` and `DELETE /libraries/icon_sets/{id}/icons/{icon_id}` (rename, remove).
2. Serve each icon from the Service's own origin (`url` above), with a cache lifetime and a content type of the image. The frontend never loads icons from another host.
3. Check uploads on the server, with the same rules the frontend applies, so they cannot be bypassed:
   - types: SVG, PNG, JPEG, WebP, by content and not by extension;
   - size: 100 KB an image (say if you prefer another limit, and publish it);
   - SVG cleaned: no `<script>`, `<foreignObject>`, event attributes, external references or embedded documents.
4. Publish the limits (sets, icons per set, bytes) in the list answer, so the frontend shows the Service's numbers instead of its own.
5. Say who may manage sets. We suggest `config:write`; a dedicated `libraries:manage` permission is welcome if you prefer.

**Decision we need from you:** how a graph refers to a shared icon.
- **(a) Keep embedding** the image in the node (`data:image/…`), as today. Graphs stay self-contained and nothing else changes; the cost is a larger graph when one icon is on many nodes.
- **(b) Refer to it** (`icon_set_id` + `icon_id`, or the `url`). Graphs are smaller and an icon can be updated in one place; but a graph then depends on the library, so deleting a set, exporting a graph (`.lxg`, B-25) and the report's images (B-26) all need a rule.
We recommend (a) for now, and (b) only if graph size becomes a problem.

**Until then:** the feature works as described under "Today".

**Frontend once done:**
- Read and write sets through these endpoints instead of `localStorage` (`src/features/graph/lib/iconSets.js` is the only place that stores them).
- Label the tab **System**, show who last changed a set, and lock the management actions without the permission.
- Offer a one-time "Send this browser's sets to the Service" for sets made before.

### B-35. Time-limited runs for the quick analysis panel (`stream` limits, P2)
**Analyst decisions 2026-11-24.** The quick analysis panel is a light way to check a small amount of data. It uses the **formal analysis pipeline** (same rules, permissions, tasks and evidence), not a second one, with these limits:
- **File:** one file, 5 MB at most.
- **Batch:** the last hour.
- **Realtime:** the next 15 minutes, counted from the start of the run.
- **Rule and connections:** the session configuration's defaults, as in a Source window (Link Analysis with the configured rule).

**Today:** the panel runs nothing. It used to show simulated progress and findings; those were removed on 2026-11-24. No call to the Service has ever come from it.

**Why the Service has to do this:**
- A realtime stream ended by a browser timer keeps running when the tab closes or the network drops.
- A time limit made with `dataframe_filter` (B-27) needs a date column and, as far as we can tell, is applied after the source is read, so the run is not light.

**Request:** an optional `limits` on `POST /live_batch_files { id: 'stream', value: { …, limits } }`, proposed as:

```jsonc
{ "max_duration_seconds": 900 }                 // realtime: stop after this long
```

and, on `create_DF` for a batch source, `limits: { "last_seconds": 3600, "time_column": "optional" }`.

1. **Realtime:** start from new messages only. Stop the run when the time is up, whether or not the browser is connected, and finish it as a normal `completed` task with its verdict and flags. Not `terminated` or `failed`. A run that received no rows completes with 0 rows.
2. **Batch:** read only the last hour from the source. Say which time you use for each source: Kafka message time, the domain's `date_column`, or the file time on HDFS. Say what happens where a source has no usable time (REST API). Refuse it rather than reading everything.
3. **File:** say whether you want a row limit as well. A 5 MB Parquet or XLSX file can hold many rows.
4. **Task:** mark the run (`origin: "quick"`, or a `quick: true` flag) and record the limits and the time covered (`window_start`, `window_end`), so the result can say what it covers.
5. **Enforce the limits on the Service** for a marked run, and refuse with `400 { code: "quick_limit", detail }`. The frontend's own checks can be bypassed.
6. **Session limit:** a quick run counts as one session (B-30) and frees it when it ends.

**Questions:**
- Which of these inputs can do it today: Kafka, REST API, HDFS?
- Does a realtime stream already have any way to end by itself?
- Is the rule in the session configuration enough to start, or must the rule come from `create_DF`'s list?

**What the result will say:** "No flags in this window", never "Clean". A short window cannot show patterns that need history (dormant-to-active) or longer periods (smurfing). Please do not return the verdict `clean` for a quick run; `undetermined` with empty `flags` is right, unless you prefer another word.

**Verify:**
1. Start a realtime quick run and close the browser. It ends by itself after 15 minutes as `completed`, and its session is free.
2. A batch quick run ingests only rows from the last hour, and the log gives the time range.

**Built by the Service (round 1, section D), and in the frontend 2026-11-25** (`src/features/quick/lib/quickRun.js`, `WorkspaceHome.jsx`): file, Kafka last hour, Kafka and REST live. Not run on the live Service yet.
- `create_DF` carries top-level `quick: true`; `stream` carries `value.quick: true`, and `listen_realtime: true` when live. No limits are sent. A live run makes no `create_DF`.
- Result wording: "No flags raised, in this short run only", never Clean.

### B-36. Send the "GPU drawing allowed" setting (`graph_gpu_allowed` in the configuration, P3)
**Found 2026-11-24.** Libraries ▸ Graph rendering reads `graph_gpu_allowed` from the session configuration, so an administrator can turn GPU drawing off for everyone (L-B2 in `libraries-plan.md`). We found no request to the Service for it, and do not know that it sends it.

**Today:** when the key is missing, GPU drawing is not restricted and the page says "Not set".

**Request:**
1. Say whether the configuration carries `graph_gpu_allowed`. If not, add it (`true` / `false`, default `true`), saved like other configuration keys with `config:write`.
2. Keep it in the answers of `/init`, `/configuration` load and save.

**Frontend once done:** nothing to change to honour it: `false` already turns GPU drawing off, and open graphs follow. A control to change it would be added to the Configuration window.

### B-37. Open a finished run's graph without its Source session (`task_id` on `/get_graph`, P1)
**Reported 2026-11-24:** Tasks ▸ Show graph on a completed run failed with "Neo4j tool_credentials missing for session 1_111378". On another run, with its Source window still open, the graph came back with no nodes.

**What the frontend does (tested):**
- A finished run's graph is asked for by its Source session only: `/get_graph { id: "relationship", source_id, relationship: "*" }`.
- It sends `/close_source_window` when the Source window closes, and when a background run ends. That may end the session's credentials; please confirm.
- Source session ids are `<window number>_<main session>`. Window numbers restart at 1 on every page load, while the main session is kept. So after a reload, or in a second tab, a new Source window sends `/init_source` for an id an earlier run already used. Production numbers its windows the same way.
- Two runs with the same id send identical graph requests.

**Changed in the frontend (2026-11-24):**
- Show graph is offered only while the run is going in this page, or once it has completed while its Source window is open. It is not offered for tasks listed by the Service.
- Source window numbers are no longer reused: each `/init_source` sends a number this main session has not used before, counted in the browser across reloads and tabs. Numbers therefore grow past 3. A browser that stores nothing still restarts at 1, so request 2 below still matters.
- When the page goes away (reload, tab closed), it sends `/close_source_window` (`reason: "page_closed"`, keepalive) for each open Source window, next to the `end_session` of a running stream; the two may arrive in either order. A completed background run keeps its session until it is saved with its graph or released (`reason: "background_task_released"`).
- **Restore workspace:** after a reload or sign-in the analyst may restore the last windows. Each Source window is opened with a new `/init_source`, one after the other.
- For a completed run it now sends `/graph_link { id: "link" }` first, then `/get_graph`. Production does too: it has no "completed" stream state, so a completed run stays linkable until it is terminated, fails or its window closes.

**Request:**
1. Accept `task_id` on `/get_graph`, and answer with that run's graph only, using the task owner's saved Neo4j login. It should work after the Source window is closed, after a reload, and until the task is archived. Same permissions as reading the task.
2. Say what `/init_source` does to an id already in use: does it clear its credentials or its data? Please refuse it or return a new id instead.
   Please also confirm that window numbers above 3 are accepted, and that `/close_source_window` is safe before, after or without an `end_session`.
3. Say exactly when a session's `tool_credentials` are removed: `/close_source_window`, sign-out, idle timeout, a restart, or a time limit.
4. Confirm that `/graph_link` is accepted for a completed run, and that `*` then returns its nodes even when it has no relationships (follow-up item 6).
5. Confirm that a configuration save **merges**: the frontend, like production, leaves out masked passwords, their `*_ref` and `tool_credentials`. They must not be removed by a save that omits them.

**Verify:** run an analysis, close its Source window, reload, and open its graph from Tasks. Then run a second analysis: the first task still opens the first run's graph.

**Frontend once done:** send `task_id` and offer Show graph for every completed task again.

### B-38. Seats for unattended runs ("Keep running while I'm away", P1)
**Decided by the analyst (2026-11-25).** A run goes on without its owner's browser only with a seat granted by the Service; asked for on purpose, run by run; one run per user. The frontend is built and stays disabled until these exist.

**Requests**
1. `GET /api/v1/unattended-seats` (any signed-in analyst with `analysis:run`) -> `200 { seats: { total, available } }`, whole numbers. `404` means "not offered".
2. `POST /api/v1/tasks/<task_id>/unattended { "on": true | false }` (the task's owner) -> `200 { task, seats }`, with `task.unattended` as it now is.
   - Grant it atomically: two requests for the last seat give one seat.
   - Turning off is always allowed, and asking twice for the same run changes nothing.
   - Refusals: `409 { code: "unattended_no_seat" }`, `409 { code: "unattended_limit" }` (the user has another run with a seat), `409 { code: "unattended_not_allowed", detail }` (this kind of run), `409 { code: "task_not_running" }`, `403` for someone else's run.
3. `unattended` (boolean) on every task, in `task_updated` and `GET /api/v1/tasks`. Send `task_updated` when a seat is given, turned off or taken back.
4. A socket event `unattended_seats { seats: { total, available } }` when the numbers change (optional; the screens ask every 30 seconds while the switch is in sight).
5. A run with a seat is not stopped by a disconnect, a closed tab, a token's end, `/auth/idle-timeout` or `/auth/logout`. Its source session is kept until it ends (and its graph, B-37).
6. The seat is free when the run ends, is turned off, or reaches your maximum time.

**Checks**
1. Turn it on, close the browser for 5 minutes, sign in again: the run went on or ended by itself.
2. The same without it: the run was stopped.
3. With every seat taken: refused, and the switch says so.
4. A second run of the same user: `unattended_limit`.

### B-39. A live quick run analyses while it listens (Question, P2)
**Analyst decision 2026-11-25:** a live quick run (Kafka or REST, 15 minutes) ingests and analyses at the same time, as a Source window's realtime run does, and not only at the end.

- **What we found:** realtime runs log `Live analysis batch <n> flags: {…}`, and the task's `flags` are provisional per batch (H-7). Your round 1 answer says a live quick run ends "with the full analysis"; your round 2 table says "as batch or realtime". Neither says whether a **quick** live run does the per-batch analysis.
- **Please confirm** that it does, with the same log lines and `task_updated` flags. If not, please build it.
- **Please also say** whether a live quick run needs a `create_DF` first. We send none, as your table says; a Source window's realtime run makes one.

**Verify:** start a live quick run on a topic with messages that match the active rule. Flags show in the panel before the 15 minutes are over.

**Frontend:** built. The panel shows the rows and flags of each batch while the run goes on, from the task and, until it has them, the log.

---

**Status after the Service's response of 2026-11-25** (`service-response-2026-11-25.md`, reviewed in `service-response-review-2026-11-25.md`). "Built" is the Service's word and live once it is deployed; not tested by us.

| Status | Items |
|---|---|
| Built | B-1, B-2, B-3, B-5, B-6 (Source routes), B-7, B-9, B-15, B-16, B-17, B-19, B-23 and B-24 (as `/domain-config` `presentation`), B-31, B-32, B-33, B-35 (narrowed) |
| Refused | B-26, B-29, B-30, B-36 |
| Later | B-4, B-8, B-10, B-11, B-12, B-13, B-14, B-25, B-34 |
| Answered before | B-18 (H-11 to H-17) |
| Built in round 2 | B-37, B-38 |

**Round 2 answered 2026-11-25** (`service-response-round-2-2026-11-25.md`, reviewed in `service-response-review-round-2-2026-11-25.md`): B-37 **built** (24 hours), B-38 **built** with the Service's limits (a quarter of the workers' capacity, 60 minutes, batch only). Next free number: B-40.

**Round 3 written 2026-11-25** (`backend-round-3-2026-11-25.md`): B-39 as R3-1, quick run questions, Phase 6 decisions (C0), requests and questions (C1 to C11; own column mapping and `settings_used` are new). Our plan: `phase6-plan.md`. Waiting for the answer.
