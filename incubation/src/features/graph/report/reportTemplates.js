import thumbnail from './nbe_graph_report_thumbnail.png';
import tableThumbnail from '../../table/lib/nbe_table_thumbnail.svg';
import { REPORT_TEMPLATE } from './graphReportModel.js';

// Report templates (analyst decision 2026-11-17): managed from Libraries ▸
// Report templates. One built-in default for now; uploaded or selectable
// templates come later. The thumbnail is the analyst's preview image of the
// template (docs/report-templates/default/NBE_Linkx_Graph_Report_thumbnail.png).
export const REPORT_TEMPLATES = Object.freeze([
  Object.freeze({
    id: REPORT_TEMPLATE.id,
    name: 'NBE LinkX Graph Report',
    kind: 'Graph report',
    version: REPORT_TEMPLATE.version,
    builtIn: true,
    isDefault: true,
    thumbnail,
    description: 'The default graph report: an NBE cover with the case and the flags, then the investigation round the graph.',
    sections: Object.freeze([
      'Cover', 'Summary', 'The graph', 'Subjects of interest', 'Relationships and patterns', 'Measures (charts)',
      'Timeline', 'Alerts and indicators', 'Assessment and next steps', 'Method (Appendix A)', 'Tables (Appendix B on)',
    ]),
    usedBy: 'Graph window ▸ Export ▸ Generate report…; Reports ▸ Download report',
  }),
  // The Table window's print (analyst decision 2026-11-18).
  Object.freeze({
    id: 'nbe-linkx-table',
    name: 'NBE LinkX Table',
    kind: 'Table',
    version: '1.0',
    builtIn: true,
    isDefault: true,
    thumbnail: tableThumbnail,
    description: 'The table as a PDF: the NBE header with the table\u2019s source on every page, the rows with their column header repeated, the CONFIDENTIAL watermark and the confidentiality footer with the page number.',
    sections: Object.freeze(['Header (NBE logo; LINK ANALYSIS \u00b7 TABLE; source)', 'Table (the column header on every page)', 'Footer (CONFIDENTIAL \u00b7 For authorised investigation use only; page n / N)']),
    usedBy: 'Table window ▸ Export ▸ Print table…',
  }),
]);

export const defaultReportTemplate = (kind = 'Graph report') => REPORT_TEMPLATES.find((template) => template.kind === kind && template.isDefault) || REPORT_TEMPLATES[0];
