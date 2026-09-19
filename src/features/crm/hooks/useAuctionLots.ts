// useAuctionLots: every unsold lot we hold for one auction office, for the
// Auction call room (Hugo, 2026-09-18).
//
// One office phone is one contact, and one call covers every lot of theirs on
// our list, so the room loads the lots by the office phone (last nine digits,
// the same match every property screen uses) through wk_auction_office_lots.
//
// Every figure here is READ off what the VPS engine filed: the value, the
// discount and the comparables are the engine's, never worked out again in the
// browser.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/browser';

export interface AuctionFacts {
  house?: string | null;
  office?: string | null;
  office_phone?: string | null;
  office_email?: string | null;
  lot_number?: string | null;
  auction_date?: string | null;
  status?: string | null;
  status_text?: string | null;
  guide_low?: number | null;
  guide_high?: number | null;
  guide_text?: string | null;
  post_auction_price?: number | null;
  price_to_beat?: number | null;
  price_to_beat_basis?: string | null;
  tenure?: string | null;
  occupancy?: string | null;
  legal_pack_url?: string | null;
  sqm_source?: string | null;
}

export interface AuctionComp {
  address?: string | null;
  price?: number | null;
  date_info?: string | null;
  distance_m?: number | null;
  floor_area_sqm?: number | null;
  property_type?: string | null;
}

export interface AuctionLot {
  id: string;
  source: string;
  lotUrl: string | null;
  address: string;
  bedrooms: number | null;
  propertyType: string | null;
  floorAreaSqm: number | null;
  floorplanUrls: string[];
  photoUrls: string[];
  auction: AuctionFacts;
  /** The engine's value from strong, size-matched comps. */
  value: number | null;
  /** How far the price to beat sits under that value, 0.25 = 25%. */
  discount: number | null;
  tier: string | null;
  valueNote: string | null;
  comps: AuctionComp[];
  evidence: string[];
  status: string;
  /** Withdrawn by the nightly re-check: sold, withdrawn, or no longer passes. */
  withdrawn: boolean;
  withdrawnWhy: string | null;
  qualification: Record<string, unknown>;
  lastCallAt: string | null;
  lastCallSummary: string | null;
}

interface Row {
  id: string;
  source: string;
  listing_url: string | null;
  address: string | null;
  bedrooms: number | null;
  property_type: string | null;
  floor_area_sqm: number | null;
  floorplan_urls: unknown;
  photo_urls: string[] | null;
  auction: AuctionFacts | null;
  deal: Record<string, unknown> | null;
  comps: unknown;
  status: string | null;
  qualification: Record<string, unknown> | null;
  last_call_at: string | null;
  last_call_summary: string | null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}

export function rowToLot(r: Row): AuctionLot {
  const deal = (r.deal ?? {}) as Record<string, unknown>;
  const cmv = (deal.cmv ?? {}) as Record<string, unknown>;
  const audit = (deal.audit ?? {}) as Record<string, unknown>;
  // Gone: the nightly re-check withdrew it (sold at the auction house, or no
  // longer passes), or Pedro pressed Sold / Not suitable (LOT_GONE in
  // api/crm/auction-outcome.ts).
  const killed = audit.verdict === 'kill' || r.status === 'auditor_killed'
    || r.status === 'sold' || r.status === 'not_suitable';
  const checks = Array.isArray(audit.checks) ? audit.checks as Array<Record<string, unknown>> : [];
  const reasons = Array.isArray(audit.reasons) ? (audit.reasons as unknown[]).map(String).join(', ') : '';
  const why = String(checks[0]?.detail ?? '') || reasons;
  return {
    id: r.id,
    source: r.source,
    lotUrl: r.listing_url,
    address: r.address ?? '',
    bedrooms: r.bedrooms,
    propertyType: r.property_type,
    floorAreaSqm: num(r.floor_area_sqm),
    floorplanUrls: Array.isArray(r.floorplan_urls) ? (r.floorplan_urls as unknown[]).filter((u): u is string => typeof u === 'string') : [],
    photoUrls: Array.isArray(r.photo_urls) ? r.photo_urls : [],
    auction: r.auction ?? {},
    value: num(cmv.estimate),
    discount: num(deal.local_discount_pct),
    tier: typeof deal.comps_tier === 'string' ? deal.comps_tier : null,
    valueNote: typeof cmv.note === 'string' ? cmv.note : null,
    comps: Array.isArray(r.comps) ? (r.comps as AuctionComp[]) : [],
    evidence: Array.isArray(deal.evidence) ? (deal.evidence as unknown[]).filter((s): s is string => typeof s === 'string') : [],
    status: r.status ?? 'new',
    withdrawn: killed,
    withdrawnWhy: killed
      ? (r.status === 'sold' ? 'Marked sold or under offer on a call.'
        : r.status === 'not_suitable' ? 'Marked not suitable on a call.' : why)
      : null,
    qualification: r.qualification ?? {},
    lastCallAt: r.last_call_at,
    lastCallSummary: r.last_call_summary,
  };
}

export const gbp = (n: number | null | undefined): string =>
  n ? `£${Math.round(n).toLocaleString('en-GB')}` : '';

/** "8 September" out of "2026-09-08". Said aloud, so no year and no weekday. */
export function spokenDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

export function guideText(a: AuctionFacts): string {
  if (a.guide_text && a.guide_text.trim()) return a.guide_text.trim();
  if (a.guide_low && a.guide_high && a.guide_low !== a.guide_high) return `${gbp(a.guide_low)} to ${gbp(a.guide_high)}`;
  return gbp(a.guide_high ?? a.guide_low);
}

/** The tokens the auction script reads for the lot on screen. */
export function lotScriptTokens(lot: AuctionLot | null): Record<string, string> {
  if (!lot) return {};
  return {
    lot_number: String(lot.auction.lot_number ?? '').trim(),
    lot_address: lot.address,
    auction_house: String(lot.auction.house ?? '').trim(),
    auction_date: spokenDate(lot.auction.auction_date),
    guide_price: guideText(lot.auction),
  };
}

export function useAuctionLots(phone: string | null | undefined) {
  const tail = String(phone ?? '').replace(/\D/g, '').slice(-9);
  const q = useQuery({
    queryKey: ['auction-office-lots', tail],
    enabled: tail.length === 9,
    staleTime: 30_000,
    queryFn: async (): Promise<AuctionLot[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('wk_auction_office_lots', { p_phone: phone });
      if (error) throw new Error(error.message);
      return ((data ?? []) as Row[]).map(rowToLot);
    },
  });
  return { lots: q.data ?? [], loading: q.isLoading, error: q.error ? String(q.error) : null, refetch: q.refetch };
}
