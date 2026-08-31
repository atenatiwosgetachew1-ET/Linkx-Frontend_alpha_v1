/**
 * GraphRenderer — The central orchestrator for the Linkx graph preview SDK.
 *
 * This class encapsulates vis-network completely. Consumers never see or
 * interact with vis-network directly. It coordinates:
 *   - GraphStore (data model + windowing)
 *   - ThemeEngine (light/dark theming)
 *   - LayoutEngine (coordinate computation)
 *   - VisualEngine (node/edge styling, encoding)
 *   - IconResolver (bundled icon resolution)
 *
 * Usage:
 *   const renderer = new GraphRenderer(containerDiv, { theme: 'light' });
 *   renderer.setGraph({ nodes: [...], edges: [...] });
 *   renderer.on('nodeClick', (node) => { ... });
 *   renderer.destroy();
 */
import { Network, DataSet } from 'vis-network/standalone';
import GraphStore from './GraphStore.js';
import { ThemeEngine } from './ThemeEngine.js';
import { computeLayout, isManualLayout, AUTO_PHYSICS_THRESHOLD } from './LayoutEngine.js';
import {
  buildNodeLabel,
  buildNodeTooltip,
  buildEdgeTooltip,
  computeEdgeWeights,
  normalizeGraphId,
  toFiniteNumber,
} from './VisualEngine.js';
import { resolveIcon } from '../icons/IconResolver.js';
import { injectStyles } from './styles.js';

/** Default physics configuration — matches the production Link Analysis module. */
const STABLE_PHYSICS = {
  enabled: true,
  stabilization: {
    enabled: true,
    iterations: 350,
    fit: true,
  },
  barnesHut: {
    gravitationalConstant: -14500,
    springLength: 12,
    springConstant: 0.06,
    damping: 0.85,
  },
  maxVelocity: 18,
  minVelocity: 0.75,
  timestep: 0.6,
};

/** Default options matching the production Link Analysis module appearance. */
const DEFAULT_OPTIONS = {
  theme: 'light',
  layout: 'default',
  layoutDirection: 'UD',
  physics: true,
  showLabels: true,
  showTooltips: true,
  nodeLimit: 25,
  edgeWeighting: '',
  iconBasePath: '',
  showExploreButton: true,
};

/**
 * @class GraphRenderer
 * Completely encapsulates vis-network. Public API exposes only platform
 * graph concepts — never vis-network internals.
 */
export class GraphRenderer {
  /**
   * @param {HTMLElement} container - DOM element to render into
   * @param {object} [options] - PreviewOptions
   */
  constructor(container, options = {}) {
    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('GraphRenderer requires a valid HTMLElement container.');
    }

    injectStyles();

    this._container = container;
    this._options = { ...DEFAULT_OPTIONS, ...options };
    this._listeners = new Map();
    this._destroyed = false;

    // ── Internal engines (not exposed) ──
    this._store = new GraphStore({ nodeLimit: this._options.nodeLimit });
    this._theme = new ThemeEngine(this._options.theme);

    // ── vis-network internals (NEVER exposed) ──
    this._nodesDataSet = new DataSet();
    this._edgesDataSet = new DataSet();
    this._network = null;

    // ── Build the DOM ──
    this._buildDom();

    // ── Create vis.Network ──
    this._createNetwork();
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════

  /**
   * Load and render a graph dataset.
   * @param {{ nodes: Array, edges: Array }} data
   */
  setGraph(data) {
    if (this._destroyed) return;
    const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
    const edges = Array.isArray(data?.edges) ? data.edges : [];

    if (nodes.length === 0) {
      this._showEmpty();
      return;
    }

    this._hideEmpty();
    this._hideError();
    this._showLoading();

    try {
      // Load into store
      this._store.setGraph({ nodes, edges });

      // Compute visible subset
      this._store.computeVisibleSubset({
        amount: this._options.nodeLimit,
      });

      // Render to vis-network
      this._renderGraph();

      // Apply layout if manual
      if (isManualLayout(this._options.layout)) {
        this._applyManualLayout();
      }

      // Update stats badge
      this._updateStats();
    } catch (err) {
      this._showError(err);
      this._emit('error', err);
    }
  }

