import { useCallback } from 'react';

import { useAuth } from './useAuth.js';

// Permissions that the admin role does NOT implicitly grant (production
// canAccess bypassed everything for admins, letting any admin manage
// superusers).
const NO_ADMIN_BYPASS = new Set(['superuser:manage']);

// Single permission check for the UI: `can('config:write')`.
// UI gating only; the backend must enforce the same rules (request B-1).
//
// Permission per action:
//   config:read    view Configuration, export encrypted configuration
//   config:write   save, reset, import, domain switch, rules, classified
//                  entities, session timeout policy
//   users:manage   Users, Service accounts, Activity log, detection
//                  sensitivity edits, vigilance pause/rewind
//   superuser:manage  assign or remove the superuser/admin roles
export function useCan() {
  const { hasRole, hasPermission } = useAuth();
  return useCallback((permission) => (
    hasPermission(permission) || (!NO_ADMIN_BYPASS.has(permission) && hasRole('admin'))
  ), [hasPermission, hasRole]);
}
