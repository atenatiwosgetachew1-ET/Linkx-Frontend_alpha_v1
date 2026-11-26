# Phase 6 plan (Domains, own columns and column mapping)

**Date:** 2026-11-25. **The Service answered round 3** (`service-response-round-3-2026-11-25.md`) and we agreed to all of it (`frontend-reply-round-3-2026-11-25.md`). **All steps are built** (2026-11-25). The Service's side is live; nothing is run on it yet.

## 1. Decided (analyst, then aligned with the Service's answer 2026-11-25)
1. Analysts may override the **search and fetch columns** for themselves; a required field cannot be removed.
2. Analysts may give **one dataframe** a column mapping of its own (`dataframe_mapping`, B-41). It is never stored and may only fill fields that would be missing. This replaces a stored mapping per user.
3. Both leave a remark on evidence, reports, prints, snaps and anything else saved to be read later or exported (`settings_used`, B-42).
4. Restore to defaults: columns only.
5. By role only: `columns:override`, `mapping:override` (B-43) for analyst, manager, admin, superuser.
6. The Domains page is inside the Configuration window.
7. Domain access starts with "All domains". It limits sessions and runs; records of other domains stay visible.
8. STR alert runs, service accounts and xVigilance use the domain's settings only. The note on the STR alerts tab of Reports says "are not used" (B-40, live).
9. "Clean (own mapping)", never plain Clean. "settings not recorded" where there is no `settings_used`.
10. A "Run settings" column, last, in CSV and copied tables.

## 2. Where things go
| What | Now | After |
|---|---|---|
| Rule thresholds, score lineage (**done**) | Configuration ▸ Detection sensitivity (active domain only) | Configuration ▸ **Domains** ▸ Thresholds, Score lineage (any domain) |
| Presets (**done**) | Not there | Domains ▸ Sensitivity |
| Domain's columns, column mapping (**done**) | Not there | Domains ▸ Columns, Column mapping; each part has its history |
| One's own columns (**done**) | Configuration ▸ Connections ▸ Search, saved with the form | Configuration ▸ Connections ▸ Own columns: saved apart, with origin, the domain's list and Restore |
| A dataframe's own column mapping (**done**) | Not there | Source window ▸ Dataframe ▸ Map columns |
| The domain's mapping in Configuration ▸ Rules (**done**) | Edited, with no effect on the Service | Read-only, with its origin and a link to Domains |
| Domain access (**done**) | Not there | Settings ▸ Users ▸ Existing users, on each user |
| Profile mapping, formatting rules | Configuration ▸ Rules | No change |

## 3. Can it be built well? Yes, if the Service records the settings with the run
- **One source.** `settings_used` on the task, the evidence record and the graph answer. One function words it. Nothing is worked out from today's configuration.
- **One road to the windows.** Graph, Table and Chart windows already share the graph store and `graphDataNotice`. The remark is put on the store with the graph, so the twins and their exports have it without asking again. It stays apart from the data notice: both can be true.
- **Not from the frontend alone.** Another reader, a later day or an archived graph has no access to the analyst's configuration. A graph drawn by session carries the `task_id` of its run or `null` (then: settings not recorded).
- **Cost.** A few strings per graph. No extra request per export, no work while drawing.

## 4. Every output that must carry it
| # | Output | Where in the code | How |
|---|---|---|---|
| 1 | Task detail and list | `TasksWindowBody.jsx` | Beside the settings versions; a mark in the list |
| 2 | Task and stream log files | `TasksWindowBody.jsx`, `StreamStep.jsx` | First line |
| 3 | Save as evidence (dialog and record) | `saveEvidence.js`, `TaskEvidenceDialog.jsx` | Shown before saving; the Service stores it |
| 4 | Reports list and detail | `ReportsWindowBody.jsx`, `ReportDetail.jsx` | Mark and section |
| 5 | Reports list PDF | `reportsPdf.js` | Column mark and note |
| 6 | Copied payload | `ReportDetail.jsx` | The Service's record holds it |
| 7 | Evidence report, graph report | `graphReportModel.js` (`runSettingsLine`) | Cover line and Method section |
| 8 | Charts and tables inside reports | `chartReport.js`, `tableReport.js` | Covered by the report's cover; repeated in captions |
| 9 | Graph snap, graph PDF | `graphSnap.js`, `offscreenSnapshot.js`, `GraphWindowBody.jsx` | Frame line |
| 10 | Graph print | `graphFile.js` `printImage` | In the picture |
| 11 | Graph file (JSON) and its import | `graphFile.js` `buildGraphExport` | `linkx.settingsUsed`, read back |
| 12 | Copied graph elements | `graphClipboard.js` | Travels; the target shows both |
| 13 | Pinned evidence | `pinnedEvidence.js` | Kept per item |
| 14 | Chart snaps, chart PDF, chart print | `chartSnaps.js` | Header line |
| 15 | Table PDF, print | `tablePdf.js`, `tablePrint.js` | Header line |
| 16 | Table CSV, copied table | `tableExport.js` | "Run settings" column at the end: a line above the header would break spreadsheets |
| 17 | STR feedback | `alertModel.js` | Not needed: domain settings only |
| 18 | Restored workspace | `workspaceCopy.js` | Not stored: comes with the graph again |
| 19 | Right panel (other session's files), AI answers | `GraphPanels.jsx`, `Workspace*Tab.jsx` | To be agreed with that work |
| 20 | Configuration export (`.lxac`) | `LxacDialog.jsx` | Say that it holds one's own columns, and that an import can make them |

Not affected: xVigilance PDF (domain settings), saved views and defaults (no data), icon sets, rule template.

**Guard:** one test that runs every export of an overridden run and fails when the remark is missing, so a new export cannot forget it.

## 5. Order
1. **Done.** Domains page: Thresholds and Score lineage, any domain.
2. **Done.** The remark: `src/shared/runSettings.js` (one reader, one wording), `src/services/runSettingsApi.js` (which runs a graph holds), the graph store carries it, `RunRemarkFlag.jsx` shows it. Guard: `src/shared/runSettings.guard.test.jsx`; a new file that exports anything fails it until it is listed there.
3. **Done.** Own columns (`OwnColumns.jsx`) and a dataframe's own column mapping (`DataframeMappingDialog.jsx`, `lib/dataframeMapping.js`).
4. **Done.** Domain's columns and column mapping (B-44).
5. **Done.** Presets (B-44).
6. **Done.** Domain access (B-45).
7. **Done.** History of every part (B-44).

Also done: `domain_config_changed`, `credentials_cleared`, `rule_not_available`, `no_data`, `domain_not_granted`, `version_conflict`.

**Not covered, on purpose:** the right panel and the AI assistant's text (the other session's files); the feedback to the parent (later, with its contract); the Tasks filter "Own settings" looks at the tasks that are loaded.

Live testing comes at the end, with the rest.
