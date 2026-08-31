/**
 * @linkx/graph-preview — Public Type Definitions
 *
 * These types form the entire public contract of the SDK.
 * vis-network internals are intentionally absent.
 */

// ─── Graph Data Types ────────────────────────────────────────

/**
 * A single node in the graph.
 * Consumers pass plain objects matching this shape; the SDK
 * translates them into the internal rendering format.
 */
export interface GraphNode {
  id: string | number;
  label?: string;
  shape?: 'dot' | 'circularImage' | 'box' | 'diamond' | 'image' | 'text';
  size?: number;
  color?: string | {
    background: string;
    border: string;
    hover?: { background: string; border: string };
    highlight?: { background: string; border: string };
  };
  font?: {
    size?: number;
    color?: string;
    face?: string;
  };
  image?: string;
  iconPath?: string;
  borderWidth?: number;
  borderWidthSelected?: number;
  margin?: number;
  shadow?: {
    enabled: boolean;
    color: string;
    size: number;
    x?: number;
    y?: number;
  };
  /** Domain-specific properties (category, department, name, etc.) */
  [key: string]: unknown;
}

/**
 * A single edge in the graph.
 */
export interface GraphEdge {
  id: string | number;
  from: string | number;
  to: string | number;
  label?: string;
  width?: number;
  weight?: number;
  value?: number;
  color?: string | {
    color: string;
    highlight?: string;
    hover?: string;
  };
  arrows?: string;
  dashes?: boolean | number[];
  font?: {
    size?: number;
    color?: string;
    strokeWidth?: number;
    strokeColor?: string;
  };
  smooth?: {
    type?: string;
    roundness?: number;
  };
  /** Domain-specific properties */
  [key: string]: unknown;
}

/**
 * Container for a complete graph dataset.
 */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ─── Configuration Types ─────────────────────────────────────

/**
 * Layout types available for the preview.
 */
export type LayoutType =
  | 'default'
  | 'concentric'
  | 'hierarchical'
  | 'circle'
  | 'star'
  | 'radial'
  | 'grid'
  | 'spiral'
  | 'layered';

/**
 * Layout direction for hierarchical/layered layouts.
 */
export type LayoutDirection = 'UD' | 'LR' | 'DU' | 'RL';

/**
 * SDK configuration options.
 */
export interface PreviewOptions {
  /** Theme mode. Defaults to 'light'. */
  theme?: 'light' | 'dark';
  /** Graph layout algorithm. Defaults to 'default' (force-directed). */
  layout?: LayoutType;
  /** Direction for hierarchical/layered layouts. Defaults to 'UD'. */
  layoutDirection?: LayoutDirection;
  /** Enable/disable physics simulation. Defaults to true. */
  physics?: boolean;
  /** Show node labels. Defaults to true. */
  showLabels?: boolean;
  /** Show tooltips on hover. Defaults to true. */
  showTooltips?: boolean;
  /** Maximum number of nodes to render. Defaults to 25. */
  nodeLimit?: number;
  /** Edge weight mode: '' (none), 'default' (by weight property), or a custom property key. */
  edgeWeighting?: string;
  /** Base URL for resolving icon paths. Defaults to bundled icons. */
  iconBasePath?: string;
  /** Show the "Explore Graph" floating action button. Defaults to true. */
  showExploreButton?: boolean;
}

// ─── Event / Callback Types ──────────────────────────────────

/**
 * Event map for the imperative API.
 */
export interface PreviewEventMap {
  /** Fired when a node is clicked. */
  nodeClick: (node: GraphNode) => void;
  /** Fired when an edge is clicked. */
  edgeClick: (edge: GraphEdge) => void;
  /** Fired when the "Explore Graph" button is clicked. */
  explore: (graphData: GraphData) => void;
  /** Fired when the graph finishes stabilizing and is ready. */
  ready: () => void;
  /** Fired when a rendering error occurs. */
  error: (error: Error) => void;
}

// ─── React Component Props ───────────────────────────────────

export interface LinkAnalysisPreviewProps {
  /** The graph data to render. */
  graph: GraphData;
  /** Configuration options. */
  options?: PreviewOptions;
  /** Called when the "Explore Graph" button is clicked. */
  onExplore?: (graphData: GraphData) => void;
  /** Called when a node is clicked. */
  onNodeClick?: (node: GraphNode) => void;
  /** Called when the graph finishes rendering. */
  onReady?: () => void;
  /** Called on rendering errors. */
  onError?: (error: Error) => void;
  /** CSS class for the container div. */
  className?: string;
  /** Inline styles for the container div. */
  style?: Record<string, string | number>;
}
