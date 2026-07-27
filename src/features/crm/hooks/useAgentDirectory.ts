// useAgentDirectory — the ONE roster of staff names, id → name.
//
// Hugo 2026-07-27: "leads must always show the name of who it belongs to, on
// all pages." Five components each rolled their own `profiles` query
// (ViewAsSelector, useAgentsToday, useCurrentAgent, useLiveActivity,
// useDailyReports) and each picked a DIFFERENT roster — two of them silently
// omit a profile with no workspace_role that does own leads, which is Hugo's
// own login, so his name rendered as "Agent"/"Unassigned".
//
// Reads the wk_agent_directory RPC, not `profiles` directly:
// wk_handle_new_user creates a profiles row for every Elsie/reviews CUSTOMER
// signup, so an unfiltered select is unbounded and leaks the customer table
// into the browser. The RPC is SECURITY DEFINER + staff-gated.
//
// TanStack Query, not a bespoke module cache: QueryClientProvider already wraps
// the CRM (CrmApp.tsx), and query dedup means N components mounting at once
// produce ONE request, for free.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/browser';

export interface AgentDirectoryEntry {
  id: string;
  name: string;
  email: string;
  workspaceRole: string | null;
  isStaff: boolean;
}

interface DirectoryRow {
  id: string;
  name: string | null;
  email: string | null;
  workspace_role: string | null;
  is_staff: boolean | null;
}

export type AgentLabelState = 'named' | 'unassigned' | 'loading' | 'unknown';

/** Pure — unit-testable without React. Exported for tests. */
export function resolveAgentLabel(
  id: string | null | undefined,
  byId: Map<string, AgentDirectoryEntry>,
  loading: boolean,
): { label: string; state: AgentLabelState } {
  if (!id) return { label: 'Unassigned', state: 'unassigned' };
  const hit = byId.get(id);
  if (hit) return { label: hit.name, state: 'named' };
  // NEVER flash "Unassigned" at a lead that HAS an owner we simply haven't
  // fetched yet — that is exactly the lie ContactDetailPage told for months.
  if (loading) return { label: '…', state: 'loading' };
  return { label: 'Unknown agent', state: 'unknown' };
}

/** Initials for the avatar disc, e.g. "Pedro III Almedina" → "PA". */
export function agentInitials(name: string): string {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export interface AgentDirectory {
  /** Staff only, name-sorted — what an owner dropdown may offer. */
  agents: AgentDirectoryEntry[];
  /** Everyone the roster resolves, incl. role-less lead owners. */
  all: AgentDirectoryEntry[];
  byId: Map<string, AgentDirectoryEntry>;
  nameOf: (id?: string | null) => string;
  loading: boolean;
}

export function useAgentDirectory(): AgentDirectory {
  const { data, isLoading } = useQuery({
    queryKey: ['agent-directory'],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<AgentDirectoryEntry[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rows, error } = await (supabase as any).rpc('wk_agent_directory');
      if (error) throw new Error(error.message);
      return ((rows ?? []) as DirectoryRow[]).map((r) => ({
        id: r.id,
        name: (r.name || '').trim() || r.email || 'Agent',
        email: r.email ?? '',
        workspaceRole: r.workspace_role,
        isStaff: !!r.is_staff,
      }));
    },
  });

  return useMemo(() => {
    const all = data ?? [];
    const byId = new Map(all.map((a) => [a.id, a]));
    return {
      all,
      // A viewer or a stale ex-agent must not be offered as an assignable
      // owner — but nameOf must still resolve one that already owns leads.
      agents: all.filter((a) => a.isStaff),
      byId,
      nameOf: (id?: string | null) => resolveAgentLabel(id, byId, isLoading).label,
      loading: isLoading,
    };
  }, [data, isLoading]);
}
