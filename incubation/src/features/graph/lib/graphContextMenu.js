// Production right-click menu (graphs_basic.html GB:2096 "oncontext"), item
// for item and in the same order. Items whose feature has not been ported
// yet are listed but unavailable, with the slice that brings them, so the
// menu already shows everything production offers.
//
// contextMenuItems({ kind, nodeId, selection, ... }) -> { header?, items }
//   kind: 'canvas' | 'node' | 'edge'
//   items: [{ action, label, enabled, pending? }]  (pending: why not yet)
//          or groups { group, label, items: [...], enabled, pending? }
//          shown as submenus (see CANVAS_GROUPS).

const PENDING = {
  analysis: 'Coming with the analysis tools.',
  review: 'Coming with alerts, pinned evidence and saved views.',
  editing: 'Coming with graph editing.',
};

// Which slice brings each action (docs/graph-chart-plan.md §4).
const ACTION_PHASE = {
  paste: 'editing',
  add_node: 'editing',
  add_label: 'editing',
  add_comment_box: 'editing',
  add_text_block: 'editing',
  add_event_frame: 'editing',
  add_theme_line: 'editing',
  add_ole_object: 'editing',
  copy: 'editing',
  delete: 'editing',
  ungroup: 'editing',
  unlink: 'editing',
  unlinks: 'editing',
  link: 'editing',
  group: 'editing',
  merge_nodes: 'editing',
  bring_to_front: 'editing',
  toggle_edge_bundling: 'editing',
  configure_edge_bundling: 'editing',
  visual_degree: 'analysis',
  visual_property: 'analysis',
  filter_elements: 'analysis',
  path_finder: 'analysis',
  find_all_paths: 'analysis',
  link_traversal: 'analysis',
  cut_points: 'analysis',
  clear_path: 'analysis',
  apply_community_detection: 'analysis',
  save_view: 'review',
  load_view: 'review',
  toggle_alert_rules: 'review',
  configure_alert_rules: 'review',
  run_alert_scan: 'review',
  show_pinned_evidence: 'review',
  clear_pinned_evidence: 'review',
  pin_evidence: 'review',
  unpin_evidence: 'review',
};

// Actions this build can run. Grows slice by slice.
export const AVAILABLE_ACTIONS = new Set([
  'expand_neighborhood', 'collapse_neighborhood',
  // G2.3 analysis tools
  'path_finder', 'find_all_paths', 'link_traversal', 'cut_points', 'clear_path',
  'apply_community_detection', 'visual_degree', 'visual_property', 'filter_elements', 'reset_node_styles',
  // G2.4 alerts
  'toggle_alert_rules', 'configure_alert_rules', 'run_alert_scan',
  // G2.4 pinned evidence
  'pin_evidence', 'unpin_evidence', 'show_pinned_evidence', 'clear_pinned_evidence',
  // G2.4 saved views
  'save_view', 'load_view', 'remove_saved_views',
  // G3.1 graph editing
  'add_node', 'delete', 'link', 'unlink', 'unlinks', 'copy', 'paste', 'bring_to_front',
  // G3.3 annotations
  'add_label', 'add_comment_box', 'add_text_block', 'add_event_frame', 'add_theme_line', 'add_ole_object',
  // G3.4 group / merge
  'group', 'ungroup', 'merge_nodes',
  // G3.5 edge bundling
  'toggle_edge_bundling', 'configure_edge_bundling',
  // G3.6 selection tools (after i2 Analyst's Notebook; not in production)
  'select_all', 'invert_selection', 'select_by_type', 'select_by_property', 'select_link_ends', 'show_hidden',
  'select_linked', 'select_same_type', 'hide_selected',
  // Link aggregation (G3.5 i2 #2).
  'expand_links', 'collapse_links',
  // Network measures (G3.5 i2 #3).
  'measure_betweenness', 'measure_closeness', 'measure_eigenvector',
  // Conditional formatting (G3.5 i2 #4).
  'conditional_formatting',
  // Table window (G3.5 i2 #5).
  // The graph's companion windows (twins: wherever one is offered, so is the
  // other; analyst decision 2026-11-18).
  'show_in_table', 'show_in_chart',
  // Another Table / Chart window beside those open (analyst decision
  // 2026-11-19), within the window limit.
  'new_table', 'new_chart',
]);

