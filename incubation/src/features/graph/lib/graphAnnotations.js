// Annotations (G3.3), ported from production graphs_adjuster.js GA:938-987
// (OLE icon and theme), GA:2497-2620 (font, event frame, attachments),
// GA:3000-3250 (createAnnotationNode and the Add handlers) and
// graphs_basic.html GB:1113-1200 (their adjust boxes), GB:1900-2090
// (date, event types, attachment preview).

// The Add prompts (production requestUserInput title / message / default).
export const ANNOTATION_PROMPTS = {
  add_label: { title: 'Add Label', label: 'Label text', value: 'Label' },
  add_comment_box: { title: 'Add Comment Box', label: 'Comment', value: 'New comment' },
  add_text_block: { title: 'Add Text Block', label: 'Text block', value: 'Analyst note' },
  add_event_frame: { title: 'Add Event Frame', label: 'Event frame title', value: 'Event Frame' },
  add_ole_object: { title: 'Add OLE Object', label: 'OLE object title', value: 'External Object' },
};
export const ANNOTATION_ACTIONS = new Set(Object.keys(ANNOTATION_PROMPTS));

export const FONT_FACES = ['Georgia', 'Times New Roman', 'Arial', 'Verdana', 'Courier New', 'Tahoma'];
export const EVENT_TYPES = [
  { value: 'meeting', label: 'Meeting' },
  { value: 'calling', label: 'Calling' },
  { value: 'email', label: 'Email' },
  { value: 'payment', label: 'Payment' },
  { value: 'travel', label: 'Travel' },
  { value: 'surveillance', label: 'Surveillance' },
];

/* ── OLE object icon (GA:942 getDocumentOneIconDataUri) ─────────────── */

const DOCUMENT_PATH = 'M19.5 3h0.5l6 7v18.009c0 1.093-0.894 1.991-1.997 1.991h-15.005c-1.107 0-1.997-0.899-1.997-2.007v-22.985c0-1.109 0.897-2.007 2.003-2.007h10.497zM19 4h-10.004c-0.55 0-0.996 0.455-0.996 0.995v23.009c0 0.55 0.455 0.995 1 0.995h15c0.552 0 1-0.445 1-0.993v-17.007h-4.002c-1.103 0-1.998-0.887-1.998-2.006v-4.994zM20 4.5v4.491c0 0.557 0.451 1.009 0.997 1.009h3.703l-4.7-5.5z';
export const documentIconDataUri = (fill = '#4f6c86') => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="${fill}" d="${DOCUMENT_PATH}"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

// GA:949 getOleObjectThemeDefaults
export const oleThemeDefaults = (dark) => (dark
  ? { iconFill: '#d5e1ec', fontColor: '#a9bdd1', shadowColor: 'rgba(111, 139, 164, 0.34)', accentColor: '#8ca9c4' }
  : { iconFill: '#4f6c86', fontColor: '#2f4a63', shadowColor: 'rgba(79, 108, 134, 0.24)', accentColor: '#4f6c86' });

/* ── New annotation nodes (GA:3000 createAnnotationNode + handlers) ──── */

