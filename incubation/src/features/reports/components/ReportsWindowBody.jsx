import React, { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import WindowLoadScreen from '../../../shared/components/WindowLoadScreen.jsx';

import { useNotifications } from '../../../shared/notifications/useNotifications.js';
import { useSession } from '../../../shared/session/useSession.js';
import { useWorkspace, useWorkspaceActions } from '../../../workspace/hooks/useWorkspace.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { buildEvidencePayload, fetchGraph } from '../../../services/graphApi.js';
import { AuthContext } from '../../../auth/authContext.js';
import { isPresentationLoaded } from '../../graph/lib/domainPresentation.js';
import { formatDomainPillarLabel, getActiveDomainKey } from '../../configuration/lib/configModel.js';
import GraphReportDialog from '../../graph/components/GraphReportDialog.jsx';
import { getProfileSettings, resolveProfileSettings } from '../../graph/lib/nodeProfile.js';
import { renderOffscreenSnapshot } from '../../graph/lib/offscreenSnapshot.js';
import { evidenceReportExtras } from '../../graph/report/reportExtras.js';
import { downloadGraphReport, evidenceReportContext } from '../../graph/report/graphReportExport.js';
import { entityName, reportRangeCounts } from '../../graph/report/graphReportModel.js';
import { cacheEvidenceGraph, getCachedEvidenceGraph } from '../lib/evidenceGraphs.js';
import { cacheReportsPage, getCachedReportsPage } from '../lib/reportsPageCache.js';
import {
  DEFAULT_FILTERS,
  REPORTS_PAGE_SIZE,
  REPORT_TABS,
  REQUESTER_FILTERS,
  SCORE_BANDS,
  SORT_OPTIONS,
  STATUS_FILTERS,
  buildReportsQuery,
  filterAndSortRecords,
  formatReportDate,
  getDomainDistribution,
  getReportTab,
  isArchived,
  pageSummary,
  toReportRecord,
  vigilanceRunView,
} from '../lib/reportModel.js';
import ReportDetail from './ReportDetail.jsx';
import AlertWorkflow from '../../alerts/components/AlertWorkflow.jsx';
import { getAlertsSnapshot, subscribeAlerts } from '../../alerts/lib/alertStore.js';
import { isMockSwitchOn, mockSwitchAvailable, setMockSwitch, subscribeAlertMode } from '../../alerts/lib/alertMode.js';
import { responseInfo } from '../../alerts/lib/alertModel.js';
import { getAlertScope, reloadAlerts, simulateAlert } from '../../alerts/lib/alertRuntime.js';
import { useCan } from '../../../auth/useCan.js';

const ICONS = {
  reports: ['M9 17v-2M12 17v-4M15 17v-6', 'M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.6a1 1 0 0 1 .7.3l5.4 5.4a1 1 0 0 1 .3.7V19a2 2 0 0 1-2 2Z'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'm20 20-3.5-3.5'],
  reset: ['M3 4v6h6', 'M5.5 15a8 8 0 1 0 1.9-8.3L3 10'],
  sort: ['M7 4v16', 'm3 8 4-4 4 4', 'M17 20V4', 'm13 16 4 4 4-4'],
  check: 'm5 12.5 4.5 4.5L19 7',
  refresh: ['M21 4v6h-6', 'M3 20v-6h6', 'M5.1 9a8 8 0 0 1 13.3-3L21 10M3 14l2.6 4a8 8 0 0 0 13.3-3'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  prev: 'M15 18l-6-6 6-6',
  next: 'm9 18 6-6-6-6',
  tag: ['M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z', 'M7.5 7.5h.01'],
  source: ['M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6'],
  empty: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.35-4.35'],
  lock: ['M7 11V7a5 5 0 0 1 10 0v4', 'M5 11h14v10H5z'],
};

function Icon({ d, className = 'reports_icon' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {(Array.isArray(d) ? d : [d]).map((path) => <path key={path} d={path} />)}
    </svg>
  );
}

const isAbort = (error) => error?.name === 'AbortError';

// Sort as an icon button with a small menu (keeps the toolbar on one line).
function SortMenu({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = options.find((option) => option.id === value) || options[0];
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className="reports_sort" ref={rootRef}>
      <button
        type="button"
        className={`reports_icon_button linkx_tooltip_anchor${value !== 'date_desc' ? ' is-set' : ''}`}
        data-tooltip={`Sort: ${current.label}`}
        aria-label={`Sort: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((state) => !state)}
      >
        <Icon d={ICONS.sort} />
      </button>
      {open && (
        <div className="reports_sort_menu" role="menu" aria-label="Sort reports">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === value}
              onClick={() => { onChange(option.id); setOpen(false); }}
            >
              <span className="reports_sort_check">{option.id === value ? <Icon d={ICONS.check} /> : null}</span>
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


// What a Reports window was opened for: a tab, and for a Vigilance run its
// window (dates) and run id (highlight).
const openRequestFrom = (metadata = {}) => {
  const tab = REPORT_TABS.some((item) => item.id === metadata.reportsTab) ? metadata.reportsTab : null;
  const run = metadata.vigilanceRun ? vigilanceRunView(metadata.vigilanceRun) : null;
  // reportsSelect: a record to show (e.g. an STR alert from its notice);
  // reportsRequester: the evidence tab's requester filter (a saved run).
  const requester = ['service', 'analyst'].includes(metadata.reportsRequester) ? metadata.reportsRequester : null;
  return { tab, run, select: metadata.reportsSelect ?? null, requester, seq: metadata.openSeq ?? 0 };
};

// STR alerts (analysis-results-plan Phase 4) as Alert reports rows: the
// report record, with the alert and its response status.
const ALERT_TONE = { pending: 'pending', progress: 'pending', resolved: 'resolved', error: 'error' };
// A report imported without an alert (no alert_id) is listed as it is.
const alertRow = (alert) => {
  const record = toReportRecord(alert.raw, 'parent');
  if (!alert.isAlert) return { ...record, id: alert.id, alert: null };
  const info = responseInfo(alert.response);
  return { ...record, id: alert.id, status: info.label, statusTone: alert.response === 'feedback_sent' ? 'success' : ALERT_TONE[info.tone] || 'pending', alert };
};

// What a Graph window (and the report) knows of an evidence report.
const evidenceMetaOf = (record, traceId) => ({
  traceId,
  reportId: record.id,
  externalReferenceId: record.externalReferenceId,
  // The evidence's own domain (its report payload), so the graph report's
  // cover names it rather than the analyst's active domain.
  domain: String(record.payload?.domain || record.payload?.resolved_domain || '').trim().slice(0, 60),
  // How its data spreads over the domains (e.g. a "domain": "all"
  // evidence), shown beside the domain on the cover.
  domainDistribution: getDomainDistribution(record.payload),
  // The link analysis rule(s) that flagged it at ingestion: the report's
  // "System rule" (analyst decision 2026-11-17).
  // The fraudulence score and its band, stamped on the report's Summary
  // (analyst decisions 2026-11-18).
  score: record.scoreLabel ? { value: record.scoreLabel, band: record.scoreBand } : null,
  systemRules: (record.flaggedRules.length ? record.flaggedRules : [record.anomaly].filter(Boolean)).slice(0, 20).map((rule) => String(rule).slice(0, 120)),
});

export default function ReportsWindowBody({ windowItem }) {
  const workspace = useWorkspace();
  const { apiFetch, configuration } = useSession();
  const { notify, dismissNotice } = useNotifications();
  const domainKey = getActiveDomainKey(configuration);
  const isCdr = domainKey === 'cdr';
  const auth = useContext(AuthContext);

  const { updateWindowMetadata } = useWorkspaceActions();
  const windowId = windowItem?.id;
  // Where the user left the window (tab, filters, page, selection), kept in
  // the window's metadata so it survives the body unmounting. A newer open
  // request (openSeq) wins over it.
  const initial = useMemo(() => {
    const request = openRequestFrom(windowItem?.metadata);
    const saved = windowItem?.metadata?.reportsUi;
    if (saved && saved.appliedSeq === request.seq) return { ...saved, seq: request.seq };
    return {
      seq: request.seq,
      tabId: request.tab || 'parent',
      filters: { ...(request.run ? { ...DEFAULT_FILTERS, from: request.run.from, to: request.run.to } : DEFAULT_FILTERS), ...(request.requester ? { requester: request.requester } : {}) },
      highlightRunId: request.run?.runId ?? null,
      offset: 0,
      selectedId: request.select,
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [tabId, setTabId] = useState(initial.tabId);
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS, ...initial.filters });
  const [highlightRunId, setHighlightRunId] = useState(initial.highlightRunId ?? null);
  const [offset, setOffset] = useState(initial.offset || 0);
  // The loaded page, tagged with the tab it belongs to.
  const [page, setPage] = useState(() => getCachedReportsPage(windowId, initial.tabId));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(initial.selectedId ?? null);
  const [graphStatus, setGraphStatus] = useState({}); // traceId -> true | false
  const [probingTraceId, setProbingTraceId] = useState(null);
  const [openingTraceId, setOpeningTraceId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const loadRef = useRef(null);
  const openControllerRef = useRef(null);
  const tab = getReportTab(tabId);

  // Opened again (e.g. from a Vigilance run) while already open.
  const lastSeq = useRef(initial.seq);
  useEffect(() => {
    const request = openRequestFrom(windowItem?.metadata);
    if (request.seq === lastSeq.current) return;
    lastSeq.current = request.seq;
    // A new request always reloads (a record saved since, e.g. a run saved
    // as evidence, must be in the list to be selected).
    setReloadKey((key) => key + 1);
    if (request.tab) setTabId(request.tab);
    setOffset(0);
    setSelectedId(request.select ?? null);
    setFilters({ ...(request.run ? { ...DEFAULT_FILTERS, from: request.run.from, to: request.run.to } : DEFAULT_FILTERS), ...(request.requester ? { requester: request.requester } : {}) });
    setHighlightRunId(request.run?.runId ?? null);
  }, [windowItem?.metadata]);

  // Remember where the user is (debounced: typing in search must not
  // re-render the workspace on every key).
  useEffect(() => {
    if (!windowId) return undefined;
    const timer = setTimeout(() => {
      updateWindowMetadata(windowId, {
        metadata: { reportsUi: { appliedSeq: lastSeq.current, tabId, filters, offset, selectedId, highlightRunId } },
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [windowId, updateWindowMetadata, tabId, filters, offset, selectedId, highlightRunId]);

  const searchRef = useRef(filters.search);
  searchRef.current = filters.search;

  // Server-side load: tab, page, status, band and dates. Search filters the
  // loaded page instantly and is sent as `q` on the next load (production).
  // STR alerts: with the alert service on, the Alert reports tab lists its
  // alerts (the mock's, or the Service's once H-3 is delivered).
  const alertsState = useSyncExternalStore(subscribeAlerts, getAlertsSnapshot);
  // The alert service (the Service's, or the mock) lists the Alert reports.
  const alertsActive = alertsState.mode !== 'off';
  const isMockAlerts = alertsState.mode === 'mock';
  const mockSwitch = useSyncExternalStore(subscribeAlertMode, isMockSwitchOn);
  // "All alerts" needs alerts:read_all (H-3); the Service lists "mine" by default.
  const canReadAllAlerts = useCan()('alerts:read_all');
  const [alertScope, setAlertScope] = useState(() => (getAlertScope() === 'all' ? 'all' : 'mine')); // 'mine' | 'all'
  const [alertScopeError, setAlertScopeError] = useState('');
  const changeAlertScope = async (next) => {
    setAlertScope(next);
    setAlertScopeError('');
    const result = await reloadAlerts(next === 'all' ? 'all' : 'me');
    if (!result.ok && result.message) setAlertScopeError(result.message);
  };
  const alertTab = tabId === 'parent' && alertsActive;

  const load = useCallback(async () => {
    if (tabId === 'parent' && getAlertsSnapshot().mode !== 'off') return;
    loadRef.current?.abort();
    const controller = new AbortController();
    loadRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const url = buildReportsQuery({ tabId, offset, filters: { ...filters, search: searchRef.current } });
      const data = await apiFetch(url, { suppressForbiddenHandler: true, signal: controller.signal });
      if (controller.signal.aborted) return;
      const records = Array.isArray(data?.data) ? data.data : [];
      const count = Number(data?.count) || 0;
      const loaded = { tabId, records, total: count };
      setPage(loaded);
      cacheReportsPage(windowId, loaded);
    } catch (loadError) {
      if (!isAbort(loadError)) setError(loadError);
    } finally {
      if (loadRef.current === controller) setLoading(false);
    }
  }, [apiFetch, windowId, tabId, offset, filters.status, filters.band, filters.from, filters.to, filters.requester, alertsState.mode, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => () => {
    loadRef.current?.abort();
    openControllerRef.current?.abort();
  }, []);

  const pageForTab = page?.tabId === tabId ? page : null;
  const alertRows = useMemo(
    () => (alertTab ? alertsState.alerts.filter((alert) => alertScope === 'all' || alert.mine).map(alertRow) : null),
    [alertTab, alertsState.alerts, alertScope],
  );
  const rawRecords = useMemo(() => (alertRows ? alertRows.map((row) => row.raw) : pageForTab?.records || []), [alertRows, pageForTab]);
  const total = alertRows ? alertRows.length : pageForTab?.total || 0;
  const records = useMemo(() => alertRows || rawRecords.map((raw) => toReportRecord(raw, tabId)), [alertRows, rawRecords, tabId]);
  const visible = useMemo(() => filterAndSortRecords(records, filters, tabId), [records, filters, tabId]);
  const selected = records.find((record) => String(record.id) === String(selectedId)) || null;

  const changeTab = (nextTab) => {
    if (nextTab === tabId) return;
    // Show the tab's own last page (if any) while it reloads, never this one.
    setPage(getCachedReportsPage(windowId, nextTab));
    setError(null);
    setTabId(nextTab);
    setOffset(0);
    setSelectedId(null);
    setHighlightRunId(null);
    // Score-only sorts do not exist on the Alert reports tab.
    if (!getReportTab(nextTab).scored && SORT_OPTIONS.find((option) => option.id === filters.sort)?.scoredOnly) {
      setFilters((current) => ({ ...current, sort: 'date_desc' }));
    }
  };

  const updateFilter = (key, value, { resetPage = true } = {}) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setHighlightRunId(null);
    if (resetPage) setOffset(0);
  };

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setHighlightRunId(null);
    setOffset(0);
  };

  // Evidence graph availability: checked when an evidence report is selected
  // and its record does not already say there is no graph.
  const selectedTraceId = selected?.traceId || null;
  useEffect(() => {
    if (!selected || tabId !== 'evidence' || !selectedTraceId) return undefined;
    if (graphStatus[selectedTraceId] !== undefined) return undefined;
    // has_graph is the Service's word (H-1): no fetch to find out.
    if (selected.graphClaim === false || selected.graphClaim === true) {
      setGraphStatus((current) => ({ ...current, [selectedTraceId]: selected.graphClaim }));
      return undefined;
    }
    if (getCachedEvidenceGraph(selectedTraceId)) {
      setGraphStatus((current) => ({ ...current, [selectedTraceId]: true }));
      return undefined;
    }
    const controller = new AbortController();
    setProbingTraceId(selectedTraceId);
    fetchGraph(apiFetch, buildEvidencePayload(selectedTraceId, selected), { signal: controller.signal })
      .then((graph) => {
        const hasGraph = graph.nodes.length > 0 || graph.edges.length > 0;
        if (hasGraph && !graph.partial) cacheEvidenceGraph(selectedTraceId, graph);
        setGraphStatus((current) => ({ ...current, [selectedTraceId]: hasGraph }));
      })
      .catch((probeError) => {
        if (isAbort(probeError)) return;
        // A record that claims a graph keeps "Open graph" (the open retries).
        if (selected.graphClaim !== true) setGraphStatus((current) => ({ ...current, [selectedTraceId]: false }));
      })
      .finally(() => setProbingTraceId((current) => (current === selectedTraceId ? null : current)));
    return () => controller.abort();
  }, [selected, selectedTraceId, tabId, graphStatus, apiFetch]);

  const graphState = (() => {
    if (tabId !== 'evidence') return 'unsupported';
    if (selected?.graphArchived && selected?.graphClaim !== true) return 'archived';
    if (!selectedTraceId) return 'unavailable';
    if (openingTraceId === selectedTraceId) return 'loading';
    if (graphStatus[selectedTraceId] === false || selected?.graphClaim === false) return 'unavailable';
    if (graphStatus[selectedTraceId] === true || (selected?.graphClaim === true && probingTraceId !== selectedTraceId)) return 'available';
    return probingTraceId === selectedTraceId ? 'checking' : 'available';
  })();

  // The evidence graph, from the cache or fetched (with progress notices).
  // Null when there is none or the fetch fails (said in a notice).
  const loadEvidenceGraph = async (traceId, record) => {
    let noticeId = notify({ title: 'Loading', message: 'Checking evidence graph data…', level: 'info', source: 'Reports' });
    try {
      let graph = getCachedEvidenceGraph(traceId);
      if (!graph) {
        openControllerRef.current?.abort();
        const controller = new AbortController();
        openControllerRef.current = controller;
        graph = await fetchGraph(apiFetch, buildEvidencePayload(traceId, record), {
          signal: controller.signal,
          onQueued: () => {
            if (noticeId) dismissNotice(noticeId);
            noticeId = notify({ title: 'Queued', message: 'Evidence graph request is queued…', level: 'info', source: 'Reports' });
          },
        });
      }
      if (noticeId) dismissNotice(noticeId);
      noticeId = null;
      if (!graph.nodes.length && !graph.edges.length) {
        setGraphStatus((current) => ({ ...current, [traceId]: false }));
        notify({ title: 'No graph', message: 'No graph data found for this evidence report.', level: 'warning', source: 'Reports' });
        return null;
      }
      if (graph.partial) {
        notify({
          title: 'Incomplete graph',
          message: `The Service delivered ${graph.nodes.length.toLocaleString('en-GB')} entities and ${graph.edges.length.toLocaleString('en-GB')} links${graph.expected ? ` of ${graph.expected.nodes.toLocaleString('en-GB')} and ${graph.expected.edges.toLocaleString('en-GB')}` : ''}. Load it again before relying on it.`,
          level: 'warning',
          source: 'Reports',
          durationMs: 15000,
        });
      } else cacheEvidenceGraph(traceId, graph);
      setGraphStatus((current) => ({ ...current, [traceId]: true }));
      return graph;
    } catch (openError) {
      if (noticeId) dismissNotice(noticeId);
      if (isAbort(openError)) return null;
      setGraphStatus((current) => ({ ...current, [traceId]: false }));
      notify({ title: 'Unavailable', message: openError?.message || 'Failed to fetch graph data.', level: 'error', source: 'Reports' });
      return null;
    }
  };

  const openGraph = async () => {
    if (!selected || !selectedTraceId || openingTraceId) return;
    const traceId = selectedTraceId;
    const existing = workspace.windows.find((windowItem) => windowItem.type === WORKSPACE_WINDOW_TYPES.GRAPH
      && windowItem.metadata?.evidence?.traceId === traceId);
    if (existing) {
      workspace.focusWindow(existing.id);
      return;
    }
    setOpeningTraceId(traceId);
    try {
      const graph = await loadEvidenceGraph(traceId, selected);
      if (!graph) return;
      workspace.openWindow(WORKSPACE_WINDOW_TYPES.GRAPH, {
        title: 'Graph',
        customTitle: `Evidence ${selected.externalReferenceId || selected.id}`,
        metadata: {
          evidence: evidenceMetaOf(selected, traceId),
        },
      });
    } finally {
      setOpeningTraceId(null);
    }
  };

  // Download report (graph-chart-plan §3.6; analyst decision 2026-11-18):
  // the built-in NBE graph report of the evidence graph, drawn without
  // opening a Graph window. The same form as the Graph window's Generate
  // report comes first, prefilled from the evidence.
  const [reportJob, setReportJob] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const openReport = async () => {
    if (!selected || !selectedTraceId || reportLoading) return;
    const traceId = selectedTraceId;
    const record = selected;
    setReportLoading(true);
    try {
      const graph = await loadEvidenceGraph(traceId, record);
      if (!graph) return;
      const profileSettings = configuration?.actor_profile && !isPresentationLoaded(domainKey) ? resolveProfileSettings(configuration, domainKey) : getProfileSettings(domainKey);
      const context = evidenceReportContext({
        graphData: graph,
        evidence: evidenceMetaOf(record, traceId),
        profileSettings,
        isCdr,
        formatDomain: formatDomainPillarLabel,
      });
      const user = auth?.user;
      setReportJob({
        context,
        // An evidence without a domain of its own falls back to the active
        // domain, as in the Graph window.
        domain: context.domain || formatDomainPillarLabel(domainKey),
        initial: context.initial({ analyst: String(user?.display_name || user?.username || '') }),
        // The popup's Range shows "of m".
        rangeCounts: reportRangeCounts(context.input('')),
      });
    } finally {
      setReportLoading(false);
    }
  };
  const generateReport = async (values) => {
    if (!reportJob) return;
    try {
      const input = reportJob.context.input(values.nameKey);
      // The picture names entities as the report does (Identify entities by).
      const snapshot = await renderOffscreenSnapshot(reportJob.context.store, { isCdr, ...values.snapshot, nameOf: (id) => entityName(input.graph, id, values.nameKey) });
      // The automatic charts and the default tables over the whole evidence
      // graph (the evidence report never takes an analyst's windows;
      // analyst decisions 2026-11-18 and 2026-11-19).
      const { measures, tables } = await evidenceReportExtras({ store: reportJob.context.store, nameKey: values.nameKey });
      await downloadGraphReport({ input, values, domain: reportJob.domain, snapshot, measures, tables });
      setReportJob(null);
      notify({ title: 'Success', message: 'Evidence report downloaded successfully.', level: 'success', source: 'Reports' });
    } catch (error) {
      notify({ title: 'Evidence report', message: `Could not generate the evidence report: ${error?.message || error}`, level: 'error', source: 'Reports' });
    }
  };


  const copyPayload = () => {
    if (!selected) return;
    const text = JSON.stringify(selected.raw.payload, null, 2);
    navigator.clipboard?.writeText(text).then(
      () => notify({ title: 'Copied', message: 'Payload copied to clipboard.', level: 'info', source: 'Reports' }),
      () => notify({ title: 'Copy failed', message: 'The clipboard is not available.', level: 'warning', source: 'Reports' }),
    );
  };

  const downloadList = async () => {
    if (!visible.length || exporting) return;
    setExporting(true);
    try {
      const { downloadReportsListPdf } = await import('../lib/reportsPdf.js');
      await downloadReportsListPdf({ records: visible, tabId, offset, total, isCdr });
      notify({ title: 'Success', message: 'Reports list downloaded successfully.', level: 'success', source: 'Reports' });
    } catch {
      notify({ title: 'Error', message: 'Failed to generate PDF.', level: 'error', source: 'Reports' });
    } finally {
      setExporting(false);
    }
  };

  const handleRowKeyDown = (event, record) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelectedId(record.id);
    }
  };

  const columns = tab.scored ? 8 : 4;
  const forbidden = error?.status === 403;

  const renderTable = () => {
    if (forbidden) {
      return (
        <div className="reports_state is-denied" role="alert">
          <Icon d={ICONS.lock} className="reports_state_icon" />
          <h4>Access denied</h4>
          <p>You do not have permission to view this report data.</p>
        </div>
      );
    }
    if (error) {
      return (
        <div className="reports_state is-error" role="alert">
          <h4>Could not load reports</h4>
          <p>{error.message || 'The reports request failed.'}</p>
          <button type="button" className="reports_action" onClick={load}>Retry</button>
        </div>
      );
    }
    if (loading && !rawRecords.length) {
      return <WindowLoadScreen className="is-block" label="Loading reports…" />;
    }
    return (
      <div className="reports_table_wrap">
        <table className={`reports_table${tab.scored ? ' is-scored' : ''}`}>
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Source</th>
              {tab.scored && (
                <>
                  <th scope="col">Anomaly type</th>
                  <th scope="col">Fraud score</th>
                  <th scope="col">Score band</th>
                  <th scope="col">Reason</th>
                </>
              )}
              <th scope="col">Status</th>
              <th scope="col">Date</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr className="reports_table_empty">
                <td colSpan={columns}>
                  <Icon d={ICONS.empty} className="reports_state_icon" />
                  <strong>No reports found</strong>
                  <span>Try adjusting your filters or date range.</span>
                </td>
              </tr>
            ) : visible.map((record) => {
              const archived = isArchived(record);
              const highlighted = Boolean(highlightRunId) && tabId === 'xvigilance' && String(record.runId) === String(highlightRunId);
              const isSelected = String(record.id) === String(selectedId);
              return (
                <tr
                  key={record.id}
                  tabIndex={0}
                  aria-selected={isSelected}
                  className={`reports_row${isSelected ? ' is-selected' : ''}${archived ? ' is-archived' : ''}${highlighted ? ' is-highlighted' : ''}`}
                  title={archived ? 'Archived (older than 180 days)' : highlighted ? 'Flagged from the Vigilance audit run' : undefined}
                  onClick={() => setSelectedId(record.id)}
                  onKeyDown={(event) => handleRowKeyDown(event, record)}
                >
                  <td>
                    <span className="reports_cell_icon"><Icon d={ICONS.tag} /><strong>{record.reportType || '—'}</strong></span>
                  </td>
                  <td>
                    <span className="reports_cell_icon is-muted"><Icon d={ICONS.source} />{record.sourceSystem || '—'}</span>
                  </td>
                  {tab.scored && (
                    <>
                      <td title={record.anomaly}>{record.anomaly || '—'}</td>
                      <td className="is-number">{record.scoreLabel || '—'}</td>
                      <td>
                        {record.scoreBand
                          ? <span className={`reports_band is-${record.scoreBand}`}>{record.scoreBand}</span>
                          : record.payload.is_flagged ? <span className="reports_band is-critical">Flagged</span> : '—'}
                      </td>
                      <td title={record.reason}>{record.reason || '—'}</td>
                    </>
                  )}
                  <td>
                    <span className={`reports_status is-${record.statusTone}`}><span aria-hidden="true" />{record.status || '—'}</span>
                  </td>
                  <td className="reports_cell_date">{formatReportDate(record.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="workspace_window_body reports_window_body">
      <div className="reports_window">
        <header className="reports_window_header">
          <div className="reports_window_heading">
            <Icon d={ICONS.reports} className="reports_window_heading_icon" />
            <div>
              <h3>Reports</h3>
              <p>Alerts forwarded by the parent service, automated system findings and evidence produced for sibling services.</p>
            </div>
          </div>
        </header>

        <div className="reports_tabs" role="tablist" aria-label="Report type">
          {REPORT_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tabId === item.id}
              className={tabId === item.id ? 'is-active' : ''}
              onClick={() => changeTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="reports_toolbar" role="search">
          <label className="reports_search">
            <Icon d={ICONS.search} />
            <input
              type="search"
              value={filters.search}
              placeholder="Search reports"
              aria-label="Search reports"
              onChange={(event) => updateFilter('search', event.target.value, { resetPage: false })}
            />
          </label>
          <select className="reports_select" aria-label="Status" value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
            {STATUS_FILTERS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          {tab.scored && (
            <>
              <select className="reports_select" aria-label="Score band" value={filters.band} onChange={(event) => updateFilter('band', event.target.value)}>
                {SCORE_BANDS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
              <span className="reports_dates">
                <input type="datetime-local" className="reports_select" aria-label="From date and time" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} />
                <span aria-hidden="true">to</span>
                <input type="datetime-local" className="reports_select" aria-label="To date and time" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} />
              </span>
            </>
          )}
          {tabId === 'parent' && alertsActive && (canReadAllAlerts || isMockAlerts) ? (
            <select className="reports_select" aria-label="Assigned" value={alertScope} onChange={(event) => changeAlertScope(event.target.value)}>
              <option value="mine">Assigned to me</option>
              <option value="all">All alerts</option>
            </select>
          ) : null}
          {tabId === 'parent' && alertScopeError ? <span className="reports_inline_error" role="status">{alertScopeError}</span> : null}
          {tabId === 'evidence' ? (
            <select className="reports_select" aria-label="Requested by" value={filters.requester} onChange={(event) => updateFilter('requester', event.target.value)}>
              {REQUESTER_FILTERS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          ) : null}
          {tabId === 'parent' && mockSwitchAvailable() ? (
            <span className="reports_mock_controls">
              <label className="reports_mock_switch" title="Development only: STR alerts from a mock parent service">
                <input type="checkbox" checked={mockSwitch} onChange={(event) => setMockSwitch(event.target.checked)} />
                Mock alerts
              </label>
              {isMockAlerts ? (
                <button type="button" className="reports_action" onClick={() => simulateAlert('new')}>New mock alert</button>
              ) : null}
            </span>
          ) : null}
          <button type="button" className="reports_icon_button linkx_tooltip_anchor" data-tooltip="Reset filters" aria-label="Reset filters" onClick={resetFilters}>
            <Icon d={ICONS.reset} />
          </button>
          <SortMenu
            value={filters.sort}
            options={SORT_OPTIONS.filter((option) => tab.scored || !option.scoredOnly)}
            onChange={(value) => updateFilter('sort', value, { resetPage: false })}
          />
        </div>

        <div className={`reports_window_main${selected ? ' has-detail' : ''}`}>
          <section className="reports_list" aria-label={tab.label} aria-busy={loading}>
            {renderTable()}
          </section>
          {selected && (
            <ReportDetail
              workflow={selected.alert ? <AlertWorkflow alertId={selected.alert.id} mockControls={isMockAlerts} /> : null}
              record={selected}
              isCdr={isCdr}
              onClose={() => setSelectedId(null)}
              onCopyPayload={copyPayload}
              graph={{ state: graphState, onOpen: openGraph }}
              download={{
                available: graphState === 'available' && !reportLoading,
                busy: reportLoading,
                hint: graphState === 'available'
                  ? 'The Evidence Report of this evidence, as the Service analysed it (PDF)'
                  : 'Available for evidence reports with a graph',
                onDownload: openReport,
              }}
            />
          )}
        </div>

        <footer className="reports_footer">
          <span className="reports_footer_summary">
            {pageSummary({ offset, shown: visible.length, loaded: rawRecords.length, total })}
          </span>
          <div className="reports_footer_actions">
            <button type="button" className="reports_action" onClick={load} disabled={loading}>
              <Icon d={ICONS.refresh} className={`reports_icon${loading ? ' is-spinning' : ''}`} /> Refresh
            </button>
            <button type="button" className="reports_action" onClick={downloadList} disabled={loading || exporting || !visible.length}>
              <Icon d={ICONS.download} /> {exporting ? 'Preparing…' : 'Download list'}
            </button>
            <span className="reports_pager">
              <button type="button" className="reports_icon_button linkx_tooltip_anchor" data-tooltip="Previous page" aria-label="Previous page" disabled={offset === 0 || loading} onClick={() => { setOffset((current) => Math.max(0, current - REPORTS_PAGE_SIZE)); setSelectedId(null); }}>
                <Icon d={ICONS.prev} />
              </button>
              <button type="button" className="reports_icon_button linkx_tooltip_anchor" data-tooltip="Next page" aria-label="Next page" disabled={offset + REPORTS_PAGE_SIZE >= total || loading} onClick={() => { setOffset((current) => current + REPORTS_PAGE_SIZE); setSelectedId(null); }}>
                <Icon d={ICONS.next} />
              </button>
            </span>
          </div>
        </footer>
        {reportJob ? (
          <GraphReportDialog
            initial={reportJob.initial}
            nameKeys={reportJob.context.nameKeys}
            draftFor={reportJob.context.draft}
            kind="evidence"
            snapshotDefaults={reportJob.context.snapshotDefaults}
            rangeCounts={reportJob.rangeCounts}
            onGenerate={generateReport}
            onCancel={() => setReportJob(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