// hint: why a disabled item is disabled (its tooltip).
const item = (action, label, { disabled = false, hint = '' } = {}) => {
  const ported = AVAILABLE_ACTIONS.has(action);
  return {
    action,
    label,
    enabled: ported && !disabled,
    ...(ported ? {} : { pending: PENDING[ACTION_PHASE[action]] || PENDING.analysis }),
    ...(ported && disabled && hint ? { hint } : {}),
  };
};

// Production edge information block (edge right-click).
// aggregate (link aggregation): { count, total, totalKey, forward, backward,
// mode, expanded } of the pair the link belongs to.
export const edgeMenuHeader = (edge = {}, { isCdr = false, aggregate = null } = {}) => ({
  title: aggregate && !aggregate.expanded ? `Aggregated Links (${aggregate.count})` : 'Edge Information',
  rows: [
    ...(aggregate && !aggregate.expanded ? [
      ['Links', String(aggregate.count)],
      ...(aggregate.mode === 'combined' ? [['Directions', `${aggregate.forward} → · ${aggregate.backward} ←`]] : []),
      ...(aggregate.totalKey ? [[`Total ${aggregate.totalKey}`, aggregate.total === null ? 'N/A' : aggregate.totalText]] : []),
    ] : []),
    ['Semantic', edge.edge_semantic || 'N/A'],
    [isCdr ? 'Call Session Flow' : 'Financial Flow', edge.financial_flow ? 'Yes' : 'No'],
    ['Directed Display', edge.directed_display ? 'Yes' : 'No'],
    ...(edge.reason ? [['Reason', String(edge.reason)]] : []),
  ],
});

// Nested grouping (analyst decision 2026-11-14: production's flat list
// needed a scrollbar). Items keep production's order inside each group;
// `null` groups stay at the top level.
const CANVAS_GROUPS = [
  [null, ['paste']],
  ['Add', ['add_node', 'add_label', 'add_comment_box', 'add_text_block', 'add_event_frame', 'add_theme_line', 'add_ole_object']],
  ['Select', ['select_all', 'invert_selection', 'select_by_type', 'select_by_property', 'select_link_ends', 'show_hidden']],
  ['Analyze', ['visual_degree', 'measure_betweenness', 'measure_closeness', 'measure_eigenvector', 'conditional_formatting', 'visual_property', 'filter_elements', 'apply_community_detection', 'link_traversal', 'cut_points', 'reset_node_styles']],
  // Not analysis: other views of this graph, named as the toolbar's Open as
  // table / Open as chart (analyst decision 2026-11-18).
  ['Open as', ['show_in_table', 'show_in_chart', 'new_table', 'new_chart']],
  [null, ['clear_path']],
  ['Views', ['save_view', 'load_view', 'remove_saved_views']],
  ['Edge Bundling', ['toggle_edge_bundling', 'configure_edge_bundling']],
  ['Alert Rules', ['toggle_alert_rules', 'configure_alert_rules', 'run_alert_scan']],
  ['Pinned Evidence', ['show_pinned_evidence', 'clear_pinned_evidence']],
];
const NODE_GROUPS = [
  [null, ['expand_neighborhood', 'collapse_neighborhood']],
  ['Select', ['select_linked', 'select_same_type', 'hide_selected']],
  ['Edit', ['copy', 'delete', 'ungroup', 'unlink', 'bring_to_front']],
  ['Evidence', ['pin_evidence', 'unpin_evidence']],
  ['Analyze', ['link_traversal', 'cut_points']],
  [null, ['clear_path']],
];
const SELECTION_GROUPS = [
  ['Select', ['select_linked', 'select_same_type', 'hide_selected']],
  ['Edit', ['copy', 'link', 'unlinks', 'group', 'merge_nodes', 'add_theme_line']],
  ['Paths', ['path_finder', 'find_all_paths']],
  ['Evidence', ['pin_evidence', 'unpin_evidence']],
  ['Analyze', ['link_traversal', 'cut_points']],
  [null, ['clear_path']],
];

