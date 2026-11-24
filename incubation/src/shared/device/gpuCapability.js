// Can this browser draw graphs with the graphics card (WebGL)?
// (graph-chart-plan §3.9)
//
// A web page cannot see the computer's graphics card, only what the browser
// lets it use. So every result is about the browser, says why, and never
// claims that a card is missing. GPU drawing stays OFF by default; this only
// decides whether it can be turned on.
//
// Signals:
// 1. A WebGL2 context created with failIfMajorPerformanceCaveat: the browser
//    refuses it when it would draw in software, or expects it to be slow.
// 2. If refused, a normal context, to find out what it would run on.
// 3. The renderer name (where the browser gives it): SwiftShader / llvmpipe /
//    "software" means software drawing.
// 4. A short off-screen draw of a graph-like picture. Slow only adds a
//    caution; a test that cannot finish rules GPU drawing out.
//
// Results are kept for this browser tab only (and at most 12 hours), so a
// fixed driver, setting or passing fault is picked up without "Check again".

const STORAGE_KEY = 'linkx.device.gpuCapability.v2';
// The first version kept its verdict for good.
const OLD_STORAGE_KEY = 'linkx.device.gpuCapability.v1';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const SOFTWARE_RENDERER_RE = /swiftshader|llvmpipe|softpipe|software|microsoft basic render|mesa offscreen/i;
// Names that identify nothing (the browser hides the real one).
const HIDDEN_RENDERER_RE = /^(webkit webgl|mozilla|webgl)?$/i;
const LOW_DEVICE_MEMORY_GB = 4;
// A graph-like frame slower than this cannot keep 60 frames per second.
const SLOW_BENCH_FRAME_MS = 16.7;

export const GPU_VERDICTS = Object.freeze({ CAPABLE: 'capable', NOT_CAPABLE: 'not_capable', UNKNOWN: 'unknown' });

// What was found. The first three can be used.
export const GPU_STATUS = Object.freeze({
  HARDWARE: 'hardware', // hardware drawing, card named
  UNNAMED: 'unnamed', // hardware drawing, card name hidden
  CAVEAT: 'caveat', // a card is named, but the browser expects slow drawing
  SOFTWARE: 'software', // the browser draws WebGL without the card
  UNCONFIRMED: 'unconfirmed', // hardware-only refused, name hidden
  UNAVAILABLE: 'unavailable', // no WebGL2 now
  TEST_FAILED: 'test_failed', // the draw test did not finish
  GRAPH_FAILED: 'graph_failed', // a graph lost the GPU while drawing
});

// The card's name, '' when the browser hides it.
export const gpuNameOf = (capability) => {
  const name = String(capability?.signals?.renderer || '').trim();
  return HIDDEN_RENDERER_RE.test(name) ? '' : name;
};

const formatFrame = (ms) => (ms < 1 ? 'under 1 ms' : `${ms.toFixed(1)} ms`);

