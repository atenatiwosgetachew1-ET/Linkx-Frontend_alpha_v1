import React, { useState } from 'react';

export default function ChartWindowBody({ windowItem }) {
  const [chartType, setChartType] = useState('bar');
  const [metric, setMetric] = useState('frequency');

  return (
    <div className="chart_window_body">
      <div className="chart_window_toolbar">
        <div className="chart_controls_group">
          <label>
            <span>Chart Type</span>
            <select value={chartType} onChange={(e) => setChartType(e.target.value)} className="chart_select">
              <option value="bar">Bar Chart</option>
              <option value="line">Trend Line</option>
              <option value="pie">Node Distribution</option>
              <option value="radar">Multi-Metric Radar</option>
            </select>
          </label>
          <label>
            <span>Metric</span>
            <select value={metric} onChange={(e) => setMetric(e.target.value)} className="chart_select">
              <option value="frequency">Node Degree / Frequency</option>
              <option value="centrality">Eigenvector Centrality</option>
              <option value="weight">Edge Weight Sum</option>
            </select>
          </label>
        </div>
      </div>

      <div className="chart_canvas_wrapper">
        <div className="chart_placeholder_hud">
          <div className="chart_placeholder_icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 20V10m7 10V4m7 16v-7M3 20h18" />
            </svg>
          </div>
          <h3>Analytics Chart Canvas</h3>
          <p>Select graph nodes or ingest dataframes to render analytics charts.</p>
        </div>
      </div>
    </div>
  );
}
