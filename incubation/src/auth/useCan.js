import { useCallback, useContext } from 'react';

import { AuthContext } from './authContext.js';

// Single permission check for the UI: `can('config:write')`.
// From the signed-in actor's permission list only (`/auth/me` →
// actor.permissions): the Service gives every role its permissions under
// the same key and enforces them, and asks the UI not to infer them from
// the role name (frontend alignment 2026-11-20, H-9 / H-16). Production's
// admin bypass is dropped for that reason.
//
// Permission per action:
//   config:read    view Configuration, export encrypted configuration
//   config:write   save, reset, import, domain switch, rules, classified
//                  entities, session timeout policy
//   users:manage   Users, Service accounts, Activity log, detection
//                  sensitivity edits, vigilance pause/rewind
//   superuser:manage  assign or remove the superuser/admin roles
//   tasks:read_all    "All tasks"; alerts:read_all "All alerts" (and analyse any)
//   alerts:feedback   report STR findings back; evidence:create  save a run
// Outside an AuthProvider (isolated component tests) nothing is permitted.
export function useCan() {
  const hasPermission = useContext(AuthContext)?.hasPermission;
  return useCallback((permission) => Boolean(hasPermission?.(permission)), [hasPermission]);
}
