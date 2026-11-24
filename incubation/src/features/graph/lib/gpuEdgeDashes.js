// Dashed and dotted links in GPU mode. Cytoscape 3.34's WebGL renderer draws
// every link solid, but the pattern carries meaning here (a time sequence, a
// grouping, a node flag; solid is an observed transfer), so a solid one could
// be misread. Its two shaders get the pattern added as they are compiled, and
// each link's pattern travels in its transform (which links do not use).
//
// The pattern is the standard renderer's: `line-dash-pattern` for dashed,
// [1, 1] for dotted, in graph units; up to four lengths. If a Cytoscape update
// changes the shaders, patching throws and the graph is drawn without the GPU
// rather than with wrong links (gpuEdgeDashes.test.js fails first).

const swap = (source, find, replace) => {
  if (source.split(find).length !== 2) throw new Error('GPU drawing cannot show dashed links with this Cytoscape version.');
  return source.replace(find, () => replace);
};

const VERTEX_PARTS = [
  ['flat out vec2 vBorderWidth;', 'flat out vec2 vBorderWidth;\n      flat out vec4 vDash; // dash, gap, dash, gap (0 = solid)\n      out float vDashAt; // distance along the link'],
  ['int vid = gl_VertexID;', 'int vid = gl_VertexID;\n        vDash = vec4(0.0);\n        vDashAt = 0.0;'],
  ['vec2 xBasis = target - source;', 'vec2 xBasis = target - source;\n          vDash = vec4(aTransform[0].xy, aTransform[1].xy);\n          vDashAt = aTransform[0].z + length(xBasis) * position.x;'],
  ['vec2 p0, p1, p2, pos;', 'vDash = vec4(aTransform[0].xy, aTransform[1].xy);\n          vDashAt = aTransform[0].z + length(pointC - pointB) * position.x;\n          vec2 p0, p1, p2, pos;'],
];

// How much of one screen pixel the dashes cover, so they fade to a lighter
// line instead of flickering when they get smaller than a pixel.
const FRAGMENT_PARTS = [
  ['flat in vec2 vBorderWidth;', 'flat in vec2 vBorderWidth;\n      flat in vec4 vDash;\n      in float vDashAt;'],
  ['vec4 blend(vec4 top, vec4 bot)', `float dashLength(float at) { // drawn length from 0 to at
        float period = vDash.x + vDash.y + vDash.z + vDash.w;
        float inside = mod(at, period);
        float drawn = min(inside, vDash.x) + clamp(inside - vDash.x - vDash.y, 0.0, vDash.z);
        return floor(at / period) * (vDash.x + vDash.z) + drawn;
      }

      vec4 blend(vec4 top, vec4 bot)`],
  ['outColor = vColor;\n        }\n', `outColor = vColor;
          if(vDash.x > 0.0) {
            float pixel = 1.0 / uZoom;
            outColor *= clamp((dashLength(vDashAt + pixel * 0.5) - dashLength(vDashAt - pixel * 0.5)) / pixel, 0.0, 1.0);
          }
        }
`],
];

const patch = (source, parts) => parts.reduce((text, [find, replace]) => swap(text, find, replace), source);

// The picking shader keeps whole links, so gaps can be clicked too.
export const patchShader = (source) => {
  if (source.includes('in vec4 aPointAPointB;')) return patch(source, VERTEX_PARTS);
  if (source.includes('outColor = vIndex;')) return source;
  if (source.includes('flat in int vVertType;')) return patch(source, FRAGMENT_PARTS);
  return source;
};

// A fresh context: shaders compiled through it get the pattern.
// -> undoes it
export const patchShaders = (gl) => {
  if (typeof gl?.shaderSource !== 'function') return () => {};
  const original = gl.shaderSource;
  gl.shaderSource = function shaderSource(shader, source) {
    return original.call(gl, shader, patchShader(source));
  };
  return () => {
    delete gl.shaderSource;
    if (gl.shaderSource !== original) gl.shaderSource = original;
  };
};

const SOLID = [0, 0, 0, 0];
const DOTTED = [1, 1, 0, 0];

export const dashesOf = (style, pattern) => {
  if (style === 'dotted') return DOTTED;
  if (style !== 'dashed') return SOLID;
  const lengths = (Array.isArray(pattern) ? pattern : [pattern]).map(Number);
  if (!lengths.length || lengths.some((length) => !(length >= 0)) || !(lengths[0] > 0)) return SOLID;
  const [dash, gap = dash, second = 0, last = second] = lengths;
  return [dash, gap, second, last];
};

// Writes each link's pattern just before Cytoscape writes the rest of it.
export const drawDashes = (drawing) => {
  const drawEdgeLine = drawing?.drawEdgeLine;
  if (typeof drawEdgeLine !== 'function' || !drawing.transformBuffer?.getMatrixView) {
    throw new Error('GPU drawing cannot show dashed links with this Cytoscape version.');
  }
  drawing.drawEdgeLine = function drawEdgeLineDashed(edge, eleIndex) {
    const points = edge.visible() ? this._getEdgePoints(edge) : null;
    if (points) {
      // As Cytoscape does first, so both write to the same places.
      if (points.length / 2 + this.instanceCount > this.maxInstances) this.endBatch();
      const [dash, gap, second, last] = dashesOf(edge.pstyle('line-style').value, edge.pstyle('line-dash-pattern').pfValue);
      let at = 0;
      for (let i = 0; i + 3 < points.length; i += 2) {
        const view = this.transformBuffer.getMatrixView(this.instanceCount + i / 2);
        view[0] = dash;
        view[1] = gap;
        view[2] = at;
        view[3] = second;
        view[4] = last;
        at += Math.hypot(points[i + 2] - points[i], points[i + 3] - points[i + 1]);
      }
    }
    return drawEdgeLine.call(this, edge, eleIndex);
  };
};
