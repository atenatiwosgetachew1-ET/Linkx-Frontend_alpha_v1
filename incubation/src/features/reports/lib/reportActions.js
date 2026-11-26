// What the details' actions say (ReportDetail, ReportDetailPopup).
export const reportGraphHint = (state) => ({
    unsupported: 'Graph visualization is only available for service evidence reports',
    checking: 'Checking graph data availability…',
    loading: 'Fetching and opening the evidence graph…',
    available: 'View the graph in a new Graph window',
    unavailable: 'No graph data was included for this service evidence report',
    archived: 'The graph is older than 180 days and was moved to cold storage by the Service',
  }[state]);
export const hasReportActions = (graph, download) => download.available || !['unsupported', 'unavailable'].includes(graph.state);
