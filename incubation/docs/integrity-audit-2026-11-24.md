# Integrity audit: Configuration, Source, Graph, Chart and Table

**Date:** 2026-11-24. **Baseline:** commit `36ce5363`. **Method:** read-only. The real modules were run against a fake Service; nothing was tested on the live Service.

**Marks**
- **Checked:** ✔ re-proved a second time, independently. (read) confirmed by reading the code. Others were reproduced once.
- **Prod:** what production (`src/App.jsx`, `public/temp_placeholders`) does.
- **Service:** the effect depends on how the Service behaves; see `backend-round-2-2026-11-24.md`.
- **Status:** updated as items are fixed. R2-n: the item in `backend-round-2-2026-11-24.md` that asks the Service about it.

**Fixed 2026-11-24, not committed:** every item except C2 (fixed 2026-11-25). Each has a regression test that fails on the baseline commit and passes now, except E5 and E11, whose tests cover code that did not exist then (`runIntegrity`, `graphIntegrity`, `figureIntegrity`, `refusals`, `values` tests, and additions to the existing ones). Whole suite: 1,118 tests; lint and build pass. Not yet run in a browser or against the live Service.

**Found while fixing:** a graph job answering in a top-level `result` (not `results.result`) was read by Reports but came out empty in the Graph window; both read it now. Eigenvector centrality refuses a graph it cannot settle on (for example, one chain of about 1,000 entities) instead of giving half-way figures.

**Sent jobs keep their configuration** (analyst, 2026-11-24: each job is queued on a worker with its initial configuration). A domain or configuration change waits while a job is out or its finished run is shown, and applies to the next job. This also removes an older behaviour (2026-11-13, not in production): a domain change ended the running stream of a connected source.

**Left as is, display only:** after a domain switch, an open Graph window draws an earlier run with today's domain's formatting rules and profile fields; a Reports download whose evidence names no domain falls back to today's (the Graph window leaves it out since D8).

**Not done (minor, outside the tables):** a typed relationship name loses its spaces ("SENT TO" becomes "SENTTO").

## A. Wrong conclusions

| # | Finding | Where | Checked | Prod / Service | Status |
|---|---|---|---|---|---|
| A1 | Tasks shows **Clean** without proof: `verdict: suspicious` with empty or list-shaped `flags`; no verdict and no log; Store data; a failed or stopped run after an early `flags: {}`; rule names holding a digit (`RULE_2`) are dropped from the log | `tasks/lib/taskFlags.js`, `taskRegistry.js` flagsOf | ✔ | Prod has no verdict. Service: which shapes it sends | Fixed; "Not determined" unless proven (R2-1) |
| A2 | STR **Extract results** preselects **clean** whenever no flag is listed, even if the Service said suspicious or undetermined | `alerts/lib/alertRuntime.js` extractAlertResults | ✔ | Incubation only | Fixed |
| A3 | STR extraction takes the window's limited view (25 entities by default) as the alert's graph, with all links when none are drawn ("25 entities, 150 links" of 200 / 150), and accepts a graph that is loading or failed | same | (read), reproduced | Incubation only | Fixed |
| A4 | "No alerts — graph looks clean." covers only what is drawn, also with every rule off or a view too large to scan. Equal link weights raise 5 "unusually high" alerts. Only the first 5 hubs are listed, unsaid | `graph/lib/graphAlerts.js` | ✔ | Same wording and maths in production | Fixed |

## B. Not analysing what is on screen

