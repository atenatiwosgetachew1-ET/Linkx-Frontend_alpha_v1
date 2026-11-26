// The selected record's details (ReportDetail, framed) in the default popup:
// the Settings ▸ Users popup frame (SettingsPopup) over the Reports window,
// so the table keeps its full width. Title row with ×, the details as its
// scrolling body, a footer with a hint and the actions (Download report,
// Open graph). Escape, × or a click outside closes it; not while the report
// form it opened is over it (busy).
import React from 'react';

import { SettingsPopup } from '../../settings/components/SettingsPage.jsx';
import { ReportDetailActions } from './ReportDetail.jsx';
import { hasReportActions, reportGraphHint } from '../lib/reportActions.js';

export default function ReportDetailPopup({ record, graph, download, busy = false, onClose, children }) {
  return (
    <SettingsPopup
      hostSelector=".reports_window"
      backdropClassName="reports_detail_backdrop"
      title={record.reportType || 'Report'}
      subtitle={`Report #${record.id}`}
      hint={graph.state === 'available' ? download.hint : reportGraphHint(graph.state)}
      busy={busy}
      onClose={onClose}
      footer={hasReportActions(graph, download) ? <ReportDetailActions framed graph={graph} download={download} /> : null}
    >
      {children}
    </SettingsPopup>
  );
}
