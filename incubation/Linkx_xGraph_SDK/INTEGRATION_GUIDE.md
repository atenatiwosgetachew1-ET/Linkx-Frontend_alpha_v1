# Link Analysis Preview SDK — Integration Guide

This guide explains how to seamlessly embed the read-only Link Analysis graph preview into your sibling React modules. 

The SDK handles all complex physics, theming, and layout calculations internally, exposing a very simple API.

## Step 1: Install the Package
Because this is an internal package hosted on GitHub, you can install it directly using the Git URL. We strongly recommend appending `#v0.1.0` (or whatever the latest stable version tag is) to lock your project to a stable release.

Run this command in your project directory:
```bash
npm install git+https://github.com/atenatiwosgetachew1-ET/linkx-graph-preview-sdk.git#v0.1.0
```

## Step 2: Import the Component
Import the React wrapper component into your target file.
```jsx
import { LinkAnalysisPreview } from '@linkx/graph-preview';
```

## Step 3: Prepare Your Graph Data
The component expects a standard graph object containing `nodes` and `edges` arrays. 

**Important Limit:** Because this is a lightweight preview component, the SDK has a hardcoded safety limit of **25 nodes** and **25 edges**. If you pass a larger dataset, the SDK will automatically safely truncate it to protect your page's performance.

```javascript
const myGraphData = {
  nodes: [
    { 
      id: 1, 
      label: 'John Doe', 
      shape: 'dot', 
      color: { background: '#3498DB', border: '#2980B9' } 
    },
    { 
      id: 2, 
      label: 'Acme Corp', 
      shape: 'dot', 
      color: { background: '#27AE60', border: '#1E8449' } 
    }
  ],
  edges: [
    { id: 'e1', from: 1, to: 2, label: 'works_at' }
  ]
};
```

## Step 4: Render in Your UI
Render the `<LinkAnalysisPreview />` component. 

**Styling Note:** Ensure the parent container wrapping the component has a defined height (e.g., `400px` or `flex: 1`), as the graph canvas will automatically scale to fill exactly `100%` of its parent wrapper.

```jsx
export default function MyDashboardCard() {
  return (
    <div style={{ height: '400px', border: '1px solid #ccc', borderRadius: '8px' }}>
      <LinkAnalysisPreview
        graph={myGraphData}
        options={{
          theme: 'light',       // 'light' or 'dark'
          layout: 'default',    // e.g., 'default', 'circle', 'hierarchical'
          physics: true         // true for physics, false for rigid geometric layouts
        }}
        onExplore={() => {
          // Triggered when the user clicks the fullscreen/explore button
          window.location.href = '/full-link-analysis?graphId=123';
        }}
        onNodeClick={(node) => {
          // Optional: React to node clicks
          console.log('User clicked node details:', node);
        }}
      />
    </div>
  );
}
```

## Configuration Options (`options` prop)

* **`theme`**: `'light'` | `'dark'` (Automatically perfectly mirrors the main app's color palette).
* **`layout`**: Choose the algorithm to arrange the nodes:
  * `'default'` (Force-directed physics engine)
  * `'circle'`, `'star'`, `'radial'`, `'grid'`, `'spiral'`, `'concentric'`, `'layered'` (Geometric manual layouts)
  * `'hierarchical'` (Strict top-down tree layout)
* **`physics`**: `boolean`. (Usually `true` if layout is `'default'`, and `false` for geometric layouts so they don't bounce).
