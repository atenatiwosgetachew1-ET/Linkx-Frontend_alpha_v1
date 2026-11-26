# Live tests (2026-11-26)

Everything owed to the Service in one table, in the order it is easiest to run. It covers what the Service asked for in round 1 (points 1, 3, 4, 6, 7, 8), round 2 (points 2 to 7) and round 3 (section 13), plus our own checks.

**Result** column: write **OK**, **Problem** or **Not done yet**, the answers the Service wants. When something is a Problem, note the request, the status and the body (DevTools ▸ Network). Then this file can go back to the Service as our report.

## Before you start

| Need | What |
|---|---|
| Accounts | **A1** admin (`users:manage`); **A2** a second admin, in another browser, for the conflict tests; **N1** an analyst with access to `bank` only; **N2** an analyst with every domain; **V1** a viewer (no `analysis:run`) |
| Files | **F1** CSV with the usual column names (ACCOUNTNO, AMOUNTINBIRR, TRANSACTIONDATE with a time, …); **F2** the same rows with other column names (e.g. `PAYER ACC` instead of ACCOUNTNO); **F3** dates only, no time anywhere; **F4** F3 plus a separate TRANSACTIONTIME column; **F5** an account column with leading zeros (`000123`) |
| Open | DevTools ▸ Network in every browser (for test J1 and for reporting Problems) |
| Do not touch | `bank`'s thresholds and score lineage: the Service owner is still checking them. Use `microfinance` for every Domains page save |

## A. Users (round 1, point 1)

| # | Who | Do | Expect | Ref | Result |
|---|---|---|---|---|---|
| A1 | A1 | Settings ▸ Users: create a user | Created; the username and password rules come from the Service. A refused name or password says why, not a raw error | R1-1, B-33 | |
| A2 | A1 | Edit that user (name, roles), save | Saved; the list shows the change | R1-1 | |
| A3 | A1 | Switch that user off, then on again | `is_active` follows; no `self_lockout` and no refusal for sending its own roles back | R1-1 | |
| A4 | A1 | Try a refused change (e.g. a role A1 may not give) | A coded refusal that names it. Note which code appeared | R1-1 | |
| A5 | A1 | User's domains popup: give N1 `bank` only, save | The list shows N1 with `bank`; N2 shows "all" | C10-9, B-45 | |

## B. Domains page as admin, on `microfinance` (Phase 6 Verify 1, round 3 section 13)

| # | Who | Do | Expect | Ref | Result |
|---|---|---|---|---|---|
| B1 | A1 | Configuration ▸ Domains, pick `microfinance`, open each of the 5 tabs | Each loads; values carry an origin badge (`profile` / `admin`) | Verify 1 | |
| B2 | A1 | Sensitivity: choose another preset, preview | A list of what would change (`now → after`), nothing saved yet (the preview is offered only when the Service sent a `version_id`) | B-44 `dry_run` | |
| B3 | A1 | Apply that preset | Saved; the tab redraws from the Service's answer; thresholds show the new values | Verify 1 | |
| B4 | A1 | Columns: change one list, save | Badge turns `admin`; the redrawn list is the Service's | Verify 1 | |
| B5 | A1 | Columns: remove a required field, save | Refused with `required_field_removed`, the field named; nothing changes | §13-2 | |
| B6 | A1 | Column mapping: add a row, save | Badge `admin`. If a required group lost its last source, a warning names it | C7-5 `warnings` | |
| B7 | A1 | Columns and Column mapping: **Reset to profile** | Badges back to `profile`; values are the profile's | Verify 1 | |
| B8 | A1 | History of columns and mapping | Each save above listed with version, who, when; sensitivity history lists the preset | C8 | |
| B9 | A1 + A2 | Both open `microfinance` Columns. A2 saves first, then A1 saves | A1 gets a conflict that names who saved; A1's draft is kept, nothing overwritten | B-44 `version_conflict` | |
| B10 | A1 + A2 | A2 saves a domain section while A1 has the page open | A1 sees a notice that `microfinance` settings changed | B-47 `domain_config_changed` | |
| B11 | A1 | Configuration ▸ Connections: change a storage or Neo4j host, save | Saved; a notice says which stored credentials were cleared and must be entered again | B-46 `credentials_cleared` | |
| B12 | A1 | Configuration ▸ Rules | The column mapping shows read-only with a link to Domains | Phase 6 | |

## C. Analyst's own columns and domain (Verify 2, round 2 point 5)

| # | Who | Do | Expect | Ref | Result |
|---|---|---|---|---|---|
| C1 | N1 | Open the domain selector | Only `bank` | Verify 2, C10 | |
| C2 | N2 | Switch domain, save | Saved without `config:write`; the session uses the new domain | R2-5, R2-18 | |
| C3 | N1 | Configuration ▸ Connections ▸ Own columns: change the fetch columns, save | Badge `override`; saved apart from the form | Verify 2, B-43 | |
| C4 | N1 | Reload the page | The override and its badge are still there | Verify 2 | |
| C5 | N1 | Remove a required field from own columns, save | Refused with `required_field_removed` | §13-2 | |
| C6 | N1 | **Restore** on one list, then **Restore all** | The domain's list again, badge `admin` or `profile` (this checks our assumption that `null` in the save restores one list) | B-43 | |
| C7 | N1 | Try to change endpoints, credentials or the column mapping | Read-only | Verify 2 | |
| C8 | V1 | Open Own columns | Not offered (no `columns:override`) | B-43 | |

