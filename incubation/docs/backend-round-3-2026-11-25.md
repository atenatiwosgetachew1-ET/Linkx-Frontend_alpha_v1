# Round 3 for the Service: report, questions and new alignment

**From:** the incubation frontend. **Date:** 2026-11-25.
**Follows:** your response to round 2 (`service-response-round-2-2026-11-25.md`).
**Status:** waiting for your answer.

Please answer item by item in this numbering, as **Built**, **Refused**, **Later** or an answer. Anything you agree to build gets a number from B-40.

**What we would like first:** section C0 (our decisions; one of them differs from your Phase 6 prompt), then C1 to C3. Phase 6 cannot be built safely before those. Sections B and C4 to C11 can follow.

## A. Report

**Aligned in our code:** everything under "Please change on your side" of both responses. Our automated tests pass. That is not a test of your deployment.

**Not aligned yet:** the username and password rules are still fixed in our form; roles and permissions are read from `user-rules`.

**Confirmed on the live Service by the analyst (2026-11-25)**

| Point | Result |
|---|---|
| Service-account secret: made without one, rotated (round 1, 2) | **OK** |
| `presentation`: save, read in another browser, version conflict (round 1, 5) | **OK** |
| A classified entity changed to a risk category, kept after a reload | **OK** |

**Not done yet.** These are run together at the end and reported in one go:
- Round 1: 1, 3, 4, 6, 7, 8, and the rest of 2 (`user-rules`, the masked token).
- Round 2: 2 to 7.
- Round 2, 8 (anything that does not match): nothing so far.

**Accepted:** your limits on seats, 2 minutes after the owner's last browser is gone, and 24 hours for a run's graph.

**Built since:** the quick analysis panel (B-35). Not yet run against you.

## B. Quick analysis (B-35)

### R3-1. A live quick run analyses while it listens (B-39, Question, P1)
**Analyst decision 2026-11-25:** a live quick run (Kafka or REST, 15 minutes) ingests and analyses **at the same time**, as a Source window's realtime run does, and not only at the end.

- **We know:** realtime runs log `Live analysis batch <n> flags: {…}`, and `flags` on the task are provisional per batch (H-7). Round 1 says a live quick run ends "with the full analysis". Round 2 says "as batch or realtime", but in the configuration table only.
- **Please confirm** that a **quick** live run analyses per batch, with the same log lines and `task_updated` flags. If not, please build it.
- **Our side:** the panel shows rows and flags while the run goes on, from the task, else from the log.

### R3-2. `create_DF` for a live quick run (Question, P1)
Your table gives only `stream` (`quick: true`, `listen_realtime: true`). A Source window's realtime run makes a dataframe first. We send **none**. Is that right for both Kafka and REST?

### R3-3. Ends and empty inputs (Question, P2)
| # | Case | Please say |
|---|---|---|
| 1 | A live quick run reaches 15 minutes | `ended_reason`: `finished`, `quick_limit` or `time_limit`? We show `quick_limit` as "It reached the limits of a quick analysis" |
| 2 | A Kafka batch with no message in the last hour | Does `create_DF` succeed with 0 rows, or fail? With which code? |
| 3 | A live quick run stopped by its user after rows came in | Are the flags found so far kept on the task? |
| 4 | `window_start` / `window_end` of a live run | Set at the start, or only at the end? |
| 5 | The active rule is not in the `rules` of `create_DF` | We refuse it before `stream`. Would you? With which code? |

### R3-4. Risk words (Request, P2)
**WANGIRI** (callback scam) is not among your risk words (R2-8). Our screen saves it in `risk_entities`, but an older entry with that category in the trusted list still counts as trusted. Please add it.

## C. Phase 6 (Domains and analyst screens)

### C0. Decided by our analyst on 2026-11-25
Please answer each as **Exists**, **Will be built** or **Refused**. "As your prompt" means your round 1 appendix already says it; please confirm it is live.

