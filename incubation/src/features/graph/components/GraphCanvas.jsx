import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import cytoscape from 'cytoscape';

import { buildElements, buildStylesheet, edgeCurveFor } from '../lib/graphElements.js';
import { GRAPH_LIMITS, layoutSignatureOf } from '../lib/graphSettings.js';
import { requestLayout, startPhysics } from '../lib/layoutClient.js';
import { neighbourIndex, placeNear } from '../lib/layouts.js';
import { getNodeValue } from '../lib/graphModel.js';
import { nodeTypeOf } from '../lib/graphAnalysis.js';
import { RENDERERS } from '../lib/rendererPreference.js';
import { subscribeIconThemes } from '../lib/graphIcons.js';
import { readGraphTheme } from '../lib/graphTheme.js';
import GraphMinimap from './GraphMinimap.jsx';

// The only on-screen user of the rendering library (graph-chart-plan §3.2;
// lib/offscreenSnapshot.js draws report snapshots without a window).
// Cytoscape draws on canvas by default; WebGL is opt-in. Lessons from G0
// (§5.3): WebGL contexts are released explicitly on destroy, and a lost
// context hands the window back to canvas.

// Replaces an element's data. Cytoscape's data() only merges, so keys the
// new data no longer has (a cleared highlight, a title switched off) are
// removed explicitly.
const FIXED_DATA_KEYS = new Set(['id', 'source', 'target', 'parent']);
const syncData = (element, next) => {
  const stale = Object.keys(element.data()).filter((key) => !(key in next) && !FIXED_DATA_KEYS.has(key));
  if (stale.length) element.removeData(stale.join(' '));
  element.data(next);
};

// A click zooms in first when the node is drawn narrower than this, or a
// link is clicked below this zoom.
const FAR_NODE_PX = 14;
const FAR_EDGE_ZOOM = 0.6;
// The zoom such a click goes to.
const FAR_TAP_ZOOM = 0.5;

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

// The canvas as an image, on its own background colour.
const capture = (cy, { full, scale, maxSide, format }) => {
  let element = cy.container();
  let background = '';
  while (element && (!background || background === 'transparent' || background === 'rgba(0, 0, 0, 0)')) {
    background = getComputedStyle(element).backgroundColor;
    element = element.parentElement;
  }
  try {
    const options = { output: 'base64uri', bg: background || '#ffffff', full, scale, maxWidth: maxSide, maxHeight: maxSide };
    return format === 'jpg' ? cy.jpg({ ...options, quality: 0.9 }) : cy.png(options);
  } catch {
    return null;
  }
};

// A stable empty list (a default prop must not change every render).
const EMPTY_LIST = [];

