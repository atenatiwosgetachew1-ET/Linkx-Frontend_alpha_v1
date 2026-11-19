import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

import GraphNodeProfile from './GraphNodeProfile.jsx';
import { placeBoxes } from '../lib/graphSnap.js';

// The actor profile cards on the canvas (analyst decision 2026-11-18: up to
// four at once). Each beside its node; one that would cover another moves to
// the nearest free place, with a dashed line back to its node (the snap
// places its cards the same way, lib/graphSnap.js). A card whose node is out
// of sight is left out until it is back.
//
// cards: [{ id, x, y }] (the node on screen), in the order opened;
// nodeOf(id): its data; onClose(id).
const FALLBACK = { width: 300, height: 120 };

export default function GraphProfileCards({ cards, nodeOf, settings, isCdr = false, onClose }) {
  const stageRef = useRef(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [sizes, setSizes] = useState({}); // id -> { width, height }
  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) return undefined;
    const measure = () => setStage((now) => (now.width === element.clientWidth && now.height === element.clientHeight ? now : { width: element.clientWidth, height: element.clientHeight }));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const measured = useCallback((id) => (size) => setSizes((now) => (
    now[id] && now[id].width === size.width && now[id].height === size.height ? now : { ...now, [id]: size }
  )), []);

  // In sight only (a node panned away hides its card).
  const inSight = cards.filter((card) => !stage.width || (card.x >= 0 && card.y >= 0 && card.x <= stage.width && card.y <= stage.height));
  const places = stage.width
    ? placeBoxes(inSight.map((card) => ({ at: card, ...(sizes[card.id] || FALLBACK) })), stage)
    : inSight.map((card) => ({ x: card.x, y: card.y, moved: false }));

  return (
    <div ref={stageRef} className="graph_profile_cards">
      {/* A line from a moved card back to its node. */}
      <svg className="graph_profile_links" aria-hidden="true" focusable="false">
        {inSight.map((card, index) => {
          const place = places[index];
          if (!place?.moved || !sizes[card.id]) return null;
          const toX = Math.max(place.x, Math.min(card.x, place.x + place.width));
          const toY = Math.max(place.y, Math.min(card.y, place.y + place.height));
          return <line key={card.id} x1={card.x} y1={card.y} x2={toX} y2={toY} />;
        })}
      </svg>
      {inSight.map((card, index) => {
        const node = nodeOf(card.id);
        if (!node) return null;
        const place = places[index];
        return (
          <GraphNodeProfile
            key={card.id}
            nodeId={card.id}
            node={node}
            at={card}
            settings={settings}
            isCdr={isCdr}
            onClose={() => onClose(card.id)}
            // Laid out once its size is known (measured first, unseen).
            place={sizes[card.id] && stage.width ? { left: place.x, top: place.y } : { left: -10000, top: 0 }}
            onMeasure={measured(card.id)}
          />
        );
      })}
    </div>
  );
}
