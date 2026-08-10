// CrmGuard — gates /crm/* routes by profiles.workspace_role.
//
// Hugo 2026-04-27 (PR 45 — CRM rename): the SMSV2 module was previously
// only behind ProtectedRoute, meaning ANY signed-in user (a tenant, a
// landlord, a guest browsing booking site) could open /smsv2/settings
// and poke around. With the public rename to CRM, we tighten access:
//
//   admin / agent / viewer  → allowed
//   anything else           → redirected to /crm/login
//   not signed in           → redirected to /crm/login
//
// The hardcoded admin allow-list (the owner/admin addresses configured
// in useAuth) is honoured: admins always pass, even if their
// workspace_role column is NULL.

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/crm/lib/useCrmAuth';
import { supabase } from '@/integrations/supabase/browser';

interface Props {
  children: ReactNode;
}

const ALLOWED_ROLES = new Set(['admin', 'agent', 'viewer']);

export default function CrmGuard({ children }: Props) {
  const { user, loading: authLoading, isAdmin } = useAuth();
  const location = useLocation();
  const [role, setRole] = useState<string | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    if (!user) {
      setRole(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from('profiles') as any)
        .select('workspace_role')
        .eq('id', user.id)
        .maybeSingle();
      if (!cancelled) setRole((data?.workspace_role as string | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (authLoading || (user && role === undefined)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F3F3EE]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#3C5A87] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-[#6B7280] mt-3">Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    // One login for the whole app host — /login routes CRM staff straight back
    // here after auth (via the `from` state), receptionist owners to /dashboard.
    // pathname AND search: the dialer's mode lives in the query
    // (?script=property_call), and bouncing through login used to strip it,
    // which dropped Pedro onto the PLUMBER script with his estate-agent queue
    // still loaded behind it.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  // Hardcoded admins pass even if workspace_role column is null.
  const allowed = isAdmin || (typeof role === 'string' && ALLOWED_ROLES.has(role));
  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F3F3EE] px-6">
        <div className="text-center max-w-[440px] bg-white border border-[#E5E7EB] rounded-2xl p-8 shadow-[0_4px_24px_rgba(0,0,0,0.05)]">
          <div className="text-3xl mb-3">🔒</div>
          <h1 className="text-[18px] font-bold text-[#1A1A1A]">CRM access required</h1>
          <p className="text-[13px] text-[#6B7280] mt-2 leading-relaxed">
            Your account isn't set up as a CRM agent. Ask the admin who invited you to
            confirm your email is registered, or sign in with the credentials they gave
            you.
          </p>
          <a
            href="/login"
            className="mt-5 inline-block text-[13px] font-semibold text-white bg-[#3C5A87] px-4 py-2 rounded-[10px]"
          >
            Sign in
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