// Pure decision from the collected signals (unit-tested).
export const decideGpuCapability = ({
  webgl2 = false,
  majorPerformanceCaveat = false,
  renderer = '',
  deviceMemoryGb = null,
  benchFrameMs = null,
  benchFailed = false,
} = {}) => {
  const name = HIDDEN_RENDERER_RE.test(renderer.trim()) ? '' : renderer.trim();
  const reasons = [];
  const cautions = [];
  const result = (verdict, status) => ({ verdict, status, reasons, cautions });

  if (!webgl2) {
    reasons.push('The browser gave this page no WebGL 2.');
    return result(GPU_VERDICTS.NOT_CAPABLE, GPU_STATUS.UNAVAILABLE);
  }
  reasons.push(name ? `The browser draws with: ${name}.` : 'The browser does not say which graphics card it draws with.');
  if (majorPerformanceCaveat) reasons.push('The browser refused a hardware-only drawing context.');
  if (name && SOFTWARE_RENDERER_RE.test(name)) return result(GPU_VERDICTS.NOT_CAPABLE, GPU_STATUS.SOFTWARE);
  if (majorPerformanceCaveat && !name) return result(GPU_VERDICTS.UNKNOWN, GPU_STATUS.UNCONFIRMED);
  if (benchFailed) {
    reasons.push('The draw test did not finish.');
    return result(GPU_VERDICTS.NOT_CAPABLE, GPU_STATUS.TEST_FAILED);
  }
  if (benchFrameMs !== null) {
    reasons.push(`Draw test: ${formatFrame(benchFrameMs)} per frame.`);
    if (benchFrameMs > SLOW_BENCH_FRAME_MS) cautions.push('The draw test was slow, so large graphs may not be smoother than with standard drawing.');
  }
  if (majorPerformanceCaveat) cautions.push('The browser expects drawing with this card to be slow.');
  if (deviceMemoryGb !== null && deviceMemoryGb < LOW_DEVICE_MEMORY_GB) {
    cautions.push(`The browser reports about ${deviceMemoryGb} GB of computer memory, which large graphs may run short of.`);
  }
  if (majorPerformanceCaveat) return result(GPU_VERDICTS.CAPABLE, GPU_STATUS.CAVEAT);
  return result(GPU_VERDICTS.CAPABLE, name ? GPU_STATUS.HARDWARE : GPU_STATUS.UNNAMED);
};

const BENCH_SIZE = 1024;

const CONTEXT_OPTIONS = { antialias: false, powerPreference: 'high-performance' };

const createContext = (options) => {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = BENCH_SIZE;
    canvas.height = BENCH_SIZE;
    return canvas.getContext('webgl2', options);
  } catch {
    return null;
  }
};

/* ── Draw test: 5 000 small squares (nodes) over 15 000 thin lines ───── */

const BENCH_NODES = 5000;
const BENCH_EDGES = 15000;
const BENCH_WARMUP = 3;
const BENCH_FRAMES = 7;
const BENCH_BUDGET_MS = 250;

// Two triangles per quad: along (dx, dy) for `length`, `width` across.
const buildBenchGeometry = () => {
  const data = new Float32Array((BENCH_NODES + BENCH_EDGES + 1) * 12);
  const px = 2 / BENCH_SIZE;
  const random = (i) => {
    const value = Math.sin(i * 12.9898) * 43758.5453;
    return value - Math.floor(value);
  };
  let at = 0;
  const quad = (x, y, angle, length, width) => {
    const ux = (Math.cos(angle) * length * px) / 2;
    const uy = (Math.sin(angle) * length * px) / 2;
    const vx = (-Math.sin(angle) * width * px) / 2;
    const vy = (Math.cos(angle) * width * px) / 2;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    corners.forEach(([a, b]) => {
      data[at] = x + a * ux + b * vx;
      data[at + 1] = y + a * uy + b * vy;
      at += 2;
    });
  };
  for (let i = 0; i < BENCH_EDGES; i += 1) quad(random(i) * 2 - 1, random(i + 0.31) * 2 - 1, random(i + 0.67) * Math.PI, 120, 2);
  for (let i = 0; i < BENCH_NODES; i += 1) quad(random(i + 0.13) * 2 - 1, random(i + 0.53) * 2 - 1, 0, 16, 16);
  quad(0, 0, 0, 40, 40); // covers the pixel read back
  return data;
};

// The median frame time (ms). Throws when the picture is not really drawn.
const runDrawBenchmark = (gl) => {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, '#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}'));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, '#version 300 es\nprecision mediump float;out vec4 c;void main(){c=vec4(0.2,0.4,0.8,0.8);}'));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('shader');
  gl.useProgram(program);
  const data = buildBenchGeometry();
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  const pixel = new Uint8Array(4);
  const times = [];
  const started = performance.now();
  for (let frame = 0; frame < BENCH_WARMUP + BENCH_FRAMES; frame += 1) {
    const start = performance.now();
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 2);
    gl.readPixels(BENCH_SIZE / 2, BENCH_SIZE / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); // waits for the GPU
    const time = performance.now() - start;
    // The first frames compile shaders and wake the card up.
    if (frame >= BENCH_WARMUP) times.push(time);
    if (times.length && performance.now() - started > BENCH_BUDGET_MS) break;
  }
  if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR || !pixel.some((value) => value > 0)) throw new Error('not drawn');
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
};