  /**
   * Update configuration options.
   * @param {object} opts - Partial PreviewOptions
   */
  updateOptions(opts) {
    if (this._destroyed) return;
    const prev = { ...this._options };
    this._options = { ...this._options, ...opts };

    // Theme change
    if (opts.theme && opts.theme !== prev.theme) {
      this._theme.setMode(this._options.theme);
      this._wrapper.setAttribute('data-theme', this._options.theme);
      this._theme.applyToNetwork(this._network);
      this._network.setOptions({
        nodes: { font: { color: this._theme.getNodeLabelColor() } },
      });
      // Re-render nodes with new theme colors
      if (this._store.nodeCount > 0) {
        this._renderGraph();
      }
    }

    // Physics change
    if (opts.physics !== undefined && opts.physics !== prev.physics) {
      this._network.setOptions({
        physics: opts.physics ? STABLE_PHYSICS : { enabled: false },
      });
      if (!opts.physics) this._network.stopSimulation();
    }

    // Layout change
    if (opts.layout && opts.layout !== prev.layout) {
      if (isManualLayout(this._options.layout)) {
        this._network.setOptions({ 
          layout: { hierarchical: { enabled: false } },
          physics: { enabled: false } 
        });
        this._network.stopSimulation();
        this._applyManualLayout();
      } else if (this._options.layout === 'hierarchical') {
        this._network.setOptions({
          layout: {
            hierarchical: {
              enabled: true,
              direction: this._options.layoutDirection || 'UD',
              sortMethod: 'directed',
            },
          },
        });
      } else {
        this._network.setOptions({
          layout: { hierarchical: { enabled: false } },
          physics: this._options.physics ? STABLE_PHYSICS : { enabled: false },
        });
      }
    }

    // Node limit change
    if (opts.nodeLimit !== undefined && opts.nodeLimit !== prev.nodeLimit) {
      this._store.computeVisibleSubset({ amount: this._options.nodeLimit });
      this._renderGraph();
    }

    // Labels/tooltips toggle
    if (opts.showLabels !== undefined || opts.showTooltips !== undefined) {
      this._renderGraph();
    }

    this._updateStats();
  }

  /** 
   * Fit the graph to the viewport. 
   * @param {boolean} [animate=true] - Whether to animate the camera movement
   */
  fitToView(animate = true) {
    if (this._destroyed || !this._network) return;
    if (animate) {
      this._network.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
    } else {
      this._network.fit();
    }
  }

