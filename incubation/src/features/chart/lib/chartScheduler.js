// Chart updates (ECharts setOption) spread over animation frames, a few
// milliseconds of them a frame, so many cards redrawing at once (a
// selection recolouring a full board) never holds the page up. One pending
// task per key: a newer one replaces it (only the latest state is drawn).

const FRAME_BUDGET_MS = 8;
const pending = new Map(); // key -> task
let frame = null;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const nextFrame = (callback) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : setTimeout(callback, 16));

const run = () => {
  frame = null;
  const start = now();
  for (const [key, task] of pending) {
    pending.delete(key);
    try {
      task();
    } catch (error) {
      // One card's failure leaves the others drawing.
      console.error('Chart update failed', error);
    }
    if (now() - start > FRAME_BUDGET_MS) break;
  }
  if (pending.size) frame = nextFrame(run);
};

export const scheduleChartWork = (key, task) => {
  pending.delete(key);
  pending.set(key, task);
  if (frame === null) frame = nextFrame(run);
};

export const cancelChartWork = (key) => {
  pending.delete(key);
};