// Collects the signals in this browser.
export const probeGpuCapability = ({ benchmark = true } = {}) => {
  const checkedAt = new Date().toISOString();
  const signals = { webgl2: false, majorPerformanceCaveat: false, renderer: '', vendor: '', maxTextureSize: 0, deviceMemoryGb: null, benchFrameMs: null, benchFailed: false };
  if (typeof document === 'undefined') {
    return { verdict: GPU_VERDICTS.UNKNOWN, status: GPU_STATUS.UNCONFIRMED, reasons: ['No browser environment.'], cautions: [], signals, checkedAt };
  }
  let gl = createContext({ ...CONTEXT_OPTIONS, failIfMajorPerformanceCaveat: true });
  if (!gl) {
    gl = createContext(CONTEXT_OPTIONS);
    signals.majorPerformanceCaveat = Boolean(gl);
  }
  if (gl) {
    signals.webgl2 = true;
    try {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      signals.renderer = String((info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || '');
      signals.vendor = String((info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)) || '');
      signals.maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
    } catch { /* the name stays hidden */ }
    // Software drawing is known by name: no need to make the page wait.
    if (benchmark && !SOFTWARE_RENDERER_RE.test(signals.renderer)) {
      try {
        signals.benchFrameMs = runDrawBenchmark(gl);
      } catch {
        signals.benchFailed = true;
      }
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  if (typeof navigator !== 'undefined' && typeof navigator.deviceMemory === 'number') signals.deviceMemoryGb = navigator.deviceMemory;
  return { ...decideGpuCapability(signals), signals, checkedAt };
};

/* ── The current result, shared by Libraries and the Graph windows ───── */

let current = null;
const listeners = new Set();

export const subscribeGpuCapability = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const isFresh = (entry) => entry?.verdict && entry.status
  && Date.now() - Date.parse(entry.failedAt || entry.checkedAt) < MAX_AGE_MS;

const readStored = () => {
  try {
    localStorage.removeItem(OLD_STORAGE_KEY);
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    return isFresh(stored) ? stored : null;
  } catch {
    return null;
  }
};

const keep = (result) => {
  current = result;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
  } catch { /* kept in memory */ }
  return result;
};

// The result in use: the same object until a new check or a failure.
export const getGpuCapability = ({ force = false, benchmark = true } = {}) => {
  if (force) return keep(probeGpuCapability({ benchmark }));
  if (!current) {
    current = readStored() || keep(probeGpuCapability({ benchmark }));
  }
  return current;
};

// "Check again": open Graph windows follow the new result.
export const recheckGpuCapability = () => {
  const result = keep(probeGpuCapability());
  listeners.forEach((listener) => listener());
  return result;
};

// A graph could not start on the GPU, or lost it (sleep, a driver reset, the
// browser closing old contexts). GPU drawing pauses in this tab until it is
// checked again; the analyst's choice is kept.
export const markGpuFailed = (reason) => {
  const result = keep({
    verdict: GPU_VERDICTS.NOT_CAPABLE,
    status: GPU_STATUS.GRAPH_FAILED,
    reasons: [reason || 'A graph could not be drawn with the GPU.'],
    cautions: [],
    signals: current?.signals || {},
    checkedAt: current?.checkedAt || null,
    failedAt: new Date().toISOString(),
  });
  listeners.forEach((listener) => listener());
  return result;
};

// Tests only.
export const resetGpuCapability = () => {
  current = null;
};
