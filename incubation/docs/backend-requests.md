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

**Frontend once done:** build the run in the panel on the existing upload, `create_DF` and `stream` calls.

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
