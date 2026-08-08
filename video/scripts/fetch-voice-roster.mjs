// fetch-voice-roster.mjs: build the voice pools the render swap draws from.
//
// Every account's copy of a master currently carries the same voice, which is
// the loudest "these are all one asset" signal left in the pipeline once the
// picture has been varied. The swap fixes that, and this script builds the
// list it picks from.
//
//   node scripts/fetch-voice-roster.mjs            # 500 per gender, default
//   node scripts/fetch-voice-roster.mjs --per=100  # smaller, for a quick refresh
//
// Writes video/data/voice-roster.json. It is DATA, refreshed on a schedule,
// never fetched per render: the list barely moves and a per-render call would
// add latency and API traffic for nothing.
//
// THE ONE THING THAT MUST NOT BREAK is gender. A woman's voice on a man is a
// ruined asset that may go out publicly, so the two pools are built separately,
// every entry is re-checked against the pool it is being filed into, and
// anything that disagrees is dropped rather than corrected. Cheap insurance.
//
// Shared-library voice_ids work DIRECTLY in speech-to-speech: they do not need
// adding to the account and consume no voice slots, so the pool size is limited
// only by what the library holds (verified 2026-08-08: 3,066 English female and
// 6,461 English male).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VIDEO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(VIDEO_DIR, 'data', 'voice-roster.json');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};
const PER_GENDER = Number(arg('per', 500));
const PAGE = 100;

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error('missing ELEVENLABS_API_KEY');
  process.exit(1);
}

const GENDERS = ['female', 'male'];
// Valid sorts are cloned_by_count, trending, usage_character_count_1y.
// most_users_chose and latest both 422, do not "fix" this to either.
const SORT = 'cloned_by_count';

/** The fields worth keeping. The rest of the payload is noise for our purpose. */
function slim(v) {
  return {
    voice_id: v.voice_id,
    name: v.name,
    gender: v.gender,
    accent: v.accent,
    age: v.age,
    use_case: v.use_case,
    descriptive: v.descriptive,
    cloned_by_count: v.cloned_by_count,
  };
}

async function fetchPool(gender) {
  const out = [];
  const seen = new Set();
  let dropped = 0;
  let page = 0;

  // Pagination is `page`, NOT `last_sort_id`. The response carries a
  // last_sort_id field but it comes back null under sort=cloned_by_count, so
  // following it stops dead after the first 100. Verified 2026-08-08.
  while (out.length < PER_GENDER) {
    const u = new URL('https://api.elevenlabs.io/v1/shared-voices');
    u.searchParams.set('gender', gender);
    u.searchParams.set('language', 'en');
    u.searchParams.set('page_size', String(PAGE));
    u.searchParams.set('sort', SORT);
    u.searchParams.set('page', String(page));

    const res = await fetch(u, { headers: { 'xi-api-key': KEY } });
    if (!res.ok) throw new Error(`shared-voices ${gender}: ${res.status} ${await res.text()}`);
    const body = await res.json();
    const voices = body.voices ?? [];
    if (!voices.length) break;

    let fresh = 0;
    for (const v of voices) {
      // Re-check rather than trust the query filter. If the API ever returns a
      // mismatch, dropping it costs one voice out of thousands; keeping it
      // costs a ruined video.
      if (v.gender !== gender) {
        dropped++;
        continue;
      }
      if (!v.voice_id || seen.has(v.voice_id)) continue;
      seen.add(v.voice_id);
      out.push(slim(v));
      fresh++;
      if (out.length >= PER_GENDER) break;
    }

    // A page that adds nothing new means we are chasing our tail, which is how
    // a paging bug turns into an infinite loop rather than a short roster.
    if (fresh === 0) break;
    if (!body.has_more) break;
    page++;
  }

  console.log(
    `${gender}: ${out.length} voices` + (dropped ? `, ${dropped} dropped on gender mismatch` : ''),
  );
  return out;
}

const pools = {};
for (const g of GENDERS) pools[g] = await fetchPool(g);

for (const g of GENDERS) {
  if (!pools[g].length) {
    console.error(`refusing to write a roster with an empty ${g} pool`);
    process.exit(1);
  }
  const wrong = pools[g].filter((v) => v.gender !== g);
  if (wrong.length) {
    console.error(`refusing to write: ${wrong.length} ${g} entries have the wrong gender`);
    process.exit(1);
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    { fetched_at: new Date().toISOString(), sort: SORT, language: 'en', pools },
    null,
    2,
  ) + '\n',
);
console.log(`wrote ${OUT}`);
console.log(`  female ${pools.female.length}, male ${pools.male.length}`);
