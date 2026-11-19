# Backend requests from the incubation frontend review

**Date:** 2026-11-13. These come from a review of the incubation frontend: the Source, Settings and Configuration windows.

**What this list contains:**
- Problems the frontend cannot fix, or can only work around unsafely, because the server owns the rule, the data or the state.
- Each item gives the current behaviour, the problem, the request, and how to verify the change.

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
  - `POST /live_batch_files` with `{id: search | create_DF | stream | end_session}`
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
