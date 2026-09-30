// Human-authorised area assumptions only. Never overwrites confirmed inputs or sends a message.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { prepareSpareRoomImport, areaProperty } from './lib/hostunico-spareroom.mjs';
const file = process.argv.find((a) => a.startsWith('--file='))?.slice(7);
if (!file) throw new Error('Private enriched source file required.');
const plan = prepareSpareRoomImport(JSON.parse(readFileSync(file, 'utf8')));
const valid = plan.properties.filter((p) => areaProperty(p));
console.log(JSON.stringify({ areasAvailable: valid.length, missingArea: plan.properties.length - valid.length, allLayoutsUnconfirmed: true }));
if (!process.argv.includes('--apply')) process.exit(0);
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
let changed = 0;
for (const p of valid) {
  const { data, error } = await db.from('sa_listings').update({ report_property: areaProperty(p), outcode: p.details.areaOutcode,
    summary: 'Area estimate only. Assumes a whole home, the advertised bedroom count (or one-bedroom proxy if missing/studio) and one bathroom. Confirm full postcode, whole-property layout, permissions and rent scope on the call.' })
    .eq('rightmove_id', `spareroom:${p.advertId}`).eq('source', 'spareroom').is('report_property', null).select('id');
  if (error) throw new Error(error.message);
  changed += data.length;
}
console.log(JSON.stringify({ assumptionsPrepared: changed, messagesSent: 0 }));
