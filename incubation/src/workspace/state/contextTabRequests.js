// Lets a window ask the right panel to show one of its tabs (production's
// "activate_graph_tab" message, e.g. Info after focusing a graph alert).
// The panel keeps its own tab state; it only follows requests for tabs that
// are enabled at that moment.
const listeners = new Set();

export const requestContextTab = (tabId) => {
  listeners.forEach((listener) => listener(tabId));
};

export const subscribeContextTabRequests = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
