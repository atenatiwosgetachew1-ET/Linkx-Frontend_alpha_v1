import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import cytoscape from 'cytoscape';

import { buildElements, buildStylesheet, edgeCurveFor } from '../lib/graphElements.js';
import { GRAPH_LIMITS } from '../lib/graphSettings.js';
import { requestLayout, startPhysics } from '../lib/layoutClient.js';
import { neighbourIndex, placeNear } from '../lib/layouts.js';
import { getNodeValue } from '../lib/graphModel.js';
import { RENDERERS } from '../lib/rendererPreference.js';
import { subscribeIconThemes } from '../lib/graphIcons.js';

// The only file that knows the rendering library (graph-chart-plan §3.2).
// Cytoscape draws on canvas by default; WebGL is opt-in. Lessons from G0
// (§5.3): WebGL contexts are released explicitly on destroy, and a lost
// context hands the window back to canvas.

// Theme tokens -> concrete colours (Cytoscape cannot read CSS variables or
// color-mix()). A probe element resolves each token through the cascade.
const THEME_TOKENS = {
  nodeFill: '--graph-node-fill',
  nodeBorder: '--graph-node-border',
  label: '--graph-label',
  edge: '--graph-edge',
  selected: '--graph-selected',
};

const readGraphTheme = (container) => {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  container.appendChild(probe);
  const theme = {};
  Object.entries(THEME_TOKENS).forEach(([name, cssVar]) => {
    probe.style.color = `var(${cssVar})`;
    theme[name] = getComputedStyle(probe).color || '#555555';
  });
  // Light or dark from the canvas background itself, so custom themes work:
  // dark canvases get production's white icons.
  probe.style.color = 'var(--graph-canvas-bg)';
  const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(getComputedStyle(probe).color);
  theme.mode = rgb && (Number(rgb[1]) * 299 + Number(rgb[2]) * 587 + Number(rgb[3]) * 114) / 1000 < 128 ? 'dark' : 'light';
  probe.remove();
  // A transparent fill keeps production's hollow nodes.
  const alpha = /rgba?\([^)]*,\s*([\d.]+)\)/.exec(theme.nodeFill)?.[1];
  theme.nodeFillOpacity = alpha === undefined ? 1 : Number(alpha);
  return theme;
};

// Replaces an element's data. Cytoscape's data() only merges, so keys the
// new data no longer has (a cleared highlight, a title switched off) are
// removed explicitly.
const FIXED_DATA_KEYS = new Set(['id', 'source', 'target', 'parent']);
const syncData = (element, next) => {
  const stale = Object.keys(element.data()).filter((key) => !(key in next) && !FIXED_DATA_KEYS.has(key));
  if (stale.length) element.removeData(stale.join(' '));
  element.data(next);
};

const releaseGraph = (cy) => {
  if (!cy) return;
  const canvases = cy.container() ? [...cy.container().querySelectorAll('canvas')] : [];
  cy.destroy();
  canvases.forEach((canvas) => {
    // Returns the canvas's existing context of that type, or null (Cytoscape
    // canvas-mode layers hold 2d contexts, so nothing new is created).
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  });
};