## D. Source window: dataframes and runs

| # | Who | Do | Expect | Ref | Result |
|---|---|---|---|---|---|
| D1 | N2 | Source window: upload F1, make the dataframe | Made; no missing required fields | §13-1 | |
| D2 | N2 | Upload F2, make the dataframe | The missing fields are listed, required ones marked; **Map columns** offered | §13-1 | |
| D3 | N2 | **Map columns**: map `PAYER ACC` → ACCOUNTNO, **Make it again** | Made; the missing line is gone for that field | §13-1, B-41 | |
| D4 | N2 | Map a column onto a field the file already has (or AMOUNT, which the Service fills to AMOUNTINBIRR) | Refused with `target_present`; the previous dataframe and your choices are kept, the popup reopens | §13-2 | |
| D5 | N2 | Type a source column that is not in the file | Refused with `unknown_source`, same behaviour as D4 | §13-2 | |
| D6 | N2 | Run the analysis on D3's dataframe to the end | Task shows the remark (own column mapping); a clean verdict reads **Clean (own mapping)**. The run's `settings_used` lists the mapping and who made it | §13-1, B-42 | |
| D7 | N2 | Upload F3, make the dataframe, run | TRANSACTIONTIME among the missing fields; LATE_NIGHT_TX and RAPID_WITHDRAWAL under rules not applicable | §13-4 | |
| D8 | N2 | Same with F4 | Those two rules ran (not under rules not applicable) | §13-4 | |
| D9 | N2 | Upload F5, run, open the graph and the table | `000123` keeps its zeros in the table, graph, CSV export | R2-7 | |
| D10 | N2 | Filtered run (keep a few columns) | Row progress counts up, then "analysing"; rules that lacked fields are listed | R1-3 | |
| D11 | N2 | Start a second analysis in the same Source window while one runs | `run_in_progress` shown in words | R2-6 | |
| D12 | N2 | Make a dataframe, switch domain, then stream it | `configuration_changed` shown in words, with both domains | R2-6 | |
| D13 | N2 | Close a Source window and open a new one at once | If the Service says `session_id_in_use`, the next number is used without an error | R2-6 | |
| D14 | N2 | Cancel a search job, then a dataframe job | Each stops (or says it is stopping); the window goes back to its step | R1-4, B-7 | |

## E. Runs over time: tasks, graphs, seats

| # | Who | Do | Expect | Ref | Result |
|---|---|---|---|---|---|
| E1 | N2 | Batch run to its end | Final verdict and `ended_reason` = finished | R2-4 | |
| E2 | N2 | Stop a run yourself | `ended_reason` = user | R2-4 | |
| E3 | N2 | Start a run without a seat, close every tab, come back after more than 2 minutes | It stopped; `ended_reason` = browser_disconnected | R2-4 | |
| E4 | N2 | Start a run, reload within 2 minutes | It is still running and the log reattaches | own | |
| E5 | N2 | Finished run: close its Source window, then **Show graph** from Tasks | Opens by `task_id` (graph kept 24 h) | R2-2 | |
| E6 | N2 | Same after a page reload | Opens | R2-2 | |
| E7 | N2 | Run twice in one window, then Show graph of the first | The first run's graph, not the second's | R2-2 | |
| E8 | N2 | **Keep running while I'm away** on a running batch run | Granted only when the Service confirms; one per user (a second says `unattended_limit`) | R2-3 | |
| E9 | N2 | Ask for a seat on a waiting run, and on a realtime run | `task_not_running`; `unattended_not_allowed` | R2-3 | |
| E10 | N2 | While an analysis waits in the queue, look at the seat switch | No seats offered (`available: 0`) | R2-3 | |
| E11 | N2 | With a seat, close every tab, come back later | The run went on | R2-3 | |
| E12 | N2 | Realtime run (Kafka) | Runs; flags per batch; no seat offered | own | |

## F. The run-settings remark in every output

Use D6's run (own column mapping) and a run after C3 (own columns, made by search).