// Attributes of a new annotation; `text` is what the analyst typed, `dark`
// the theme when it was made (production picked colours then).
export const annotationNode = (action, text, { dark = false } = {}) => {
  const label = String(text);
  const build = ({ shape = 'box', image = '', color = { background: '#fffdf2', border: '#8b7d4f' }, font = { color: '#333333', size: 14 }, extra = {} }) => ({
    label,
    shape,
    ...(shape === 'image' ? { image } : {}),
    color,
    font,
    borderWidth: extra.borderWidth ?? (shape === 'image' ? 0 : 1.2),
    borderWidthSelected: extra.borderWidthSelected ?? (shape === 'image' ? 0 : 2),
    margin: extra.margin ?? 8,
    annotationType: extra.annotationType || 'generic',
    note: extra.note || '',
    ...extra,
  });
  if (action === 'add_label') {
    return build({ shape: 'text', font: { color: dark ? '#8fa4bd' : '#1f2d3d', size: 18, face: 'Georgia' }, extra: { annotationType: 'label' } });
  }
  if (action === 'add_comment_box') {
    return build({
      color: dark
        ? { background: 'rgba(34, 47, 60, 0.42)', border: 'rgba(137, 157, 178, 0.42)', hover: { background: 'rgba(46, 62, 78, 0.54)', border: 'rgba(154, 178, 201, 0.50)' }, highlight: { background: 'rgba(50, 67, 84, 0.58)', border: 'rgba(168, 191, 213, 0.56)' } }
        : { background: '#fff9e6', border: '#b8860b' },
      font: { color: dark ? '#c4d1dd' : '#4d3b00', size: 14 },
      extra: { annotationType: 'comment_box', note: label },
    });
  }
  if (action === 'add_text_block') {
    return build({
      color: dark
        ? { background: 'rgba(30, 42, 55, 0.40)', border: 'rgba(126, 151, 175, 0.40)', hover: { background: 'rgba(41, 57, 73, 0.52)', border: 'rgba(146, 172, 197, 0.48)' }, highlight: { background: 'rgba(44, 62, 79, 0.56)', border: 'rgba(162, 188, 212, 0.54)' } }
        : { background: '#f3f7ff', border: '#4a6fa5' },
      font: { color: dark ? '#c8d5e1' : '#1b3558', size: 13 },
      extra: { annotationType: 'text_block', note: label },
    });
  }
  if (action === 'add_event_frame') {
    return build({
      color: dark
        ? { background: 'rgba(24, 35, 46, 0.34)', border: 'rgba(121, 146, 170, 0.46)', hover: { background: 'rgba(33, 48, 62, 0.44)', border: 'rgba(145, 170, 194, 0.52)' }, highlight: { background: 'rgba(37, 53, 68, 0.50)', border: 'rgba(160, 185, 208, 0.58)' } }
        : { background: '#f8f8f8', border: '#555555' },
      font: { color: dark ? '#b8c9da' : '#333333', size: 13 },
      extra: { annotationType: 'event_frame', borderWidth: 2, dashes: [8, 4], eventDateTime: '', eventTypes: [] },
    });
  }
  if (action === 'add_ole_object') {
    // Production passed size / shadow beside createAnnotationNode's options,
    // which ignored them: the node took vis's image defaults.
    const theme = oleThemeDefaults(dark);
    return build({
      shape: 'image',
      image: documentIconDataUri(theme.iconFill),
      font: { color: theme.fontColor, size: 13, face: 'Georgia' },
      extra: {
        annotationType: 'ole_object',
        accentColor: theme.accentColor,
        attachmentLink: '',
        attachmentDataUrl: '',
        attachmentName: '',
        attachmentMime: '',
        attachmentAutoOpen: true,
      },
    });
  }
  return null;
};

// Production's OLE click (GB:2430): an object that lost its icon gets the
// document icon back, at size 34.
export const oleIconRepair = (node = {}, { dark = false } = {}) => (
  node.shape !== 'image' || !node.image
    ? { shape: 'image', image: documentIconDataUri(oleThemeDefaults(dark).iconFill), size: node.size || 34, borderWidth: 0, borderWidthSelected: 0 }
    : null
);

/* ── Theme lines (GA:3192 handleAddThemeLine) ───────────────────────── */

// Left to right, then top to bottom, then by id (numeric aware).
export const themeLineOrder = (ids, positionOf) => [...ids].sort((a, b) => {
  const pa = positionOf(a) || { x: 0, y: 0 };
  const pb = positionOf(b) || { x: 0, y: 0 };
  if (pa.x !== pb.x) return pa.x - pb.x;
  if (pa.y !== pb.y) return pa.y - pb.y;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
});

// The theme line edge (its look is also an edit, so it wins over any
// semantic styling, as production's edge options did).
export const themeLineEdge = () => ({
  label: 'Theme',
  width: 2,
  dashes: [8, 6],
  color: { color: '#6b7280', inherit: false },
  arrows: '',
  smooth: { type: 'curvedCW', roundness: 0.18 },
  physics: false,
  edge_kind: 'theme_line',
  __edits: { width: 2, dashes: [8, 6], color: '#6b7280', arrow: false, curve: 0.18 },
});

/* ── Annotation box values and helpers ──────────────────────────────── */

// GA:2607 shouldKeepNodeLabelVisible: annotations and text nodes always show
// their label, whatever "Show labels" says.
export const keepsLabel = (node) => Boolean(node && (node.annotationType || String(node.shape || '').toLowerCase() === 'text'));

