// "See as: <agent>" — lets an ADMIN view the CRM exactly as one agent sees it.
// Admins normally see the whole workspace; when they pick an agent here, the
// agent-scoped hooks (starting with the inbox) filter to that agent's own
// leads instead. Non-admins can't impersonate — the context is inert for them.
//
// Persisted in localStorage so it survives navigation/reload. The effective
// scope is resolved by useEffectiveAgentId() below, which every agent-scoped
// hook should use instead of reading auth.uid() directly.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './useCrmAuth';

interface ViewAsValue {
  /** Agent being impersonated, or null = the admin's own whole-workspace view. */
  viewAsId: string | null;
  viewAsName: string | null;
  setViewAs: (id: string | null, name: string | null) => void;
}

const ViewAsContext = createContext<ViewAsValue>({
  viewAsId: null,
  viewAsName: null,
  setViewAs: () => {},
});

const KEY = 'crm_view_as';

export function ViewAsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ id: string | null; name: string | null }>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw) as { id: string | null; name: string | null };
    } catch { /* ignore */ }
    return { id: null, name: null };
  });

  const setViewAs = useCallback((id: string | null, name: string | null) => {
    setState({ id, name });
    try {
      if (id) localStorage.setItem(KEY, JSON.stringify({ id, name }));
      else localStorage.removeItem(KEY);
    } catch { /* ignore */ }
  }, []);

  const value = useMemo(
    () => ({ viewAsId: state.id, viewAsName: state.name, setViewAs }),
    [state, setViewAs],
  );

  return <ViewAsContext.Provider value={value}>{children}</ViewAsContext.Provider>;
}

export function useViewAs(): ViewAsValue {
  return useContext(ViewAsContext);
}

/**
 * The agent id that data should be scoped to for the current viewer:
 *   - a non-admin  → always their own uid (they can't impersonate).
 *   - an admin impersonating an agent → that agent's id.
 *   - an admin NOT impersonating → null (= see the whole workspace).
 * Hooks treat `null` as "no per-agent filter". `resolved` is false until the
 * admin check has settled, so callers can wait rather than briefly over-scope.
 */
export function useEffectiveAgentId(uid: string | null): { scopeAgentId: string | null; resolved: boolean } {
  const { isAdmin, loading } = useAuth();
  const { viewAsId } = useViewAs();
  // While auth/admin is still resolving, don't guess.
  if (loading) return { scopeAgentId: uid, resolved: false };
  if (!isAdmin) return { scopeAgentId: uid, resolved: true };
  return { scopeAgentId: viewAsId, resolved: true };
}

/** Clear a stale impersonation when the tab is opened by a non-admin. */
export function useResetViewAsForNonAdmin() {
  const { isAdmin, loading } = useAuth();
  const { viewAsId, setViewAs } = useViewAs();
  useEffect(() => {
    if (!loading && !isAdmin && viewAsId) setViewAs(null, null);
  }, [loading, isAdmin, viewAsId, setViewAs]);
}
