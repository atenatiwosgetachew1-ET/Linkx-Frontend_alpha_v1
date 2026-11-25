// In-app link between a Graph window and its companion windows (the Table
// window, G3.5 i2 #5; analyst decision 2026-11-17; later the Chart window).
// Same browser, same app: no postMessage, no backend.
//
// A Graph window publishes what it draws (the view after the limit, filters,
// timeline and hidden items) and what is selected; a companion subscribes
// per graph window id. A companion asks the Graph window to select or focus
// items; the Graph window carries it out with its own canvas (showing items
// the limit hides first).

const states = new Map(); // graph window id -> { nodeIds, edgeIds, selection: { nodes, edges }, title, weightKey }
const stateListeners = new Map(); // graph window id -> Set(listener)
const actionHandlers = new Map(); // graph window id -> handler
// A request made while its Graph window is not mounted (docked mode mounts
// only the active window): carried out when it mounts again.
const pendingActions = new Map(); // graph window id -> action

const EMPTY_STATE = Object.freeze({ nodeIds: Object.freeze([]), edgeIds: Object.freeze([]), selection: Object.freeze({ nodes: Object.freeze([]), edges: Object.freeze([]) }), title: '', weightKey: '', timeKey: '', timeSlice: 'auto', live: false });

const notify = (id) => stateListeners.get(id)?.forEach((listener) => listener());

export const publishGraphState = (graphId, next) => {
  const id = String(graphId);
  states.set(id, { ...EMPTY_STATE, ...next, live: true });
  notify(id);
};

// The Graph window was closed (not remounted): its companions are told.
export const forgetGraphState = (graphId) => {
  const id = String(graphId);
  states.delete(id);
  actionHandlers.delete(id);
  pendingActions.delete(id);
  notify(id);
};

export const getGraphState = (graphId) => states.get(String(graphId)) || EMPTY_STATE;

export const subscribeGraphState = (graphId, listener) => {
  const id = String(graphId);
  if (!stateListeners.has(id)) stateListeners.set(id, new Set());
  stateListeners.get(id).add(listener);
  return () => {
    stateListeners.get(id)?.delete(listener);
    if (!stateListeners.get(id)?.size) stateListeners.delete(id);
  };
};

// The Graph window's handler for companion requests. Returns the unregister.
export const handleGraphActions = (graphId, handler) => {
  const id = String(graphId);
  actionHandlers.set(id, handler);
  if (pendingActions.has(id)) {
    const pending = pendingActions.get(id);
    pendingActions.delete(id);
    // After the mount (the canvas draws first).
    setTimeout(() => { if (actionHandlers.get(id) === handler) handler(pending); }, 0);
  }
  return () => {
    if (actionHandlers.get(id) === handler) actionHandlers.delete(id);
  };
};

// action: { type: 'select' | 'focus', nodes: [ids], edges: [keys] }
// -> false when its Graph window is not mounted: the action is then kept
// for when it is (the latest one wins), and the published selection is set
// to it at once, so companions show it meanwhile.
export const requestGraphAction = (graphId, action) => {
  const id = String(graphId);
  const handler = actionHandlers.get(id);
  if (handler) {
    handler(action);
    return true;
  }
  pendingActions.set(id, action);
  if (states.has(id)) {
    states.set(id, { ...states.get(id), selection: { nodes: [...(action.nodes || [])], edges: [...(action.edges || [])] } });
    notify(id);
  }
  return false;
};

// Sign-out (the next workspace reuses window ids), and tests.
export const resetGraphLinkBus = () => {
  states.clear();
  stateListeners.clear();
  actionHandlers.clear();
  pendingActions.clear();
};
