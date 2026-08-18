// useDealOrders: the brain's newest judgement per branch, for the board.
//
// Goes through the wk_deal_orders RPC and ONLY through it. A raw select on
// wk_deal_manager_log would hit the RLS row filter, which silently skips
// Hugo-flagged rows for an agent, so "the newest row" would be an OLDER
// visible one: the exact Zest "Hold, nothing today" bug, reborn on the board.
// The RPC reads past the policy and applies the same privacy by hand
// (migration 20260817000002).
//
// One rpc() call for the whole board: the ids travel in the POST body, so
// there is no URL-length trap to chunk around (unlike the .in() hooks).

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/browser';
import type { DealOrder } from '../lib/dealOrder';

interface OrderRow {
  contact_id: string;
  property_id: string | null;
  instruction: string | null;
  action: string | null;
  who: string | null;
  confidence: string | null;
  source: string | null;
  at: string;
  blocked_on_hugo: boolean;
}

/** Map keyed by contact_id. Absent = the brain has never judged this one. */
export function useDealOrders(contactIds: string[]): Map<string, DealOrder> {
  const idsKey = useMemo(
    () => Array.from(new Set(contactIds.filter(Boolean))).sort(),
    [contactIds],
  );

  const q = useQuery({
    queryKey: ['deal-orders', idsKey.join('|')],
    enabled: idsKey.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<OrderRow[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('wk_deal_orders', {
        p_contact_ids: idsKey,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as OrderRow[];
    },
  });

  return useMemo(() => {
    const m = new Map<string, DealOrder>();
    for (const r of q.data ?? []) {
      m.set(r.contact_id, {
        instruction: r.instruction,
        action: r.action,
        who: r.who,
        confidence: r.confidence,
        at: r.at,
        blockedOnHugo: r.blocked_on_hugo === true,
      });
    }
    return m;
  }, [q.data]);
}
