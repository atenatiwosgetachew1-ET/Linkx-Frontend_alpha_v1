import { useCallback, useEffect, useRef, useState } from 'react';

import { resolveSourceDefaults } from '../../features/source/lib/sourceConfig.js';
import { getGraphStore, hasGraphStore } from '../../features/graph/lib/graphStore.js';
import { buildWorkspaceCopy, readTabCopy, readWorkspaceCopy, removeWorkspaceCopy, workspaceOwnerKey, writeTabCopy, writeWorkspaceCopy } from '../lib/workspaceCopy.js';

const SAVE_DELAY_MS = 600;
const OTHER_TAB_WAIT_MS = 250;
const CHANNEL = 'linkx.workspace';
const hasNodes = (windowId) => hasGraphStore(windowId) && getGraphStore(windowId).getSnapshot().nodes > 0;

// Keeps the workspace in this browser and offers the last one
// (lib/workspaceCopy.js). Nothing is written until the offer is answered, so
// a new page never replaces what it could restore.
// - A reload offers this tab's own workspace.
// - A new tab or a sign-in offers the user's last one, unless another tab of
//   theirs is using it; that tab then keeps the user's copy, and this one
//   takes over when it closes.
// -> { offer (the copy, or null), answered() }.
// configuration: the session's, to tell its defaults from the analyst's values.
export function useWorkspaceCopy({ user, workspace, configuration }) {
  const owner = workspaceOwnerKey(user);
  const [offer, setOffer] = useState(null);
  const writingRef = useRef(false); // the offer was answered, or there was none
  const mainRef = useRef(false); // no other tab keeps the user's copy
  const latestRef = useRef({ workspace, configuration });
  latestRef.current = { workspace, configuration };

  const save = useCallback(() => {
    if (!writingRef.current) return;
    const { workspace: current, configuration: settings } = latestRef.current;
    const copy = buildWorkspaceCopy(current, { hasNodes, sourceDefaults: resolveSourceDefaults(settings) });
    writeTabCopy(owner, copy);
    if (mainRef.current) writeWorkspaceCopy(owner, copy);
  }, [owner]);

  useEffect(() => {
    let channel = null;
    let timer = null;
    writingRef.current = false;
    mainRef.current = false;
    const begin = (isMain) => {
      timer = null;
      mainRef.current = isMain;
      const copy = readTabCopy(owner) || (isMain ? readWorkspaceCopy(owner) : null);
      if (copy) setOffer(copy);
      else writingRef.current = true;
    };
    if (typeof BroadcastChannel !== 'function') {
      begin(true);
    } else {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = ({ data }) => {
        if (data?.owner !== owner) return;
        if (data.type === 'who' && mainRef.current) channel.postMessage({ type: 'here', owner });
        else if (data.type === 'here' && timer) {
          clearTimeout(timer);
          begin(false);
        } else if (data.type === 'bye' && !timer) mainRef.current = true;
      };
      timer = setTimeout(() => begin(true), OTHER_TAB_WAIT_MS);
      channel.postMessage({ type: 'who', owner });
    }
    const leave = () => {
      save();
      if (mainRef.current) channel?.postMessage({ type: 'bye', owner });
    };
    window.addEventListener('pagehide', leave);
    return () => {
      // Signed out: what this page last held is kept for the next sign-in.
      window.removeEventListener('pagehide', leave);
      clearTimeout(timer);
      leave();
      channel?.close();
      setOffer(null);
    };
  }, [owner, save]);

  const { windows, activeWindowId, orientation, contextTab } = workspace;
  useEffect(() => {
    const timer = setTimeout(save, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [save, windows, activeWindowId, orientation, contextTab]);

  // Restored, or started fresh (which forgets the copy).
  const answered = useCallback(() => {
    setOffer(null);
    writingRef.current = true;
    writeTabCopy(owner, null);
    if (mainRef.current) removeWorkspaceCopy(owner);
    save();
  }, [owner, save]);

  return { offer, answered };
}
