import React, { useEffect, useMemo, useState } from 'react';

import { bandForScore, formatReportDate } from '../lib/reportModel.js';
import { hasReportActions, reportGraphHint } from '../lib/reportActions.js';

const ICONS = {
  close: ['M18 6 6 18', 'M6 6l12 12'],
  tag: ['M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z', 'M7.5 7.5h.01'],
  source: ['M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
  graph: ['M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M8.6 13.5l6.8 4M15.4 6.5l-6.8 4'],
  noGraph: ['M3 3l18 18', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z'],
  spinner: ['M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1'],
  download: ['M12 4v11', 'm7 10 5 5 5-5', 'M5 20h14'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  check: 'm5 12.5 4.5 4.5L19 7',
  chevron: 'm9 6 6 6-6 6',
  code: ['m8 8-4 4 4 4', 'm16 8 4 4-4 4', 'M13.5 5 10.5 19'],
  hash: ['M5 9h14', 'M5 15h14', 'M10 4 8 20', 'M16 4l-2 16'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  trace: ['M6 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z', 'M18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z', 'M6 8v5a3 3 0 0 0 3 3h7'],
  sliders: ['M4 7h10', 'M18 7h2', 'M4 17h2', 'M10 17h10', 'M16 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z', 'M8 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'],
};

function Icon({ d, className = 'reports_icon' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {(Array.isArray(d) ? d : [d]).map((path) => <path key={path} d={path} />)}
    </svg>
  );
}

function CopyValue({ value, label }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);
  if (!value || typeof navigator === 'undefined' || !navigator.clipboard) return null;
  return (
    <button
      type="button"
      className={`reports_copy linkx_tooltip_anchor${copied ? ' is-copied' : ''}`}
      data-tooltip={copied ? 'Copied' : `Copy ${label}`}
      aria-label={copied ? 'Copied' : `Copy ${label}`}
      onClick={() => navigator.clipboard.writeText(String(value)).then(() => setCopied(true), () => {})}
    >
      <Icon d={copied ? ICONS.check : ICONS.copy} />
    </button>
  );
}

// Syntax-coloured JSON built as React nodes (no innerHTML).
const JSON_TOKEN_RE = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;
const prettyJson = (value) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  return JSON.stringify(value, null, 2);
};

function JsonView({ text }) {
  const parts = [];
  let last = 0;
  text.replace(JSON_TOKEN_RE, (match, _str, colon, offset) => {
    if (offset > last) parts.push(text.slice(last, offset));
    const kind = match.startsWith('"') ? (colon ? 'key' : 'string') : /true|false/.test(match) ? 'boolean' : match === 'null' ? 'null' : 'number';
    parts.push(<span key={offset} className={`reports_json_${kind}`}>{match}</span>);
    last = offset + match.length;
    return match;
  });
  if (last < text.length) parts.push(text.slice(last));
  return <pre className="reports_json" tabIndex={0} aria-label="Payload data">{parts.length ? parts : 'No payload.'}</pre>;
}

// Fraud score on a 0-100 scale split into the production score bands.
const BANDS = [
  { id: 'low', from: 0, to: 20, label: 'Low risk' },
  { id: 'medium', from: 20, to: 50, label: 'Moderate risk' },
  { id: 'high', from: 50, to: 80, label: 'High risk' },
  { id: 'critical', from: 80, to: 90, label: 'Critical risk' },
  { id: 'fatal', from: 90, to: 100, label: 'Fatal: highest risk' },
];
const TICKS = [0, 20, 50, 80, 90, 100];

function ScoreMeter({ record }) {
  const score = record.fraudScore;
  const band = record.scoreBand || (score !== null ? bandForScore(score) : '');
  if (score === null && !band) return null;
  const meta = BANDS.find((item) => item.id === band);
  const position = score === null ? null : Math.min(100, Math.max(0, score));
  return (
    <section className={`reports_score is-${band || 'none'}`} aria-label="Fraud score">
      <div className="reports_score_top">
        <div className="reports_score_value">
          <span className="reports_section_label">Fraud score</span>
          <p>
            <strong>{score === null ? record.scoreLabel || '—' : score.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong>
            {score !== null ? <span>/ 100</span> : null}
          </p>
        </div>
        {band ? (
          <div className="reports_score_band">
            <span className={`reports_band is-${band}`}>{band}</span>
            {meta ? <small>{meta.label}</small> : null}
          </div>
        ) : null}
      </div>
      {position !== null ? (
        <div className="reports_score_scale" aria-hidden="true">
          <div className="reports_score_track">
            <span className="reports_score_fill" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }} />
            <i style={{ left: `${position}%` }} />
          </div>
          <div className="reports_score_ticks">
            {TICKS.map((tick) => <span key={tick} style={{ left: `${tick}%` }}>{tick}</span>)}
          </div>
        </div>
      ) : null}
    </section>
  );
}

// The popup's score: the figure and its band, at the right of the hero.
function HeroScore({ record, band }) {
  const score = record.fraudScore;
  const meta = BANDS.find((item) => item.id === band);
  return (
    <section className={`reports_score rdx_score is-${band || 'none'}`} aria-label="Fraud score">
      <span className="rdx_kicker">Fraud score</span>
      <p className="rdx_score_value">
        <strong>{score === null ? record.scoreLabel || '—' : score.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong>
        {score !== null ? <span>/ 100</span> : null}
      </p>
      {band ? <p className="rdx_score_band"><span className={`reports_band is-${band}`}>{band}</span>{meta ? <small>{meta.label}</small> : null}</p> : null}
    </section>
  );
}

// The 0-100 scale under the hero: the five score bands at their real
// widths, each in its own colour, lit up to the score.
function BandScale({ score }) {
  const position = Math.min(100, Math.max(0, score));
  const bands = (lit) => (
    <div className={`rdx_scale_bands${lit ? ' is-lit' : ''}`} style={lit ? { clipPath: `inset(0 ${100 - position}% 0 0)` } : undefined}>
      {BANDS.map((item) => <span key={item.id} className={`is-${item.id}`} style={{ flexGrow: item.to - item.from }} />)}
    </div>
  );
  return (
    <div className="rdx_scale" aria-hidden="true">
      <div className="rdx_scale_track">
        {bands(false)}
        {bands(true)}
        <i style={{ left: `${position}%` }} />
      </div>
      <div className="rdx_scale_ticks">
        {TICKS.map((tick) => <span key={tick} style={{ left: `${tick}%` }}>{tick}</span>)}
      </div>
    </div>
  );
}

const DETAIL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'history', label: 'History', needs: 'history' },
  { id: 'payload', label: 'Payload' },
];

