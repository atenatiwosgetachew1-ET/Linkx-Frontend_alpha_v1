# Phase 6 plan (Domains, own columns and column mapping)

**Date:** 2026-11-25. **Nothing built yet.** Waits for the Service's answer to `backend-round-3-2026-11-25.md` (C0 to C3).

## 1. Decided by the analyst (2026-11-25)
1. Analysts may override the search columns, the fetch columns **and the column mapping**, for themselves, with:
   - a remark on evidence, reports, prints, snaps and anything else saved to be read later or exported;
   - restore to defaults;
   - the account's privileges.
2. The Domains page is inside the Configuration window.
3. Domain access starts with "All domains" for every existing user.

**Proposed by us, not decided:** alert runs, service accounts and xVigilance use the domain's settings only; the labels "Clean (own mapping)" and "settings not recorded"; a "Run settings" column in CSV and copied tables; the two permission keys.

## 2. Where things go
| What | Now | After |
|---|---|---|
| Rule thresholds, score lineage | Configuration ▸ Detection sensitivity (active domain only) | Configuration ▸ **Domains** ▸ Thresholds, Score lineage (any domain) |
| Presets | Not there | Domains ▸ Sensitivity |
| Domain's columns, column mapping, history | Not there | Domains ▸ Columns, Column mapping, History |
| One's own columns | Configuration ▸ Connections ▸ Search | Same place, with the origin and Restore |
| One's own column mapping | Configuration ▸ Rules | Same place, with the origin and Restore |
| Domain access | Not there | Settings ▸ Users, on each user |
| Profile mapping, formatting rules | Configuration ▸ Rules | No change |

## 3. Can it be built well? Yes, if the Service records the settings with the run
- **One source.** `settings_used` on the task, the evidence record and the graph answer. One function words it. Nothing is worked out from today's configuration.
- **One road to the windows.** Graph, Table and Chart windows already share the graph store and `graphDataNotice`. The remark is put on the store with the graph, so the twins and their exports have it without asking again. It stays apart from the data notice: both can be true.
- **Not from the frontend alone.** Another reader, a later day or an archived graph has no access to the analyst's configuration. A graph drawn by session falls back on the latest task of that session, which is a guess: `/get_graph` must say the run.
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
| 17 | STR feedback | `alertModel.js` | Only if alert runs may use overrides |
| 18 | Restored workspace | `workspaceCopy.js` | Not stored: comes with the graph again |
| 19 | Right panel (other session's files), AI answers | `GraphPanels.jsx`, `Workspace*Tab.jsx` | To be agreed with that work |
| 20 | Configuration export (`.lxac`) | `LxacDialog.jsx` | Waits for C1, 11 |

Not affected: xVigilance PDF (domain settings), saved views and defaults (no data), icon sets, rule template.

**Guard:** one test that runs every export of an overridden run and fails when the remark is missing, so a new export cannot forget it.

## 5. Order
1. Domains page with Thresholds and Score lineage moved in, changed values only. Needs nothing.
2. The remark (reading `settings_used`) and the guard test. Needs C2. **Before** overrides can be made.
3. Own columns, then own mapping, with Restore and privileges. Needs C1, C3.
4. Domain's columns and mapping (admin). Needs C1, C6, C7.
5. Presets. Needs C4.
6. Domain access. Needs C10.
7. History. Needs C8.

Live testing comes at the end, with the rest.
