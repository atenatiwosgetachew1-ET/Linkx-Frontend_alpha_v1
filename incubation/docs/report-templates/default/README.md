# Built-in template: LinkX Graph Report (v1)

The default graph report, built 2026-11-17 from the analyst's design reference `NBE_Linkx_Graph_Report_template.pdf` in this folder. The source PDF and `NBE_logo.svg` are design references and are not shipped. `NBE_Linkx_Graph_Report_thumbnail.png` is the template's preview image; the app's copy is `src/features/graph/report/nbe_graph_report_thumbnail.png`, shown in Libraries ▸ Report templates (where the built-in template is listed as the default graph report template, from `reportTemplates.js`) and beside the Generate report form. The app's copy of the logo is `src/features/graph/report/nbe_logo.svg`, which was checked for safety: no scripts, links or embedded objects, and its text is drawn as shapes.

- **Code:**
  - `src/features/graph/report/graphReportModel.js`: the report as structured data.
  - `src/features/graph/report/graphReportPdf.js`: the layout, drawn with the bundled jsPDF.
  - `src/features/graph/components/GraphReportDialog.jsx`: the analyst's form.
  - `src/features/graph/report/graphReportExport.js`: drawing and downloading, shared by both entry points; the evidence report's input.
  - `src/features/graph/lib/offscreenSnapshot.js`: the snapshot drawn without a window (Reports).
- **Opened from:**
  - Graph window toolbar ▸ Export ▸ Generate report… (the window's current view, alerts, pinned items, rules and groups);
  - Reports ▸ Service evidence ▸ Download report (the whole evidence graph, without opening a Graph window; snapshot drawn as the form's Graph options say (Order by, Direction, Orientation with the Graph window's layout options, Amount; by default the 250 most connected entities, concentric), each entity labelled with the report's name for it; no window alerts, pinned items, rules or groups).

## Two kinds of report, named apart (analyst decision 2026-11-18)
The same template draws two kinds of report. They are named apart everywhere, because an Evidence Report is organic and original, while a Graph Report may contain the analyst's changes:

| | Evidence Report | Graph Report |
|---|---|---|
| Started from | Reports ▸ Service evidence ▸ Download report | Graph window ▸ Export ▸ Generate report… (also for an evidence graph) |
| Graph | The evidence record as the backend analysed it | The window's graph, possibly edited, filtered, styled or extended |
| Title | Evidence Report · <reference> | Graph Report · <window title> |
| Cover header | LINK ANALYSIS · EVIDENCE REPORT | LINK ANALYSIS · GRAPH REPORT |
| Running header | NBE · LINKX EVIDENCE REPORT | NBE · LINKX GRAPH REPORT |
| File | `LinkxEvidence_Report_<ref>_<time>.pdf` | `LinkxGraph_Report_<ref>_<time>.pdf` |
| Form heading | Generate evidence report | Generate graph report |
| PDF subject | LinkX Evidence Report | LinkX Graph Report |
| Appendix A | "Provenance: an Evidence Report, drawn from the evidence record as the backend analysed it; nothing in its graph was changed by an analyst." | "Provenance: a Graph Report, drawn from a Graph window as the analyst left it; its graph may have been edited, filtered, styled or extended by the analyst." |
| Snapshot caption | The evidence graph as analysed, drawn for this report. | The graph as drawn when the report was generated. |

## Kept from the reference: the visual language
- **Cover:**
  - full dark navy, with the gold accent bar;
  - the title in bold white, 22 pt; a report from the evidence table is titled "Evidence Report · <reference>", one from a Graph window "Graph Report · <window title>";
  - a small grey label line ("NATIONAL BANK OF ETHIOPIA · Domain : BANKING"); the domain is the evidence's own (its report's `domain`, else `resolved_domain`), followed, when its data spans several domains (or the domain is `all`), by its `domain_distribution`, e.g. "Domain : ALL (BANKING 1,200 · MICROFINANCE 3)" (shares given as fractions show as percentages; a long line shrinks to fit, down to 7 pt); else the active domain a session ran under, else none for an imported file; then a large bold white title and a light one-line purpose;
  - the **Case ID** under the purpose, in bold gold, larger than the purpose (always shown: "Case ID - Undefined" when none is given);
  - the **NBE logo** at the top, on the navy itself, as it is: its own colours on a transparent background (analyst decisions 2026-11-17: no white band, no recolouring);
  - the cover fields as a **ledger** on the cover's navy (no fill, no box, no radius): a thin gold line down its left side, one field per line, the label in small spaced regular-weight capitals in the purpose line's muted grey in a left column and the value in white beside it, compact rows with no lines between them, aligned to the title's left edge:
    - Analysis Reference ID;
    - Date & Time of Report (`dd/mm/yy HH:mm`);
    - Analyst / Investigator Details;
    - System Flagged Rule: the backend link analysis rule(s) that flagged the evidence at ingestion: the rules on the graph's own relationships (a relationship the analysis drew is labelled with its rule, e.g. `FUND_FLOW`, and carries the analysis metadata), together with the evidence report's flagged rules (else its anomaly type);
    - Graph Alert: the Graph window's alert configuration (its enabled rules and thresholds, and how many alerts were raised), or "Graph alerts off".