  /**
   * Register an event listener.
   * @param {string} event - Event name (nodeClick, edgeClick, explore, ready, error)
   * @param {Function} handler
   */
  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
  }

  /**
   * Remove an event listener.
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    const handlers = this._listeners.get(event);
    if (handlers) handlers.delete(handler);
  }

  /**
   * Get the current graph data (for the Explore callback).
   * @returns {{ nodes: Array, edges: Array }}
   */
  getGraphData() {
    return {
      nodes: Array.from(this._store.nodes.values()),
      edges: Array.from(this._store.edges.values()),
    };
  }

  /** Destroy the renderer and clean up all resources. */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    if (this._network) {
      this._network.destroy();
      this._network = null;
    }
    this._nodesDataSet.clear();
    this._edgesDataSet.clear();
    this._store.clear();
    this._listeners.clear();

    // Remove DOM
    if (this._wrapper && this._wrapper.parentNode) {
      this._wrapper.parentNode.removeChild(this._wrapper);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE — DOM Construction
  // ═══════════════════════════════════════════════════════════

  _buildDom() {
    // Wrapper
    this._wrapper = document.createElement('div');
    this._wrapper.className = 'linkx-graph-preview';
    this._wrapper.setAttribute('data-theme', this._options.theme);

    // Canvas container (for vis-network)
    this._canvas = document.createElement('div');
    this._canvas.className = 'linkx-graph-preview__canvas';
    this._wrapper.appendChild(this._canvas);

    // Loading overlay
    this._loadingEl = document.createElement('div');
    this._loadingEl.className = 'linkx-graph-preview__loading';
    const spinner = document.createElement('div');
    spinner.className = 'linkx-graph-preview__spinner';
    this._loadingEl.appendChild(spinner);
    this._loadingEl.style.display = 'none';
    this._wrapper.appendChild(this._loadingEl);

    // Empty state
    this._emptyEl = document.createElement('div');
    this._emptyEl.className = 'linkx-graph-preview__empty';
    const emptyIcon = document.createElement('div');
    emptyIcon.className = 'linkx-graph-preview__empty-icon';
    emptyIcon.textContent = '◇';
    const emptyText = document.createElement('div');
    emptyText.textContent = 'No graph data';
    this._emptyEl.appendChild(emptyIcon);
    this._emptyEl.appendChild(emptyText);
    this._emptyEl.style.display = 'none';
    this._wrapper.appendChild(this._emptyEl);

    // Error state
    this._errorEl = document.createElement('div');
    this._errorEl.className = 'linkx-graph-preview__error';
    this._errorEl.style.display = 'none';
    this._wrapper.appendChild(this._errorEl);

    // Explore button
    if (this._options.showExploreButton) {
      this._exploreBtn = document.createElement('button');
      this._exploreBtn.className = 'linkx-graph-preview__explore-btn';
      this._exploreBtn.textContent = '⬈ Explore Graph';
      this._exploreBtn.addEventListener('click', () => {
        this._emit('explore', this.getGraphData());
      });
      this._wrapper.appendChild(this._exploreBtn);
    }

    // Stats badge
    this._statsEl = document.createElement('div');
    this._statsEl.className = 'linkx-graph-preview__stats';
    this._statsEl.textContent = '';
    this._wrapper.appendChild(this._statsEl);

    this._container.appendChild(this._wrapper);
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE — vis-network Management
  // ═══════════════════════════════════════════════════════════

  _createNetwork() {
    const visOptions = {
      nodes: {
        shape: 'dot',
        size: 15,
        font: { size: 16, color: this._theme.getNodeLabelColor() },
        borderWidth: 1.3,
        borderWidthSelected: 2,
        margin: 5,
        color: this._theme.getNodeDefaults(),
      },
      edges: {
        arrows: 'to',
        width: 0.85,
        hoverWidth: 1.05,
        selectionWidth: 1.15,
        font: { size: 10, strokeWidth: 0.8, strokeColor: 'rgba(0,0,0,0.12)' },
        color: this._theme.getEdgeDefaults(),
        smooth: { type: 'dynamic', roundness: 0.1 },
      },
      interaction: {
        hover: true,
        multiselect: false,
        navigationButtons: false,
        keyboard: false,
        dragNodes: true,
      },
      physics: this._options.physics ? STABLE_PHYSICS : { enabled: false },
      layout: {},
    };

    // Hierarchical layout
    if (this._options.layout === 'hierarchical') {
      visOptions.layout.hierarchical = {
        enabled: true,
        direction: this._options.layoutDirection || 'UD',
        sortMethod: 'directed',
      };
    }

    this._network = new Network(
      this._canvas,
      { nodes: this._nodesDataSet, edges: this._edgesDataSet },
      visOptions
    );

    // ── Read-only event wiring ──
    this._network.on('click', (params) => {
      if (params.nodes && params.nodes.length > 0) {
        const nodeId = params.nodes[0];
        const nodeData = this._store.getNode(nodeId);
        if (nodeData) this._emit('nodeClick', { ...nodeData });
      } else if (params.edges && params.edges.length > 0) {
        const edgeId = params.edges[0];
        const edgeData = this._store.getEdge(edgeId);
        if (edgeData) this._emit('edgeClick', { ...edgeData });
      }
    });

    this._handleReady = () => {
      if (this._loadingEl && this._loadingEl.style.display !== 'none') {
        this._hideLoading();
        // Delay fitting by 1 frame to ensure vis-network canvas size has fully settled
        setTimeout(() => {
          if (this._network && !this._destroyed) {
            this.fitToView(false); // Instant fit, no animation
          }
        }, 10);
        this._emit('ready');
      }
    };

    this._network.on('stabilizationIterationsDone', this._handleReady);
    this._network.on('stabilized', this._handleReady);
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE — Graph Rendering Pipeline
  // ═══════════════════════════════════════════════════════════

  _renderGraph() {
    // Fallback timeout to ensure load screen clears if events misfire
    if (this._fallbackTimeout) clearTimeout(this._fallbackTimeout);
    this._fallbackTimeout = setTimeout(() => {
      if (this._handleReady) this._handleReady();
    }, 2500);
    const filteredIds = this._store.getFilteredVisibleIds();
    let desiredNodeIds = filteredIds.nodeIds;
    let desiredEdgeIds = filteredIds.edgeIds;

    // FORCED SDK PREVIEW LIMITS: Static max 25 nodes, 25 edges
    if (desiredNodeIds.size > 25) {
      desiredNodeIds = new Set(Array.from(desiredNodeIds).slice(0, 25));
    }
    
    // Filter edges to ensure they only connect the surviving nodes
    const validEdges = [];
    for (const edgeId of desiredEdgeIds) {
      const edge = this._store.getEdge(edgeId);
      if (edge && desiredNodeIds.has(edge.from) && desiredNodeIds.has(edge.to)) {
        validEdges.push(edgeId);
      }
    }
    
    desiredEdgeIds = new Set(validEdges.slice(0, 25));

    // ── Performance guard: auto-disable physics for large graphs ──
    if (desiredNodeIds.size >= AUTO_PHYSICS_THRESHOLD) {
      this._network.setOptions({ physics: { enabled: false } });
    }

    // ── Compute edge weights if configured ──
    let edgeWidths = null;
    if (this._options.edgeWeighting) {
      edgeWidths = computeEdgeWeights(this._store.edges, this._options.edgeWeighting);
    }

    // ── Build node batch ──
    const nodeBatch = [];
    for (const id of desiredNodeIds) {
      const base = this._store.getNode(id);
      if (!base) continue;

      const node = this._theme.normalizeNodeForTheme({ ...base });

      // Resolve icon
      const iconPath = String(node.iconPath || node.image || '').trim();
      if (String(node.shape || '') === 'circularImage' && iconPath) {
        node.image = resolveIcon(iconPath, this._options.iconBasePath);
        node.imagePadding = node.imagePadding ?? 10;
      } else if (node.shape === 'image' && (!node.image || !node.image.trim())) {
        node.image = this._theme.getDocumentIconDataUri(this._theme.getOleDefaults().iconFill);
      }

      // Label
      node.label = buildNodeLabel(base, this._options.showLabels);

      // Tooltip
      if (this._options.showTooltips) {
        node.title = buildNodeTooltip(base);
      } else {
        node.title = undefined;
      }

      nodeBatch.push(node);
    }

    // ── Build edge batch ──
    const edgeBatch = [];
    for (const id of desiredEdgeIds) {
      const base = this._store.getEdge(id);
      if (!base) continue;

      const edge = this._theme.normalizeEdgeForTheme({ ...base });

      // Apply computed width
      if (edgeWidths && edgeWidths.has(id)) {
        edge.width = edgeWidths.get(id).width;
      }

      // Tooltip
      if (this._options.showTooltips) {
        const fromNode = this._store.getNode(edge.from);
        const toNode = this._store.getNode(edge.to);
        const fromLabel = fromNode?.label ?? edge.from;
        const toLabel = toNode?.label ?? edge.to;
        const weight = toFiniteNumber(edge.weight ?? edge.value ?? edge.width ?? 1) ?? 1;
        edge.title = `From: ${fromLabel}\nTo: ${toLabel}\nWeight: ${weight}`;
      } else {
        edge.title = undefined;
      }

      edgeBatch.push(edge);
    }

    // ── Apply to vis-network DataSets ──
    this._nodesDataSet.clear();
    this._edgesDataSet.clear();
    if (nodeBatch.length > 0) this._nodesDataSet.add(nodeBatch);
    if (edgeBatch.length > 0) this._edgesDataSet.add(edgeBatch);

    this._network.redraw();

    // If physics is disabled or we are using a manual layout, stabilization won't fire.
    // We attach a one-time listener to the very next drawing frame to handle readiness.
    const isPhysicsActive = this._options.physics && 
                           (desiredNodeIds.size < AUTO_PHYSICS_THRESHOLD) && 
                           !isManualLayout(this._options.layout) &&
                           this._options.layout !== 'hierarchical';
                           
    if (!isPhysicsActive && this._handleReady) {
      this._network.once('afterDrawing', this._handleReady);
    }
  }

  _applyManualLayout() {
    const positions = computeLayout(
      this._options.layout,
      this._store.nodes,
      this._store.edges,
      this._store.adjacency,
      { direction: this._options.layoutDirection }
    );

    if (!positions || positions.size === 0) return;

    const updates = [];
    for (const [id, pos] of positions) {
      if (this._nodesDataSet.get(id)) {
        updates.push({ id, x: pos.x, y: pos.y });
      }
    }
    if (updates.length > 0) {
      this._nodesDataSet.update(updates);
    }

    this._network.setOptions({ 
      layout: { hierarchical: { enabled: false } },
      physics: { enabled: false } 
    });
    this._network.stopSimulation();
    setTimeout(() => this.fitToView(false), 50);
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE — UI State Helpers
  // ═══════════════════════════════════════════════════════════

  _showLoading() { if (this._loadingEl) this._loadingEl.style.display = 'flex'; }
  _hideLoading() { if (this._loadingEl) this._loadingEl.style.display = 'none'; }
  _showEmpty() {
    if (this._emptyEl) this._emptyEl.style.display = 'flex';
    this._nodesDataSet.clear();
    this._edgesDataSet.clear();
    this._hideLoading();
    this._updateStats();
  }
  _hideEmpty() { if (this._emptyEl) this._emptyEl.style.display = 'none'; }
  _showError(err) {
    if (this._errorEl) {
      this._errorEl.textContent = `Error: ${err?.message || 'Unknown error'}`;
      this._errorEl.style.display = 'flex';
    }
    this._hideLoading();
  }
  _hideError() { if (this._errorEl) this._errorEl.style.display = 'none'; }

  _updateStats() {
    const visibleNodes = this._nodesDataSet.length;
    const visibleEdges = this._edgesDataSet.length;
    const totalNodes = this._store.nodeCount;
    const totalEdges = this._store.edgeCount;

    if (totalNodes === 0) {
      this._statsEl.textContent = '';
    } else if (visibleNodes < totalNodes) {
      this._statsEl.textContent = `${visibleNodes} of ${totalNodes} nodes · ${visibleEdges} edges`;
    } else {
      this._statsEl.textContent = `${totalNodes} nodes · ${totalEdges} edges`;
    }
  }

  _emit(event, ...args) {
    const handlers = this._listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(...args);
      } catch (err) {
        console.error(`[LinkxGraphPreview] Error in ${event} handler:`, err);
      }
    }
  }
}

export default GraphRenderer;
