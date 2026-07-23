import React, { useState } from 'react';
import { useNotifications } from '../../../shared/notifications/useNotifications.js';

export default function GraphWindowBody({ windowItem }) {
  const { notify } = useNotifications();
  const [performanceMood, setPerformanceMood] = useState('normal');
  const [searchQuery, setSearchQuery] = useState('');

  const handlePhysicsToggle = () => {
    notify({
      title: 'Graph Physics',
      message: 'Physics layout updated.',
      level: 'info',
    });
  };

  return (
    <div className="graph_window_body">
      <div className="graph_window_toolbar">
        <div className="graph_window_search">
          <input
            type="text"
            placeholder="Search nodes & edges..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button type="button" className="graph_btn_primary">
            Find
          </button>
        </div>
        <div className="graph_window_controls">
          <button type="button" className="graph_btn_secondary" onClick={handlePhysicsToggle}>
            Physics: On
          </button>
          <select
            value={performanceMood}
            onChange={(e) => setPerformanceMood(e.target.value)}
            className="graph_select"
          >
            <option value="high">High Performance</option>
            <option value="normal">Balanced Mode</option>
            <option value="quality">Quality Visuals</option>
          </select>
        </div>
      </div>

      <div className="graph_window_canvas_wrapper">
        <div className="graph_canvas_placeholder">
          <div className="graph_canvas_grid_bg" />
          <div className="graph_canvas_status_hud">
            <span>Nodes: 0</span>
            <span>Edges: 0</span>
            <span>Mode: {performanceMood.toUpperCase()}</span>
          </div>
          <div className="graph_canvas_center_message">
            <svg className="graph_icon_lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M7 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm10 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM7 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm2.2-4.2 5.6-7.6M9.5 7.3l5 8.2" />
            </svg>
            <h3>Graph Canvas Active</h3>
            <p>Connect a Data Source or run ingestion to populate graph nodes.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
