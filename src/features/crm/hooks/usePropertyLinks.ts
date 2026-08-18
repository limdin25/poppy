// usePropertyLinks — "which house is this branch selling, and where do I click
// to see it", for surfaces that render a hundred rows at once.
//
// Hugo, 2026-08-11: "if you want a link and go to rightmove from the pipeline
// or also from the call recording we should be able to go and see the property.
// I have no link to go see the property on rightmove."
//
// NOT usePropertyListings(). That one takes a single phone and returns the full
// deal jsonb with the offer band worked out, which is exactly right for the
// dialer's Houses tab and exactly wrong for a board of a hundred cards: it
// would be a hundred round trips for a hyperlink. This calls the batched
// wk_property_links RPC once for every phone on screen.
//
// Keyed on the LAST 9 DIGITS, the same rule the sibling RPC uses, because the
// scraper writes "0121 387 6499" and the ingest route writes "+441213876499"
// and they are the same branch.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/browser';
import { phoneTail } from '../../../../api/lib/phone-match';
import type { NextStepBrief } from '../../../../api/lib/next-step-brief';

export interface PropertyLink {
  phone_tail: string;
  property_id: string;
  listing_url: string;
  address: string | null;
  price_text: string | null;
  asking_price: number | null;
  bedrooms: number | null;
  property_type: string | null;
  /** 2026-08-14: the board card used to render a phone number over a house that
   *  had a whole paragraph of instruction on it. All four of these already
   *  existed on brrr_properties; the RPC simply did not project them. */
  brief: NextStepBrief | null;
  pinned_note: string | null;
  agent_name: string | null;
  /** Who Pedro spoke to at the branch, off the call checklist. */
  branch_contact_name: string | null;
}

/** The last 9 digits of a phone, or '' when there are not 9 to take.
 *
 *  Re-exported (it used to be defined here) so the existing callers keep their
 *  import, while the rule itself lives in ONE place beside samePhone, where the
 *  inbound call screen reads it too. See api/lib/phone-match.ts. */
export { phoneTail };

/**
 * @param phones every branch number on screen. Order and duplicates do not
 *        matter; they are normalised and sorted into the query key so a
 *        re-render with the same set does not refetch.
 * @returns tail -> the houses that branch has listed, newest first. Branches
 *          with no property (every plumber lead, for one) are simply absent.
 */
export function usePropertyLinks(phones: Array<string | null | undefined>) {
  const tails = useMemo(() => {
    return [...new Set(phones.map(phoneTail).filter(Boolean))].sort();
  }, [phones]);

  const q = useQuery({
    queryKey: ['property-links', tails.join(',')],
    enabled: tails.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<PropertyLink[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('wk_property_links', {
        p_phones: tails,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as PropertyLink[];
    },
  });

  const byPhone = useMemo(() => {
    const m = new Map<string, PropertyLink[]>();
    for (const row of q.data ?? []) {
      const list = m.get(row.phone_tail);
      if (list) list.push(row);
      else m.set(row.phone_tail, [row]);
    }
    return m;
  }, [q.data]);

  return { byPhone, loading: q.isLoading && tails.length > 0 };
}
