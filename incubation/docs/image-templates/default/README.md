# NBE LinkX Chart Snap (default image template)

The frame every chart and graph snap is drawn in (Chart window ▸ Export ▸ Take snaps… and Print charts…; Graph window ▸ Export ▸ Take a snap… and Print graph…), listed under Libraries ▸ Charts. Built in; version 1.0.

| Part | Content |
|---|---|
| Header | Navy (`#131d29`). The NBE logo (`NBE_logo.svg`, the same file as the graph report's) on the left; on the right `LINK ANALYSIS · CHART SNAP`, the source (`Source: <graph window> · <scope> scope`) and the snap (`<chart window> · <n> charts · <date and time>`). |
| Body | White. The charts as framed cells (the chart's level, title and tone, the chart redrawn for a white page with its colours, zoom and selection pins). Group and Print: two across, six a page (cells 368 × 262 CSS px); Individual: one per page at full width (750 × 456). A `CONFIDENTIAL` watermark across it, bottom-left to top-right. |
| Footer | Navy. `CONFIDENTIAL · For authorised investigation use only`; `Page n / N` on the right when there are several. |

Every picture is an A4 portrait page: 794 × 1123 CSS px drawn at 3× (2382 × 3369 pixels, about 290 dpi). More charts than a page holds continue on further pages, a PNG file each (`…_p1of3`).

Files:

- `NBE_Linkx_Image_thumbnail.png`: the analyst's preview of the template (1016 × 1444). The app ships a reduced copy (`src/features/chart/lib/nbe_chart_snap_thumbnail.png`, 508 × 722, about 23 KB).
- `NBE_logo.svg`: the logo.

The graph and evidence reports carry the same `CONFIDENTIAL` watermark on every page (analyst decision 2026-11-18).

The Graph window's snap is one A4 page (landscape by default, or portrait): the view as drawn, fitted whole in the body with a thin border, headed `LINK ANALYSIS · GRAPH SNAP` with the window and the nodes and links drawn; a node's actor profile card can be drawn into it beside the node.