// score_evidence as one stacked bar: base score + node bonus + financial /
// volume bonus.
function ScoreBreakdown({ evidence, isCdr }) {
  if (!evidence) return null;
  const parts = [
    { id: 'base', label: 'Base score', value: Number(evidence.base_score_applied) || 0 },
    { id: 'node', label: 'Node bonus', value: Number(evidence.node_count_bonus) || 0 },
    { id: 'money', label: isCdr ? 'Volume bonus' : 'Financial bonus', value: Number(evidence.financial_bonus) || 0 },
  ];
  const sum = parts.reduce((total, part) => total + Math.max(0, part.value), 0);
  return (
    <section className="reports_section" aria-label="Score breakdown">
      <div className="reports_section_head">
        <span className="reports_section_label">Score breakdown</span>
        {evidence.config_version != null ? <span className="reports_section_meta">Config {String(evidence.config_version)}</span> : null}
      </div>
      {sum > 0 ? (
        <div className="reports_breakdown_bar" aria-hidden="true">
          {parts.map((part) => (part.value > 0 ? <span key={part.id} className={`is-${part.id}`} style={{ flexGrow: part.value }} /> : null))}
        </div>
      ) : null}
      <dl className="reports_breakdown_legend">
        {parts.map((part) => (
          <div key={part.id} className={`is-${part.id}`}>
            <dt><span aria-hidden="true" />{part.label}</dt>
            <dd>{part.value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// Network figures as a compact grid; only what the payload carries.
const networkFigures = (payload) => [
  payload.linked_accounts_count != null && ['Linked accounts', Number(payload.linked_accounts_count).toLocaleString()],
  payload.all_relationships != null && ['Relationships', Number(payload.all_relationships).toLocaleString()],
  payload.network_centrality_score != null && ['Centrality', String(payload.network_centrality_score)],
  payload.max_path_length != null && ['Max path', String(payload.max_path_length)],
  payload.duration_ms != null && ['Analysis time', `${(Number(payload.duration_ms) / 1000).toFixed(2)}s`],
].filter(Boolean);

let payloadOpenPreference = false;
try {
  payloadOpenPreference = window.localStorage.getItem('linkx.reports.payloadOpen') === '1';
} catch { /* storage unavailable */ }

// graph: { state: 'unsupported' | 'checking' | 'loading' | 'available' | 'unavailable' | 'archived', onOpen }
// The details' actions (Open graph, Download report): in their own footer, or
// in the popup's footer when the details are framed by it. Framed, they are
// the popup's default buttons (graph_customize_button, words only, Open
// graph the primary one), as in every other popup of this kind.
export function ReportDetailActions({ graph, download, framed = false }) {
  const graphLabel = {
    unsupported: 'No graph available',
    checking: 'Checking graph…',
    loading: 'Loading graph…',
    available: 'Open graph',
    unavailable: 'No graph available',
    archived: 'Graph archived',
  }[graph.state];
  const graphBusy = graph.state === 'checking' || graph.state === 'loading';
  if (framed) {
    return (
      <>
        <button
          type="button"
          className="graph_customize_button linkx_tooltip_anchor"
          disabled={!download.available}
          data-tooltip={download.hint}
          onClick={download.onDownload}
        >
          {download.busy ? 'Preparing…' : 'Download report'}
        </button>
        <button
          type="button"
          className="graph_customize_button is-primary linkx_tooltip_anchor"
          disabled={graph.state !== 'available'}
          data-tooltip={reportGraphHint(graph.state)}
          onClick={graph.onOpen}
        >
          {graphLabel}
        </button>
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        className="reports_action linkx_tooltip_anchor"
        disabled={!download.available}
        data-tooltip={download.hint}
        onClick={download.onDownload}
      >
        <Icon d={download.busy ? ICONS.spinner : ICONS.download} className={download.busy ? 'reports_icon is-spinning' : undefined} />
        {download.busy ? 'Preparing…' : 'Download report'}
      </button>
      <button
        type="button"
        className="reports_action is-primary linkx_tooltip_anchor"
        disabled={graph.state !== 'available'}
        data-tooltip={reportGraphHint(graph.state)}
        onClick={graph.onOpen}
      >
        <Icon d={graphBusy ? ICONS.spinner : graph.state === 'available' ? ICONS.graph : ICONS.noGraph} className={`reports_icon${graphBusy ? ' is-spinning' : ''}`} />
        {graphLabel}
      </button>
    </>
  );
}

// framed: inside the popup, which gives the title, the close button and the
// actions; the details show their tags and score at the top of the body.
export default function ReportDetail({ record, isCdr, graph, onClose, onCopyPayload, download, workflow = null, history = null, onShowRunSettings, framed = false }) {
  const { payload } = record;
  const [payloadOpen, setPayloadOpen] = useState(payloadOpenPreference);
  const [tab, setTab] = useState('overview');
  const jsonText = useMemo(() => prettyJson(record.raw.payload), [record.raw.payload]);
  const jsonLines = jsonText ? jsonText.split('\n').length : 0;
  const figures = networkFigures(payload);
  const entity = payload.account_no || payload.entity_id || record.leadingEntity;
  const domain = payload.domain || payload.resolved_domain || record.domain;
  const signals = record.flaggedRules.length ? record.flaggedRules : record.anomaly ? [record.anomaly] : [];
  const blacklisted = payload.beneficiary_blacklisted;

  const togglePayload = () => {
    const next = !payloadOpen;
    payloadOpenPreference = next;
    setPayloadOpen(next);
    try { window.localStorage.setItem('linkx.reports.payloadOpen', next ? '1' : '0'); } catch { /* ignore */ }
  };

  // The action bar only shows when one of its actions can be used (or the
  // graph is still being checked).
  // The header's tone follows the fraud score band; reports without a score
  // keep the status tone.
  const headerBand = record.scoreBand || (record.fraudScore !== null ? bandForScore(record.fraudScore) : '');
  const showFooter = !framed && hasReportActions(graph, download);

  // In the popup: a hero (who it is about, the score and where it falls on
  // the band scale), then two sections: the overview (an alert's procedure,
  // the findings, and the record's facts as one flowing row, so no part
  // leaves a hole when another is missing) and the payload. The popup is as
  // tall as the section it shows.
  if (framed) {
    const showTrace = record.traceId && String(record.traceId) !== String(record.externalReferenceId) && String(record.traceId) !== String(record.id);
    const hasScore = record.fraudScore !== null || Boolean(headerBand);
    const origin = [record.sourceSystem, formatReportDate(record.createdAt)].filter(Boolean).join(' · ');
    // History shows only for records that have one (an STR alert's).
    const tabs = DETAIL_TABS.filter((item) => !item.needs || (item.needs === 'history' && history));
    const onTabKey = (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const index = tabs.findIndex((item) => item.id === tab);
      const next = tabs[(index + step + tabs.length) % tabs.length].id;
      setTab(next);
      event.currentTarget.querySelector(`[data-tab="${next}"]`)?.focus();
    };
    return (
      <aside className={`reports_detail is-framed rdx is-${record.statusTone}${headerBand ? ` band-${headerBand}` : ''}`} aria-label={`Report ${record.id}`} tabIndex={-1}>
        <header className="rdx_hero">
          <div className="rdx_hero_row">
            <section className="rdx_subject" aria-label="Subject">
              <span className="rdx_kicker">Entity / Account</span>
              <strong className="is-mono" title={entity || ''}>{entity || '—'}</strong>
              <div className="rdx_meta">
                <span className={`reports_status is-${record.statusTone}`}><span aria-hidden="true" />{record.status || '—'}</span>
                {domain ? <span className="rdx_badge">{domain}</span> : null}
                {blacklisted !== undefined ? (
                  <span className={`rdx_badge ${blacklisted ? 'is-danger' : 'is-ok'}`}>{blacklisted ? 'Blacklisted' : 'Not blacklisted'}</span>
                ) : null}
                {origin ? <span className="rdx_meta_text">{origin}</span> : null}
              </div>
            </section>
            {hasScore ? <HeroScore record={record} band={headerBand} /> : null}
          </div>
          {record.fraudScore !== null ? <BandScale score={record.fraudScore} /> : null}
        </header>

        <div className="rdx_tabs graph_customize_segments" role="tablist" aria-label="Report sections" onKeyDown={onTabKey}>
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`rdx-tab-${item.id}`}
              data-tab={item.id}
              aria-selected={tab === item.id}
              aria-controls="rdx-panel"
              tabIndex={tab === item.id ? 0 : -1}
              className={`graph_customize_segment${tab === item.id ? ' is-current' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
              {item.id === 'overview' && signals.length ? <small aria-hidden="true">{signals.length}</small> : null}
            </button>
          ))}
        </div>

        <div className={`rdx_panel is-${tab}`} role="tabpanel" id="rdx-panel" aria-labelledby={`rdx-tab-${tab}`}>
          {tab === 'overview' ? (
            <>
              {workflow ? <div className="rdx_workflow">{workflow}</div> : null}
              {signals.length || record.reason ? (
                <section className="rdx_section" aria-label="Signals">
                  <h5 className="rdx_head_label">{record.flaggedRules.length ? 'Flagged rules' : 'Signals'}</h5>
                  {signals.length ? (
                    <div className="rdx_chips">{signals.map((signal) => <span key={signal} className="rdx_chip">{signal}</span>)}</div>
                  ) : null}
                  {record.reason ? <p className="rdx_text">{record.reason}</p> : null}
                </section>
              ) : null}
              {payload.score_evidence || figures.length ? (
                <div className="rdx_pair">
                  <ScoreBreakdown evidence={payload.score_evidence} isCdr={isCdr} />
                  {figures.length ? (
                    <section className="rdx_section" aria-label="Network">
                      <h5 className="rdx_head_label">Network</h5>
                      <dl className="rdx_stats">
                        {figures.map(([label, value]) => <div key={label}><dd>{value}</dd><dt>{label}</dt></div>)}
                      </dl>
                    </section>
                  ) : null}
                </div>
              ) : null}
              <section className="rdx_section" aria-label="Record">
                <h5 className="rdx_head_label">Record</h5>
                <dl className="rdx_facts">
                  <div><dt><Icon d={ICONS.hash} />ID</dt><dd><span className="is-mono">{record.id || '—'}</span><CopyValue value={record.id} label="ID" /></dd></div>
                  <div><dt><Icon d={ICONS.link} />Ref ID</dt><dd><span className="is-mono">{record.externalReferenceId || '—'}</span><CopyValue value={record.externalReferenceId} label="Ref ID" /></dd></div>
                  {showTrace ? <div><dt><Icon d={ICONS.trace} />Trace ID</dt><dd><span className="is-mono">{record.traceId}</span><CopyValue value={record.traceId} label="trace ID" /></dd></div> : null}
                  {record.runRemark ? (
                    <div>
                      <dt>
                        <Icon d={ICONS.sliders} />Run settings
                        {onShowRunSettings ? <button type="button" className="rdx_link" onClick={onShowRunSettings}>See what it used</button> : null}
                      </dt>
                      <dd>
                        <span className={`rdx_run is-${record.runRemark.kind}`}><i aria-hidden="true" />{record.runRemark.marked ? record.runRemark.label : 'The domain’s settings'}</span>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </section>
            </>
          ) : null}

          {tab === 'history' && history ? (
            <section className="rdx_section" aria-label="History">
              <h5 className="rdx_head_label">History</h5>
              {history}
            </section>
          ) : null}

          {tab === 'payload' ? (
            <section className="rdx_payload" aria-label="Payload">
              <div className="rdx_payload_bar">
                <span className="rdx_payload_size"><Icon d={ICONS.code} />{jsonLines ? `${jsonLines.toLocaleString()} lines of JSON` : 'Empty'}</span>
                <button type="button" className="reports_text_button" onClick={onCopyPayload} disabled={!jsonText}>
                  <Icon d={ICONS.copy} /> Copy JSON
                </button>
              </div>
              <JsonView text={jsonText} />
            </section>
          ) : null}
        </div>
      </aside>
    );
  }

  return (
    <aside className={`reports_detail is-${record.statusTone}${headerBand ? ` band-${headerBand}` : ''}`} aria-label={`Report ${record.id}`} tabIndex={-1}>
      <header className="reports_detail_header">
        <div className="reports_detail_heading">
          <p className="reports_detail_eyebrow">Report #{record.id}</p>
          <h3 title={record.reportType}>{record.reportType || 'Report'}</h3>
          <div className="reports_detail_tags">
            <span className={`reports_status is-${record.statusTone}`}><span aria-hidden="true" />{record.status || '—'}</span>
            {record.sourceSystem ? <span className="reports_detail_tag"><Icon d={ICONS.source} />{record.sourceSystem}</span> : null}
            <span className="reports_detail_tag"><Icon d={ICONS.clock} />{formatReportDate(record.createdAt)}</span>
          </div>
        </div>
        <button type="button" className="reports_icon_button linkx_tooltip_anchor" data-tooltip="Close details" aria-label="Close details" onClick={onClose}>
          <Icon d={ICONS.close} />
        </button>
        <ScoreMeter record={record} />
      </header>

      <div className="reports_detail_body">
        {/* An STR alert's procedure (analysis-results-plan Phase 4). */}
        {workflow}

        {entity || domain || blacklisted !== undefined ? (
          <section className="reports_entity" aria-label="Subject">
            <div className="reports_entity_main">
              <span className="reports_section_label">Entity / Account</span>
              <strong className="is-mono" title={entity || ''}>{entity || '—'}</strong>
            </div>
            <div className="reports_entity_side">
              {domain ? <span className="reports_detail_tag is-domain">{domain}</span> : null}
              {blacklisted !== undefined ? (
                <span className={`reports_detail_tag ${blacklisted ? 'is-danger' : 'is-ok'}`}>{blacklisted ? 'Blacklisted' : 'Not blacklisted'}</span>
              ) : null}
            </div>
          </section>
        ) : null}

        {signals.length || record.reason ? (
          <section className="reports_section" aria-label="Signals">
            <div className="reports_section_head">
              <span className="reports_section_label">{record.flaggedRules.length ? 'Flagged rules' : 'Signals'}</span>
              {record.flaggedRules.length ? <span className="reports_section_meta">{record.flaggedRules.length}</span> : null}
            </div>
            {signals.length ? (
              <div className="reports_signal_chips">
                {signals.map((signal) => <span key={signal} className="reports_signal_chip">{signal}</span>)}
              </div>
            ) : null}
            {record.reason ? <p className="reports_reason">{record.reason}</p> : null}
          </section>
        ) : null}

        {figures.length ? (
          <section className="reports_section" aria-label="Network">
            <div className="reports_section_head"><span className="reports_section_label">Network</span></div>
            <dl className="reports_figures">
              {figures.map(([label, value]) => (
                <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          </section>
        ) : null}

        <ScoreBreakdown evidence={payload.score_evidence} isCdr={isCdr} />

        {record.runRemark ? (
          <section className="reports_section" aria-label="Run settings">
            <div className="reports_section_head">
              <span className="reports_section_label">Run settings</span>
              {record.runRemark.marked ? <span className="reports_run_mark">{record.runRemark.label}</span> : null}
              {onShowRunSettings ? <button type="button" className="reports_run_settings_open" onClick={onShowRunSettings}>Details</button> : null}
            </div>
            <p className="reports_reason">{record.runRemark.text.replace(/^Run settings: /, '')}</p>
          </section>
        ) : null}

        <section className="reports_section" aria-label="Identifiers">
          <div className="reports_section_head"><span className="reports_section_label">Identifiers</span></div>
          <dl className="reports_ids">
            <div><dt>ID</dt><dd><span className="is-mono">{record.id || '—'}</span><CopyValue value={record.id} label="ID" /></dd></div>
            <div><dt>Ref ID</dt><dd><span className="is-mono">{record.externalReferenceId || '—'}</span><CopyValue value={record.externalReferenceId} label="Ref ID" /></dd></div>
            {record.traceId && String(record.traceId) !== String(record.externalReferenceId) && String(record.traceId) !== String(record.id) ? (
              <div><dt>Trace ID</dt><dd><span className="is-mono">{record.traceId}</span><CopyValue value={record.traceId} label="trace ID" /></dd></div>
            ) : null}
          </dl>
        </section>

        <section className={`reports_payload${payloadOpen ? ' is-open' : ''}`} aria-label="Payload">
          <div className="reports_payload_header">
            <button type="button" className="reports_payload_toggle" aria-expanded={payloadOpen} onClick={togglePayload}>
              <Icon d={ICONS.chevron} className="reports_icon reports_payload_chevron" />
              <Icon d={ICONS.code} />
              Payload data
              <span className="reports_section_meta">{jsonLines ? `${jsonLines} lines` : 'empty'}</span>
            </button>
            <button type="button" className="reports_text_button" onClick={onCopyPayload} disabled={!jsonText}>
              <Icon d={ICONS.copy} /> Copy JSON
            </button>
          </div>
          {payloadOpen ? <JsonView text={jsonText} /> : null}
        </section>
      </div>

      {showFooter && (
      <footer className="reports_detail_footer">
        <ReportDetailActions graph={graph} download={download} />
      </footer>
      )}
    </aside>
  );
}
