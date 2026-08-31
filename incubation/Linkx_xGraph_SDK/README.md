# @linkx/graph-preview

> Read-only Link Analysis graph preview SDK for embedding in sibling platform modules.

## Quick Start — React

```jsx
import { LinkAnalysisPreview } from '@linkx/graph-preview';

function MyPage() {
  const graphData = {
    nodes: [
      { id: 1, label: 'John', shape: 'circularImage', iconPath: 'Person Male.svg', color: { background: '#4A90D9', border: '#2C6FAC' } },
      { id: 2, label: 'Acme Corp', shape: 'circularImage', iconPath: 'Office.svg', color: { background: '#27AE60', border: '#1E8449' } },
    ],
    edges: [
      { id: 'e1', from: 1, to: 2, label: 'works_at', arrows: 'to' },
    ],
  };

  return (
    <LinkAnalysisPreview
      graph={graphData}
      options={{ theme: 'light', layout: 'default', nodeLimit: 50 }}
      onExplore={(data) => navigateToLinkAnalysis(data)}
      onNodeClick={(node) => console.log('Clicked:', node)}
    />
  );
}
```

## Quick Start — Vanilla JS

```js
import GraphRenderer from '@linkx/graph-preview';

const renderer = new GraphRenderer(document.getElementById('graph-container'), {
  theme: 'dark',
  physics: true,
  nodeLimit: 100,
});

renderer.setGraph({ nodes: [...], edges: [...] });
renderer.on('nodeClick', (node) => console.log(node));
renderer.on('explore', (data) => window.location.href = '/link-analysis?graph=' + data.id);

// Cleanup
renderer.destroy();
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `theme` | `'light' \| 'dark'` | `'light'` | Color theme |
| `layout` | `string` | `'default'` | Layout algorithm: `default`, `concentric`, `hierarchical`, `circle`, `star`, `radial`, `grid`, `spiral`, `layered` |
| `layoutDirection` | `string` | `'UD'` | Direction for hierarchical/layered: `UD`, `LR`, `DU`, `RL` |
| `physics` | `boolean` | `true` | Enable force-directed physics |
| `showLabels` | `boolean` | `true` | Show node labels |
| `showTooltips` | `boolean` | `true` | Show tooltips on hover |
| `nodeLimit` | `number` | `25` | Max nodes to render |
| `edgeWeighting` | `string` | `''` | Edge weight property key |
| `showExploreButton` | `boolean` | `true` | Show "Explore Graph" button |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `nodeClick` | `GraphNode` | Node was clicked |
| `edgeClick` | `GraphEdge` | Edge was clicked |
| `explore` | `GraphData` | "Explore Graph" button clicked |
| `ready` | — | Graph finished rendering |
| `error` | `Error` | Rendering error occurred |

## Graph Data Format

```typescript
interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GraphNode {
  id: string | number;
  label?: string;
  shape?: 'dot' | 'circularImage' | 'box' | 'diamond' | 'image' | 'text';
  size?: number;
  color?: string | { background: string; border: string };
  iconPath?: string;      // Icon name, e.g. "Person Male.svg"
  [key: string]: unknown; // Domain properties
}

interface GraphEdge {
  id: string | number;
  from: string | number;
  to: string | number;
  label?: string;
  weight?: number;
  arrows?: string;
  [key: string]: unknown;
}
```

## Architecture

```
Consumer App
    │
    ▼
@linkx/graph-preview
    ├── LinkAnalysisPreview (React component)
    ├── GraphRenderer (vanilla JS class)
    │     ├── GraphStore (data model)
    │     ├── ThemeEngine (light/dark)
    │     ├── LayoutEngine (7 algorithms)
    │     ├── VisualEngine (encoding)
    │     └── vis-network (INTERNAL — never exposed)
    └── Bundled SVG icons (104 icons)
```

## What This SDK Does NOT Include

This is a **preview** SDK. Advanced Link Analysis features remain exclusive to the full module:

- ❌ Graph traversal / node expansion
- ❌ Relationship expansion
- ❌ Advanced filtering / path analysis
- ❌ Graph editing (add/remove/merge nodes)
- ❌ Undo/redo history
- ❌ Investigation workflows
- ❌ Report generation

Use the **"Explore Graph"** button to navigate users to the full Link Analysis module.