| # | Decision | Against your prompt |
|---|---|---|
| D1 | A **Domains** page inside Configuration, for any domain: sensitivity, thresholds, score lineage, columns, column mapping, history. Today's Detection sensitivity page becomes its first tabs; nothing of it is dropped | As your prompt; score lineage is ours (C4, 5) |
| D2 | An **admin's** change is the default of everyone in the domain | As your prompt |
| D3 | **Analysts may override the search and fetch columns**, for themselves | As your prompt |
| D4 | **Analysts may also override the column mapping**, for themselves | **Differs.** Your prompt: admin only. See C1 |
| D5 | **Whatever is made under an override says so,** wherever it is saved, sent, read later, printed or exported | **New.** See C2 |
| D6 | **Restore to the domain's default:** one row, one list, or everything of one's own | Columns as your prompt; mapping **new** |
| D7 | **The account's privileges decide who may override,** and only in domains granted to it | **New** keys. See C3 |
| D8 | Domain access on each user. **Every existing user starts with all domains** (`null`) | As your prompt; please confirm the start |
| D9 | Profile mapping and formatting rules stay in `presentation`, unchanged | As your prompt |

The overrides are for a user's **own** runs. They never change another user's, a service account's, xVigilance's, or the domain's.

### C1. An analyst's own column mapping (Request, P0)
**Why:** an analyst meets files with column names that the domain does not map. Waiting for an admin, or changing the mapping for the whole domain because of one file, is worse.

**The danger, and what we ask against it.** A mapping decides what the rules read, so an override can hide a finding (amount mapped away, so no amount rule fires) as well as reveal one.

| # | Request |
|---|---|
| 1 | Accept `column_mapping` from holders of the privilege (C3) in `POST /configuration { id: "save" }`, beside the five keys of R2-18, **as changed rows only**, with your values: `"TARGET"`, `null` (drop), `"__inherit__"` (restore) |
| 2 | Origin **`override`** for a mapping row, beside `profile`, `admin` and `service_account` |
| 3 | Refuse an override that leaves a **required** field (account, counterparty, amount, date, and what your rules need in that domain) without a source: `400 { code: "required_field_unmapped", fields }` |
| 4 | Refuse a target that is not a canonical field of the domain: `400 { code: "unknown_target", fields }` |
| 5 | **One effective mapping per run, resolved once on the Service when the run is queued:** profile, then admin, then the user's override. A copy kept in a session from before Phase 6 is not a layer of its own |
| 6 | **A dataframe made with another mapping than the run would use** is refused: `409 configuration_changed` with `changed: ["column_mapping"]`. Today it runs: the dataframe keeps one mapping and Analyze takes another (Q2). With overrides this will happen often |
| 7 | **Alert (STR) runs, service accounts and xVigilance use the domain's mapping and columns only**, because their results leave the Service or run with nobody there. **Decided by our analyst;** our Reports window says so on the STR alerts tab. Please confirm that an alert run takes nothing from the session of the analyst who starts it |
| 8 | Every override is in the audit: who, domain, when, before and after |

**If you refuse D4**, please say why, and whether a run-only mapping would do: sent with one `create_DF`, recorded on its task, never stored.

**And about today:**
| # | Please say |
|---|---|
| 9 | Our Configuration form sends the **whole** configuration on every save, `column_mapping` and the lists included. Is an admin's stored for the session, for the domain, or ignored? What happens to what is stored now? |
| 10 | When we stop sending `column_mapping`, the stored key is kept (R2-3). Does that kept value still win in a run? |
| 11 | Can a `.lxac` import or `load_default` bring an old mapping back? Does a `.lxac` export hold one's own overrides? |
| 12 | Does a rule upload still read `column_mapping` and the column lists from its form fields? (Lists of entities are ignored now, R2-11) |

### C2. The remark on everything made under an override (Request, P0)
We can show a remark everywhere only if the Service **records it with the run**. The configuration of today says nothing about a run of last week, and another reader does not have the analyst's configuration at all.

