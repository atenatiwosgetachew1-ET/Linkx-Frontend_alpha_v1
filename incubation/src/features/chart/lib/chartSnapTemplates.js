import thumbnail from './nbe_chart_snap_thumbnail.png';

// Image templates (analyst decision 2026-11-18): the frame chart snaps are
// drawn in, listed in Libraries ▸ Report templates with the report layouts. One
// built-in default: a navy header (the NBE logo left; "LINK ANALYSIS ·
// CHART SNAP" and the snap's source right), a white body with the charts
// under a CONFIDENTIAL watermark, a navy footer with the distribution
// marking. The thumbnail is the analyst's preview of it
// (docs/image-templates/default/NBE_Linkx_Image_thumbnail.png, reduced).
export const IMAGE_TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'nbe-linkx-chart-snap',
    name: 'NBE LinkX Chart Snap',
    kind: 'Chart snap',
    version: '1.0',
    builtIn: true,
    isDefault: true,
    thumbnail,
    description: 'The default frame for chart snaps: the NBE header with the snap’s source, the charts on white under a CONFIDENTIAL watermark, and the confidentiality footer.',
    sections: Object.freeze(['Header (NBE logo; LINK ANALYSIS · CHART SNAP; source)', 'Body (the charts; CONFIDENTIAL watermark)', 'Footer (CONFIDENTIAL · For authorised investigation use only)']),
    usedBy: 'Chart window ▸ Export ▸ Take snaps… and Print charts',
  }),
]);

export const defaultImageTemplate = () => IMAGE_TEMPLATES.find((template) => template.isDefault) || IMAGE_TEMPLATES[0];
