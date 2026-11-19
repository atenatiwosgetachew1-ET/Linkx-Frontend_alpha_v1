// The table's PDF with what it needs loaded: the NBE logo (rasterized, as
// the graph report's) and, for Ethiopic text, Noto Sans Ethiopic.
import { ETHIOPIC_RE, rasterizeSvg, svgDataUrl } from '../../graph/report/graphReportPdf.js';
import { loadEthiopicFonts } from '../../graph/report/reportFonts.js';
import nbeLogoSvg from '../../graph/report/nbe_logo.svg?raw';
import { renderTablePdf } from './tablePdf.js';

// options: renderTablePdf's (rows, columns, orientation, source, details).
export const buildTablePdf = async (options) => {
  const logo = await rasterizeSvg(svgDataUrl(nbeLogoSvg));
  const ethiopic = options.rows.some((row) => ETHIOPIC_RE.test(Object.values(row.values || {}).join(' ')));
  const fonts = ethiopic ? await loadEthiopicFonts() : null;
  return renderTablePdf({ ...options, logo, fonts });
};
