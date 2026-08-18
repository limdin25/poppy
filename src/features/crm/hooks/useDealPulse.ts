// useDealPulse — for every card on the board, what last happened to the deal,
// read from the SAME two streams the cockpit reads so the two screens cannot
// disagree: executed presses from wk_deal_manager_log, and the branch's own
// inbound messages from wk_sms_messages.
//
// Hugo, 2026-08-17: cockpit presses were invisible on the pipeline. The send
// on Zest and the reply from DDM both showed on the cockpit and neither showed
// on the card. See src/features/crm/lib/dealPulse.ts for the decision rule.
//
// Batched and chunked exactly like useContactChannelStatus, because one giant
// in.(...) filter on a 1,100-card board once built a URL past the server's
// limit and the failure was silent (found 2026-07-26).

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { pickPulse, type DealPulse, type PulseAction, type PulseReply } from '../lib/dealPulse';

interface LogRow extends PulseAction { contact_id: string }
interface ReplyRow extends PulseReply { contact_id: string }

/** Map keyed by contact_id. Absent = nothing has happened, render nothing. */
export function useDealPulse(contactIds: string[]): Map<string, DealPulse> {
  const [actions, setActions] = useState<LogRow[]>([]);
  const [replies, setReplies] = useState<ReplyRow[]>([]);

  const idsKey = useMemo(
    () => Array.from(new Set(contactIds.filter(Boolean))).sort().join('|'),
    [contactIds],
  );

  useEffect(() => {
    let cancelled = false;
    const list = idsKey.split('|').filter(Boolean);
    if (list.length === 0) { setActions([]); setReplies([]); return; }

    const CHUNK = 100;
    const chunks: string[][] = [];
    for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK));

    (async () => {
      const [acts, reps] = await Promise.all([
        Promise.all(chunks.map(async (ids) => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase.from('wk_deal_manager_log' as any) as any)
              .select('contact_id, action, instruction, created_at')
              .eq('kind', 'action_executed')
              .in('contact_id', ids)
              .order('created_at', { ascending: false })
              .limit(400);
            if (error) { console.warn('[useDealPulse] log batch failed:', error.message); return []; }
            return (data ?? []) as LogRow[];
          } catch (e) { console.warn('[useDealPulse] log batch threw:', e); return []; }
        })),
        Promise.all(chunks.map(async (ids) => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase.from('wk_sms_messages' as any) as any)
              .select('contact_id, body, created_at')
              .eq('direction', 'inbound')
              .in('contact_id', ids)
              .order('created_at', { ascending: false })
              .limit(400);
            if (error) { console.warn('[useDealPulse] reply batch failed:', error.message); return []; }
            return (data ?? []) as ReplyRow[];
          } catch (e) { console.warn('[useDealPulse] reply batch threw:', e); return []; }
        })),
      ]);
      if (cancelled) return;
      setActions(acts.flat());
      setReplies(reps.flat());
    })();
    return () => { cancelled = true; };
  }, [idsKey]);

  return useMemo(() => {
    const actsBy = new Map<string, LogRow[]>();
    for (const a of actions) {
      const arr = actsBy.get(a.contact_id);
      if (arr) arr.push(a); else actsBy.set(a.contact_id, [a]);
    }
    // Rows arrive newest-first per chunk; first seen per contact is the newest.
    const replyBy = new Map<string, ReplyRow>();
    const sorted = [...replies].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    for (const r of sorted) if (!replyBy.has(r.contact_id)) replyBy.set(r.contact_id, r);

    const out = new Map<string, DealPulse>();
    const everyId = new Set([...actsBy.keys(), ...replyBy.keys()]);
    for (const id of everyId) {
      const pulse = pickPulse(actsBy.get(id) ?? [], replyBy.get(id) ?? null);
      if (pulse) out.set(id, pulse);
    }
    return out;
  }, [actions, replies]);
}
