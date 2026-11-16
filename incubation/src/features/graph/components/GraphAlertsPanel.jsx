import React from 'react';

import GraphCardNode from './GraphCardNode.jsx';
import GraphOverlayPanel from './GraphOverlayPanel.jsx';

// Production's Graph Alerts panel (graphs_basic.html #alerts-overlay) in the
// shared overlay frame. "Name by" picks the node property that names each
// alert; clicking a card focuses it; Rescan runs the scan again.
//
// Folded, it is an alerted node (the bubble); unfolded, it rises out of that
// node (analyst decision 2026-11-16): the same node, small, beside the title,
// severity counts, "Name by" and Rescan on one line, and the alerts grouped
// by severity (sticky headings) as compact rows: a flat warning sign in the
// alert colour, the name, category and short text, and the number that
// raised it (links or weight). × folds it back; it opens at the canvas's bottom-right corner and is resized from its top-left corner.
//
// alerts: [{ key, alert, severity, name, category, short, detail, nameMissing }]
// (described; `alert` is the raw alert handed back to onFocus; `short` is the
// card line and `detail` production's full text, the card's tooltip;
// nameMissing is the chosen "Name by" key when this node has no value for it).
const RescanIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M20 11a8 8 0 1 0-2.3 5.6" />
    <path d="M20 4v6h-6" />
  </svg>
);
// A flat warning sign, filled in the alert colour.
const WarningIcon = () => (
  <svg viewBox="0 0 24 24" focusable="false">
    <path className="graph_card_row_sign" d="M10.3 3.9a2 2 0 0 1 3.4 0l8 13.8a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3Z" />
    <path className="graph_card_row_bang" d="M12 9v4.5" />
    <circle className="graph_card_row_dot" cx="12" cy="16.8" r="1.1" />
  </svg>
);

// High first, then medium; each a group with its count.
const GROUPS = [{ severity: 'high', title: 'High' }, { severity: 'medium', title: 'Medium' }];
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
// The number that raised the alert: a hub's links, a link's weight.
const metricOf = (alert) => {
  if (alert?.type === 'high_degree' && Number.isFinite(Number(alert.degree))) return { value: compact.format(Number(alert.degree)), unit: 'links' };
  if (alert?.type === 'heavy_edge' && Number.isFinite(Number(alert.value))) return { value: compact.format(Number(alert.value)), unit: 'weight' };
  return null;
};
export default function GraphAlertsPanel({
  alerts, summary, emptyText, scanning, nameKey, nameKeys, onNameKey, onFocus, onRescan, canRescan = true, ...frame
}) {
  const high = alerts.filter((alert) => alert.severity === 'high').length;
  const medium = alerts.length - high;
  return (
    <GraphOverlayPanel
      {...frame}
      corner="bottom-right"
      className="is-node-card is-alerts"
      label="Graph Alerts"
      title="Graph Alerts"
      mark={<GraphCardNode tone="alert" count={alerts.length} busy={scanning} small />}
      summary={scanning ? 'Scanning…' : summary}
      bubble={<GraphCardNode tone="alert" count={alerts.length} busy={scanning} />}
      tip={!scanning && alerts.length ? (
        <>
          {high ? <span className="graph_card_chip is-high">{high} high</span> : null}
          {medium ? <span className="graph_card_chip is-medium">{medium} medium</span> : null}
        </>
      ) : null}
    >
      <div className="graph_card_tools">
        {!scanning && alerts.length ? (
          <span className="graph_card_counts">
            {high ? <span className="graph_card_chip is-high">{high} high</span> : null}
            {medium ? <span className="graph_card_chip is-medium">{medium} medium</span> : null}
          </span>
        ) : null}
        <label className="graph_card_field">
          <span>Name by</span>
          <select value={nameKey} title="Choose which node property labels the alerts" onChange={(event) => onNameKey(event.target.value)}>
            <option value="">Auto (first property)</option>
            {nameKeys.map((key) => <option key={key} value={key}>{key}</option>)}
          </select>
        </label>
        <button
          type="button"
          className={`graph_card_button${scanning ? ' is-spinning' : ''}`}
          aria-label="Rescan"
          title={canRescan ? 'Run the alert scan again' : 'Alert rules are off'}
          disabled={scanning || !canRescan}
          onClick={onRescan}
        >
          <RescanIcon />
        </button>
      </div>
      <div className="graph_overlay_list graph_card_list">
        {scanning ? (
          <div className="graph_overlay_loading"><span className="graph_window_spinner" aria-hidden="true" />Scanning graph for alerts…</div>
        ) : alerts.length ? GROUPS.map(({ severity, title: groupTitle }) => {
          const items = alerts.filter((alert) => (alert.severity === 'high') === (severity === 'high'));
          if (!items.length) return null;
          return (
            <section key={severity} className={`graph_card_group is-${severity}`} aria-label={`${groupTitle} severity`}>
              <h5 className="graph_card_group_head">
                <span>{groupTitle}</span>
                <span className="graph_card_group_count">{items.length}</span>
              </h5>
              {items.map((alert, index) => {
                const edge = alert.alert?.type === 'heavy_edge';
                const metric = metricOf(alert.alert);
                return (
                  <button
                    key={alert.key}
                    type="button"
                    className={`graph_card_row is-${alert.severity}${edge ? ' is-edge' : ''}`}
                    style={{ '--i': Math.min(index, 12) }}
                    title={`${alert.detail}\nClick to focus it and open its details in the Info tab.`}
                    onClick={() => onFocus(alert.alert)}
                  >
                    <span className="graph_card_row_mark" aria-hidden="true"><WarningIcon /></span>
                    <span className="graph_card_row_body">
                      <strong className="graph_card_row_name">{alert.name}</strong>
                      <span className="graph_card_row_line">
                        <span className="graph_card_row_category">{alert.category}</span>
                        <span className="graph_card_row_detail">{alert.short}</span>
                      </span>
                      {alert.nameMissing ? <span className="graph_overlay_note">No “{alert.nameMissing}” on this node; named automatically.</span> : null}
                    </span>
                    {metric ? (
                      <span className="graph_card_row_metric">
                        <b>{metric.value}</b>
                        <small>{metric.unit}</small>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </section>
          );
        }) : (
          <div className="graph_card_empty">
            <span className="graph_card_empty_mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false"><path d="m6 12.5 4 4 8-9" /></svg>
            </span>
            <p className="graph_overlay_empty">{emptyText || 'No alerts triggered. The current view did not match any active alert rule.'}</p>
          </div>
        )}
      </div>
      <footer className="graph_card_footer">Click an alert to focus it · drag the top-left corner to resize</footer>
    </GraphOverlayPanel>
  );
}
