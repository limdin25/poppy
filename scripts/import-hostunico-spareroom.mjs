// Explicit human-requested import. No calls, texts or emails. Defaults to a dry run.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { prepareSpareRoomImport, areaProperty, wholeHomeEligibility } from './lib/hostunico-spareroom.mjs';
const file = process.argv.find((arg) => arg.startsWith('--file='))?.slice(7);
if (!file) throw new Error('Pass --file with the private export JSON.');
const sourceDirectory = process.argv.find((arg) => arg.startsWith('--source='))?.slice(9);
if (!sourceDirectory) throw new Error('Pass --source with the saved advert pages. Only verified whole studios and one-bedroom homes can be imported.');
const sourceRows = JSON.parse(readFileSync(file, 'utf8')).filter((row) => {
  const id = /flatshare_id=(\d+)/.exec(row.Link || '')?.[1];
  if (!id) return false;
  try { return wholeHomeEligibility(row.Name, readFileSync(`${sourceDirectory}/${id}.txt`, 'utf8')).eligible; } catch { return false; }
});
const plan = prepareSpareRoomImport(sourceRows);
console.log(JSON.stringify({ sourceRows: plan.sourceRows, contacts: plan.contacts.length, properties: plan.properties.length, duplicateRows: plan.duplicateRows, rejected: plan.rejected.length }));
if (plan.rejected.length) throw new Error('Import contains invalid phone numbers or listing IDs.');
if (!process.argv.includes('--apply')) process.exit(0);
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const campaignId = '5d9657f9-d9b4-4e27-a2d1-83db80867f92';
const pipelineId = 'dadce4ac-90b5-4320-9291-ff6bb1cf89f0';
function check({ data, error }) { if (error) throw new Error(error.message); return data; }
const pedro = check(await supa.from('profiles').select('id').eq('email', 'pedro@hostunico.com').single());
const stage = check(await supa.from('wk_pipeline_columns').select('id').eq('pipeline_id', pipelineId).eq('name', 'New lead').single());
const campaign = check(await supa.from('wk_dialer_campaigns').select('desk').eq('id', campaignId).single());
if (campaign.desk !== 'sa') throw new Error('Wrong campaign desk.');
let contactsAdded = 0, propertiesAdded = 0, queued = 0, optedOut = 0;
// Validate conflicts before any mutation; never move an existing lead from another desk or owner.
const existing = check(await supa.from('wk_contacts').select('id,phone,desk,owner_agent_id,do_not_call,custom_fields').in('phone', plan.contacts.map((c) => c.phone)));
if (existing.some((c) => c.desk !== 'sa' || c.owner_agent_id !== pedro.id)) throw new Error('A number belongs to another desk or agent. Review without reassigning it.');
const timestamp = Date.now();
for (const [index, c] of plan.contacts.entries()) {
  let contact = existing.find((row) => row.phone === c.phone);
  if (!contact) {
    contact = check(await supa.from('wk_contacts').insert({ name: c.name, phone: c.phone, desk: 'sa', owner_agent_id: pedro.id, pipeline_column_id: stage.id, ai_enabled: false,
      custom_fields: { lead_type: 'hostunico_owner', source: 'spareroom', owner_name: c.name, advertiser_type: c.advertiserType, next_step: 'Offer the property report', property_count: String(c.properties.length) } }).select('id,do_not_call').single());
    contactsAdded++;
  }
  for (const [pIndex, property] of c.properties.entries()) {
    const rightmoveId = `spareroom:${property.advertId}`;
    const present = check(await supa.from('sa_listings').select('id,wk_contact_id').eq('rightmove_id', rightmoveId).maybeSingle());
    if (present) { if (present.wk_contact_id !== contact.id) throw new Error('A property belongs to another contact.'); continue; }
    // Hugo approved clearly labelled area assumptions. Confirmed property facts stay empty.
    check(await supa.from('sa_listings').insert({ rightmove_id: rightmoveId, source: 'spareroom', agency: c.name, agency_phone: c.phone, wk_contact_id: contact.id,
      address: property.title || property.location, city: property.location, source_price: property.sourcePrice, rent_pcm: property.monthlyRent,
      bedrooms: null, bathrooms: null, property_type: property.details.studio ? 'Advertised studio (confirm)' : 'Confirm whole property or room',
      outcode: property.details.areaOutcode || null,
      summary: `SpareRoom. Advertiser: ${property.advertiserType}. Area estimate assumptions are unconfirmed. Collect the full postcode, whole-property bedrooms, bathrooms and rent scope on the call.`,
      listing_url: property.listingUrl, let_available_date: property.availableDate, report_property: areaProperty(property),
      dealt_at: new Date(timestamp - index * 100 - pIndex).toISOString() }));
    propertiesAdded++;
  }
  if (contact.do_not_call) { optedOut++; continue; }
  const verified = check(await supa.from('sa_listings').select('id').eq('wk_contact_id', contact.id).eq('hostunico_call_eligible', true).limit(1));
  // New imports enter the queue only after the photo and eligibility screen.
  if (!verified.length) continue;
  const history = check(await supa.from('wk_dialer_queue').select('id').eq('campaign_id', campaignId).eq('contact_id', contact.id).limit(1));
  if (!history.length) { check(await supa.from('wk_dialer_queue').insert({ campaign_id: campaignId, contact_id: contact.id, status: 'pending', priority: plan.contacts.length - index })); queued++; }
}
console.log(JSON.stringify({ contactsAdded, propertiesAdded, queued, optedOut, automaticMessages: 0 }));