const GraphCanvas = forwardRef(function GraphCanvas({ windowId, store, view, settings, renderer, isCdr, onRendererFailed, onLayoutState, onContextMenu, onNodeDoubleClick, onElementTap, tapZoomsTo, onEdgeSelection, onViewportChange, onEdgeDoubleClick, expandedLinks = EMPTY_LIST, showMinimap = true, showGlyphs = true }, ref) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  // The same instance as state, for the minimap (follows renderer switches).
  const [cyInstance, setCyInstance] = useState(null);
  const themeRef = useRef(null);
  const needsFitRef = useRef(true);
  const curveRef = useRef('bezier');
  // The running physics simulation ({ stop, moveNode }) while physics is on.
  const physicsRef = useRef(null);
  // True once the drawn positions are physics-settled: a re-run (labels,
  // theme…) then continues from them without refitting the view.
  // Kept in the window's store, so a remount (docked <-> floating, docked
  // tab switch) neither re-stabilises nor refits.
  const physicsSettledRef = useRef(store.getUi('canvasPhysicsSettled', false));
  const setPhysicsSettled = useCallback((value) => {
    physicsSettledRef.current = value;
    store.setUi('canvasPhysicsSettled', value);
  }, [store]);
  // The largest zoom the next fit may reach (vis-network fitted up to 1; a
  // restored view that showed the whole graph refits up to its own zoom).
  const fitCapRef = useRef(1);
  // The canvas size last seen, so resizes keep the view's centre.
  const sizeRef = useRef(null);
  const tooltipRef = useRef(null);
  // Restyles for the current zoom (set by the renderer effect).
  const zoomStyleRef = useRef(() => {});
  // Bumped when a theme change or a recoloured icon needs the elements redrawn.
  const [themeVersion, setThemeVersion] = useState(0);
  useEffect(() => subscribeIconThemes(() => setThemeVersion((value) => value + 1)), []);
  const callbacksRef = useRef({ onRendererFailed, onLayoutState, onContextMenu, onNodeDoubleClick, onElementTap, tapZoomsTo, onEdgeSelection, onViewportChange, onEdgeDoubleClick });
  callbacksRef.current = { onRendererFailed, onLayoutState, onContextMenu, onNodeDoubleClick, onElementTap, tapZoomsTo, onEdgeSelection, onViewportChange, onEdgeDoubleClick };

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
    // Centres one node at a zoom level (production network.focus, scale 1.2).
    focus: (id, scale = 1.2) => {
      const cy = cyRef.current;
      const node = cy?.getElementById(String(id));
      if (!node || node.empty()) return;
      cy.animate({ center: { eles: node }, zoom: scale }, { duration: 300 });
    },
    // Production saved views: the view's centre in graph coordinates and the
    // zoom (network.getViewPosition / getScale), and what is selected.
    getCamera: () => {
      const cy = cyRef.current;
      if (!cy) return null;
      const zoom = cy.zoom();
      const pan = cy.pan();
      return {
        position: { x: (cy.width() / 2 - pan.x) / zoom, y: (cy.height() / 2 - pan.y) / zoom },
        scale: zoom,
        selectedNodes: cy.nodes(':selected').map((node) => node.id()),
        selectedEdges: cy.edges(':selected').map((edge) => edge.id()),
      };
    },
    // Production network.moveTo({ position, scale }).
    moveTo: ({ position, scale }) => {
      const cy = cyRef.current;
      if (!cy || !position || !Number.isFinite(scale)) return;
      cy.animate({ zoom: scale, pan: { x: cy.width() / 2 - position.x * scale, y: cy.height() / 2 - position.y * scale } }, { duration: 280 });
    },
    // What is selected now (production network.getSelectedNodes / Edges).
    selectedIds: () => {
      const cy = cyRef.current;
      if (!cy) return { nodes: [], edges: [] };
      return { nodes: cy.nodes(':selected').map((node) => node.id()), edges: cy.edges(':selected').map((edge) => edge.id()) };
    },
    // How an element is drawn now, from its render data (not the selection
    // highlight): the Customize popup's preview. null colours are the theme's.
    lookOf: (kind, id) => {
      const element = cyRef.current?.getElementById(String(id));
      if (!element || element.empty()) return null;
      const data = element.data();
      return kind === 'edge'
        ? { color: data.color || null, arrow: data.arrow !== 'none' }
        : { fill: data.fill || null, border: data.border || null };
    },
    // A PNG of the current view (production captureGraphSnapshot: the
    // canvas as drawn), on the canvas colour, at twice the screen size for
    // a sharp print. null while nothing is drawn. maxSide bounds the
    // longer side in pixels; format 'jpg' (quality 0.9) for a small file
    // (the report: a PNG of a large graph made a PDF of tens of MB).
    // nameOf(id): a label to draw each labelled node with in the picture
    // only (the graph report names entities by its chosen column); the
    // canvas's own labels are put back at once.
    snapshot: ({ full = false, scale = 2, maxSide = 8000, format = 'png', nameOf = null } = {}) => {
      const cy = cyRef.current;
      if (!cy || cy.nodes().empty()) return null;
      const restore = [];
      if (nameOf) {
        cy.batch(() => {
          cy.nodes().forEach((node) => {
            const label = node.data('label');
            if (!label) return;
            const name = nameOf(node.id());
            if (!name || name === label) return;
            restore.push([node, label]);
            node.data('label', name);
          });
        });
      }
      try {
        return capture(cy, { full, scale, maxSide, format });
      } finally {
        if (restore.length) cy.batch(() => restore.forEach(([node, label]) => node.data('label', label)));
      }
    },

    // The canvas's element (what a snapshot is taken of; the snap reads the
    // profile cards over it relative to its box).
    container: () => cyRef.current?.container() || null,
    // Where a node is drawn on the canvas, in screen pixels from its top-left
    // (the snap draws a node's profile card beside it); null when not drawn.
    renderedPositionOf: (id) => {
      const cy = cyRef.current;
      const node = cy?.getElementById(String(id));
      if (!node || node.empty() || !node.visible()) return null;
      const { x, y } = node.renderedPosition();
      return { x, y };
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
    // Focuses the given nodes (the timeline's Play step): fits them to the
    // view, animated, zooming in no further than maxZoom so a lone node is
    // not blown up.
    focusOn: (ids, { duration = 300, maxZoom = 1.5, padding = 60 } = {}) => {
      const cy = cyRef.current;
      if (!cy || !ids?.length) return;
      const nodes = cy.collection(ids.map((id) => cy.getElementById(String(id))).filter((ele) => ele.nonempty()));
      if (nodes.empty()) return;
      const box = nodes.boundingBox({ includeLabels: false, includeOverlays: false });
      const fitZoom = Math.min((cy.width() - 2 * padding) / Math.max(box.w, 1), (cy.height() - 2 * padding) / Math.max(box.h, 1));
      const level = Math.max(cy.minZoom(), Math.min(fitZoom, maxZoom, cy.maxZoom()));
      const centre = { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 };
      cy.stop();
      cy.animate({ zoom: level, pan: { x: cy.width() / 2 - centre.x * level, y: cy.height() / 2 - centre.y * level } }, { duration });
    },
    // A point on the canvas (pixels) in graph coordinates (production
    // network.DOMtoCanvas), e.g. where a node is added or pasted.
    toGraphPosition: ({ x, y }) => {
      const cy = cyRef.current;
      if (!cy) return { x: 0, y: 0 };
      const zoom = cy.zoom();
      const pan = cy.pan();
      return { x: (x - pan.x) / zoom, y: (y - pan.y) / zoom };
    },
    // Zoom to area (after i2 Analyst's Notebook): fits the box drawn on the
    // canvas, in canvas pixels { x1, y1, x2, y2 }, to the view.
    zoomToRect: (box) => {
      const cy = cyRef.current;
      if (!cy) return;
      const width = Math.abs(box.x2 - box.x1);
      const height = Math.abs(box.y2 - box.y1);
      if (width < 1 || height < 1) return;
      const zoom = cy.zoom();
      const pan = cy.pan();
      const centre = {
        x: ((box.x1 + box.x2) / 2 - pan.x) / zoom,
        y: ((box.y1 + box.y2) / 2 - pan.y) / zoom,
      };
      const level = Math.min(cy.maxZoom(), Math.max(cy.minZoom(), zoom * Math.min(cy.width() / width, cy.height() / height)));
      cy.animate({ zoom: level, pan: { x: cy.width() / 2 - centre.x * level, y: cy.height() / 2 - centre.y * level } }, { duration: 280 });
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
    // shown (docked <-> floating, docked tab switch), else fit once the
    // elements are in.
    const saved = previous ? null : store.getViewport();
    const viewport = previous ? { zoom: previous.zoom(), pan: { ...previous.pan() } } : saved;
    releaseGraph(previous);
    let cy;
    try {
      cy = cytoscape({
        container,
        style: buildStylesheet(themeRef.current, { curve, zoom: 1 }),
        layout: { name: 'preset' },
        boxSelectionEnabled: true,
        // A click selects that node or link alone, moving the selection to
        // it; Ctrl (or Cmd / Shift) + click adds to it (production vis
        // multiselect; analyst decision 2026-11-16, was additive).
        selectionType: 'single',
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
      setCyInstance(null);
      if (renderer === RENDERERS.WEBGL) callbacksRef.current.onRendererFailed?.(error);
      return undefined;
    }
    cyRef.current = cy;
    setCyInstance(cy);
    needsFitRef.current = !viewport;
    fitCapRef.current = 1;
    if (saved?.whole) {
      // The whole graph was in view: show it whole again in this canvas.
      needsFitRef.current = true;
      fitCapRef.current = Math.max(1, saved.zoom || 1);
      cy.viewport({ zoom: saved.zoom, pan: saved.pan });
    } else if (viewport) {
      // The same point stays in the middle when the canvas size differs.
      const shift = saved?.width && cy.width() ? { x: (cy.width() - saved.width) / 2, y: (cy.height() - saved.height) / 2 } : { x: 0, y: 0 };
      cy.viewport({ zoom: viewport.zoom, pan: { x: viewport.pan.x + shift.x, y: viewport.pan.y + shift.y } });
    }
    sizeRef.current = { width: cy.width(), height: cy.height() };
    cy.on('viewport', () => {
      store.setViewport({ zoom: cy.zoom(), pan: { ...cy.pan() }, width: cy.width(), height: cy.height() });
      // Things placed by an element (the actor profile) are let go.
      callbacksRef.current.onViewportChange?.();
    });

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
    // The selected links (the toolbar's Customize button follows them).
    let edgeSync = 0;
    cy.on('select unselect', 'edge', () => {
      if (edgeSync) return;
      edgeSync = requestAnimationFrame(() => {
        edgeSync = 0;
        if (!cy.destroyed()) callbacksRef.current.onEdgeSelection?.(cy.edges(':selected').map((edge) => edge.id()));
      });
    });
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

    // Cytoscape caches where the canvas is on the page and only forgets it on
    // a resize, a scroll or a CSS transition. A workspace window dragged (or
    // a docked layout shifting) moves the canvas without any of those, and
    // clicks, the tap circle, wheel zoom and hover then landed off the
    // pointer. Forget it whenever the pointer enters, presses or wheels
    // (capture: before Cytoscape's own handlers read it).
    const refreshPlace = () => cy.renderer()?.invalidateContainerClientCoordsCache?.();
    const placeEvents = ['pointerenter', 'pointerdown', 'mousedown', 'touchstart', 'wheel'];
    placeEvents.forEach((name) => container.addEventListener(name, refreshPlace, { capture: true, passive: true }));
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
        edgeSelection: cy.edges(':selected').map((edge) => edge.id()),
        x: event.renderedPosition.x,
        y: event.renderedPosition.y,
      });
    });
    cy.on('tap viewport', () => callbacksRef.current.onContextMenu?.(null));
    // Production doubleClick (GB:2536): expand one hidden neighbour.
    cy.on('dbltap', 'node', (event) => callbacksRef.current.onNodeDoubleClick?.(event.target.id()));
    // Link aggregation: a double-click expands / collapses a pair.
    cy.on('dbltap', 'edge', (event) => callbacksRef.current.onEdgeDoubleClick?.(event.target.id()));
    // Production click (GB:2374): an annotation opens its box (by the
    // node); the background closes it. Plain nodes and links are customized
    // from the toolbar instead (analyst decision 2026-11-16).
    //
    // Clicked from far out (the node a few pixels wide), the view first zooms
    // in to an annotation (to zoom 0.5, centred; tapZoomsTo says which), and
    // the box opens once there. Shift / Ctrl / Cmd clicks (adding to the
    // selection) leave the view alone.
    cy.on('tap', (event) => {
      const target = event.target;
      if (target === cy) {
        callbacksRef.current.onElementTap?.(null);
        return;
      }
      const isNode = target.isNode();
      const report = () => {
        if (cy.destroyed() || target.removed()) return;
        const at = isNode ? target.renderedPosition() : { x: event.position.x * cy.zoom() + cy.pan().x, y: event.position.y * cy.zoom() + cy.pan().y };
        callbacksRef.current.onElementTap?.({ kind: isNode ? 'node' : 'edge', id: target.id(), x: at.x, y: at.y, adding: Boolean(adding) });
      };
      const original = event.originalEvent;
      const adding = original && (original.shiftKey || original.ctrlKey || original.metaKey);
      const far = isNode ? target.renderedWidth() < FAR_NODE_PX : cy.zoom() < FAR_EDGE_ZOOM;
      const wanted = callbacksRef.current.tapZoomsTo ? callbacksRef.current.tapZoomsTo({ kind: isNode ? 'node' : 'edge', id: target.id() }) : true;
      if (adding || !far || !wanted) {
        report();
        return;
      }
      const zoom = Math.min(cy.maxZoom(), Math.max(cy.zoom(), FAR_TAP_ZOOM));
      const point = isNode ? target.position() : event.position;
      cy.stop();
      cy.animate(
        { zoom, pan: { x: cy.width() / 2 - point.x * zoom, y: cy.height() / 2 - point.y * zoom } },
        { duration: 350, complete: report },
      );
    });

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
      placeEvents.forEach((name) => container.removeEventListener(name, refreshPlace, { capture: true }));
    };
    // `store` is per window and stable; elements are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, fast, hideEdgesWhileMoving]);

  useEffect(() => () => {
    const cy = cyRef.current;
    // Kept for the next mount: the view, the canvas size and whether the
    // whole graph was in view.
    if (cy && !cy.destroyed() && cy.nodes().length) {
      const box = cy.nodes().boundingBox({ includeLabels: false, includeOverlays: false });
      const extent = cy.extent();
      const whole = box.x1 >= extent.x1 && box.y1 >= extent.y1 && box.x2 <= extent.x2 && box.y2 <= extent.y2;
      store.setViewport({ zoom: cy.zoom(), pan: { ...cy.pan() }, width: cy.width(), height: cy.height(), whole });
    }
    releaseGraph(cy);
    cyRef.current = null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cytoscape only follows browser-window resizes; the workspace window can
  // be resized, docked or maximised on its own.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const cy = cyRef.current;
        if (!cy || cy.destroyed()) return;
        cy.resize();
        // Keep the view's centre where it was (Cytoscape keeps the top-left).
        const before = sizeRef.current;
        const width = cy.width();
        const height = cy.height();
        if (before?.width && width && (before.width !== width || before.height !== height)) {
          cy.panBy({ x: (width - before.width) / 2, y: (height - before.height) / 2 });
        }
        sizeRef.current = { width, height };
      });
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
      edgeBundling: settings.edgeBundling,
      edgeBundleMin: settings.edgeBundleMin,
      aggregation: settings.linkAggregation?.on ? { ...settings.linkAggregation, expanded: expandedLinks } : null,
      formatting: settings.formatting,
      glyphColors: showGlyphs && themeRef.current ? {
        alert: themeRef.current.glyphAlert,
        pinned: themeRef.current.glyphPinned,
        flag: themeRef.current.glyphFlag,
        note: themeRef.current.glyphNote,
        group: themeRef.current.glyphGroup,
        merged: themeRef.current.glyphMerged,
      } : null,
    });
    const edgePairs = edges.map((edge) => [edge.data.source, edge.data.target]);
    const stopPhysics = () => {
      physicsRef.current?.stop();
      physicsRef.current = null;
    };
    if (!settings.physics && physicsSettledRef.current) setPhysicsSettled(false);

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
      // Settled positions continue live, without stabilising again.
      physicsRef.current = startPhysics(windowId, { nodeIds: view.nodeIds, edgePairs, positions, stabilize: !physicsSettledRef.current }, {
        onStabilized: (next) => {
          if (!live()) return;
          draw(next);
          if (!physicsSettledRef.current) cy.fit(undefined, 30);
          setPhysicsSettled(true);
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
        // vis-network's fit never zoomed past 1 (one node, or a few close
        // together, would otherwise fill the canvas).
        if (cy.zoom() > fitCapRef.current) {
          cy.zoom(fitCapRef.current);
          cy.center();
        }
        needsFitRef.current = false;
        fitCapRef.current = 1;
      }
    };

    // Positions are reused unless the layout settings changed (the whole
    // view is then laid out again, as production re-applies its layout) or
    // some visible node has none yet.
    const { type, direction, sortMethod, layerMode, layerKey } = settings.layout;
    const signature = layoutSignatureOf(settings.layout);
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
    } else if (type === 'grouped') {
      // Grouped (i2 #6): by a property's value, else by node type.
      const byKey = layerMode === 'by_key' && layerKey;
      view.nodeIds.forEach((id) => {
        const node = store.getNode(id) || {};
        info[id] = { group: byKey ? getNodeValue(node, layerKey) : nodeTypeOf(node) };
      });
    }
    requestLayout(windowId, type, view.nodeIds, edgePairs, { direction, sortMethod, layerMode, info })
      .then((positions) => {
        if (cancelled || !positions || cyRef.current !== cy) return;
        const entries = Object.entries(positions);
        setPhysicsSettled(false);
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
  }, [store, view, settings.showLabels, settings.labels, settings.edgeWeight, settings.showTitles, settings.edgeBundling, settings.edgeBundleMin, settings.linkAggregation, expandedLinks, settings.formatting, settings.physics, settings.layout, showGlyphs, isCdr, windowId, renderer, fast, hideEdgesWhileMoving, themeVersion, setPhysicsSettled]);

  return (
    <>
      <div ref={containerRef} className="graph_canvas" role="img" aria-label="Graph" />
      <div ref={tooltipRef} className="graph_canvas_tooltip" role="tooltip" hidden />
      {showMinimap ? <GraphMinimap cy={cyInstance} /> : null}
    </>
  );
});

export default GraphCanvas;