- **Profile cards:** one full-width white card per entity, with a hairline border and a thin rule down its left edge in the entity's mark colour (Alerted red, else Pinned gold, else Bridge slate, else navy). The actor profile (Configuration ▸ Profile mapping fields) is shown as its on-screen card shows it. The **square** portrait sits on the left; a placeholder silhouette shows when there is none or it cannot be read (backend request B-26). Beside it: the name, with its marks as small outlined tags on the right; its type and link count; a hairline; then every shown field in a three-column grid of small spaced labels over their values ("—" when unknown; a long value spans the rest of its row, up to two lines). Only entities the profile knows something about get a card.
- **Subjects table:** the Notes column draws each mark as a small flag in its colour before its word (Pinned gold, Alerted red, Bridge slate).
- **Fraudulence score:** an evidence's report stamps its fraudulence score at the right end of the Summary heading: upright and without a border, "FRAUDULENCE SCORE" in spaced capitals, the score large and bold, the band below (e.g. "FATAL · 90+"), all in the band's colour (fatal deep red, critical red, high orange, medium amber, low green); the page's top-right corner is washed in that colour, fading out, as the Generate report popup's corner is in its accent.
- **Section headings:** a gold bar down the left of the small uppercase label and the title; the section number (or "Appendix A ·") and the title in bold navy (long titles shrink to fit the line).
- **Inner pages:**
  - nothing is split from what it belongs to: a subheading stays with the start of its block, a short table (up to about 9 rows) is kept whole, a long one starts with its head and at least three rows (its head repeats on each page);
  - a running header ("NBE · LINKX GRAPH REPORT" or "NBE · LINKX EVIDENCE REPORT", and on the right "REF … · date") over a hairline;
  - a footer with the distribution marking and the page number;
  - each section on a new page, under a small uppercase slate label and a numbered navy heading;
  - slate subheadings, the key-figure strip, navy-headed tables with pale-blue stripes.

## Not kept: the reference's content
The reference is an operating-model document. These sections do not belong in a graph report and were left out:
- workflow;
- data contracts;
- components;
- operations;
- statuses;
- capacity;
- build order.

## Sections (round the investigation)
| # | Section | Content |
|---|---|---|
| Cover | Title page | NBE logo, title, purpose, the four fields, marking |
| 1 | Summary | Purpose; 4 key figures in one tight row of tiles, each with a drawn icon; **Key findings** (the analyst's lines, or a factual draft marked as such); Contents with page numbers |
| 2 | The graph | Graph snapshot (the whole drawn graph, in a padded frame, sized 70-150 mm so the rest of the section stays on its page); entity types; scope (shown vs total, search, period, hidden types) |
| 3 | Subjects of interest | Pinned first, then most connected (15); notes: Alerted, Pinned, Group, Merged, Bridge; **profile cards** from the actor profile mapping (4) |
| 4 | Relationships and patterns | Relationship types; strongest relationships (links, total of the link aggregation / edge weight key); bridging entities (cut points); groups and merged; separate parts; highlighted path |
| 5 | Timeline | Dated items and span; weekly / monthly bar chart (at most 40 bars); busiest periods in the chart's unit (only when the data has dates) |
| 6 | Alerts and indicators | Alerts; pinned evidence; conditional formatting rules in use (only when there is any) |
| 7 | Assessment and next steps | The analyst's assessment (or "To be completed by the analyst"); follow-up actions (`action \| owner \| status`); signature block |
| A | Method, sources and limitations | Source, generation time and template version, scope caveat, definitions of the measures |
| B | Entity and link lists | Optional; first 2 000 of each |

## Naming entities
The form asks for the column that identifies entities (**Identify entities by**: a node property such as a full name or account number; default: the alert card's "Name by" column, else the label). Every name in the report uses it: findings, subjects, profiles, relationships, alerts, pinned items, groups and lists. Entities without a value fall back to their label, then their id. The findings draft follows the choice until the analyst edits it.

## Security and reliability
- **Drawn directly as PDF:** the report never passes through HTML. Nothing is fetched and no script is involved; every value is written as plain, bounded text.
- **Real PDF output:** text is selectable, the output is the same every time, and the files are small (about 20 KB without the snapshot).
- **Fonts:** Latin text uses the standard PDF fonts. **Ethiopic** text (Amharic, Tigrinya, Ge'ez) is drawn in **Noto Sans Ethiopic** (Regular and Bold, SIL Open Font License 1.1, `src/features/graph/report/fonts/` with `OFL.txt`; added 2026-11-18): any string with an Ethiopic character (cover, text, tables) is drawn and measured in it at the same weight, and as it also covers Latin-1, mixed text such as "አበበ ከበደ (Abebe Kebede)" stays whole. The fonts are separate files (about 367 KB each), fetched only for a report with Ethiopic text (`reportFonts.js`), and jsPDF embeds only the glyphs used (about 30 KB more in the PDF). Without them (e.g. the fetch fails) Ethiopic prints as `?`. Other scripts print as `?`.
