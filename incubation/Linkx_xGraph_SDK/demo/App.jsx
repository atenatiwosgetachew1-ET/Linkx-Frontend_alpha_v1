import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LinkAnalysisPreview } from '@linkx/graph-preview';

// ── Sample Graph Data ─────────────────────────────────────────
const SAMPLE_GRAPH_SMALL = {
  nodes: [
    { id: 1, label: 'John Doe', shape: 'circularImage', iconPath: 'Person Male.svg', color: { background: '#4A90D9', border: '#2C6FAC' } },
    { id: 2, label: 'Jane Smith', shape: 'circularImage', iconPath: 'Person Female.svg', color: { background: '#E74C8B', border: '#C0397A' } },
    { id: 3, label: 'Acme Corp', shape: 'circularImage', iconPath: 'Office.svg', color: { background: '#27AE60', border: '#1E8449' } },
    { id: 4, label: 'Bank Account #4521', shape: 'circularImage', iconPath: 'Bank Account.svg', color: { background: '#F39C12', border: '#D4850F' } },
    { id: 5, label: 'Phone: +251-911-XXX', shape: 'circularImage', iconPath: 'Phone.svg', color: { background: '#8E44AD', border: '#6C3483' } },
    { id: 6, label: 'Vehicle ETH-3-12345', shape: 'circularImage', iconPath: 'Car.svg', color: { background: '#16A085', border: '#117A65' } },
    { id: 7, label: 'Location: Addis Ababa', shape: 'circularImage', iconPath: 'Location.svg', color: { background: '#E67E22', border: '#CA6F1E' } },
    { id: 8, label: 'Document #887', shape: 'circularImage', iconPath: 'Document.svg', color: { background: '#3498DB', border: '#2980B9' } },
  ],
  edges: [
    { id: 'e1', from: 1, to: 3, label: 'works_at', arrows: 'to' },
    { id: 'e2', from: 2, to: 3, label: 'works_at', arrows: 'to' },
    { id: 'e3', from: 1, to: 4, label: 'owns', arrows: 'to' },
    { id: 'e4', from: 1, to: 5, label: 'uses', arrows: 'to' },
    { id: 'e5', from: 2, to: 5, label: 'called', arrows: 'to', dashes: [10, 6] },
    { id: 'e6', from: 1, to: 6, label: 'registered_to', arrows: 'to' },
    { id: 'e7', from: 3, to: 7, label: 'located_in', arrows: 'to' },
    { id: 'e8', from: 1, to: 2, label: 'associated_with', arrows: 'to', width: 2 },
    { id: 'e9', from: 4, to: 8, label: 'referenced_in', arrows: 'to' },
  ],
};

const SAMPLE_GRAPH_LARGE = generateLargeGraph(100, 150);

function generateLargeGraph(nodeCount, edgeCount) {
  const shapes = ['dot', 'circularImage', 'box', 'diamond'];
  const iconPaths = ['Person Male.svg', 'Person Female.svg', 'Phone.svg', 'Office.svg', 'Bank.svg', 'Car.svg', 'Computer.svg', 'Globe.svg'];
  const colors = ['#4A90D9', '#E74C8B', '#27AE60', '#F39C12', '#8E44AD', '#16A085', '#E67E22', '#3498DB', '#C0392B', '#2ECC71'];
  const nodes = [];
  const edges = [];

  for (let i = 1; i <= nodeCount; i++) {
    const shape = shapes[i % shapes.length];
    nodes.push({
      id: i,
      label: `Entity ${i}`,
      shape,
      iconPath: shape === 'circularImage' ? iconPaths[i % iconPaths.length] : undefined,
      size: 10 + Math.random() * 20,
      color: { background: colors[i % colors.length], border: '#555' },
    });
  }

  for (let i = 0; i < edgeCount; i++) {
    const from = Math.floor(Math.random() * nodeCount) + 1;
    let to = Math.floor(Math.random() * nodeCount) + 1;
    if (to === from) to = (to % nodeCount) + 1;
    edges.push({
      id: `e${i}`,
      from,
      to,
      label: i % 5 === 0 ? `rel_${i}` : undefined,
      arrows: 'to',
      weight: Math.random() * 10,
    });
  }

  return { nodes, edges };
}

const SAMPLE_GRAPH_MEDIUM = {
  nodes: Array.from({length: 25}, (_, i) => ({
    id: i + 1,
    label: `Node ${i + 1}`,
    shape: 'dot',
    size: 15,
    color: { background: '#3498DB', border: '#2980B9' }
  })),
  edges: [
    { id: 'e1', from: 1, to: 2 }, { id: 'e2', from: 1, to: 3 }, { id: 'e3', from: 1, to: 4 }, { id: 'e4', from: 1, to: 5 },
    { id: 'e5', from: 2, to: 6 }, { id: 'e6', from: 2, to: 7 }, { id: 'e7', from: 3, to: 8 }, { id: 'e8', from: 3, to: 9 },
    { id: 'e9', from: 6, to: 10 }, { id: 'e10', from: 7, to: 11 }, { id: 'e11', from: 8, to: 12 }, { id: 'e12', from: 9, to: 13 },
    { id: 'e13', from: 10, to: 14 }, { id: 'e14', from: 11, to: 15 }, { id: 'e15', from: 12, to: 16 }, { id: 'e16', from: 13, to: 17 },
    { id: 'e17', from: 18, to: 19 }, { id: 'e18', from: 19, to: 20 }, { id: 'e19', from: 20, to: 21 }, { id: 'e20', from: 21, to: 22 },
    { id: 'e21', from: 22, to: 23 }, { id: 'e22', from: 23, to: 24 }, { id: 'e23', from: 24, to: 25 }, { id: 'e24', from: 25, to: 18 },
    { id: 'e25', from: 1, to: 18 }
  ]
};

