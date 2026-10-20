# Linkx Graph Preview SDK (`@linkx/graph-preview`) — Integration Handoff Document

**Document Version:** 1.0  
**SDK Version:** `v0.2.0`  
**Target Audience:** Sibling Service Developers, Platform Frontend Engineers, Module Integrators  
**GitHub Repository:** `https://github.com/atenatiwosgetachew1-ET/linkx-graph-preview-sdk.git`  
**Latest Stable Tag:** `v0.2.0`

---

## 1. Overview & Purpose

The **Linkx Graph Preview SDK** (`@linkx/graph-preview`) is a lightweight, zero-configuration graph preview component designed for embedding inside sibling platform modules, dashboard widgets, transaction feeds, and modal previews.

### Key Goals & Guarantees
* **Visual Parity:** Matches the exact visual styling, dark/light themes, icon sets, node colors, and edge typologies of the full Link Analysis workbench.
* **Encapsulated Dependencies:** Sibling applications **do not** need to install `vis-network`, `vis-data`, or complex canvas math libraries. Everything is self-contained.
* **Performance Safety Cap:** Automatically enforces a hard limit of **25 nodes and 25 edges**. Passing large datasets will never lock up the browser thread or lag parent dashboard views.
* **Drop-in React & Vanilla Support:** Exposes both a standard React component (`<LinkAnalysisPreview />`) and an imperative class (`GraphRenderer`).

---

## 2. Quick Start & Installation

Install the package directly from GitHub locked to the latest stable release tag:

```bash
npm install git+https://github.com/atenatiwosgetachew1-ET/linkx-graph-preview-sdk.git#v0.2.0
```

> **Note on Peer Dependencies:**  
> The SDK expects React `^18.0.0` or `^19.0.0` as a peer dependency (which your React app already has). No other external dependencies are required.

---

## 3. React Integration Guide

### Minimal Example (Dashboard Widget)

```jsx
import React from 'react';
import { LinkAnalysisPreview } from '@linkx/graph-preview';

export function AccountGraphCard({ accountData }) {
  const graphData = {
    nodes: [
      { 
        id: 'ACC-1001', 
        label: 'Abebe Kebede', 
        shape: 'circularImage', 
        iconPath: 'Person Male.svg',
        color: { background: '#4A90D9', border: '#2C6FAC' } 
      },
      { 
        id: 'ACC-2002', 
        label: 'Commercial Bank', 
        shape: 'circularImage', 
        iconPath: 'Bank Account.svg',
        color: { background: '#27AE60', border: '#1E8449' } 
      }
    ],
    edges: [
      { 
        id: 'e1', 
        from: 'ACC-1001', 
        to: 'ACC-2002', 
        label: 'transfer', 
        financial_flow: true, 
        directed_display: true,
        reason: 'Initial deposit'
      }
    ]
  };

  return (
    // IMPORTANT: The wrapper MUST have an explicit height (e.g. 350px or height: 100%)
    <div style={{ width: '100%', height: '350px', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
      <LinkAnalysisPreview
        graph={graphData}
        options={{
          theme: 'light',       // 'light' | 'dark'
          layout: 'default',    // 'default' (force-directed) | 'circle' | 'hierarchical' | etc.
          physics: true,
          showExploreButton: true
        }}
        onExplore={(data) => {
          // Redirect user to the full Link Analysis module
          window.location.href = `/linkxDS2026/?targetAccount=${accountData.id}`;
        }}
        onNodeClick={(node) => {
          console.log('Clicked node:', node);
        }}
      />
    </div>
  );
}
```

---

## 4. Component Props Specification

`<LinkAnalysisPreview />` accepts the following props:

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `graph` | `GraphData` | **Required** | The graph object containing `{ nodes: [...], edges: [...] }`. |
| `options` | `PreviewOptions` | `{}` | Configuration object controlling theme, layouts, physics, and limits. |
| `onExplore` | `(data) => void` | `undefined` | Callback fired when the top-right "⬈ Explore Graph" button is clicked. |
| `onNodeClick` | `(node) => void` | `undefined` | Callback fired when a node is clicked. Passes the clicked node data. |
| `onReady` | `() => void` | `undefined` | Fired when the layout stabilizes and the camera finishes centering. |
| `onError` | `(error) => void` | `undefined` | Fired if a rendering or data parsing error occurs. |
| `className` | `string` | `""` | Optional CSS class applied to the outer wrapper container. |
| `style` | `object` | `{}` | Optional inline styles applied to the outer wrapper container. |

---

## 5. Configuration Options (`options` prop)

```javascript
const options = {
  theme: 'dark',              // 'light' | 'dark' (Default: 'light')
  layout: 'default',          // See Layout Options below (Default: 'default')
  layoutDirection: 'UD',      // 'UD' | 'LR' | 'DU' | 'RL' for hierarchical/layered
  physics: true,              // Enable/disable force-directed physics
  showLabels: true,           // Toggle node labels under shapes
  showTooltips: true,         // Toggle hover tooltips on nodes and edges
  showExploreButton: true,    // Show/hide the top-right "⬈ Explore Graph" button
  edgeWeighting: '',          // '' (none) | 'default' (auto scale width by weight)
  iconBasePath: ''            // Optional base URL for external SVG icons
};
```

### Supported Layout Algorithms (`layout`)
1. `'default'` — Force-directed physics tuned with a low `minVelocity: 0.75` for smooth, jitter-free settling.
2. `'hierarchical'` — Strict tree hierarchy (top-down or left-right).
3. `'layered'` — Identity/rank based grouping (source → entity → target) with barycenter crossing reduction.
4. `'concentric'` — Degree-ranked concentric rings (highest-connected nodes at the center).
5. `'radial'` — BFS hop-distance rings originating from the central node.
6. `'circle'` — Clean geometric circle.
7. `'star'` — High-degree hub with peripheral nodes in an outer ring.
8. `'grid'` — Structured row/column matrix.
9. `'spiral'` — Archimedean spiral formation.

