// Can this device draw graphs with the GPU (WebGL)? (graph-chart-plan §3.9)
//
// Browsers do not expose GPU memory, so the answer is a verdict, never a
// figure: "capable" | "not_capable" | "unknown", with the reasons. GPU
// rendering stays OFF by default; this only decides whether to *offer* it.
//
// Signals, cheapest first:
// 1. A WebGL2 context created with failIfMajorPerformanceCaveat: the browser
//    refuses it when it would fall back to software rendering.
// 2. The renderer string (where WEBGL_debug_renderer_info is allowed):
//    SwiftShader / llvmpipe / "software" means software rendering.
// 3. MAX_TEXTURE_SIZE and navigator.deviceMemory as coarse floors.
// 4. A short off-screen draw benchmark (optional, under ~200 ms).

const STORAGE_KEY = 'linkx.device.gpuCapability.v1';
const SOFTWARE_RENDERER_RE = /swiftshader|llvmpipe|softpipe|software|microsoft basic render|mesa offscreen/i;
const MIN_TEXTURE_SIZE = 4096;
const MIN_DEVICE_MEMORY_GB = 4;
// Benchmark: frames of a 20k-triangle draw; slower than this is not "capable".
const MAX_BENCH_FRAME_MS = 12;

export const GPU_VERDICTS = Object.freeze({ CAPABLE: 'capable', NOT_CAPABLE: 'not_capable', UNKNOWN: 'unknown' });

// Pure decision from the collected signals (unit-tested).
export const decideGpuCapability = ({
  webgl2 = false,
  majorPerformanceCaveat = false,
  renderer = '',
  maxTextureSize = 0,
  deviceMemoryGb = null,
  benchFrameMs = null,
} = {}) => {
  const reasons = [];
  if (!webgl2) return { verdict: GPU_VERDICTS.NOT_CAPABLE, reasons: ['WebGL2 is not available in this browser.'] };
  if (majorPerformanceCaveat) {
    return { verdict: GPU_VERDICTS.NOT_CAPABLE, reasons: ['The browser would draw WebGL in software (no usable GPU).'] };
  }
  if (renderer && SOFTWARE_RENDERER_RE.test(renderer)) {
    return { verdict: GPU_VERDICTS.NOT_CAPABLE, reasons: [`Software renderer detected (${renderer}).`] };
  }
  if (maxTextureSize && maxTextureSize < MIN_TEXTURE_SIZE) {
    return { verdict: GPU_VERDICTS.NOT_CAPABLE, reasons: [`GPU texture limit too small (${maxTextureSize}px).`] };
  }
  if (deviceMemoryGb !== null && deviceMemoryGb < MIN_DEVICE_MEMORY_GB) {
    return { verdict: GPU_VERDICTS.NOT_CAPABLE, reasons: [`Low device memory (${deviceMemoryGb} GB).`] };
  }
  if (benchFrameMs !== null && benchFrameMs > MAX_BENCH_FRAME_MS) {
    return { verdict: GPU_VERDICTS.NOT_CAPABLE, reasons: [`GPU draw test too slow (${benchFrameMs.toFixed(1)} ms per frame).`] };
  }
  if (renderer) reasons.push(`GPU: ${renderer}.`);
  if (benchFrameMs !== null) reasons.push(`Draw test: ${benchFrameMs.toFixed(1)} ms per frame.`);
  if (!renderer && benchFrameMs === null) {
    return { verdict: GPU_VERDICTS.UNKNOWN, reasons: ['Hardware WebGL is available, but the GPU could not be identified.'] };
  }
  return { verdict: GPU_VERDICTS.CAPABLE, reasons };
};

const createContext = (canvas, options) => {
  try {
    return canvas.getContext('webgl2', options);
  } catch {
    return null;
  }
};

// Draws 20k triangles a few times and returns the median frame time (ms).
const runDrawBenchmark = (gl) => {
  const vertexSource = '#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';
  const fragmentSource = '#version 300 es\nprecision mediump float;out vec4 c;void main(){c=vec4(0.2,0.4,0.8,1.0);}';
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const triangles = 20000;
  const data = new Float32Array(triangles * 6);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1;
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  const pixel = new Uint8Array(4);
  const times = [];
  for (let frame = 0; frame < 6; frame += 1) {
    const start = performance.now();
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, triangles * 3);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); // forces the GPU to finish
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
};

// Collects the signals in this browser. `benchmark: false` skips step 4.
export const probeGpuCapability = ({ benchmark = true } = {}) => {
  if (typeof document === 'undefined') return { verdict: GPU_VERDICTS.UNKNOWN, reasons: ['No browser environment.'], signals: {} };
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const strict = createContext(canvas, { failIfMajorPerformanceCaveat: true, antialias: false, preserveDrawingBuffer: true });
  const signals = { webgl2: false, majorPerformanceCaveat: false, renderer: '', vendor: '', maxTextureSize: 0, deviceMemoryGb: null, benchFrameMs: null };
  let gl = strict;
  if (!gl) {
    // Distinguish "no WebGL2 at all" from "only in software".
    const lenient = createContext(document.createElement('canvas'), {});
    signals.webgl2 = Boolean(lenient);
    signals.majorPerformanceCaveat = Boolean(lenient);
    lenient?.getExtension('WEBGL_lose_context')?.loseContext();
  } else {
    signals.webgl2 = true;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    signals.renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
    signals.vendor = String(info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR) || '');
    // Masked generic strings ("WebKit WebGL") identify nothing.
    if (/^webkit webgl$/i.test(signals.renderer)) signals.renderer = '';
    signals.maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
    if (benchmark) {
      try {
        signals.benchFrameMs = runDrawBenchmark(gl);
      } catch {
        signals.benchFrameMs = null;
      }
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  if (typeof navigator !== 'undefined' && typeof navigator.deviceMemory === 'number') signals.deviceMemoryGb = navigator.deviceMemory;
  return { ...decideGpuCapability(signals), signals, checkedAt: new Date().toISOString() };
};

// Cached per browser (the device rarely changes); "Check again" passes force.
export const getGpuCapability = ({ force = false, benchmark = true } = {}) => {
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (cached?.verdict) return cached;
    } catch { /* no storage */ }
  }
  const result = probeGpuCapability({ benchmark });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
  } catch { /* no storage */ }
  return result;
};

// A WebGL context was lost or failed in a graph: remember "not capable" here.
export const markGpuNotCapable = (reason) => {
  const result = { verdict: GPU_VERDICTS.NOT_CAPABLE, reasons: [reason || 'GPU rendering failed on this device.'], signals: {}, checkedAt: new Date().toISOString() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
  } catch { /* no storage */ }
  return result;
};
