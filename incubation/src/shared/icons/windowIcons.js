// Icons shared by the launcher, the dock, the home page and the windows'
// toolbars (24 x 24, stroked), so a window type looks the same everywhere.
// Each is one path string (several sub-paths) or a list of them.

// Chart window: a pie with a slice drawn out (analyst decision 2026-11-18:
// the bars it had looked like the Graph window's timeline).
export const CHART_ICON = 'M11 5a8 8 0 1 0 8 8h-8zM13.5 2.5v8h8a8 8 0 0 0-8-8z';
// Table window: a grid.
export const TABLE_ICON = 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14';
// Graph timeline: date bars with a clock (analyst decision 2026-11-18).
export const TIMELINE_ICON = ['M3 20h10', 'M5 20v-4', 'M8.5 20v-8', 'M12 20v-5', 'M17.5 10.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10z', 'M17.5 13v2.6l1.6 1.1'];

// Toolbar actions of the Table and Chart windows.
export const TOOL_ICONS = Object.freeze({
  // Show graph: nodes and links.
  showGraph: ['M7 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', 'M17 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', 'M7 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', 'm9.2 16.3 5.6-7.6', 'M7 8.5v7'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'm20 20-3.5-3.5'],
  columns: ['M4 5h16v14H4z', 'M9.5 5v14', 'M14.5 5v14'],
  follow: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M12 3v3', 'M12 18v3', 'M3 12h3', 'M18 12h3'],
  plus: ['M12 5v14', 'M5 12h14'],
  snap: ['M4 8h3l2-3h6l2 3h3v11H4z', 'M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z'],
  print: ['M7 9V3h10v6', 'M7 17H4v-7h16v7h-3', 'M7 14h10v7H7z'],
  reset: ['M3 4v6h6', 'M5.5 15a8 8 0 1 0 1.9-8.3L3 10'],
  // Refresh: two arrows round (re-read the linked graph).
  refresh: ['M20 11a8 8 0 0 0-14.6-4.5L4 8', 'M4 3v5h5', 'M4 13a8 8 0 0 0 14.6 4.5L20 16', 'M20 21v-5h-5'],
  // Generation: a wand (charts made by themselves, or by hand).
  generation: ['m4 20 11-11', 'm13 7 4 4', 'M17 3v3', 'M15.5 4.5h3', 'M20 9v2', 'M19 10h2'],
  // Scope: layers (what is drawn, selected, or all).
  scope: ['m12 3 9 5-9 5-9-5 9-5Z', 'm3 13 9 5 9-5'],
  // Colours: a palette.
  colours: ['M12 3a9 9 0 1 0 0 18c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4-4-7.2-9-7.2Z', 'M7.5 11h.01', 'M10.5 7h.01', 'M15.5 7.5h.01'],
  // Chart cards: full screen, return, close.
  expand: ['M15 4h5v5', 'M9 20H4v-5', 'm20 4-6 6', 'm4 20 6-6'],
  collapse: ['M4 14h6v6', 'M20 10h-6V4', 'm14 10 6-6', 'm4 20 6-6'],
  close: ['m6 6 12 12', 'M18 6 6 18'],
  // Export (as the Graph window's).
  export: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4'],
});
