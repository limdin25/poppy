// usePropertyListings — every house this estate agency branch has listed, with
// the offer band already worked out, for the dialer's Houses tab.
//
// Keyed on the BRANCH PHONE, not a property id, because one agency lists many
// houses and Pedro rings the branch once rather than once per house. The RPC
// matches on the last 9 digits, so a number stored as "0191 625 0242" by the
// scraper and "+441916250242" by the ingest route is the same branch.
//
// Reads the wk_property_agent_listings RPC, not brrr_properties directly:
// that table has NO RLS and is service-role only by design, so an anon-key
// browser session cannot see a row of it. The RPC is SECURITY DEFINER with a
// wk_is_agent_or_admin() gate and an explicit projection.
//
// The offer band comes from the SAME offerRange() the dial cron and the admin
// page use — never recomputed here. See api/lib/brrr-offer.ts for why it is a
// percentage of what the house is worth today and never of GDV.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/browser';
import { offerRange, gbpShort, ladderText } from '../../../../api/lib/brrr-offer';

/** One row as the RPC returns it. */
interface ListingRow {
  id: string;
  source_property_id: string | null;
  listing_url: string | null;
  address: string | null;
  price_text: string | null;
  asking_price: number | null;
  bedrooms: number | null;
  property_type: string | null;
  days_on_market: string | null;
  floorplan_urls: string[] | null;
  deal: Record<string, unknown> | null;
  status: string | null;
  qualification: Record<string, unknown> | null;
  notes: string | null;
  call_channel: string | null;
  agent_name: string | null;
  agent_phone: string | null;
  offer_low_pct: number | null;
  offer_high_pct: number | null;
  last_call_at: string | null;
  last_call_channel: string | null;
  last_call_summary: string | null;
}

export interface PropertyListing extends ListingRow {
  /** Open here. Never higher. */
  offerMin: number;
  /** Walk away here. Never said out loud. */
  offerMax: number;
  /** "£108,000, then £114,000, then £119,500" */
  ladder: string;
  /** How much to trust the valuation: high | medium | low | insufficient. */
  confidence: string;
  /** Up to three sold comps, as sentences. */
  evidence: string[];
  /** Plain-English warnings from the valuation engine. */
  flags: string[];
  isAuction: boolean;
}

/** The engine's flag codes, in words an agent can use on the phone.
 *  This is now the ONLY copy. The AI qualifier that held the other one was
 *  retired on 2026-08-09, and its cron was deleted with it. */
const FLAG_NOTES: Record<string, string> = {
  conversion_adds_no_value: 'Converting this adds little value. The money has to come off the purchase price.',
  low_confidence: 'Thin sold evidence nearby. Treat the figures as a guide, not gospel.',
  wide_ring: 'The comparable sales are further away than ideal.',
  old_comps: 'The comparable sales are old. The local market may have moved.',
  no_ppsf_check: 'No floor area, so there was no price-per-square-foot cross-check.',
  priced_below_market: 'It looks keenly priced. Find out why: lease, condition, or a problem.',
  auction: 'Auction lot. There is no negotiation, only a maximum bid.',
};

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

export function usePropertyListings(phone: string | null | undefined) {
  const digits = (phone ?? '').replace(/\D/g, '');
  const enabled = digits.length >= 9;

  const q = useQuery({
    queryKey: ['property-listings', digits.slice(-9)],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<ListingRow[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('wk_property_agent_listings', {
        p_phone: phone,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as ListingRow[];
    },
  });

  const listings = useMemo<PropertyListing[]>(() => {
    return (q.data ?? []).map((r) => {
      const deal = r.deal ?? {};
      const pct = {
        offer_low_pct: r.offer_low_pct ?? 70,
        offer_high_pct: r.offer_high_pct ?? 75,
      };
      const band = offerRange(r, pct);
      const isAuction = deal.is_auction === true || deal.is_auction === '1'
        || String(deal.verdict ?? '').includes('auction');
      const flagCodes = Array.isArray(deal.flags) ? (deal.flags as unknown[]).map(str) : [];
      return {
        ...r,
        offerMin: band.min,
        offerMax: band.max,
        ladder: ladderText(deal, band, isAuction),
        confidence: str(deal.cmv_confidence) || 'unknown',
        evidence: (Array.isArray(deal.evidence) ? (deal.evidence as unknown[]) : [])
          .map(str).filter(Boolean).slice(0, 3),
        flags: flagCodes.map((c) => FLAG_NOTES[c] ?? c).filter(Boolean),
        isAuction,
      };
    });
  }, [q.data]);

  return {
    listings,
    loading: q.isLoading && enabled,
    error: q.error instanceof Error ? q.error.message : null,
    refetch: q.refetch,
  };
}

/** The script's [tokens] for one listing. Kept next to the maths so the words
 *  on screen and the words the agent reads can never use different figures. */
export function scriptTokensFor(l: PropertyListing | null | undefined): Record<string, string> {
  if (!l) return {};
  const addr = l.address ?? '';
  return {
    property_address: addr,
    // "Bedford Street, Coventry, West Midlands, CV1" -> "Bedford Street".
    property_street: addr.split(',')[0]?.trim() || addr,
    asking_price: l.price_text || gbpShort(l.asking_price),
    bedrooms: l.bedrooms != null ? String(l.bedrooms) : '',
    property_type: (l.property_type ?? '').toLowerCase(),
    days_on_market: l.days_on_market ?? '',
    agency: l.agent_name ?? '',
    property_worth: l.deal?.cmv
      ? `${gbpShort(l.deal.cmv)}${l.confidence !== 'unknown' ? ` (${l.confidence} confidence)` : ''}`
      : 'not established',
    offer_open: gbpShort(l.offerMin),
    offer_ceiling: gbpShort(l.offerMax),
    ladder: l.ladder,
    comp_evidence: l.evidence.length ? l.evidence.join(' · ') : 'no sold comparables on file',
    valuation_notes: l.flags.length ? l.flags.join(' ') : 'nothing unusual flagged',
  };
}
