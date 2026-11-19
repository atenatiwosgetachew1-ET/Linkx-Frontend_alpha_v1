import React from 'react';

// A 24 x 24 stroked icon from one path string or a list of them.
export default function StrokeIcon({ d, className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {(Array.isArray(d) ? d : [d]).map((path) => <path key={path} d={path} />)}
    </svg>
  );
}
