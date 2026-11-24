// A picture of a Cytoscape graph as a data URL.
//
// Cytoscape ignores maxWidth / maxHeight when a scale is given, so a large
// graph drawn whole at 2x asked the browser for a canvas beyond its limits and
// got the empty "data:," back (the report then failed: "addImage does not
// support files of type 'UNKNOWN'"). The scale is worked out here instead.

const isPicture = (url) => /^data:image\/(png|jpeg);base64,[\w+/]{16}/.test(url || '');

// Pixels per graph unit for the whole graph, the longer side within maxSide.
// The current view keeps its scale exactly (Take a snap draws cards on it).
export const pictureScale = (cy, { full = false, scale = 2, maxSide = 8000 } = {}) => {
  if (!full) return scale;
  const box = cy.elements().boundingBox();
  return Math.min(scale, maxSide / Math.max(box.w || 1, box.h || 1, 1));
};

// null when the browser cannot make one, even smaller.
export const graphPicture = (cy, { full = false, scale = 2, maxSide = 8000, format = 'png', bg = '#ffffff' } = {}) => {
  let size = pictureScale(cy, { full, scale, maxSide });
  for (let attempt = 0; attempt < (full ? 3 : 1); attempt += 1, size /= 2) {
    try {
      // maxWidth only keeps the screen's pixel ratio out of it.
      const options = { output: 'base64uri', bg, full, scale: size, maxWidth: maxSide, maxHeight: maxSide };
      const url = format === 'jpg' ? cy.jpg({ ...options, quality: 0.9 }) : cy.png(options);
      if (isPicture(url)) return url;
    } catch { /* tried smaller */ }
  }
  return null;
};