export const annotationTypeOf = (node) => String(node?.annotationType || '').toLowerCase();
// The types with their own adjust box (others use the node box).
export const BOXED_ANNOTATIONS = new Set(['label', 'comment_box', 'text_block', 'event_frame', 'ole_object']);

// GB:1900 toDateTimeLocalValue (local time, minutes).
export const toDateTimeLocalValue = (raw) => {
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
export const fromDateTimeLocalValue = (value) => (value ? new Date(value).toISOString() : '');

// GA:2547 normalizeExternalLink, limited to web and mail links: production
// opened any scheme (javascript: included) in a new tab.
export const normalizeExternalLink = (raw) => {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  let candidate = trimmed;
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
    candidate = trimmed.startsWith('//') ? `https:${trimmed}` : `https://${trimmed.replace(/^\/+/, '')}`;
  }
  try {
    const url = new URL(candidate);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};

// GB:1935 inferAttachmentPreviewKind
export const attachmentPreviewKind = (mime, reference) => {
  const type = String(mime || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  const ref = String(reference || '').toLowerCase().split(/[?#]/)[0];
  const ext = ref.includes('.') ? ref.split('.').pop() : '';
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'avif'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audio';
  if (['mp4', 'webm', 'mov', 'm4v', 'ogv', 'avi', 'mkv'].includes(ext)) return 'video';
  return '';
};

// Only data URLs of a media type are previewed or downloaded from a file.
const SAFE_DATA_URL = /^data:(image|audio|video|application|text)\/[\w.+-]+[;,]/i;

// What the object box previews: { kind, source } or null.
export const attachmentPreview = (node = {}) => {
  const dataUrl = String(node.attachmentDataUrl || '').trim();
  const link = String(node.attachmentLink || '').trim();
  const mime = node.attachmentMime;
  const name = String(node.attachmentName || '').trim();
  let source = '';
  let kind = '';
  if (dataUrl && SAFE_DATA_URL.test(dataUrl)) {
    source = dataUrl;
    kind = attachmentPreviewKind(mime, name || dataUrl);
  } else if (link) {
    source = normalizeExternalLink(link);
    kind = source && !source.startsWith('mailto:') ? attachmentPreviewKind(mime, source) : '';
  }
  return source && kind ? { kind, source } : null;
};

// GA:2540 nodeHasAttachment
export const hasAttachment = (node = {}) => Boolean(String(node.attachmentLink || '').trim() || String(node.attachmentDataUrl || '').trim());

// GA:2555-2595: the file first (downloaded), else the link (new tab).
// -> true when something was opened
export const openAttachment = (node = {}, { file = true, link = true } = {}) => {
  const open = (href, download) => {
    const anchor = document.createElement('a');
    anchor.href = href;
    if (download) anchor.download = download;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  };
  const dataUrl = String(node.attachmentDataUrl || '').trim();
  if (file && dataUrl && SAFE_DATA_URL.test(dataUrl)) return open(dataUrl, String(node.attachmentName || 'attachment'));
  const href = link ? normalizeExternalLink(node.attachmentLink) : '';
  return href ? open(href) : false;
};

// Which box an annotation opens, and its fields (GB:2400-2447).
export const annotationBoxKind = (node) => ({
  label: 'label', comment_box: 'note', text_block: 'note', event_frame: 'event', ole_object: 'object',
}[annotationTypeOf(node)] || null);

export const annotationBoxValues = (node = {}) => {
  const kind = annotationBoxKind(node);
  const label = node.label == null ? '' : String(node.label);
  if (kind === 'label') {
    const color = String(node.font?.color || '');
    return { label, face: node.font?.face || 'Georgia', size: Number(node.font?.size) || 18, color: /^#[0-9a-f]{6}$/i.test(color) ? color : '#1f2d3d' };
  }
  if (kind === 'note') return { title: annotationTypeOf(node) === 'comment_box' ? 'Comment Box' : 'Analyst Note', label, note: node.note == null ? '' : String(node.note) };
  if (kind === 'event') return { label, datetime: toDateTimeLocalValue(node.eventDateTime), types: Array.isArray(node.eventTypes) ? node.eventTypes.map(String) : [] };
  if (kind === 'object') {
    return { label, link: String(node.attachmentLink || ''), name: String(node.attachmentName || ''), preview: attachmentPreview(node) };
  }
  return null;
};
