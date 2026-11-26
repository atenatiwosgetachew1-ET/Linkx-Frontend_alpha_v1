// A sign-out asked from inside a window (Settings → Log out) goes through the
// launcher's flow (WorkspaceFrame requestSignOut: warns about running runs,
// /auth/logout as SessionLifecycle decides). False when no frame took it.
export const SIGN_OUT_REQUEST_EVENT = 'linkx:sign-out-request';

export const requestWorkspaceSignOut = () => {
  const event = new Event(SIGN_OUT_REQUEST_EVENT, { cancelable: true });
  return !window.dispatchEvent(event);
};

// The frame's side: `handler` runs and the request counts as taken.
export const onSignOutRequest = (handler) => {
  const listener = (event) => {
    event.preventDefault();
    handler();
  };
  window.addEventListener(SIGN_OUT_REQUEST_EVENT, listener);
  return () => window.removeEventListener(SIGN_OUT_REQUEST_EVENT, listener);
};