**Please add one object, the same everywhere:**
```jsonc
"settings_used": {
  "domain": "microfinance",
  "versions": { "thresholds": 12, "preset": "baseline", "mapping": 4, "columns": null },
  "overridden": true,
  "overrides": {
    "columns": { "fetch_columns": { "added": ["FEE"], "removed": ["BRANCH"] } },
    "column_mapping": { "SENDERACCOUNTID": { "from": "ACCOUNTNO", "to": "BENACCOUNTNO" } }
  },
  "overridden_by": "analyst name",
  "missing_fields": []
}
```
Copied when the run is queued and never changed after. `overridden: false` when there is none. Absent on older records: we then show **"settings not recorded"**, never "domain default".

| # | Where | Why |
|---|---|---|
| 1 | Task: `GET /api/v1/tasks`, `task_updated` | Tasks, the run's windows, quick runs |
| 2 | Evidence record, on saving a run (H-6), as a **copy** | It outlives the task (retention) and the analyst's account |
| 3 | Report records of every tab (H-1) | The Reports window and its exports |
| 4 | Alert record and its feedback to the parent | Shows that no override was used (C1, 7) |
| 5 | **`/get_graph`, every form:** by `task_id`, by evidence, by session. Also `task_id` in the answer by session | A graph drawn by session does not say which run it comes from. Graph, Table and Chart windows and all their exports take the remark from here |
| 6 | Archived graphs (180 days) | Kept with the archive |
| 7 | AI assistant and MCP answers, if they read these records | So an answer about a finding names it |

| # | Please also say |
|---|---|
| 8 | **A search** (Elastic, Hive) made with one's own search columns and then turned into a dataframe: are those columns recorded too? They decide which rows were found |
| 9 | May the verdict stay `clean` under a mapping override? We show it as **"Clean (own mapping)"**, never plain Clean (decided) |
| 10 | Filter: `overridden` on `GET /api/v1/tasks` and the reports, for a reviewer |
| 11 | Evidence of a run with an override: allowed for everyone with `evidence:create`, or should an admin confirm it first? We would allow it, with the remark |

### C3. Privileges and how long an override lasts (Request + question, P0)
| # | Please say or build |
|---|---|
| 1 | **Two permission keys:** `columns:override` and `mapping:override`, in `GET /auth/admin/permissions` and in `user-rules`. Given to `analyst` and `manager`; not to `viewer` |
| 2 | Round 1: permissions come from roles and cannot be given to one user. May an admin take `mapping:override` from **one analyst**, or only from a role? If only a role: a switch on the user, like `domains`, would do |
| 3 | A missing key: `403 { permission, invalid_fields }`, as R2-18 |
| 4 | **How long:** R2-18 says "the caller's own session"; your Verify says it survives a reload. Please keep it **per user and per domain**, so it survives a sign-out, and never reaches another domain. Is that `POST /account/configuration`? May an analyst call it? |
| 5 | **Restore:** `"__inherit__"` per mapping row and `null` per list. For "everything of mine": `POST /domain-config/reset { domain, section, scope: "own" }`? |
| 6 | The **domain's value beside the override** in the answer, so we can show both before restoring |
| 7 | An admin changes the domain while an override exists: the override stays, and we are told it now differs from a newer default? And an override equal to the new default: dropped? |
| 8 | Privilege or domain taken away: the override is ignored in the next run, or deleted? A run already queued keeps it? |
| 9 | Where are `columns_origins` and `column_mapping_origins`: on `load`, `save`, domain switch, `/init`? |

### C3b. "No request contains secret keys or `***`" (Question, P0)
Your rule 2 and Verify step 3 conflict with other answers. Please confirm that the rule is for **`POST /configuration`, `POST /account/configuration` and `/domain-config` only**, and that these stay as they are:

| Request | What we send |
|---|---|
| `/connect_to_tool` with a saved password | `password: "***"` and `password_ref`, as production (H-10). If you prefer another form, please name it |
| Service accounts | `auth_token`: omitted or `***` keeps, `null` clears (B-2) |
| An admin sets or clears the Neo4j password in Configuration | `active_tool_password`: the typed text, or `null` (round 2 says they may) |

### Domains screen

### C4. Presets and sensitivity (Question + request, P1)
1. What is in `available_presets`: names only, or name, label and description? The same for all domains?
2. **Request:** the values of each preset in the answer, or a `dry_run: true` on the POST. We want to show exactly which thresholds change, from what to what, before an admin confirms.
3. Does applying a preset overwrite keys changed by hand (`modified_since_applied`)? Does it touch keys outside `managed_keys`?
4. Is applying one a new version in the thresholds' history?
5. **Score lineage** is not in your prompt. Does it stay on `/config/score-lineage?domain=D`? Is it part of a preset? Is there a history of it?

### C5. Thresholds: which keys a domain has (Request, P1)
Our page knows two fixed lists: CDR, and one for every other domain. They are copied from production.
1. Does `GET /rule-thresholds?domain=D` return **exactly** the keys that the domain accepts?
2. **Request:** per key, its type, minimum, maximum, default and a short label, so the form is not a copy of your rules. If refused, please send the list for `microfinance`, `insurance` and `social_media`.
3. Since 2026-11-25 our page sends **only the changed keys**. Before, and in production, a save sends every key of the list: did that mark unchanged keys as `modified_since_applied`, or fail on those three domains? Keys you send that we have no field for are shown read-only.
4. **Please check `bank`'s history:** until 2026-11-25 our page saved the thresholds and score lineage of microfinance, insurance and social media to `bank`. (Also with the owner.)

### C6. Two admins at once (Request, P1)
`presentation` refuses an old `version_id` with `409 version_conflict { current }`. Please accept `version_id` the same way on **sensitivity, thresholds, score lineage, columns and mapping**. These change detection for a whole domain, and last save wins today. One's own overrides need none. If `versions` in the answers is that id, please give its shape.

### C7. Mapping rules (Question, P1)
1. Which canonical fields may be a target, per domain, and **which are required** (C1, 3)? **Request:** the list in the answer of `section=mapping`, for a dropdown instead of free text.
2. May two sources map to one target? If not, which code?
3. Rules for a source name: the same pattern as columns? Is case kept, and does `AccountNo` match `ACCOUNTNO`?
4. Column names must match `^[A-Za-z0-9_.-]{1,128}$`. Files and Elastic can have names with spaces. Are they unusable in lists, or stored under another name? What happens to lists stored before that rule?
5. May an **admin** leave a required field unmapped? We would warn and ask; would you refuse?

### C8. History (Question, P2)
1. The shape of one entry for `sensitivity`, `columns` and `mapping`: the full value, or only the change?
2. Can an earlier version be restored, or does an admin set the values again?
3. `limit` and paging as for thresholds?

### C9. What the answers look like (Question, P2)
1. Is `state` of a save the same object as the GET of that section? Also on `POST /rule-thresholds`, `POST /config/score-lineage` and `/domain-config/reset`?
2. **`enforced: false`:** what does it mean for the admin: saved but not applied? We would say so in the screen.
3. **`404 feature_disabled`:** per section or for all of `/domain-config`? Can it differ by domain?
4. **The domain list:** does the Service send the known domains, or do we keep our five (`bank`, `microfinance`, `cdr`, `insurance`, `social_media`)?
5. Who may **read** `sensitivity`, `columns` and `mapping`: anyone with `config:read`, for domains they are not granted too?

### Domain access