| # | Finding | Where | Checked | Prod / Service | Status |
|---|---|---|---|---|---|
| B1 | After a domain switch Analyze still starts on the old dataframe, and the filter is silently gone. A dataframe answer made under the old domain is accepted | `source/lib/sourceModel.js` canStream, `SourceWindowBody.jsx` | (read), reproduced | Service: does it drop the session's dataframe? | Fixed; replaced 2026-11-25: the dataframe is kept and only analysed under its own domain (Q1) |
| B2 | A default broker connects to one topic, and `create_DF` is sent another after a configuration change | `SourceWindowBody.jsx` | reproduced | Service: which one it reads | Fixed (R2-10) |
| B3 | The task records no rule, mapping columns or filter (read from `payload.rule`, sent as `payload.value.rule`). Tasks shows 100 rows when 3 were analysed | `SourceWindowBody.jsx` createTask | ✔ | Service: return `dataframe_filter` on tasks | Fixed (R2-2) |
| B4 | HTTP 200 refusals with a `results` body count as success (stream accepted, dataframe ready, configuration saved). Partly failed sources on success are dropped | `services/apiClient.js` isSuccessResponse | ✔ | Same in production. Service: which refusals it sends as 200 | Fixed (R2-6) |
| B5 | The configured active rule is not the rule preselected; the list's first is | `SourceWindowBody.jsx` | reproduced | Production leaves it empty | Fixed |
| B6 | Realtime keeps the configuration saved at tool connect; later saves are not carried over | `SourceWindowBody.jsx` | reproduced | Service: which session's configuration rules read | Replaced 2026-11-25: realtime saves nothing (R2-18) |
| B7 | "Is one of" lists are cut at 200 characters, mid-value; "5,000" becomes 5 and 000; impossible ranges and dates pass | `source/lib/dataframeFilter.js` | reproduced | Not in production | Fixed (R2-13) |

## C. Configuration damage

| # | Finding | Where | Checked | Prod / Service | Status |
|---|---|---|---|---|---|
| C1 | Uploading a rule posts the trusted and risk lists as the text `[object Object]` | `services/configurationApi.js` uploadRule | (read), reproduced | Production's form does not send them. Service: what it stores | Fixed (R2-11) |
| C2 | Categories other than exactly "Risk" (Sanction, PEP, SIM_BOX…) are saved into `trusted_entities`; plain-text entries and the `reason` field are lost | `configuration/lib/configModel.js` | reproduced | Same in production. Service: list or category? | Fixed 2026-11-25 (R2-8): risk categories go to the risk list |
| C3 | Save is possible before any configuration was loaded, and posts empty lists | `ConfigurationWindowBody.jsx` | reproduced | Shared payload builder | Fixed (R2-12) |

## D. Incomplete or wrong graph

| # | Finding | Where | Checked | Prod / Service | Status |
|---|---|---|---|---|---|
| D1 | A job that says 500 nodes and delivers 2 is "ready". A graph kept after a failed or timed-out load can be used and exported. A failed relationship switch leaves the old graph under the new tab | `services/graphApi.js`, `graphFetchRunner.js`, `GraphWindowBody.jsx` | ✔ | (a) same in production. Service: totals, last chunks | Fixed; marked Incomplete (R2-4) |
| D2 | A link whose end arrives in a later chunk is lost for good | `graph/lib/graphStore.js` | ✔ | Production keeps it. Service: chunk order | Fixed (R2-4) |
| D3 | Reports and STR alerts cannot read a chunked graph job that the Graph window can | `services/graphApi.js` fetchGraph | ✔ | Production always reads chunks | Fixed |
| D4 | A Graph window opened mid-run keeps its snapshot as the finished run's graph | `GraphWindowBody.jsx`, `TasksWindowBody.jsx` | reproduced | Service: does the graph grow mid-run? | Fixed; offers a reload (R2-4) |
| D5 | A window titled for run 1 loads run 2 after the Source window runs again; relinking keeps the old drawing under the new session | `GraphWindowBody.jsx`, `graphLinkFlow.js` | reproduced | Session-only request in production too. B-37 | Fixed on screen; B-37 for the cure (R2-3) |
| D6 | Edits or Undo while loading corrupt the data, and the edited graph is cached as the evidence graph later reports use | `GraphWindowBody.jsx`, `graphStore.js` | reproduced (store level) | Production re-sends all chunks | Fixed |
| D7 | Numeric ids above 2^53 merge different accounts. Same link id with other ends overwrites a link. A repeated chunk of links without ids doubles them | `services/apiClient.js`, `graphStore.js` | ✔ (first two) | Service: number or text ids, unique link ids | Fixed; links without ids need R2-5 |
| D8 | Report covers of session graphs name today's domain, not the run's | `GraphWindowBody.jsx` | (read) | — | Fixed; left out when unknown (R2-2) |
| D9 | Above 10,000 nodes the chosen order is ignored; search shows 25 of 400 matches without saying so; link counts have no "of" | `graphStore.js`, `graphSearch.js` | reproduced | Same sort and search in production | Fixed |
| D10 | Python-style answers: text such as "None Trading" is changed; a double-quoted string breaks the whole answer | `services/graphApi.js` | reproduced | Service: does it ever answer this way? | Fixed (R2-15) |