const GraphCanvas = forwardRef(function GraphCanvas({ windowId, store, view, settings, renderer, isCdr, onRendererFailed, onLayoutState, onContextMenu, onNodeDoubleClick }, ref) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const themeRef = useRef(null);
  const needsFitRef = useRef(true);
  const curveRef = useRef('bezier');
  // The running physics simulation ({ stop, moveNode }) while physics is on.
  const physicsRef = useRef(null);
  // True once the drawn positions are physics-settled: a re-run (labels,
  // theme…) then continues from them without refitting the view.
  const physicsSettledRef = useRef(false);
  const tooltipRef = useRef(null);
  // Restyles for the current zoom (set by the renderer effect).
  const zoomStyleRef = useRef(() => {});
  // Bumped when a theme change or a recoloured icon needs the elements redrawn.
  const [themeVersion, setThemeVersion] = useState(0);
  useEffect(() => subscribeIconThemes(() => setThemeVersion((value) => value + 1)), []);
  const callbacksRef = useRef({ onRendererFailed, onLayoutState, onContextMenu, onNodeDoubleClick });
  callbacksRef.current = { onRendererFailed, onLayoutState, onContextMenu, onNodeDoubleClick };

  const visibleCount = view.nodeIds.length;
  const fast = renderer === RENDERERS.CANVAS && visibleCount > GRAPH_LIMITS.CANVAS_FAST_ABOVE;
  const hideEdgesWhileMoving = renderer === RENDERERS.CANVAS && visibleCount > GRAPH_LIMITS.CANVAS_HIDE_EDGES_ABOVE;
  const curve = edgeCurveFor(visibleCount);
  curveRef.current = curve;

  useImperativeHandle(ref, () => ({
    // Fits the whole view, or the given node ids (production network.fit).
    fit: (ids) => {
      const cy = cyRef.current;
      if (!cy) return;
      const eles = ids?.length ? cy.collection(ids.map((id) => cy.getElementById(String(id))).filter((ele) => ele.nonempty())) : undefined;
      cy.animate({ fit: { eles, padding: 30 } }, { duration: 300 });
    },
    // Replaces the selection (production network.selectNodes).
    select: (ids) => {
      const cy = cyRef.current;
      if (!cy) return;
      cy.batch(() => {
        cy.elements(':selected').unselect();
        ids.forEach((id) => cy.getElementById(String(id)).select());
      });
    },
    zoomBy: (factor) => {
      const cy = cyRef.current;
      if (!cy) return;
      const center = { x: cy.width() / 2, y: cy.height() / 2 };
      cy.zoom({ level: cy.zoom() * factor, renderedPosition: center });
    },
  }), []);

  // (Re)create the renderer: on mount, renderer switch, or crossing the
  // canvas speed threshold (those options are fixed at creation). The view
  // and selection survive (G0: switch kept both).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    themeRef.current = readGraphTheme(container);
    const previous = cyRef.current;
    // Previous renderer's view, else the view saved when the window was last
    // shown (docked tab switch), else fit once the elements are in.
    const viewport = previous ? { zoom: previous.zoom(), pan: { ...previous.pan() } } : store.getViewport();
    releaseGraph(previous);
    let cy;
    try {
      cy = cytoscape({
        container,
        style: buildStylesheet(themeRef.current, { curve, zoom: 1 }),
        layout: { name: 'preset' },
        boxSelectionEnabled: true,
        selectionType: 'additive',
        ...(renderer === RENDERERS.WEBGL ? { renderer: { name: 'canvas', webgl: true } } : {}),
        // No textureOnViewport: it draws a cached snapshot while zooming and
        // fills around it with grey (visible when zooming out fast). Large
        // canvas views use pixel ratio 1, and hide edges while moving only
        // above 1 000 nodes.
        motionBlur: false,
        ...(fast ? { pixelRatio: 1 } : {}),
        ...(hideEdgesWhileMoving ? { hideEdgesOnViewport: true } : {}),
      });
    } catch (error) {
      if (renderer === RENDERERS.WEBGL) callbacksRef.current.onRendererFailed?.(error);
      return undefined;
    }
    cyRef.current = cy;
    needsFitRef.current = !viewport;
    if (viewport) cy.viewport(viewport);
    cy.on('viewport', () => store.setViewport({ zoom: cy.zoom(), pan: { ...cy.pan() } }));

    // Constant on-screen border / minimum edge widths (vis-network): restyle
    // for the new zoom every frame on normal views, after the zoom settles on
    // large ones (a full restyle of thousands of elements per frame is costly).
    let zoomFrame = 0;
    let zoomTimer = 0;
    let styledZoom = 1;
    const applyZoomStyle = () => {
      zoomFrame = 0;
      const zoom = cy.zoom();
      if (Math.abs(zoom - styledZoom) / styledZoom < 0.02) return;
      styledZoom = zoom;
      cy.style(buildStylesheet(themeRef.current, { curve: curveRef.current, zoom }));
    };
    cy.on('zoom', () => {
      if (cy.nodes().length > GRAPH_LIMITS.CANVAS_FAST_ABOVE) {
        clearTimeout(zoomTimer);
        zoomTimer = setTimeout(applyZoomStyle, 120);
      } else if (!zoomFrame) {
        zoomFrame = requestAnimationFrame(applyZoomStyle);
      }
    });
    zoomStyleRef.current = () => {
      styledZoom = cy.zoom();
      cy.style(buildStylesheet(themeRef.current, { curve: curveRef.current, zoom: styledZoom }));
    };
    // A restored view (previous renderer / docked tab switch) has its own zoom.
    if (viewport) zoomStyleRef.current();

    const syncSelection = () => store.setSelection(cy.nodes(':selected').map((node) => node.id()));
    cy.on('select unselect', 'node', syncSelection);
    // Production (vis) physics while dragging: the node is pinned at the
    // pointer and the others follow live; released, it settles with them.
    cy.on('grab', 'node', (event) => physicsRef.current?.moveNode(event.target.id(), { ...event.target.position() }, true));
    cy.on('drag', 'node', (event) => physicsRef.current?.moveNode(event.target.id(), { ...event.target.position() }));
    cy.on('free', 'node', (event) => physicsRef.current?.moveNode(event.target.id(), { ...event.target.position() }, false));
    cy.on('dragfree', 'node', (event) => {
      store.setPositions([[event.target.id(), { ...event.target.position() }]]);
    });

    // Hover titles (production "Show titles"): plain text, never HTML.
    const tooltip = tooltipRef.current;
    const hideTooltip = () => {
      if (tooltip) tooltip.hidden = true;
    };
    cy.on('mouseover', 'node, edge', (event) => {
      const title = event.target.data('title');
      if (!tooltip || !title) return;
      tooltip.textContent = String(title).trim();
      tooltip.hidden = false;
      // Beside the pointer, flipped to the other side where it would leave
      // the canvas, and never past its edges.
      const { x, y } = event.renderedPosition || event.target.renderedPosition();
      const gap = 14;
      const margin = 4;
      const width = tooltip.offsetWidth;
      const height = tooltip.offsetHeight;
      const maxX = container.clientWidth - width - margin;
      const maxY = container.clientHeight - height - margin;
      const left = x + gap <= maxX ? x + gap : x - gap - width;
      const top = y + gap <= maxY ? y + gap : y - gap - height;
      tooltip.style.left = `${Math.round(Math.max(margin, Math.min(left, maxX)))}px`;
      tooltip.style.top = `${Math.round(Math.max(margin, Math.min(top, maxY)))}px`;
    });
    cy.on('mouseout', 'node, edge', hideTooltip);
    cy.on('viewport grab', hideTooltip);

    // Production right-click (GB:2096 oncontext): a node outside the
    // selection becomes the selection; the menu itself is the window's.
    const blockBrowserMenu = (event) => event.preventDefault();
    container.addEventListener('contextmenu', blockBrowserMenu);
    cy.on('cxttap', (event) => {
      hideTooltip();
      const target = event.target;
      const kind = target === cy ? 'canvas' : target.isNode() ? 'node' : 'edge';
      if (kind === 'node' && !target.selected()) {
        cy.nodes(':selected').unselect();
        target.select();
      }
      callbacksRef.current.onContextMenu?.({
        kind,
        id: kind === 'canvas' ? null : target.id(),
        selection: cy.nodes(':selected').map((node) => node.id()),
        x: event.renderedPosition.x,
        y: event.renderedPosition.y,
      });
    });
    cy.on('tap viewport', () => callbacksRef.current.onContextMenu?.(null));
    // Production doubleClick (GB:2536): expand one hidden neighbour.
    cy.on('dbltap', 'node', (event) => callbacksRef.current.onNodeDoubleClick?.(event.target.id()));

    const onContextLost = (event) => {
      event.preventDefault();
      callbacksRef.current.onRendererFailed?.(new Error('The GPU context was lost.'));
    };
    const canvases = renderer === RENDERERS.WEBGL ? [...container.querySelectorAll('canvas')] : [];
    canvases.forEach((canvas) => canvas.addEventListener('webglcontextlost', onContextLost));

    return () => {
      cancelAnimationFrame(zoomFrame);
      clearTimeout(zoomTimer);
      canvases.forEach((canvas) => canvas.removeEventListener('webglcontextlost', onContextLost));
      container.removeEventListener('contextmenu', blockBrowserMenu);
    };
    // `store` is per window and stable; elements are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, fast, hideEdgesWhileMoving]);

  useEffect(() => () => {
    releaseGraph(cyRef.current);
    cyRef.current = null;
  }, []);

  // Cytoscape only follows browser-window resizes; the workspace window can
  // be resized, docked or maximised on its own.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => cyRef.current?.resize());
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // Theme switches (light / dark / custom themes) restyle without redrawing data.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const restyle = () => {
      const previousMode = themeRef.current?.mode;
      themeRef.current = readGraphTheme(container);
      zoomStyleRef.current();
      if (previousMode && previousMode !== themeRef.current.mode) setThemeVersion((value) => value + 1);
    };
    restyle();
    const observer = new MutationObserver(restyle);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    return () => observer.disconnect();
  }, [curve, renderer, fast, hideEdgesWhileMoving]);

  // Sync the visible view: remove what left, add what came, update the rest;
  // lay out (in the worker) only when some visible node has no position yet.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return undefined;
    let cancelled = false;
    const iconMode = themeRef.current?.mode || 'light';
    const { nodes, edges } = buildElements(store, view, {
      showLabels: settings.showLabels,
      labels: settings.labels,
      isCdr,
      iconMode,
      edgeWeight: settings.edgeWeight,
      showTitles: settings.showTitles,
    });
    const edgePairs = edges.map((edge) => [edge.data.source, edge.data.target]);
    const stopPhysics = () => {
      physicsRef.current?.stop();
      physicsRef.current = null;
    };
    if (!settings.physics) physicsSettledRef.current = false;

    // Production physics (vis barnesHut, in the worker): 350 stabilisation
    // iterations, the view fitted to the result (stabilization.fit), then
    // live until every node is slower than minVelocity.
    const runPhysics = () => {
      stopPhysics();
      if (!settings.physics || cyRef.current !== cy || !view.nodeIds.length) return;
      const positions = {};
      view.nodeIds.forEach((id) => {
        const node = cy.getElementById(id);
        if (node.nonempty()) positions[id] = { ...node.position() };
      });
      const draw = (next) => {
        cy.batch(() => {
          Object.entries(next).forEach(([id, position]) => {
            const node = cy.getElementById(id);
            if (node.nonempty() && !node.grabbed()) node.position(position);
          });
        });
      };
      const live = () => !cancelled && cyRef.current === cy;
      physicsRef.current = startPhysics(windowId, { nodeIds: view.nodeIds, edgePairs, positions, stabilize: true }, {
        onStabilized: (next) => {
          if (!live()) return;
          draw(next);
          if (!physicsSettledRef.current) cy.fit(undefined, 30);
          physicsSettledRef.current = true;
        },
        onFrame: (next) => {
          if (live()) draw(next);
        },
        onSettled: (next) => {
          if (live()) store.setPositions(Object.entries(next));
        },
      });
    };

    // Applies the view. New nodes are only added once they have a position:
    // adding them first would draw them piled on one point until the layout
    // arrives, then jump (the "zoom out" effect).
    const apply = (positioned, { fit }) => {
      const wanted = new Set([...positioned, ...edges].map((element) => element.data.id));
      cy.batch(() => {
        cy.elements().filter((element) => !wanted.has(element.id())).remove();
        const additions = [];
        positioned.forEach((element) => {
          const existing = cy.getElementById(element.data.id);
          if (existing.nonempty()) {
            syncData(existing, element.data);
            if (element.position) existing.position(element.position);
          } else additions.push(element);
        });
        if (additions.length) cy.add(additions);
        const edgeAdditions = edges.filter((element) => cy.getElementById(element.data.id).empty());
        edges.forEach((element) => {
          const existing = cy.getElementById(element.data.id);
          if (existing.nonempty()) syncData(existing, element.data);
        });
        if (edgeAdditions.length) cy.add(edgeAdditions);
      });
      if (fit && positioned.length) {
        cy.fit(undefined, 30);
        needsFitRef.current = false;
      }
    };

    // Positions are reused unless the layout settings changed (the whole
    // view is then laid out again, as production re-applies its layout) or
    // some visible node has none yet.
    const { type, direction, sortMethod, layerMode, layerKey } = settings.layout;
    const signature = JSON.stringify([type, direction, sortMethod, layerMode, layerKey]);
    const relayout = store.getLayoutSignature() !== signature;
    const unplaced = relayout ? nodes : nodes.filter((node) => !node.position);
    // Nodes joining a drawn view (expand, double-click) are placed beside
    // their neighbours; nothing already drawn moves and the view is not refit.
    if (view.edited && !relayout && unplaced.length && unplaced.length < nodes.length) {
      const placed = {};
      nodes.forEach((node) => {
        if (node.position) placed[node.data.id] = node.position;
      });
      const added = placeNear(unplaced.map((node) => node.data.id), placed, neighbourIndex(edgePairs));
      store.setPositions(Object.entries(added));
      apply(nodes.map((node) => (node.position ? node : { ...node, position: added[node.data.id] })), { fit: false });
      runPhysics();
      return () => {
        cancelled = true;
        stopPhysics();
      };
    }
    if (unplaced.length === 0) {
      apply(nodes, { fit: needsFitRef.current });
      runPhysics();
      return () => {
        cancelled = true;
        stopPhysics();
      };
    }
    callbacksRef.current.onLayoutState?.(true);
    const info = {};
    if (type === 'layered' || type === 'hierarchical') {
      view.nodeIds.forEach((id) => {
        const node = store.getNode(id) || {};
        info[id] = { identity: node.node_identity, layerValue: layerKey ? getNodeValue(node, layerKey) : undefined };
      });
    }
    requestLayout(windowId, type, view.nodeIds, edgePairs, { direction, sortMethod, layerMode, info })
      .then((positions) => {
        if (cancelled || !positions || cyRef.current !== cy) return;
        const entries = Object.entries(positions);
        physicsSettledRef.current = false;
        store.setPositions(entries);
        store.setLayoutSignature(signature);
        apply(nodes.map((node) => ({ ...node, position: positions[node.data.id] || node.position || { x: 0, y: 0 } })), { fit: true });
        runPhysics();
      })
      .catch(() => {
        // Worker unavailable: fall back to Cytoscape's grid so the graph shows.
        if (cancelled || cyRef.current !== cy) return;
        apply(nodes, { fit: false });
        cy.layout({ name: 'grid', fit: true, padding: 30 }).run();
      })
      .finally(() => {
        if (!cancelled) callbacksRef.current.onLayoutState?.(false);
      });
    return () => {
      cancelled = true;
      stopPhysics();
    };
  }, [store, view, settings.showLabels, settings.labels, settings.edgeWeight, settings.showTitles, settings.physics, settings.layout, isCdr, windowId, renderer, fast, hideEdgesWhileMoving, themeVersion]);

  return (
    <>
      <div ref={containerRef} className="graph_canvas" role="img" aria-label="Graph" />
      <div ref={tooltipRef} className="graph_canvas_tooltip" role="tooltip" hidden />
    </>
  );
});

export default GraphCanvas;