### C10. Granted domains (Question, P1)
| # | Please say |
|---|---|
| 0 | **Please confirm:** every existing user is `null` (all domains) when this goes live (D8), and so is a new one unless an admin chooses |
| 1 | Where in `GET /auth/me` is `allowed_domains`: on the actor, or beside it? In the sign-in answer too? |
| 2 | Does a change reach a signed-in user at once, or at their next sign-in? Is a socket event sent? |
| 3 | A user loses the domain they are **in**: what happens to the session's domain, an open dataframe, a waiting run, a running one? |
| 4 | An **empty list**: no domain at all, or refused? |
| 5 | Are **tasks, reports, evidence, alerts and kept graphs** of other domains hidden or refused as well, or only sessions and runs? |
| 6 | Which routes answer `403 domain_not_granted`? |
| 7 | Who may set it: the same accounts as `manageable_roles`? Is it refused on admins? |
| 8 | Does it exist for **service accounts** (their routed domains are in their `config`)? |
| 9 | Is it in the user list, or one request per user? **Request:** put `domains` in the list |

### Endpoints

### C11. Changing a host clears its credential (Question, P2)
1. Which keys count as a host change: storage, tool, Kafka, REST? A port, a path, a database name?
2. Does the answer say that a credential was dropped, and which one? **Request:** for example `credentials_cleared: ["active_tool"]`, so the warning is yours and not our guess.

## D. "Later" items that Phase 6 makes more important

Please say whether any of these can come with it:

| Item | Why now |
|---|---|
| **B-11** push configuration changes | A domain change by an admin reaches everyone's next run, but open screens still show the old values (Q12) |
| **B-4** versions on the session configuration | The same risk as C6, for a session open in two tabs |
| **B-13** audit of admin changes | Presets, mapping and domain access change what a whole domain detects and who may see it |
| **B-10** full configuration after a domain switch and a save | Rule 1 of your prompt ("re-render from the response") needs it for the session too |

B-8, B-12, B-14, B-25, B-34 and `columns` of B-28 can stay as they are.

## E. New on our side, for your information

- **The Domains page** is in Configuration now, with Thresholds and Score lineage for any domain (D1, first step). An admin confirms the exact changes. Score lineage still sends the whole version, with the typologies we have no field for kept as you sent them.
- **Quick runs** have a source session of their own, opened by `/init_source` with a new number and closed by `/close_source_window` when they end. One at a time per page. Cancelled while it gets ready: a queued `create_DF` is cancelled; a start already sent gets `end_session`.
- **A quick run is stopped before it is sent** if the domain or the active rule changed while it was getting ready.
- **Result wording:** a quick run without flags reads "No flags raised, in this short run only". Never Clean.
- **HDFS and REST batches** are disabled in the panel, as you refuse them.

## F. What we will build on our side
So you can tell us early if something does not fit.

1. **One remark, one source.** Everything takes it from `settings_used`: Tasks, evidence, Reports, Graph, Table and Chart windows, every snap, print, PDF, CSV, copied table, graph file and generated report. Nothing is worked out from the configuration of the moment.
2. **An unknown is shown as unknown** ("settings not recorded"). Mixed graphs (elements pasted from another graph) keep both remarks.
3. **Before a save** the admin sees what changes for the domain; the analyst sees what differs from the default, and which rules lose a field.
4. **Restore** per row, per list and all, always showing the value it goes back to.
5. **A dataframe made before an override was changed** is not analysed until it is made again.
6. **Only changed keys are sent** to the domain routes, and the screens are drawn again from your answer.

## Answer sheet

| Item | Answer |
|---|---|
| R3-1 (B-39) | |
| R3-2 | |
| R3-3 (1 to 5) | |
| R3-4 | |
| C0 (D1 to D9) | |
| C1 (1 to 12) | |
| C2 (1 to 11) | |
| C3 (1 to 9) | |
| C3b | |
| C4 (1 to 5) | |
| C5 (1 to 4) | |
| C6 | |
| C7 (1 to 5) | |
| C8 (1 to 3) | |
| C9 (1 to 5) | |
| C10 (0 to 9) | |
| C11 (1, 2) | |
| D: B-4, B-10, B-11, B-13 | |
