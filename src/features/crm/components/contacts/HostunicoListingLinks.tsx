import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';

export function spareRoomListingUrl(value: string | null | undefined): string | null {
  try {
    const url = new URL(value || '');
    return url.protocol === 'https:' && ['spareroom.co.uk', 'www.spareroom.co.uk'].includes(url.hostname) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export default function HostunicoListingLinks({ contactId }: { contactId: string }) {
  // All cards share one cached request. Include held properties for inspection.
  const { data } = useQuery({
    queryKey: ['hostunico-advert-links'], staleTime: 60000,
    queryFn: async () => {
      const { data, error } = await (supabase.from('sa_listings' as any) as any)
        .select('id,wk_contact_id,address,listing_url').eq('source', 'spareroom').order('id');
      if (error) throw error;
      return data as { id: string; wk_contact_id: string; address: string; listing_url: string }[];
    },
  });
  const listings = (data || []).filter((l) => l.wk_contact_id === contactId && spareRoomListingUrl(l.listing_url));
  if (!listings.length) return null;
  const link = (listing: typeof listings[number]) => <a key={listing.id} href={spareRoomListingUrl(listing.listing_url)!} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} title={listing.address} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-50"><ExternalLink size={13} />{listings.length === 1 ? 'Open SpareRoom advert' : listing.address}</a>;
  return listings.length === 1 ? link(listings[0]) : <details className="relative text-xs" onClick={(event) => event.stopPropagation()}><summary className="cursor-pointer rounded-lg border border-blue-200 px-2 py-1.5 font-semibold text-blue-800">SpareRoom adverts ({listings.length})</summary><div className="mt-1 flex flex-col items-start gap-1">{listings.map(link)}</div></details>;
}
