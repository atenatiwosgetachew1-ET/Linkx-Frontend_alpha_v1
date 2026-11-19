// Graph files (G4.1; production graphs_adjuster.js exportGraph ~7014,
// loadGraphFromFile ~7080, captureGraphSnapshot ~7160, printGraph ~7186).
//
// Export JSON keeps production's shape, { graphData: { type: 'Graph', nodes,
// edges }, networkOptions }, so production reads our files and we read
// theirs. As production (nodesData.get()), what is drawn is exported; each
// node also carries its drawn position (x, y) and the file a `linkx` block
// (format version, the window's settings), which production ignores. An
// import puts the positions back when every node has one.
//
// Import reads production's JSON (that shape, or plain { nodes, edges }).
// HTML files are neither made nor read (analyst decision 2026-11-17: a
// format built to carry a script is not taken in; production's HTML export
// also pulled an unpinned vis-network from a CDN). A file is untrusted
// input: it is bounded and cleaned before it reaches the graph (sanitizeItem).
// An encrypted, server-checked LinkX format is backend request B-25.

export const GRAPH_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const GRAPH_FILE_ACCEPT = '.json,application/json';
export const GRAPH_FILE_LIMITS = Object.freeze({
  nodes: 100000,
  edges: 300000,
  idLength: 512,
  keyLength: 120,
  keysPerItem: 300,
  stringLength: 2 * 1024 * 1024, // an uploaded icon is a data URL
  depth: 8,
  coordinate: 1e7,
});

const stamp = () => Date.now();
export const exportFileName = (ext) => `LinkxGraph_export_${stamp()}.${ext}`;
export const snapshotFileName = () => `LinkxGraph_snapshot_${stamp()}.png`;

// Drawing state never written to a file.
const DROP = new Set(['__customized']);
const cleanAttributes = (attributes) => Object.fromEntries(Object.entries(attributes).filter(([key]) => !DROP.has(key)));

// store + the drawn view -> production's export object.
export const buildGraphExport = (store, view, settings = null) => {
  const graph = store.graph();
  const drawn = view.nodeIds.filter((id) => graph.hasNode(id));
  const nodes = drawn.map((id) => {
    const position = store.getPosition(id);
    return {
      ...cleanAttributes(graph.getNodeAttributes(id)),
      id,
      ...(position ? { x: Math.round(position.x * 100) / 100, y: Math.round(position.y * 100) / 100 } : {}),
    };
  });
  const edges = view.edgeIds.filter((key) => graph.hasEdge(key)).map((key) => ({
    ...cleanAttributes(graph.getEdgeAttributes(key)),
    from: graph.source(key),
    to: graph.target(key),
  }));
  return {
    graphData: { type: 'Graph', nodes, edges },
    networkOptions: {},
    linkx: { format: 1, exportedAt: new Date().toISOString(), ...(settings ? { settings } : {}) },
  };
};

// Production's messages where it had them, so analysts see the same reasons.
export class GraphFileError extends Error {}

// Keys never taken from a file: prototype pollution, and our drawing state
// (`__edits`, the link Customize edits, is kept: our own files carry it).
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const keepKey = (key, depth) => key.length <= GRAPH_FILE_LIMITS.keyLength
  && !FORBIDDEN_KEYS.has(key)
  && (depth > 0 || !key.startsWith('__') || key === '__edits');

// A file value, bounded: plain data only (no prototype keys), strings cut
// to length, nesting cut at the depth limit (group nodes nest their members).
const cleanValue = (value, depth) => {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.length > GRAPH_FILE_LIMITS.stringLength ? value.slice(0, GRAPH_FILE_LIMITS.stringLength) : value;
  if (depth >= GRAPH_FILE_LIMITS.depth || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) return value.map((entry) => cleanValue(entry, depth + 1)).filter((entry) => entry !== undefined);
  const out = {};
  Object.keys(value).slice(0, GRAPH_FILE_LIMITS.keysPerItem).forEach((key) => {
    if (!keepKey(key, depth)) return;
    const cleaned = cleanValue(value[key], depth + 1);
    if (cleaned !== undefined) out[key] = cleaned;
  });
  return out;
};

const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
const cleanId = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= GRAPH_FILE_LIMITS.idLength ? trimmed : null;
};

// One node or link from a file -> its cleaned attributes.
export const sanitizeItem = (item) => cleanValue(item, 0);

const fromParsed = (parsed) => {
  if (parsed?.graphData && Array.isArray(parsed.graphData.nodes) && Array.isArray(parsed.graphData.edges)) return parsed.graphData;
  if (Array.isArray(parsed?.nodes) && Array.isArray(parsed?.edges)) return parsed;
  throw new GraphFileError('This JSON file does not contain a valid graph.');
};