const LAYOUT_OPTIONS = ['default', 'concentric', 'hierarchical', 'circle', 'star', 'radial', 'grid', 'spiral', 'layered'];

// ── Demo App ──────────────────────────────────────────────────
function DemoApp() {
  const [theme, setTheme] = useState('light');
  const [dynamicLayout, setDynamicLayout] = useState('circle');

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  const handleExplore = (data) => {
    alert(`Explore Graph clicked!\n${data.nodes.length} nodes, ${data.edges.length} edges\n\nIn production, this would navigate to the full Link Analysis module.`);
  };

  const handleNodeClick = (node) => {
    console.log('Node clicked:', node);
  };

  return (
    <>
      <div className="demo-header">
        <h1>@linkx/graph-preview — SDK Demo</h1>
        <button onClick={toggleTheme}>Toggle Theme ({theme})</button>
      </div>
      <div className="demo-grid" style={{ background: theme === 'dark' ? '#0f1720' : '#f4f6f8' }}>
        <div className="demo-card" style={{ background: theme === 'dark' ? '#1a2836' : '#fff', borderColor: theme === 'dark' ? '#2a3f52' : '#dde3ea' }}>
          <div className="demo-card__title" style={{ background: theme === 'dark' ? '#15202d' : '#f9fafb', color: theme === 'dark' ? '#8fa4bd' : '#4a6580', borderColor: theme === 'dark' ? '#2a3f52' : '#eef1f5' }}>
            Small Graph (8 nodes) — Read-Only Preview
          </div>
          <div className="demo-card__body">
            <LinkAnalysisPreview
              graph={SAMPLE_GRAPH_SMALL}
              options={{ theme, showLabels: true, showTooltips: true, nodeLimit: 50 }}
              onExplore={handleExplore}
              onNodeClick={handleNodeClick}
              onReady={() => console.log('Small graph ready')}
            />
          </div>
        </div>

        <div className="demo-card" style={{ background: theme === 'dark' ? '#1a2836' : '#fff', borderColor: theme === 'dark' ? '#2a3f52' : '#dde3ea' }}>
          <div className="demo-card__title" style={{ background: theme === 'dark' ? '#15202d' : '#f9fafb', color: theme === 'dark' ? '#8fa4bd' : '#4a6580', borderColor: theme === 'dark' ? '#2a3f52' : '#eef1f5' }}>
            Large Graph ({SAMPLE_GRAPH_LARGE.nodes.length} nodes) — Performance Test
          </div>
          <div className="demo-card__body">
            <LinkAnalysisPreview
              graph={SAMPLE_GRAPH_LARGE}
              options={{ theme, physics: true, nodeLimit: 100, layout: 'default' }}
              onExplore={handleExplore}
              onReady={() => console.log('Large graph ready')}
            />
          </div>
        </div>

        <div className="demo-card" style={{ background: theme === 'dark' ? '#1a2836' : '#fff', borderColor: theme === 'dark' ? '#2a3f52' : '#dde3ea' }}>
          <div className="demo-card__title" style={{ background: theme === 'dark' ? '#15202d' : '#f9fafb', color: theme === 'dark' ? '#8fa4bd' : '#4a6580', borderColor: theme === 'dark' ? '#2a3f52' : '#eef1f5' }}>
            Empty Graph — Empty State
          </div>
          <div className="demo-card__body">
            <LinkAnalysisPreview
              graph={{ nodes: [], edges: [] }}
              options={{ theme }}
              onExplore={handleExplore}
            />
          </div>
        </div>

        <div className="demo-card" style={{ background: theme === 'dark' ? '#1a2836' : '#fff', borderColor: theme === 'dark' ? '#2a3f52' : '#dde3ea' }}>
          <div className="demo-card__title" style={{ background: theme === 'dark' ? '#15202d' : '#f9fafb', color: theme === 'dark' ? '#8fa4bd' : '#4a6580', borderColor: theme === 'dark' ? '#2a3f52' : '#eef1f5' }}>
            Concentric Layout
          </div>
          <div className="demo-card__body">
            <LinkAnalysisPreview
              graph={SAMPLE_GRAPH_SMALL}
              options={{ theme, layout: 'concentric', physics: false, showLabels: true, nodeLimit: 50 }}
              onExplore={handleExplore}
            />
          </div>
        </div>
        {/* 5. Layout Showcase */}
        <div className="demo-card" style={{ background: theme === 'dark' ? '#1a2836' : '#fff', borderColor: theme === 'dark' ? '#2a3f52' : '#dde3ea' }}>
          <div className="demo-card__title" style={{ background: theme === 'dark' ? '#15202d' : '#f9fafb', color: theme === 'dark' ? '#8fa4bd' : '#4a6580', borderColor: theme === 'dark' ? '#2a3f52' : '#eef1f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Layout Showcase</span>
            <select 
              value={dynamicLayout} 
              onChange={e => setDynamicLayout(e.target.value)} 
              style={{ padding: '2px 8px', fontSize: '13px', background: theme === 'dark' ? '#2a3f52' : '#fff', color: theme === 'dark' ? '#fff' : '#000', border: '1px solid', borderColor: theme === 'dark' ? '#4a6580' : '#ccc', borderRadius: '4px' }}
            >
              {LAYOUT_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="demo-card__body">
            <LinkAnalysisPreview
              graph={SAMPLE_GRAPH_MEDIUM}
              options={{ theme, layout: dynamicLayout, physics: dynamicLayout === 'default' }}
              onExplore={handleExplore}
            />
          </div>
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')).render(<DemoApp />);