---

## 6. Data Contract (Node & Edge Format)

### Node Object Schema
```javascript
{
  id: "1001",                   // string | number (Required, unique)
  label: "Jane Doe",            // Display label under the node
  shape: "circularImage",       // 'dot' | 'circularImage' | 'box' | 'diamond' | 'image'
  iconPath: "Person Female.svg",// Bundled SVG icon name (see Icon section)
  size: 15,                     // Node radius/size (Default: 15)
  color: {
    background: "#4A90D9",      // Hex base color
    border: "#2C6FAC"
    // Note: 'hover' and 'highlight' colors are automatically synthesized 
    // (+12% and +18% brightness) if omitted!
  },
  // Custom business properties (automatically shown in hover tooltip):
  category: "Individual",
  department: "Retail Banking",
  risk_level: "High"
}
```

### Edge Object Schema & Semantic Typologies (New in `v0.2.0`)
Edges automatically adapt their arrows, stroke patterns, and tooltips based on business semantics:

```javascript
{
  id: "e1",                     // string | number (Required)
  from: "1001",                 // Source node ID (Required)
  to: "2002",                   // Target node ID (Required)
  label: "transfer",            // Edge label text
  weight: 50000,                // Edge weight/value (used for width scaling)
  
  // ── Semantic Edge Typologies (Automatic Visual Styling) ──
  // 1. Observed Financial Transfer (Solid bold arrow):
  financial_flow: true,
  directed_display: true,

  // 2. Temporal Sequence (Dotted sequence arrow):
  // financial_flow: false, directed_display: true,

  // 3. Analytical Grouping (Dashed undirected line, no arrow):
  // financial_flow: false, directed_display: false,

  // 4. Node Flag Badge (Amber warning fine-dotted badge):
  // edge_semantic: "NODE_FLAG",

  // 5. Structural Theme Line (Gray dashed boundary line):
  // edge_kind: "theme_line",

  // ── Enriched Tooltip Fields ──
  reason: "Multiple rapid transactions under threshold",
  hub_account: "ACCT-899120",
  _semanticTooltip: "Observed monetary flow"
}
```

---

## 7. Built-in Bundled Icons

The SDK comes with **103 pre-compiled SVG icons** bundled directly inside the code as lightweight data URIs. Consumers do not need to host image files or configure static asset paths.

Simply pass the icon file name into `iconPath`:

| Category | Available Icon Names |
| :--- | :--- |
| **People & Entities** | `Person.svg`, `Person Male.svg`, `Person Female.svg`, `Agent.svg`, `Support agent.svg` |
| **Banking & Finance** | `Bank.svg`, `Bank Account.svg`, `Money.svg`, `Cart.svg`, `Shopping.svg` |
| **Vehicles & Travel** | `Car.svg`, `Car 1.svg`, `Motorcycle.svg`, `Bicycle.svg`, `Boat.svg`, `Airplane.svg`, `Flight.svg`, `Drone.svg` |
| **Communication** | `Phone.svg`, `Mobile.svg`, `Mail.svg`, `Message.svg`, `Comment.svg`, `Mic.svg` |
| **Tech & Infra** | `Computer.svg`, `Server.svg`, `Database.svg`, `Signal.svg`, `Bluetooth.svg`, `Globe.svg` |
| **Places & Assets** | `Office.svg`, `Home.svg`, `Hospital.svg`, `Motel.svg`, `Restaurant.svg`, `Location.svg`, `Map.svg` |
| **Documents & Data** | `Document.svg`, `Document 1.svg`, `Documents.svg`, `Tag.svg`, `Lock.svg` |

*(In Dark Mode, icons are automatically recolored to bright white for high contrast).*

---

## 8. Non-React / Vanilla JavaScript Usage

If integrating into a non-React dashboard or vanilla web application, use the imperative `GraphRenderer` directly:

```javascript
import { GraphRenderer } from '@linkx/graph-preview';

const container = document.getElementById('graph-preview-container');

// Instantiate
const renderer = new GraphRenderer(container, {
  theme: 'dark',
  layout: 'concentric',
  physics: false
});

// Load Graph
renderer.setGraph(graphData);

// Listen to events
renderer.on('nodeClick', (node) => {
  alert(`Clicked: ${node.label}`);
});

renderer.on('explore', (data) => {
  window.location.href = `/full-view`;
});

// Cleanup on page unmount
// renderer.destroy();
```

---

## 9. Troubleshooting & Best Practices

1. **"The graph appears as a 0px high line or is blank."**  
   * **Cause:** The parent container has no defined CSS height.  
   * **Fix:** Ensure the parent wrapping element has a defined height (e.g., `height: 350px`, `height: 100%`, or `flex: 1`). The preview canvas automatically fills 100% of its parent.

2. **"Does passing 1,000 nodes cause browser lag?"**  
   * **Answer:** No. The SDK enforces an internal safety slice of **max 25 nodes and 25 edges**. It will safely isolate the top connected components and render them without freezing the UI thread.

3. **"How do I prevent re-rendering loops in React?"**  
   * **Best Practice:** Wrap the `options` and `graph` objects in React's `useMemo` if they are defined inline inside your component body.

---

## 10. Release Verification

* **Git Tag:** `v0.2.0` (Commit: `bea33bf`)
* **Registry Status:** Verified and reachable via Git URL.
* **Tested With:** React 18, React 19, Vite, Webpack, and Vanilla JS.
