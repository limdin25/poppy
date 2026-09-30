// Screens saved source pages, preserves excluded history and never makes contact.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { wholeHomeEligibility } from './lib/hostunico-spareroom.mjs';
const directory = process.argv.find((arg) => arg.startsWith('--source='))?.slice(9);
if (!directory) throw new Error('Pass the directory containing saved advert text.');
const apply = process.argv.includes('--apply');
const db = createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const check = ({ data, error }) => { if (error) throw error; return data; };
const listings = check(await db.from('sa_listings').select('id,rightmove_id,wk_contact_id,address,photo_urls').eq('source', 'spareroom'));
const eligibleContacts = new Set();
let eligible = 0;
for (const listing of listings) {
  const advertId = listing.rightmove_id.replace('spareroom:', '');
  let text = '';
  try { text = readFileSync(`${directory}/${advertId}.txt`, 'utf8'); } catch { /* Unverified adverts stay out of the queue. */ }
  const result = wholeHomeEligibility(listing.address, text);
  if (result.eligible && listing.photo_urls?.length) { eligible++; eligibleContacts.add(listing.wk_contact_id); }
  if (apply) check(await db.from('sa_listings').update({ hostunico_call_eligible: result.eligible && !!listing.photo_urls?.length, hostunico_eligibility_note: listing.photo_urls?.length ? result.reason : 'Actual advert photo unavailable', ...(result.eligible ? { bedrooms: result.bedrooms, property_type: result.studio ? 'Studio' : 'Flat', summary: `${result.reason}. Confirm availability, authority, full postcode and bathroom count. Area report assumptions remain unconfirmed.` } : {}) }).eq('id', listing.id));
}
const queue = check(await db.from('wk_dialer_queue').select('id,contact_id,status').eq('campaign_id', '5d9657f9-d9b4-4e27-a2d1-83db80867f92'));
const excluded = queue.filter((row) => row.status === 'pending' && !eligibleContacts.has(row.contact_id));
if (apply && excluded.length) check(await db.from('wk_dialer_queue').update({ status: 'skipped' }).in('id', excluded.map((row) => row.id)).eq('status', 'pending'));
console.log(JSON.stringify({ applied: apply, eligibleProperties: eligible, uniqueEligibleContacts: eligibleContacts.size, removedFromPendingQueue: excluded.length, automaticMessages: 0 }));
