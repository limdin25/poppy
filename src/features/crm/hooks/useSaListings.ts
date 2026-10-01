// useSaListings: the flats we dealt to Pedro for one letting agency, for the
// Serviced Accommodation call room (Hugo, 2026-09-23).
//
// One agency is one contact and gets one flat at a time, then rests 14 days
// (scripts/lib/sa-listings.mjs). When it comes back it brings a new flat, so a
// contact can hold several over the months; the newest is the one on the call.
//
// Read straight from sa_listings: RLS lets any agent or admin read it, and
// only the service role writes it (the assign script, api/crm/sa-outcome.ts).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/browser';

export interface SaListing {
  id: string;
  rightmoveId: string;
  agency: string;
  agencyPhone: string;
  city: string | null;
  outcode: string | null;
  address: string;
  rentPcm: number | null;
  sourcePrice?: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  propertyType: string | null;
  summary: string | null;
  listingUrl: string | null;
  photoUrls: string[];
  firstListedAt: string | null;
  letAvailableDate: string | null;
  dealtAt: string;
  outcome: string | null;
  outcomeNote: string | null;
  outcomeAt: string | null;
}

interface Row {
  id: string;
  rightmove_id: string;
  agency: string;
  agency_phone: string;
  city: string | null;
  outcode: string | null;
  address: string | null;
  rent_pcm: number | string | null;
  source_price?: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  property_type: string | null;
  summary: string | null;
  listing_url: string | null;
  photo_urls: string[] | null;
  first_listed_at: string | null;
  let_available_date: string | null;
  dealt_at: string;
  outcome: string | null;
  outcome_note: string | null;
  outcome_at: string | null;
}

export function rowToSaListing(r: Row): SaListing {
  const rent = r.rent_pcm == null ? null : Number(r.rent_pcm);
  return {
    id: r.id,
    rightmoveId: r.rightmove_id,
    agency: r.agency,
    agencyPhone: r.agency_phone,
    city: r.city,
    outcode: r.outcode,
    address: r.address ?? '',
    rentPcm: Number.isFinite(rent) ? rent : null,
    sourcePrice: r.source_price ?? null,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms,
    propertyType: r.property_type,
    summary: r.summary,
    listingUrl: r.listing_url,
    photoUrls: Array.isArray(r.photo_urls) ? r.photo_urls : [],
    firstListedAt: r.first_listed_at,
    letAvailableDate: r.let_available_date,
    dealtAt: r.dealt_at,
    outcome: r.outcome,
    outcomeNote: r.outcome_note,
    outcomeAt: r.outcome_at,
  };
}

export const gbpMonth = (n: number | null | undefined): string =>
  n ? `£${Math.round(n).toLocaleString('en-GB')} a month` : '';

/** "Crump Street" out of "Parliament Square, 8 Crump Street, Liverpool".
 *  Mirrors spokenStreet in scripts/lib/sa-listings.mjs. */
export function spokenStreet(address: string | null | undefined): string {
  const parts = String(address ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const STREET = /\b(street|st|road|rd|lane|avenue|place|square|way|court|row|walk|terrace|quay|gardens|close|drive|hill|wharf|parade|crescent|yard)\b/i;
  // A numbered part ("8 Crump Street") is the street; a bare one before it is
  // usually the building ("Parliament Square", "Dakota House").
  const street = parts.find((s) => /^\d+[a-z]?\s/i.test(s) && STREET.test(s))
    ?? parts.find((s) => STREET.test(s))
    ?? parts[0] ?? '';
  return street.replace(/^\d+[a-z]?\s+/i, '').replace(/^(flat|apartment|apt)\s+\S+\s*/i, '').trim();
}

/** The type as said aloud: "flat", "apartment", "penthouse". */
function spokenType(t: string | null): string {
  const s = (t ?? '').trim().toLowerCase();
  if (!s) return 'flat';
  if (s.includes('apartment')) return 'apartment';
  if (s.includes('penthouse')) return 'penthouse';
  if (s.includes('maisonette')) return 'maisonette';
  if (s.includes('duplex')) return 'duplex';
  return 'flat';
}

/** "Now" for a date already past, else "12 October". Rightmove sends an ISO
 *  timestamp or a word ("Now", "Ask agent"); a word is shown as it is. */
export function availableText(v: string | null | undefined): string {
  const s = (v ?? '').trim();
  if (!s) return '';
  const t = Date.parse(s);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s) || Number.isNaN(t)) return s;
  if (t <= Date.now()) return 'Now';
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/** Where the companies want flats, said aloud: "central London", or
 *  "Leeds city centre". */
export function spokenArea(city: string | null | undefined): string {
  const c = (city ?? '').trim();
  if (!c) return 'the city centre';
  return c === 'London' ? 'central London' : `${c} city centre`;
}

/** The tokens the SA script reads for the flat on screen. */
export function saScriptTokens(l: SaListing | null): Record<string, string> {
  if (!l) return {};
  return {
    sa_address: l.address,
    sa_street: spokenStreet(l.address) || l.address,
    sa_rent: gbpMonth(l.rentPcm),
    sa_beds: l.bedrooms ? String(l.bedrooms) : '',
    sa_type: spokenType(l.propertyType),
    sa_city: l.city ?? '',
    sa_area: spokenArea(l.city),
    sa_agency: l.agency,
  };
}

export function useSaListings(contactId: string | null | undefined) {
  const q = useQuery({
    queryKey: ['sa-listings', contactId ?? ''],
    enabled: !!contactId,
    staleTime: 30_000,
    queryFn: async (): Promise<SaListing[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('sa_listings' as any) as any)
        .select('id, rightmove_id, agency, agency_phone, city, outcode, address, rent_pcm, source_price, bedrooms, bathrooms, property_type, summary, listing_url, photo_urls, first_listed_at, let_available_date, dealt_at, outcome, outcome_note, outcome_at')
        .eq('wk_contact_id', contactId)
        .eq('hostunico_call_eligible', true)
        .eq('hostunico_uplift_status', 'eligible')
        .order('dealt_at', { ascending: false })
        .order('id');
      if (error) throw new Error(error.message);
      return ((data ?? []) as Row[]).map(rowToSaListing);
    },
  });
  return { listings: q.data ?? [], loading: q.isLoading, error: q.error ? String(q.error) : null, refetch: q.refetch };
}
