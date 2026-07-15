// useActiveDialerLegs — what's ringing right now for THIS agent.
//
// PR 24 (Hugo 2026-04-27): the parallel-dial board was rendering
// hardcoded MOCK_DIALER_LEGS. Now we read live wk_calls rows for
// the signed-in agent in the in-flight statuses (queued / ringing /
// in_progress) and show them. Realtime subscription on wk_calls so
// the board updates as Twilio fires status callbacks.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export type DialerLegStatus =
  | 'queued'
  | 'ringing'
  | 'in_progress'
  | 'completed'
  | 'busy'
  | 'no_answer'
  | 'failed'
  | 'canceled'
  | 'missed'
  | 'voicemail';

export interface DialerLeg {
  id: string;
  contactId: string | null;
  contactName: string;
  phone: string;
  status: DialerLegStatus;
  startedAt: number;
  twilioSid: string | null;
  /** PR 54 (Hugo 2026-04-27): retry counter from wk_dialer_queue.attempts.
   *  0 = first try, 1 = second try, etc. Null when no queue row matches
   *  (e.g. manual single-dial calls that never went through the dialer
   *  campaign queue). */
  attempts: number | null;
}

interface CallRow {
  id: string;
  contact_id: string | null;
  campaign_id: string | null;
  to_e164: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  twilio_call_sid: string | null;
}

interface QueueRow {
  contact_id: string;
  campaign_id: string;
  attempts: number;
}

interface ContactRow {
  id: string;
  name: string;
  phone: string;
}

/** Statuses that count as "still in flight" — the board shows these.
 *  Once a call resolves (completed / failed / etc) it drops off. */
const ACTIVE_STATUSES = new Set<string>([
  'queued',
  'ringing',
  'in_progress',
]);

/** PR 54 (Hugo 2026-04-27): max age for an in-flight leg before we
 *  hide it from the board even if Twilio's terminal status callback
 *  hasn't landed yet. Twilio's outbound-dial timeout is 60s, so any
 *  leg older than 90s is almost certainly dead. The admin Live
 *  Activity feed uses a 60-min cutoff because it's a history view;
 *  the dialer board is a real-time snapshot, so we're stricter. */
const STALE_LEG_MAX_AGE_MS = 90_000;

interface SupaTable<T> {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        in?: (c: string, vs: string[]) => Promise<{
          data: T[] | null;
          error: { message: string } | null;
        }>;
        order?: (
          col: string,
          opts: { ascending: boolean }
        ) => Promise<{ data: T[] | null; error: { message: string } | null }>;
      };
    };
  };
  channel: (name: string) => {
    on: (
      ev: string,
      filter: { event: string; schema: string; table: string; filter?: string },
      cb: (payload: unknown) => void
    ) => { subscribe: () => unknown };
  };
  removeChannel: (c: unknown) => void;
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
}

