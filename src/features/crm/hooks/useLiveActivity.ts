// useLiveActivity — list of currently-active calls across the workspace.
//
// Reads wk_calls where status IN (queued, ringing, in_progress) joined to
// the contact (for display name) and agent (for first-name display). Used
// by the admin dashboard's "Live activity" feed.
//
// Refreshes via wk_calls realtime + a 10s safety poll.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface LiveActivityRow {
  callId: string;
  agentId: string;
  agentName: string;
  contactName: string;
  contactPhone: string;
  status: 'queued' | 'ringing' | 'in_progress';
  startedAt: string;
  aiCoachEnabled: boolean;
}

interface CallRow {
  id: string;
  agent_id: string | null;
  contact_id: string | null;
  status: string;
  started_at: string | null;
  ai_coach_enabled: boolean;
  to_e164: string | null;
}

interface ContactRow {
  id: string;
  name: string;
  phone: string;
}

interface ProfileRow {
  id: string;
  name: string | null;
  email: string | null;
}

export function useLiveActivity(
  // PR 54 (Hugo 2026-04-27): optional agent filter. When set, the
  // dashboard's Live Activity feed only shows calls for that agent.
  // Click an agent in AgentsTable → DashboardPage sets this →
  // refresh() applies the eq.agent_id filter.
  agentId?: string | null,
): { rows: LiveActivityRow[]; loading: boolean } {
  const [rows, setRows] = useState<LiveActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // PR 31 (Hugo 2026-04-27): only consider calls started in the
    // last hour. Hugo saw the dashboard's timer ticking on calls that
    // had clearly ended — the row was stuck at status='in_progress'
    // because Twilio's status callback didn't land (or hasn't yet).
    // Any row older than 60 minutes is almost certainly a stale ghost;
    // hide it from the live feed regardless of status.
    const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('wk_calls' as any) as any)
      .select('id, agent_id, contact_id, status, started_at, ai_coach_enabled, to_e164')
      .in('status', ['queued', 'ringing', 'in_progress'])
      .gte('started_at', oneHourAgoIso)
      .order('started_at', { ascending: false });
    if (agentId) q = q.eq('agent_id', agentId);
    const callsRes = await q;

    const calls = (callsRes.data ?? []) as CallRow[];
    const contactIds = Array.from(
      new Set(calls.map((c) => c.contact_id).filter((x): x is string => !!x))
    );
    const agentIds = Array.from(
      new Set(calls.map((c) => c.agent_id).filter((x): x is string => !!x))
    );

    const [contactsRes, profilesRes] = await Promise.all([
      contactIds.length > 0
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase.from('wk_contacts' as any) as any)
            .select('id, name, phone')
            .in('id', contactIds)
        : Promise.resolve({ data: [] }),
      agentIds.length > 0
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase.from('profiles' as any) as any)
            .select('id, name, email')
            .in('id', agentIds)
        : Promise.resolve({ data: [] }),
    ]);

    const contactById = new Map<string, ContactRow>();
    for (const c of (contactsRes.data ?? []) as ContactRow[]) contactById.set(c.id, c);
    const profileById = new Map<string, ProfileRow>();
    for (const p of (profilesRes.data ?? []) as ProfileRow[]) profileById.set(p.id, p);

    setRows(
      calls.map((c): LiveActivityRow => {
        const contact = c.contact_id ? contactById.get(c.contact_id) : undefined;
        const agent = c.agent_id ? profileById.get(c.agent_id) : undefined;
        return {
          callId: c.id,
          agentId: c.agent_id ?? '',
          agentName: agent?.name ?? agent?.email ?? 'Agent',
          contactName: contact?.name ?? c.to_e164 ?? 'Unknown',
          contactPhone: contact?.phone ?? c.to_e164 ?? '',
          status: c.status as 'queued' | 'ringing' | 'in_progress',
          startedAt: c.started_at ?? new Date().toISOString(),
          aiCoachEnabled: c.ai_coach_enabled,
        };
      })
    );
    setLoading(false);
  }, [agentId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 10_000);
    const ch = supabase
      .channel('smsv2-live-activity')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_calls' },
        () => {
          void refresh();
        }
      )
      .subscribe();
    return () => {
      clearInterval(t);
      void supabase.removeChannel(ch);
    };
  }, [refresh]);

  return { rows, loading };
}
