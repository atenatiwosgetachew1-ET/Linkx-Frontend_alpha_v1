// Non-serializable, per-window runtime data for Source windows. Workspace
// state only holds plain data, so File objects, abort controllers and active
// job ids live here keyed by the workspace window id.

const registry = new Map();

const entryFor = (windowId) => {
  const key = String(windowId);
  if (!registry.has(key)) registry.set(key, { files: [], controllers: new Set(), jobs: {}, secrets: {}, disposers: new Set(), refs: {} });
  return registry.get(key);
};

// Persistent per-window ref objects ({ current }). They outlive component
// instances, so async work started before a remount (or a docked-tab
// switch) still reads and writes this window's latest state.
export const windowRef = (windowId, name, initial = null) => {
  const refs = entryFor(windowId).refs;
  if (!refs[name]) refs[name] = { current: initial };
  return refs[name];
};

export const setStagedFiles = (windowId, files) => {
  entryFor(windowId).files = Array.from(files || []);
};

export const getStagedFiles = (windowId) => entryFor(windowId).files;

// Returns an AbortController tracked for the window; call `release` when done.
export const trackRequest = (windowId) => {
  const entry = entryFor(windowId);
  const controller = new AbortController();
  entry.controllers.add(controller);
  return {
    signal: controller.signal,
    release: () => entry.controllers.delete(controller),
  };
};

// Typed secrets (the Neo4j password) live here, never in workspace window
// state, so they stay out of the global store / DevTools and are dropped when
// the window closes. `scope` is the mode ('batch' | 'realtime').
export const setSecret = (windowId, scope, value) => {
  const entry = entryFor(windowId);
  if (value) entry.secrets[scope] = value;
  else delete entry.secrets[scope];
};

export const getSecret = (windowId, scope) => entryFor(windowId).secrets[scope] || '';

export const setActiveJob = (windowId, kind, jobId) => {
  const entry = entryFor(windowId);
  if (jobId) entry.jobs[kind] = jobId;
  else delete entry.jobs[kind];
};

export const getActiveJob = (windowId, kind) => entryFor(windowId).jobs[kind] || null;

// Analyst cancelled the running action: abort everything in flight but keep
// the staged files.
export const abortSourceRequests = (windowId) => {
  const entry = registry.get(String(windowId));
  if (!entry) return;
  entry.controllers.forEach((controller) => controller.abort());
  entry.controllers.clear();
  entry.jobs = {};
};

// Work that must stop when the window closes but must survive Esc-cancel
// (e.g. following a long-running stream job).
export const onSourceRuntimeDispose = (windowId, dispose) => {
  entryFor(windowId).disposers.add(dispose);
};

// Window closed: cancel in-flight requests and forget everything.
export const disposeSourceRuntime = (windowId) => {
  const key = String(windowId);
  const entry = registry.get(key);
  if (!entry) return;
  entry.controllers.forEach((controller) => controller.abort());
  entry.disposers.forEach((dispose) => { try { dispose(); } catch { /* ignore */ } });
  registry.delete(key);
};

// Signed out: window ids are reused by the next workspace, so no typed
// password, staged file or job may survive into it.
export const disposeAllSourceRuntimes = () => {
  [...registry.keys()].forEach(disposeSourceRuntime);
};
