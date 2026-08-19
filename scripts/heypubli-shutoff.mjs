#!/usr/bin/env node
// The Instagram method's WhatsApp shutoff (Hugo, 2026-08-19: "block everybody,
// the WhatsApp becomes the business line for builders and estate agents, and
// stop all whatsapp follow up for heypubli as well").
//
// DRY BY DEFAULT. Without --apply it changes nothing anywhere, it only counts
// and reports. With --apply it does exactly two things, neither of which
// deletes a single row:
//
//   1. Elsie CRM: every wk_contacts stamped custom_fields.product='heypubli'
//      gets the 'do-not-text' tag. That tag is the one gate wk-sms-send,
//      wk-draft-action, ai-reply AND wk-partner-api (the door HeyPubli's own
//      reply brain sends through) all refuse on, so nothing in either app can
//      message a creator again, whatever its own switches say.
//   2. HeyPubli Supabase: funnel_settings 'default' row gets whatsapp_enabled,
//      auto_reply_enabled, nurture_enabled and onboarding_nudges_enabled all
//      set false, which stops every WhatsApp follow-up ladder at its source.
//
// Run:  node scripts/heypubli-shutoff.mjs           (dry, prints the counts)
//       node scripts/heypubli-shutoff.mjs --apply

import { createClient } from '@supabase/supabase-js';
import { loadRepoEnv } from './lib/line-status.mjs';

loadRepoEnv();

const APPLY = process.argv.includes('--apply');
const say = (s) => console.log(s);

const ELSIE_URL = process.env.SUPABASE_URL;
const ELSIE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HP_URL = process.env.HEYPUBLI_SUPABASE_URL;
const HP_KEY = process.env.HEYPUBLI_SERVICE_ROLE_KEY;

if (!ELSIE_URL || !ELSIE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing.');
  process.exit(1);
}

const elsie = createClient(ELSIE_URL, ELSIE_KEY);

say(APPLY ? 'APPLY RUN. Rows will be tagged and switches flipped.' : 'DRY RUN. Nothing changes. Re-run with --apply to do it.');

// ---- 1. do-not-text every heypubli contact (Elsie side) --------------------
// PostgREST caps at 1000 a page, and an unpaged read here would silently miss
// contacts (the skool_invites lesson). Page until short.
const contacts = [];
for (let fromRow = 0; ; fromRow += 1000) {
  const { data, error } = await elsie
    .from('wk_contacts')
    .select('id, name, custom_fields')
    .eq('custom_fields->>product', 'heypubli')
    .range(fromRow, fromRow + 999);
  if (error) { console.error('read wk_contacts failed:', error.message); process.exit(1); }
  contacts.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
say(`HeyPubli-stamped contacts: ${contacts.length}`);

let alreadyTagged = 0;
let tagged = 0;
for (const c of contacts) {
  const { data: existing } = await elsie
    .from('wk_contact_tags')
    .select('tag')
    .eq('contact_id', c.id)
    .eq('tag', 'do-not-text')
    .maybeSingle();
  if (existing) { alreadyTagged += 1; continue; }
  if (APPLY) {
    const { error } = await elsie
      .from('wk_contact_tags')
      .insert({ contact_id: c.id, tag: 'do-not-text' });
    if (error) console.error(`  tag failed for ${c.name ?? c.id}: ${error.message}`);
    else tagged += 1;
  } else {
    tagged += 1;
  }
}
say(`  already blocked: ${alreadyTagged}`);
say(`  ${APPLY ? 'newly blocked' : 'would block'}: ${tagged}`);

// ---- 2. HeyPubli's own follow-up switches ----------------------------------
if (!HP_URL || !HP_KEY) {
  say('HEYPUBLI_SUPABASE_URL / HEYPUBLI_SERVICE_ROLE_KEY not set, skipping the funnel switches.');
  say('The do-not-text tags above still block every send at the wk-partner-api door.');
} else {
  const hp = createClient(HP_URL, HP_KEY);
  const { data: fs, error } = await hp
    .from('funnel_settings').select('*').eq('id', 'default').maybeSingle();
  if (error || !fs) {
    say(`Could not read funnel_settings: ${error?.message ?? 'no default row'}.`);
    say('The do-not-text tags above still block every send at the wk-partner-api door.');
  } else {
    const SWITCHES = ['whatsapp_enabled', 'auto_reply_enabled', 'nurture_enabled', 'onboarding_nudges_enabled'];
    say('funnel_settings today:');
    for (const k of SWITCHES) say(`  ${k}: ${fs[k]}`);
    if ('skool_invites_enabled' in fs) say(`  skool_invites_enabled: ${fs.skool_invites_enabled} (email, left alone)`);
    const on = SWITCHES.filter((k) => fs[k] === true);
    if (!on.length) {
      say('Every WhatsApp switch is already off.');
    } else if (APPLY) {
      const patch = Object.fromEntries(on.map((k) => [k, false]));
      const { error: upErr } = await hp.from('funnel_settings').update(patch).eq('id', 'default');
      if (upErr) console.error(`flip failed: ${upErr.message}`);
      else say(`Flipped off: ${on.join(', ')}`);
    } else {
      say(`Would flip off: ${on.join(', ')}`);
    }
  }
}

say('Done. No rows were deleted; threads stay reachable under See as: HeyPubli.');