// (file name, its text) -> { nodes, edges, positions: [[id, {x, y}]] | null }
export const parseGraphFile = (name, text) => {
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (ext !== 'json') throw new GraphFileError('Unsupported file type. Only .json graph files are allowed.');
  const content = String(text || '').replace(/^\uFEFF/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new GraphFileError('This JSON file could not be read; it may be corrupted.');
  }
  const data = fromParsed(parsed);
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new GraphFileError('Graph data must contain nodes and edges arrays.');
  if (data.nodes.length > GRAPH_FILE_LIMITS.nodes) throw new GraphFileError(`This file has more than ${GRAPH_FILE_LIMITS.nodes.toLocaleString()} nodes.`);
  if (data.edges.length > GRAPH_FILE_LIMITS.edges) throw new GraphFileError(`This file has more than ${GRAPH_FILE_LIMITS.edges.toLocaleString()} links.`);
  // Plain objects with a usable id (the first of a repeated id wins).
  const seen = new Set();
  const nodes = [];
  data.nodes.forEach((raw) => {
    if (!isPlainObject(raw)) return;
    const id = cleanId(raw.id);
    if (id === null || seen.has(id)) return;
    seen.add(id);
    nodes.push({ ...sanitizeItem(raw), id });
  });
  const edges = [];
  data.edges.forEach((raw) => {
    if (!isPlainObject(raw)) return;
    const from = cleanId(raw.from);
    const to = cleanId(raw.to);
    if (from === null || to === null) return;
    const id = raw.id == null ? null : cleanId(raw.id);
    edges.push({ ...sanitizeItem(raw), from, to, ...(id === null ? {} : { id }) });
  });
  if (!nodes.length) throw new GraphFileError('This file has no nodes.');
  const coordinate = (value) => {
    const number = Number(value);
    return value !== '' && value !== null && Number.isFinite(number) && Math.abs(number) <= GRAPH_FILE_LIMITS.coordinate ? number : null;
  };
  const placed = nodes.every((node) => coordinate(node.x) !== null && coordinate(node.y) !== null);
  const positions = placed ? nodes.map((node) => [node.id, { x: coordinate(node.x), y: coordinate(node.y) }]) : null;
  return { nodes, edges, positions };
};

// A file's text (FileReader where Blob.text is missing).
export const readFileText = (file) => (typeof file?.text === 'function'
  ? file.text()
  : new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Error reading file.'));
    reader.readAsText(file);
  }));

// A download (shows in the browser's downloads).
export const downloadBlob = (name, blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const downloadDataUrl = (name, dataUrl) => {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
};

// Production printGraph: the image alone is printed (everything else hidden
// for print), then removed after printing (or after two minutes).
// Prints a picture (or several, one after another: the Chart window's
// cards) alone, then removes it. For print the page grows with them (the
// app's body is one screen that never scrolls: only a first page came out).
// { pages: true }: the pictures are whole A4 pages (chart snaps): printed one
// to a sheet, edge to edge (no page margins; analyst report 2026-11-18: in the
// margins a page was taller than the sheet and its footer went over to a new
// one).
// orientation: the pages' ('portrait' | 'landscape').
export const printImage = (dataUrls, { pages = false, orientation = 'portrait' } = {}) => {
  document.getElementById('linkx-print-image')?.remove();
  document.getElementById('linkx-print-style')?.remove();
  const list = (Array.isArray(dataUrls) ? dataUrls : [dataUrls]).filter(Boolean);
  const holder = document.createElement('div');
  holder.id = 'linkx-print-image';
  list.forEach((url, index) => {
    const image = document.createElement('img');
    image.alt = list.length > 1 ? `Chart ${index + 1}` : 'Graph';
    image.src = url;
    holder.appendChild(image);
  });
  const style = document.createElement('style');
  style.id = 'linkx-print-style';
  style.textContent = `
    #linkx-print-image { display: none; }
    @media print {
      html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; position: static !important; filter: none !important; background: #fff !important; }
      body > *:not(#linkx-print-image) { display: none !important; }
      #linkx-print-image { display: block !important; }
      #linkx-print-image img { display: block; max-width: 100%; height: auto; margin: 0 auto 12mm; break-inside: avoid; }
    }${pages ? `
    @page { size: A4 ${orientation === 'landscape' ? 'landscape' : 'portrait'}; margin: 0; }
    @media print {
      html, body { margin: 0 !important; padding: 0 !important; }
      #linkx-print-image img { ${orientation === 'landscape' ? 'width: 297mm; height: 209.8mm;' : 'width: 210mm; height: 296.8mm;'} max-width: none; margin: 0; object-fit: contain; break-inside: avoid; }
      #linkx-print-image img:not(:last-child) { break-after: page; }
    }` : ''}`;
  document.body.appendChild(holder);
  document.head.appendChild(style);
  const cleanup = () => {
    holder.remove();
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 120000);
  setTimeout(() => window.print(), 100);
};
