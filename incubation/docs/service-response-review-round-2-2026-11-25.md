# Review of the Service's response to round 2

**Response:** `service-response-round-2-2026-11-25.md`. **Date:** 2026-11-25.
**State of ours:** aligned in code; 1,208 tests, lint and build pass. Nothing run in a browser or against the live Service.

## 1. Accepted as changed (analyst and Service, for the workers' capacity)
| Ours (B-38) | Now |
|---|---|
| The Service sets the seats | A quarter of what the live workers can run at once, rounded down; fewer than 4 slots: none. `available` is 0 while any analysis waits |
| A seat until the run ends | 60 minutes (`unattended_until`), then taken back; may be asked for again |
| Realtime may have one | Batch only (`unattended_not_allowed` for realtime and quick; STR alerts need none) |
| Any going run | Only one that has started (`task_not_running`) |
| 15 minutes after a disconnect | 2 minutes after the owner's last browser is gone |

## 2. What we changed
| Answer | Change |
|---|---|
| R2-19 | The switch follows the rules above and says until when. **A closed or reloaded page stops nothing**: the Service's 2 minutes do. The running window's session is not closed. `/auth/idle-timeout` sends `cleanup: true` again (a seat's session is left alone). A run left behind shows its live log and can be stopped |
| R2-3 / B-37 | Show graph opens a finished run's kept graph by `task_id`: window closed, after a reload, after a second run. Tasks says until when it is kept. A kept run is no longer asked about on closing, and a held session is freed once its graph is kept |
| Q1, Q19 | A batch dataframe is kept across a domain switch, labelled, and only analysed under its own domain (this replaces the drop of audit B1). `configuration_changed` is worded |
| Q2 | A mapping change asks to make the dataframe again |
| R2-18 | Realtime saves nothing before a start (this replaces audit B6). Analysts switch domain without `config:write`. Passwords and entity lists are left out of a save by anyone without `users:manage`; refusals name the settings |
| R2-8 (audit C2) | A category that names a risk is saved in `risk_entities`, never passed through. `reason` and plain text entries are kept |
| R2-4 | `complete`, `partial`, `truncated_by` mark a graph Incomplete |
| R2-17 | "Injection finished" shows Finishing; the Service says how it ended |
| R2-20, R2-2 | Why it ended, domain and the versions it ran with are on Tasks. Clean at a time limit says so |
| R2-23 | Roles that may be given come from `user-rules` |
| `session_id_in_use` | The next window number is taken (up to 5). `run_in_progress` is worded |

## 3. For the owner
1. **Check the stored trusted and risk lists** for `[object Object]` (R2-11), and for entries that were trusted with a risk category (R2-8): runs before this fix ignored rules for them. The category field in Configuration ▸ Rules is a dropdown now (it was a text field with suggestions that hid every category but the one held; production has the same fault).
2. **Old results** (R2-21): a Clean without `ended_reason` is shown as **Clean (unconfirmed)**, with the reason. The record is unchanged.
3. **Thresholds of microfinance, insurance and social media** may have been saved to `bank`: Detection sensitivity only knew CDR and bank until 2026-11-25. Please check the history of `bank`'s thresholds and score lineage.
4. **Mapping or thresholds** changed by an admin reach other analysts' next runs; their open screens are not told (Q12, B-11 later).

## 4. Done 2026-11-25 (after the alignment)
- This round: settings a run was made with in reports; a kept graph comes back with a restored workspace; canonical domain names in service accounts (aliases read, never sent).
- Round 1: secrets made and rotated by the Service (B-3); `PATCH` only, thresholds and lineage by domain without fallbacks (B-9); search, dataframe and graph jobs cancelled (B-7); rule template from the Service (B-16); profile mapping and formatting rules on `/domain-config` with version conflicts, browser copies dropped (B-23, B-24); GPU drawing per browser only (B-36).

- Quick analysis panel (B-35): built 2026-11-25, not run on the live Service yet.

**Next:** Phase 6, after the answer to `backend-round-3-2026-11-25.md` (C1 to C3).

**To tell the Service** (in round 3, R3-4): WANGIRI (callback scams) is not among its risk words; this screen saves it in `risk_entities`.

## 5. Reply to "Please report back"
Confirmed by the analyst on the live Service, 2026-11-25: a category changed to a risk and kept after a reload; service-account secret made and rotated; `presentation` saved, read in another browser, and a version conflict.

| # (round 1) | Answer |
|---|---|
| 2 | Secret creation and rotation: OK. `user-rules` and the masked token: not reported yet |
| 5 | OK |
| 1, 3, 4, 6, 7, 8 | In the code, not reported yet (8 not built) |

| # (round 2) | Answer |
|---|---|
| 2 to 7 | In the code, not reported yet |
| 8 | Nothing that does not match, so far |
