// Caller — useCalls.
// Lists wk_calls (most recent 200) with realtime + agent scoping. Used
// by CallsPage. Phase 4 skeleton: no joins for recording / intelligence
// / cost — those land per phase 5 (recording playback) and reports.

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface CallListRow {
  id: string;
  contactId: string;
  agentId: string;
  direction: 'inbound' | 'outbound';
  status: string;
  startedAt: string | null;
  durationSec: number | null;
  dispositionColumnId: string | null;
  agentNote: string | null;
  contactName: string | null;
  contactPhone: string | null;
  pipelineColumnId: string | null;
  recordingUrl: string | null;
}

interface WkCallRow {
  id: string;
  contact_id: string;
  agent_id: string;
  direction: 'inbound' | 'outbound';
  status: string;
  started_at: string | null;
  duration_sec: number | null;
  disposition_column_id: string | null;
  agent_note: string | null;
}

interface ContactNamePhone {
  id: string;
  name: string | null;
  phone: string | null;
  pipeline_column_id: string | null;
}

function rowToCall(r: WkCallRow, contact?: ContactNamePhone, recordingUrl?: string | null): CallListRow {
  return {
    id: r.id,
    contactId: r.contact_id,
    agentId: r.agent_id,
    direction: r.direction,
    status: r.status,
    startedAt: r.started_at,
    durationSec: r.duration_sec,
    dispositionColumnId: r.disposition_column_id,
    agentNote: r.agent_note,
    contactName: contact?.name ?? null,
    contactPhone: contact?.phone ?? null,
    pipelineColumnId: contact?.pipeline_column_id ?? null,
    recordingUrl: recordingUrl ?? null,
  };
}

interface Opts {
  /** When set, only calls placed by this agent. */
  agentId?: string | null;
  /** When set, only calls for this contact. */
  contactId?: string | null;
  limit?: number;
}

export function useCalls(opts: Opts = {}) {
  const { agentId = null, contactId = null, limit = 200 } = opts;
  const [calls, setCalls] = useState<CallListRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refetch = () => setTick((t) => t + 1);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (supabase.from('wk_calls' as any) as any)
        .select(
          'id, contact_id, agent_id, direction, status, started_at, duration_sec, disposition_column_id, agent_note'
        )
        .order('started_at', { ascending: false })
        .limit(limit);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let countQ = (supabase.from('wk_calls' as any) as any)
        .select('id', { count: 'exact', head: true });

      if (agentId) {
        q = q.eq('agent_id', agentId);
        countQ = countQ.eq('agent_id', agentId);
      }
      if (contactId) {
        q = q.eq('contact_id', contactId);
        countQ = countQ.eq('contact_id', contactId);
      }

      const [{ data, error: e }, { count, error: countErr }] = await Promise.all([q, countQ]);
      if (cancelled) return;

      if (e || countErr) {
        setError(e?.message ?? countErr?.message ?? 'Failed to load calls');
        setCalls([]);
        setTotalCount(0);
        setLoading(false);
        return;
      }
      setTotalCount(count ?? 0);
      const callRows = (data ?? []) as WkCallRow[];
      const callIds = callRows.map((r) => r.id);
      const contactIds = Array.from(new Set(callRows.map((r) => r.contact_id)));
      let contactsById = new Map<string, ContactNamePhone>();
      let recordingsByCallId = new Map<string, string>();
      if (contactIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: cs } = await (supabase.from('wk_contacts' as any) as any)
          .select('id, name, phone, pipeline_column_id')
          .in('id', contactIds);
        if (cancelled) return;
        contactsById = new Map(
          ((cs ?? []) as ContactNamePhone[]).map((c) => [c.id, c] as const)
        );
      }
      if (callIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: recs } = await (supabase.from('wk_call_recordings' as any) as any)
          .select('call_id, storage_path')
          .in('call_id', callIds);
        if (cancelled) return;
        for (const r of (recs ?? []) as { call_id: string; storage_path: string }[]) {
          recordingsByCallId.set(r.call_id, r.storage_path);
        }
      }
      setCalls(callRows.map((r) => rowToCall(r, contactsById.get(r.contact_id), recordingsByCallId.get(r.id))));
      setLoading(false);
    }

    void load();

    let pending: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        if (!cancelled) void load();
      }, 500);
    };

    const channelSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ch = supabase
      .channel(`caller-calls-${agentId ?? 'all'}-${contactId ?? 'any'}-${channelSuffix}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_calls' },
        refresh
      )
      .subscribe();

    // Polling fallback (8s) — Supabase realtime drops events under load
    // or when RLS evaluates server-side. Hugo flagged that the call
    // history wasn't updating live; polling guarantees eventual
    // consistency without relying on the websocket.
    const pollId = window.setInterval(() => {
      if (!cancelled) void load();
    }, 8_000);

    return () => {
      cancelled = true;
      if (pending) clearTimeout(pending);
      window.clearInterval(pollId);
      try { void supabase.removeChannel(ch); } catch { /* ignore */ }
    };
  }, [agentId, contactId, limit, tick]);

  return { calls, totalCount, loading, error, refetch };
}

export async function signCallRecording(path: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from('call-recordings')
      .createSignedUrl(path, 600);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}
