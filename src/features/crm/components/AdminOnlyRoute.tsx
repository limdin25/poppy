// AdminOnlyRoute — wraps /crm routes that should only be visible to
// admins. Non-admins are redirected to /crm/inbox. Auth + workspace
// membership is already enforced by CrmGuard at the layout level —
// this guard adds the admin check on top.
//
// PR 62 (Hugo 2026-04-27).

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/features/crm/lib/useCrmAuth';
import { supabase } from '@/integrations/supabase/browser';

interface Props {
  children: ReactNode;
}

export default function AdminOnlyRoute({ children }: Props) {
  const { user, loading: authLoading, isAdmin } = useAuth();
  const [workspaceRole, setWorkspaceRole] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    // PR 62 (Hugo 2026-04-27): wait for auth to settle BEFORE flipping
    // workspaceRole. Earlier code immediately set workspaceRole=null
    // when user was still null (auth loading), then briefly rendered
    // "not admin" → redirect → wrong route. Now we explicitly leave
    // workspaceRole as `undefined` (= "still loading") until auth
    // either resolves to a user (→ query DB) or confirms no user (→
    // null).
    if (authLoading) return;
    if (!user) { setWorkspaceRole(null); return; }
    let cancelled = false;
    setWorkspaceRole(undefined);
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from('profiles' as any) as any)
        .select('workspace_role')
        .eq('id', user.id)
        .maybeSingle();
      if (!cancelled) setWorkspaceRole((data?.workspace_role as string | null) ?? null);
    })();
    return () => { cancelled = true; };
  }, [authLoading, user]);

  if (authLoading || (user && workspaceRole === undefined)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F3F3EE]">
        <div className="w-8 h-8 border-2 border-[#3C5A87] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // PR 63 (Hugo 2026-04-27): workspace_role wins when explicitly set.
  // The hardcoded admin email allow-list (an owner address, etc.) used
  // to override an explicit 'agent' role — Hugo found this when he
  // renamed his own profile to "Rod" + workspace_role='agent' and
  // could still see Settings because the email match snuck through.
  // New rule: if workspace_role IS set, that's the source of truth.
  // If workspace_role is null, fall back to the email allow-list.
  const allowed =
    workspaceRole === 'admin' || (workspaceRole === null && isAdmin);
  if (!allowed) return <Navigate to="/admin/crm/inbox" replace />;

  return <>{children}</>;
}
