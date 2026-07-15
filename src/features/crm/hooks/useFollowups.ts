// useFollowups — agent-scoped follow-up timer queue.
//
// Hugo 2026-04-26 (PR 19): Nurturing / Callback / Interested all carry
// a follow-up timer. When the follow-up time arrives, a banner sits at
// the top of every /smsv2 page until the agent dismisses or marks done.
// This hook is the data layer:
//   - SELECT pending wk_contact_followups for the signed-in agent.
//   - Subscribe realtime so newly inserted rows appear without reload.
//   - Expose create / markDone / dismiss / snooze actions.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export type FollowupStatus = 'pending' | 'done' | 'dismissed' | 'snoozed';

export interface Followup {
  id: string;
  contact_id: string;
  agent_id: string;
  column_id: string | null;
  call_id: string | null;
  due_at: string;
  note: string | null;
  status: FollowupStatus;
  created_at: string;
  updated_at: string;
  contact_name: string | null;
  contact_phone: string | null;
}

interface FollowupsTable {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        in: (c: string, vs: string[]) => {
          order: (col: string, opts: { ascending: boolean }) => Promise<{
            data: Followup[] | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    insert: (v: Record<string, unknown>) => {
      select: (c: string) => {
        single: () => Promise<{ data: Followup | null; error: { message: string } | null }>;
      };
    };
    update: (v: Record<string, unknown>) => {
      eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
    };
  };
  channel: (name: string) => {
    on: (
      ev: string,
      filter: { event: string; schema: string; table: string; filter?: string },
      cb: (payload: { new?: Followup; old?: Partial<Followup> }) => void
    ) => { subscribe: () => unknown };
  };
  removeChannel: (c: unknown) => void;
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
}

export interface CreateFollowupInput {
  contact_id: string;
  column_id?: string | null;
  call_id?: string | null;
  due_at: string;
  note?: string | null;
}

const ACTIVE_STATUSES: FollowupStatus[] = ['pending', 'snoozed'];

export function useFollowups() {
  const [items, setItems] = useState<Followup[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (uid: string) => {
    try {
      const client = supabase as unknown as FollowupsTable;
      const { data: raw, error: e } = await client
        .from('wk_contact_followups')
        .select(
          'id, contact_id, agent_id, column_id, call_id, due_at, note, status, created_at, updated_at, wk_contacts(name, phone)'
        )
        .eq('agent_id', uid)
        .in('status', ACTIVE_STATUSES)
        .order('due_at', { ascending: true });
      const data = (raw as any[] | null)?.map((r: any) => ({
        ...r,
        contact_name: r.wk_contacts?.name ?? null,
        contact_phone: r.wk_contacts?.phone ?? null,
        wk_contacts: undefined,
      })) as Followup[] | null;
      if (e) {
        setError(e.message);
      } else {
        setItems(data ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const client = supabase as unknown as FollowupsTable;
    (async () => {
      const { data: userData } = await client.auth.getUser();
      const uid = userData.user?.id ?? null;
      if (cancelled || !uid) {
        setLoading(false);
        return;
      }
      setAgentId(uid);
      await reload(uid);
      const channel = client
        .channel(`wk_contact_followups:${uid}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'wk_contact_followups',
            filter: `agent_id=eq.${uid}`,
          },
          () => {
            if (!cancelled) void reload(uid);
          }
        )
        .subscribe();
      return () => {
        cancelled = true;
        try {
          client.removeChannel(channel);
        } catch {
          /* ignore */
        }
      };
    })();
  }, [reload]);

  const create = useCallback(
    async (input: CreateFollowupInput): Promise<Followup | null> => {
      if (!agentId) {
        setError('Not signed in');
        return null;
      }
      const client = supabase as unknown as FollowupsTable;
      const { data, error: e } = await client
        .from('wk_contact_followups')
        .insert({
          contact_id: input.contact_id,
          agent_id: agentId,
          column_id: input.column_id ?? null,
          call_id: input.call_id ?? null,
          due_at: input.due_at,
          note: input.note ?? null,
          status: 'pending',
        })
        .select(
          'id, contact_id, agent_id, column_id, call_id, due_at, note, status, created_at, updated_at'
        )
        .single();
      if (e) {
        setError(e.message);
        return null;
      }
      return data;
    },
    [agentId]
  );

  const setStatus = useCallback(
    async (id: string, status: FollowupStatus) => {
      const client = supabase as unknown as FollowupsTable;
      const { error: e } = await client
        .from('wk_contact_followups')
        .update({ status })
        .eq('id', id);
      if (e) setError(e.message);
    },
    []
  );

  const snooze = useCallback(
    async (id: string, hours: number) => {
      const client = supabase as unknown as FollowupsTable;
      const due = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
      const { error: e } = await client
        .from('wk_contact_followups')
        .update({ due_at: due, status: 'snoozed' })
        .eq('id', id);
      if (e) setError(e.message);
    },
    []
  );

  // PR 110 (Hugo 2026-04-28): reschedule a follow-up to an explicit
  // datetime (ISO). Unlike snooze() which is relative-hours-from-now,
  // this takes an absolute timestamp. Status stays 'pending' so the
  // banner countdown picks it up. Used by EditContactModal.
  const reschedule = useCallback(
    async (id: string, dueIsoString: string) => {
      const client = supabase as unknown as FollowupsTable;
      const { error: e } = await client
        .from('wk_contact_followups')
        .update({ due_at: dueIsoString, status: 'pending' })
        .eq('id', id);
      if (e) setError(e.message);
      return !e;
    },
    []
  );

  return { items, agentId, loading, error, create, setStatus, snooze, reschedule };
}