## E. Wrong numbers and matches

| # | Finding | Where | Checked | Prod / Service | Status |
|---|---|---|---|---|---|
| E1 | Formatting rules treat different accounts as equal: `0012345` = `12345`; 17+ digit numbers; `1E3` = `1000`; `0x10` = 16. Search does the same | `conditionalFormatting.js`, `graphSearch.js` | ✔ (rules) | Same search in production | Fixed |
| E2 | Sorting uses the leading number: dates of a year are equal, "900 ETB" sorts above "10,000 ETB", 1,000,000 before 9 | `graph/lib/graphModel.js` compareNodeValues | ✔ | Same in production | Fixed |
| E3 | Link totals: `1.234,56 + 100` = 101.23; `$1,200 + ETB 500 + 300` = 300; missing values unsaid | `graph/lib/linkAggregation.js` and 5 other parsers | ✔ | No such feature in production | Fixed |
| E4 | Choosing an edge weight (a node property) empties the money charts | `GraphWindowBody.jsx`, `chartState.js` | ✔ | Charts are random in production | Fixed |
| E5 | Charts round to 4 significant digits (1,234,567.89 → 1,235,000), histograms to 6 | `chartOption.js`, `ChartCard.jsx`, `chartSnaps.js`, `chartMetrics.js` | (read), reproduced | — | Fixed |
| E6 | Table, Chart and report count different populations (theme lines, undrawn links, selected links); text notes count as entities | `tableRows.js`, `chartState.js`, `graphReportModel.js` | reproduced | — | Fixed |
| E7 | Reports leave out Assortativity and Histogram with a false reason | `chart/lib/chartReport.js` | reproduced | — | Fixed |
| E8 | Eigenvector centrality is returned before it converges (up to 2×) | `graph/lib/networkMeasures.js` | reproduced | Random in production | Fixed |
| E9 | Time cards: periods cut at 2,000 lose links silently; unreadable dates unsaid; links take their entities' dates; histogram edges misplace values; account numbers binned as amounts | `chart/lib/chartMetrics.js`, `chartState.js` | reproduced | — | Fixed |
| E10 | CSV: negative amounts and "+" numbers become text | `table/lib/tableExport.js` | reproduced | — | Fixed |
| E11 | Drawn-scope charts and tables go stale while docked away or loading, unsaid | `graphLinkBus.js`, twins | reproduced (store level) | — | Fixed |

## Sound
- Betweenness, closeness, edge betweenness, k-core, components, bridges, cut vertices, degree sums and PageRank matched brute force on 200 random graphs.
- A late or older result cannot overwrite a newer one (graph fetches, chart results).
- A filter never carries over to a new dataframe; mapping columns cannot be stripped.
- Unsaved Configuration drafts never reach a run; saves carry the session's domain.
- Text ids keep their leading zeros. CSV holds every shown row; PDF and report caps are stated.
- The run sent equals the Dataframe step's choices while that step is open.
