/**
 * LinkAnalysisPreview — React wrapper component for the GraphRenderer.
 *
 * Usage:
 *   import { LinkAnalysisPreview } from '@linkx/graph-preview';
 *
 *   <LinkAnalysisPreview
 *     graph={{ nodes: [...], edges: [...] }}
 *     options={{ theme: 'light', layout: 'default' }}
 *     onExplore={(data) => navigateToFullModule(data)}
 *     onNodeClick={(node) => console.log(node)}
 *   />
 */
import React, { useRef, useEffect } from 'react';
import { GraphRenderer } from '../core/GraphRenderer.js';

/**
 * @param {import('../types.js').LinkAnalysisPreviewProps} props
 */
export function LinkAnalysisPreview({
  graph,
  options = {},
  onExplore,
  onNodeClick,
  onReady,
  onError,
  className = '',
  style = {},
}) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const callbacksRef = useRef({ onExplore, onNodeClick, onReady, onError });

  // Keep callbacks ref up to date without re-creating the renderer
  useEffect(() => {
    callbacksRef.current = { onExplore, onNodeClick, onReady, onError };
  }, [onExplore, onNodeClick, onReady, onError]);

  // ── Create / Destroy renderer on mount / unmount ──
  useEffect(() => {
    if (!containerRef.current) return;

    const renderer = new GraphRenderer(containerRef.current, options);

    // Wire callbacks via stable refs
    renderer.on('explore', (data) => callbacksRef.current.onExplore?.(data));
    renderer.on('nodeClick', (node) => callbacksRef.current.onNodeClick?.(node));
    renderer.on('ready', () => callbacksRef.current.onReady?.());
    renderer.on('error', (err) => callbacksRef.current.onError?.(err));

    rendererRef.current = renderer;

    // Initial render if graph data is already available
    if (graph && Array.isArray(graph.nodes) && graph.nodes.length > 0) {
      renderer.setGraph(graph);
    } else if (graph) {
      renderer.setGraph(graph); // Will show empty state
    }

    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Mount-only

  // ── React to graph data changes ──
  useEffect(() => {
    if (rendererRef.current && graph) {
      rendererRef.current.setGraph(graph);
    }
  }, [graph]);

  // ── React to options changes ──
  useEffect(() => {
    if (rendererRef.current && options) {
      rendererRef.current.updateOptions(options);
    }
  }, [options]);

  return React.createElement('div', {
    ref: containerRef,
    className: `linkx-graph-preview-wrapper ${className}`.trim(),
    style: {
      width: '100%',
      height: '100%',
      position: 'relative',
      ...style,
    },
  });
}

export default LinkAnalysisPreview;