export function useActiveDialerLegs(): { legs: DialerLeg[]; loading: boolean } {
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [contactsById, setContactsById] = useState<Map<string, ContactRow>>(new Map());
  const [queueByCampaignContact, setQueueByCampaignContact] = useState<Map<string, number>>(
    new Map()
  );
  const [agentId, setAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 1Hz tick so the stale-leg cutoff re-evaluates without waiting
  // for a wk_calls realtime event to drop the row.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Resolve agent id once.
  useEffect(() => {
    (async () => {
      const client = supabase as unknown as SupaTable<unknown>;
      const { data } = await client.auth.getUser();
      setAgentId(data.user?.id ?? null);
    })();
  }, []);

  // Initial fetch + realtime subscription on wk_calls for this agent.
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    const client = supabase as unknown as SupaTable<CallRow>;

    const reload = async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from('wk_calls' as any) as any)
        .select('id, contact_id, campaign_id, to_e164, status, started_at, ended_at, twilio_call_sid')
        .eq('agent_id', agentId)
        .in('status', Array.from(ACTIVE_STATUSES))
        .order('started_at', { ascending: false });
      if (cancelled) return;
      const rows = (data ?? []) as CallRow[];
      setCalls(rows);
      setLoading(false);
    };

    void reload();

    const channel = client
      .channel(`dialer-legs:${agentId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'wk_calls',
          filter: `agent_id=eq.${agentId}`,
        },
        () => {
          if (!cancelled) void reload();
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
  }, [agentId]);

  // PR 54 (Hugo 2026-04-27): pull wk_dialer_queue.attempts for the
  // (campaign_id, contact_id) pairs in scope so the dialer board can
  // show "2nd try" / "3rd try" badges. Re-runs whenever the call set
  // changes — re-uses the existing fetch path instead of subscribing
  // to wk_dialer_queue separately (each leg's row is already covered
  // by the wk_calls realtime channel via reload()).
  useEffect(() => {
    const pairs = calls
      .filter((c) => !!c.campaign_id && !!c.contact_id)
      .map((c) => ({
        campaign_id: c.campaign_id as string,
        contact_id: c.contact_id as string,
      }));
    if (pairs.length === 0) {
      if (queueByCampaignContact.size > 0) setQueueByCampaignContact(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const campaignIds = Array.from(new Set(pairs.map((p) => p.campaign_id)));
      const contactIds = Array.from(new Set(pairs.map((p) => p.contact_id)));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from('wk_dialer_queue' as any) as any)
        .select('campaign_id, contact_id, attempts')
        .in('campaign_id', campaignIds)
        .in('contact_id', contactIds);
      if (cancelled || !data) return;
      const next = new Map<string, number>();
      for (const row of data as QueueRow[]) {
        next.set(`${row.campaign_id}:${row.contact_id}`, row.attempts ?? 0);
      }
      setQueueByCampaignContact(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calls]);

  // Resolve contact names for the active calls (parallel SELECT). Cache
  // by id so subsequent reloads don't re-fetch unchanged contacts.
  useEffect(() => {
    const ids = Array.from(
      new Set(calls.map((c) => c.contact_id).filter((v): v is string => !!v))
    );
    const missing = ids.filter((id) => !contactsById.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from('wk_contacts' as any) as any)
        .select('id, name, phone')
        .in('id', missing);
      if (cancelled || !data) return;
      setContactsById((prev) => {
        const next = new Map(prev);
        for (const row of data as ContactRow[]) next.set(row.id, row);
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [calls, contactsById]);

  const legs = useMemo<DialerLeg[]>(() => {
    const cutoff = Date.now() - STALE_LEG_MAX_AGE_MS;
    return calls
      .filter((c) => ACTIVE_STATUSES.has(c.status))
      // PR 54 (Hugo 2026-04-27): drop "Connected" / "Calling…" rows
      // that are older than STALE_LEG_MAX_AGE_MS — Twilio's terminal
      // status callback may be delayed or lost; this prevents the
      // dialer board showing a ghost timer ticking up forever.
      // ended_at being non-null also drops the row.
      .filter((c) => c.ended_at === null)
      .filter((c) => {
        const startedMs = c.started_at ? new Date(c.started_at).getTime() : Date.now();
        return startedMs > cutoff;
      })
      .map((c) => {
        const contact = c.contact_id ? contactsById.get(c.contact_id) : undefined;
        const queueKey =
          c.campaign_id && c.contact_id ? `${c.campaign_id}:${c.contact_id}` : null;
        const attempts =
          queueKey && queueByCampaignContact.has(queueKey)
            ? (queueByCampaignContact.get(queueKey) ?? 0)
            : null;
        return {
          id: c.id,
          contactId: c.contact_id,
          contactName: contact?.name ?? 'Unknown',
          phone: contact?.phone ?? c.to_e164 ?? '',
          status: c.status as DialerLegStatus,
          startedAt: c.started_at ? new Date(c.started_at).getTime() : Date.now(),
          twilioSid: c.twilio_call_sid,
          attempts,
        };
      });
  }, [calls, contactsById, queueByCampaignContact]);

  return { legs, loading };
}
