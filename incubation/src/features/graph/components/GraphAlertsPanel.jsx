import React from 'react';

import GraphOverlayPanel from './GraphOverlayPanel.jsx';

// Production's Graph Alerts panel (graphs_basic.html #alerts-overlay) in the
// shared overlay frame. "Name by" picks the node property that names each
// alert; clicking a card focuses it; Rescan runs the scan again.
//
// alerts: [{ key, alert, severity, name, category, short, detail, nameMissing }]
// (described; `alert` is the raw alert handed back to onFocus; `short` is the
// card line and `detail` production's full text, the card's tooltip;
// nameMissing is the chosen "Name by" key when this node has no value for it).
const WarningIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 3 2 21h20L12 3Z" />
    <path d="M12 10v5" />
    <circle cx="12" cy="17.6" r="0.4" />
  </svg>
);
const RescanIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M20 11a8 8 0 1 0-2.3 5.6" />
    <path d="M20 4v6h-6" />
  </svg>
);

export default function GraphAlertsPanel({
  alerts, summary, emptyText, scanning, nameKey, nameKeys, onNameKey, onFocus, onRescan, canRescan = true, ...frame
}) {
  return (
    <GraphOverlayPanel {...frame} label="Graph Alerts" title="Graph Alerts" icon={<WarningIcon />} summary={scanning ? 'Scanning…' : summary}>
      <label className="graph_overlay_name">
        <span>Name by</span>
        <select value={nameKey} title="Choose which node property labels the alerts" onChange={(event) => onNameKey(event.target.value)}>
          <option value="">Auto (first property)</option>
          {nameKeys.map((key) => <option key={key} value={key}>{key}</option>)}
        </select>
      </label>
      <div className="graph_overlay_list">
        {scanning ? (
          <div className="graph_overlay_loading"><span className="graph_window_spinner" aria-hidden="true" />Scanning graph for alerts…</div>
        ) : alerts.length ? alerts.map((alert) => (
          <button
            key={alert.key}
            type="button"
            className={`graph_overlay_card is-${alert.severity}`}
            title={`${alert.detail}\nClick to focus it and open its details in the Info tab.`}
            onClick={() => onFocus(alert.alert)}
          >
            <span className="graph_overlay_card_top">
              <strong>{alert.name}</strong>
              <span className="graph_overlay_badge">{alert.severity === 'high' ? 'HIGH' : 'MEDIUM'}</span>
            </span>
            <span className="graph_overlay_category">{alert.category}</span>
            {alert.nameMissing ? <span className="graph_overlay_note">No “{alert.nameMissing}” on this node; named automatically.</span> : null}
            <span className="graph_overlay_detail">{alert.short}</span>
          </button>
        )) : (
          <p className="graph_overlay_empty">{emptyText || 'No alerts triggered. The current view did not match any active alert rule.'}</p>
        )}
      </div>
      <footer className="graph_overlay_footer">
        <span>Click an alert to focus it · drag to move</span>
        <button
          type="button"
          className="graph_window_button is-compact"
          title={canRescan ? 'Run the alert scan again' : 'Alert rules are off'}
          disabled={scanning || !canRescan}
          onClick={onRescan}
        >
          <RescanIcon /> Rescan
        </button>
      </footer>
    </GraphOverlayPanel>
  );
}
