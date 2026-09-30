import { createClient } from '@supabase/supabase-js';
import { spareRoomPhotos } from './lib/spareroom-photos.mjs';
const apply = process.argv.includes('--apply');
const db = createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: listings, error } = await db.from('sa_listings').select('id,listing_url,photo_urls').eq('source', 'spareroom');
if (error) throw error;
let updated = 0, missing = 0;
for (let i = 0; i < listings.length; i += 4) await Promise.all(listings.slice(i, i + 4).map(async (listing) => {
  try {
    const url = new URL(listing.listing_url);
    if (!/^(www\.)?spareroom\.co\.uk$/.test(url.hostname) || url.protocol !== 'https:') throw new Error('Not a SpareRoom advert');
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Advert unavailable');
    const photos = spareRoomPhotos(await response.text());
    if (!photos.length) throw new Error('No advert photo');
    const image = await fetch(photos[0], { method: 'HEAD', signal: AbortSignal.timeout(12000) });
    if (!image.ok || !image.headers.get('content-type')?.startsWith('image/')) throw new Error('Photo unavailable');
    if (apply) {
      const saved = await db.from('sa_listings').update({ photo_urls: photos }).eq('id', listing.id);
      if (saved.error) throw saved.error;
    }
    updated++;
  } catch { missing++; }
}));
console.log(JSON.stringify({ applied: apply, listings: listings.length, withVerifiedPhoto: updated, needsPhoto: missing }));