// -> [item | { group, label, items, enabled, pending? }]
const groupItems = (items, layout) => {
  const byAction = new Map(items.map((entry) => [entry.action, entry]));
  const result = [];
  layout.forEach(([label, actions]) => {
    const members = actions.map((action) => byAction.get(action)).filter(Boolean);
    actions.forEach((action) => byAction.delete(action));
    if (!members.length) return;
    if (!label) {
      result.push(...members);
      return;
    }
    const enabled = members.some((entry) => entry.enabled);
    result.push({
      group: label.toLowerCase().replace(/\s+/g, '_'),
      label,
      items: members,
      enabled,
      ...(enabled ? {} : { pending: members.find((entry) => entry.pending)?.pending || '' }),
    });
  });
  byAction.forEach((entry) => result.push(entry)); // anything not laid out
  return result;
};

// Every leaf item, groups flattened (order kept).
export const flattenMenuItems = (items) => items.flatMap((entry) => (entry.items ? entry.items : [entry]));

export const contextMenuItems = ({
  kind,
  nodeId = null,
  selection = [],
  edge = null,
  isCdr = false,
  hasClipboard = false,
  savedViewCount = 0,
  edgeBundling = false,
  alertRules = false,
  nodeHasEdges = false,
  selectionFullyLinked = false,
  pathHighlighted = false,
  nodeStylesChanged = false,
  // Pinned evidence: how many are pinned on the device, and whether the
  // targets (node or selection) include unpinned / pinned items.
  pinnedCount = 0,
  canPin = true,
  canUnpin = true,
  // Selection tools: whether links are selected, how many nodes this
  // window has hidden in the current view, whether anything is drawn.
  edgeSelectionCount = 0,
  hiddenCount = 0,
  drawnCount = 0,
  // Link aggregation: the right-clicked link's pair (see edgeMenuHeader).
  aggregate = null,
  // Open as: whether this graph has a Table / Chart window, and the window
  // limit's text when no more Graph / Chart / Table windows may open.
  tableOpen = false,
  chartOpen = false,
  windowLimit = '',
} = {}) => {
  if (kind === 'edge') {
    // Link aggregation: a merged pair expands; a link of an expanded pair
    // collapses it again.
    const linkItems = aggregate
      ? [aggregate.expanded ? item('collapse_links', 'Collapse Links') : item('expand_links', `Expand Links (${aggregate.count})`)]
      : [];
    return { header: edgeMenuHeader(edge || {}, { isCdr, aggregate }), items: linkItems };
  }

  const items = [];
  if (kind === 'canvas') {
    if (hasClipboard) items.push(item('paste', 'Paste'));
    items.push(
      item('add_node', 'Add Node'),
      item('add_label', 'Label'),
      item('add_comment_box', 'Comment Box'),
      item('add_text_block', 'Text Block'),
      item('add_event_frame', 'Event Frame'),
      item('add_theme_line', 'Theme Line', { disabled: selection.length < 2 }),
      item('add_ole_object', 'OLE Object'),
      item('select_all', 'Select All', { disabled: drawnCount === 0 }),
      item('invert_selection', 'Invert Selection', { disabled: drawnCount === 0 }),
      item('select_by_type', 'Select by Type…', { disabled: drawnCount === 0 }),
      item('select_by_property', 'Select by Property…', { disabled: drawnCount === 0 }),
      item('select_link_ends', 'Select Link Ends', { disabled: edgeSelectionCount === 0 }),
      item('show_hidden', hiddenCount ? `Show Hidden Nodes (${hiddenCount})` : 'Show Hidden Nodes', { disabled: hiddenCount === 0 }),
      item('visual_degree', 'Visualize by Degree'),
      // Network measures (G3.5 i2 #3; not in production).
      item('measure_betweenness', 'Visualize by Betweenness', { disabled: drawnCount < 3 }),
      item('measure_closeness', 'Visualize by Closeness', { disabled: drawnCount < 2 }),
      item('measure_eigenvector', 'Visualize by Eigenvector', { disabled: drawnCount < 2 }),
      item('conditional_formatting', 'Conditional Formatting…'),
      // The Table and Chart windows (G3.5 i2 #5, G5; not in production).
      // Table / Chart: this graph's window (a new one when there is none);
      // New Table / New Chart: another, always new (analyst decision
      // 2026-11-19). A new window only within the limit.
      item('show_in_table', 'Table', { disabled: drawnCount === 0 || (!tableOpen && Boolean(windowLimit)), hint: windowLimit }),
      item('show_in_chart', 'Chart', { disabled: drawnCount === 0 || (!chartOpen && Boolean(windowLimit)), hint: windowLimit }),
      item('new_table', 'New Table', { disabled: drawnCount === 0 || Boolean(windowLimit), hint: windowLimit }),
      item('new_chart', 'New Chart', { disabled: drawnCount === 0 || Boolean(windowLimit), hint: windowLimit }),
      item('visual_property', 'Visualize by Property'),
      item('filter_elements', 'Filter Elements'),
      item('save_view', 'Save View'),
    );
    if (savedViewCount > 0) {
      items.push(item('load_view', 'Load View'));
      // Production offered removal inside Load View's list.
      items.push(item('remove_saved_views', 'Remove Saved Views'));
    }
    items.push(
      item('toggle_edge_bundling', `${edgeBundling ? 'Disable' : 'Enable'} Edge Bundling`),
      item('configure_edge_bundling', 'Configure Edge Bundling'),
      item('toggle_alert_rules', `${alertRules ? 'Disable' : 'Enable'} Alert Rules`),
      item('configure_alert_rules', 'Configure Alert Rules'),
      // Nothing to scan while the rules are off (production ran an empty scan).
      item('run_alert_scan', 'Run Alert Scan', { disabled: !alertRules }),
      item('show_pinned_evidence', 'Show Pinned Evidence', { disabled: pinnedCount === 0 }),
      item('clear_pinned_evidence', 'Clear Pinned Evidence', { disabled: pinnedCount === 0 }),
      item('apply_community_detection', 'Detect Communities'),
      item('link_traversal', 'Link Traversal (5 degrees)', { disabled: selection.length === 0 }),
      item('cut_points', 'Cut Points'),
    );
    // Not in production (it had undo): restores what the visual tools changed.
    if (nodeStylesChanged) items.push(item('reset_node_styles', 'Reset Node Styles'));
    if (pathHighlighted) items.push(item('clear_path', 'Clear Path Highlight'));
    return { items: groupItems(items, CANVAS_GROUPS) };
  }

  // Node: the right-clicked node is part of `selection` (GraphCanvas selects it).
  items.push(
    item('select_linked', 'Select Linked'),
    item('select_same_type', 'Select Same Type'),
    item('hide_selected', selection.length > 1 ? 'Hide Selected Nodes' : 'Hide Node'),
  );
  if (selection.length <= 1) {
    items.push(item('copy', 'Copy'), item('delete', 'Delete Node'));
    if (String(nodeId ?? selection[0]).startsWith('Group')) items.push(item('ungroup', 'Ungroup'));
    if (nodeHasEdges) items.push(item('unlink', 'Unlink Node'));
    items.push(
      item('expand_neighborhood', 'Expand Neighborhood'),
      item('collapse_neighborhood', 'Collapse Neighborhood'),
      item('bring_to_front', 'Bring to Front'),
      item('pin_evidence', 'Pin Evidence', { disabled: !canPin }),
      item('unpin_evidence', 'Unpin Evidence', { disabled: !canUnpin }),
    );
  } else {
    items.push(
      item('copy', 'Copy Nodes/Edges'),
      selectionFullyLinked ? item('unlinks', 'Unlink Nodes') : item('link', 'Link Nodes'),
      item('group', 'Group Nodes'),
      item('merge_nodes', 'Merge Nodes'),
      item('add_theme_line', 'Theme Line'),
    );
    if (selection.length === 2) items.push(item('path_finder', 'Find Shortest Path'));
    items.push(
      item('find_all_paths', 'Find All Paths', { disabled: selection.length !== 2 }),
      item('pin_evidence', 'Pin Evidence', { disabled: !canPin }),
      item('unpin_evidence', 'Unpin Evidence', { disabled: !canUnpin }),
    );
  }
  items.push(item('link_traversal', 'Link Traversal (5 degrees)'), item('cut_points', 'Cut Points'));
  if (pathHighlighted) items.push(item('clear_path', 'Clear Path Highlight'));
  return { items: groupItems(items, selection.length <= 1 ? NODE_GROUPS : SELECTION_GROUPS) };
};

// Production areAllSelectedNodesLinked: every pair of the selection has an
// edge (either direction).
export const allPairsLinked = (graph, ids) => {
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      if (!graph.hasNode(ids[i]) || !graph.hasNode(ids[j])) return false;
      if (!graph.areNeighbors(ids[i], ids[j])) return false;
    }
  }
  return ids.length > 1;
};