| # | Who | Do | Expect | Ref | Result |
|---|---|---|---|---|---|
| F1 | N1 | Search with own columns, run | Task in Tasks with the filter **Own settings** (the Service's `?overridden=true` should list it too) | §13-3 | |
| F2 | N1 | Save that run as evidence; open the evidence | Saved, with the remark; the evidence's graph has it too | §13-3 | |
| F3 | N2 | Graph window of D6: snap, print, PDF report, JSON export, copy, pin | Each carries the remark. Re-import the JSON: the remark comes back | Phase 6 §4 | |
| F4 | N2 | Table window: CSV export, PDF, copy | Last column **Run settings**; PDF says it | Phase 6 §4 | |
| F5 | N2 | Chart window: a card snap and print | Framed with the remark | Phase 6 §4 | |
| F6 | N2 | Reports: open the report of D6 | The cover lists the run settings | Phase 6 §4 | |
| F7 | N2 | Show graph of a session with several runs | Remark if any run was overridden (this checks our assumption about `GET /api/v1/tasks/<id>`) | B-42 | |
| F8 | N2 | A run made before this deployment, an old evidence or an old graph file | **Settings not recorded** | B-42 | |
| F9 | N2 | A run with the domain's settings only (D1) | No remark beyond the domain | B-42 | |

## G. Quick analysis (round 1 point 6, round 3 section 8)

| # | Who | Do | Expect | Ref | Result |
|---|---|---|---|---|---|
| G1 | N2 | Quick run on a file (under 5 MB) | Ends `suspicious` or `undetermined`, never clean; the task is closed | R1-6 | |
| G2 | N2 | Quick run on a Kafka batch | Same; ends at `quick_limit` if it reaches it | R1-6 | |
| G3 | N2 | Quick realtime run to its end | Flags per batch while it runs, then the full result | R1-6, B-39 | |
| G4 | N2 | Quick run with no rule set | Refused with `rule_not_available`, the rule named | B-48 | |
| G5 | N2 | Quick run on an empty window | Fails with `no_data`, said in words | R3-3 | |

## H. Alerts (round 1 point 7)

| # | Who | Do | Expect | Ref | Result |
|---|---|---|---|---|---|
| H1 | N2 | Parent alert run-through from the screens: open an alert, analyse it, save as evidence, report | Each step works; the result shows the domain `bank` | R1-7, C2-4 | |
| H2 | N2 | Reports ▸ STR alerts | The note says own settings are not used | B-40 | |

## I. Domain access (round 3 section 10)

| # | Who | Do | Expect | Ref | Result |
|---|---|---|---|---|---|
| I1 | A1 + N2 | N2 has a session in `microfinance`; A1 takes `microfinance` away from N2 | N2's next search, dataframe or stream there is refused in words; closing the session works; a running run goes on | B-45 | |

## J. Security check (Verify 3)

| # | Who | Do | Expect | Ref | Result |
|---|---|---|---|---|---|
| J1 | all | During B, C and D, look at the request bodies in Network | No password, secret, token, credential, authorization or `***` in any body; the configuration form never sends column lists or the column mapping | Verify 3 | |

## K. Round 4: superuser and sign-in (only once the Service's next deployment is live)

The Service's own list (response round 4, last section) is K0 to K5 below; K1 to K7 are ours.

| # | Who | Do | Expect | Ref | Result |
|---|---|---|---|---|---|
| K0 | superuser, A1 | Sign in as each; Settings ▸ Profile | Superuser holds `domains:manage`; `admin` does not | R4-S1 | |
| K0b | two browsers on auto-login | Browser 1 runs a batch analysis; browser 2 signs out | Browser 1's run goes on (sign-out of the shared account no longer calls `/auth/logout`) | R4-S2 | |
| K0c | superuser | Try to deactivate `bank` | Refused, naming why (default domain, alert runs, service accounts) | R4-S5 | |
| K0d | superuser | Change a rule set, Save | The warning that the domain's settings were made for the old rules shows before saving | R4 §4 | |
| K0e | A1 | Libraries: upload a rule named as a built-in rule set, or with a relationship `SMURFING` | Refused, naming it | R4 §6 | |

| # | Who | Do | Expect | Ref | Result |
|---|---|---|---|---|---|
| K1 | any | Auto-login on: Sign out | The sign-in page, with **Continue with the default account**; Continue goes back to `admin` | R4-1 | |
| K2 | superuser | Sign in with username and password, work for over 30 minutes | Still the superuser (never swapped to `admin`); when the sign-in ends, the sign-in page shows | R4-1 | |
| K3 | superuser | Configuration ▸ Domain profiles: change a relationship name to `PAID TO`, then `PAID_TO`; Preview; Save | The space is refused before sending; Preview lists the change; saved as a new version, in the history | R4-3 | |
| K4 | superuser + A2 | Both edit one profile; A2 saves first | The superuser gets a conflict; their edits are kept | R4-3 | |
| K4b | superuser | Give a domain another's display name | Refused with `display_name_exists`, naming the domain | R4 §3 | |
| K5 | superuser | New domain: id `telecom`, then `retail`; on a rule set, copy from a domain on it; Create | `telecom` refused (alias); `retail` created and appears in every domain selector under its display name | R4-3, R4-4 | |
| K6 | superuser, N2 | Deactivate `retail` with a reason; N2 searches in it | Gone from selectors; N2 refused with `domain_inactive` in words; Activate brings it back | R4-5 | |
| K7 | A1 | Open Domain profiles | Locked (needs `domains:manage`) | R4-2 | |

## Afterwards

- Screenshots of the 5 Domains tabs and the analyst screen (Verify 4).
- Anything that differs from the Service's documents: the request, status and body.
