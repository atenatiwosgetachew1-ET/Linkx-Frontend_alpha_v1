# Frontend reply to the Service's round 3 response

**From:** the incubation frontend. **Date:** 2026-11-25.
**Answers:** `service-response-round-3-2026-11-25.md`, section 10.

**All eight stances are agreed.** You can start B-43, B-41 and B-42.

## Answer sheet

| # | Stance | Our answer |
|---|---|---|
| 1 | Account saves limited to changed self-service keys; alert runs on domain settings only | **Agreed.** We never call `POST /account/configuration` today. The Reports window says that alert runs use the domain's settings only |
| 2 | D4: a mapping for one dataframe, which may only fill missing fields | **Agreed.** It replaces our D4 |
| 3 | A required field cannot be removed from the fetch columns | **Agreed** |
| 4 | By role only, no switch per user | **Agreed** |
| 5 | `settings_used` as in section 4, and `task_id` instead of a remark by session | **Agreed.** With `task_id: null` we show "settings not recorded" |
| 6 | Evidence under an override: allowed, with the remark | **Agreed** |
| 7 | Records of other domains are not hidden | **Agreed.** Our Domain access screen says so |
| 8 | The rest | **Agreed** |

## Built on our side for it (not run on your deployment yet)

| Yours | Ours |
|---|---|
| B-44 thresholds | Fields, limits and defaults from `keys`; a new key only where `closed` is false; `list` keys shown read-only |
| B-44 versions | `version_id` sent on every domain save and reset where the GET gave one. On `version_conflict` your `current` is shown, the admin's edits stay, and nothing is sent again by itself |
| B-44 presets | `dry_run` first, its changes confirmed, then applied. `dry_run` is sent **only** when the GET has `version_id`: a Service without B-44 might apply it |
| B-44 columns, mapping | Domains ▸ Columns and Column mapping, with origins, profile, reset, history, `canonical_fields`, `required_fields` and `warnings` |
| B-44 lineage | Its history, `version_id` and conflict |
| C1, 9 and 12 | `column_mapping` is never sent any more. Rule uploads send neither it nor the column lists. Configuration ▸ Rules shows it read-only |
| C1, 11 | A configuration save sends a column list only if it was edited, so an old copy cannot become an override |
| C1, 6 | `configuration_changed` with `column_mapping`: the analyst is told to make the dataframe again |
| C7, 4 | A column name that would void its list is refused before saving in Domains, and marked in Configuration |
| B-45 | Domain access on each user; the domain selectors offer granted domains only; `domain_not_granted` is worded |
| B-46 | `credentials_cleared` is shown |
| B-47 | `domain_config_changed`: the open Domains page reads that part again; users of that domain are told; columns and mapping reload the session's configuration |
| B-48, R3-3 | `rule_not_available`, `no_data` and a quick run without `window_end` are worded |

## Please say

**Before you build B-41**

1. **`create_DF` and missing fields.** Our plan: make the dataframe, show the missing fields and the data's columns, let the analyst map, and make it again with `dataframe_mapping`. So we need `missing_fields` **and the original column names** in the answer of every `create_DF`, also one without a mapping. Is that right?
2. **Quick runs.** Is `dataframe_mapping` accepted on a quick `create_DF`? We would offer it in Source windows only.

**About section 2**

3. **Trusted entries already stored by non-admins** in their own account (your first error): will they be found and removed? Do they still suppress rules in their owners' runs until then?
4. **Alert runs on `bank`** "until the parent names one": a call or microfinance alert would be analysed as banking. Can an alert say its domain sooner?

**Small, no hurry**

5. **First save of a domain (`version_id: null`).** We then send no version, so two admins' first saves do not conflict. Does sending `null` mean "only if nothing was saved yet"? If so we will send it.
6. **`warnings` of a mapping save:** sentences, `[["ACCOUNTNO"], …]`, or `{ fields: […] }`? We read all three.
7. **A stored column override that breaks the new rule** (`required_field_removed`): ignored, or only refused at its next save?

## To report after your next deployment
Round 1 (points 1, 3, 4, 6, 7, 8), round 2 (2 to 7), the quick runs, and the Domains page with `version_conflict`, `dry_run`, `credentials_cleared` and `domain_config_changed`. We run them together at the end.
