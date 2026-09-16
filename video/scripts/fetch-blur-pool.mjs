// fetch-blur-pool.mjs: the stock half of the blurred-opening clip pool.
//
// Every post opens on 5 seconds of heavily blurred, desaturated footage with
// three beats of text over it. Hugo's own 11 masters are the primary source
// because nobody else on Instagram has them, but 357 seconds of footage is 303
// distinct windows, and at 3,700 posts a day the picture-and-look pairs start
// repeating in under two months. This tops the pool up.
//
// The clips are never seen unblurred, so what they are OF barely matters. What
// matters is that there are a lot of them, that they are portrait, and that
// they move a little. Queries are chosen for volume, not for meaning.
//
// Pexels licence: free, commercial, no attribution, modification allowed. A
// blurred background is well inside it. The key lives in PEXELS_API_KEY and is
// sent as a bare Authorization header, no "Bearer" prefix, which is unusual and
// is the first thing to check if this ever starts 401ing.
//
// Run:  node scripts/fetch-blur-pool.mjs [--target=500]
// Resumable: a clip whose file already exists is skipped, so a Ctrl-C costs
// only the file in flight.

import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VIDEO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POOL = join(VIDEO_DIR, 'blur-pool');
mkdirSync(POOL, { recursive: true });

const KEY = process.env.PEXELS_API_KEY;
if (!KEY) {
  console.error('PEXELS_API_KEY missing');
  process.exit(1);
}

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};
const TARGET = Number(arg('target', 500));

// Spread across many subjects so the pool does not become 500 shots of one
// thing, which would defeat the point at the exact moment it got large.
const QUERIES = [
  'city street', 'coffee shop', 'walking people', 'neon night', 'office desk',
  'gym workout', 'beach waves', 'forest walk', 'rain window', 'car driving',
  'kitchen cooking', 'shopping mall', 'subway train', 'sunset sky', 'crowd',
  'laptop typing', 'phone screen', 'skyline', 'traffic', 'market',
  'dancing', 'running', 'bicycle', 'plants', 'abstract lights',
  'water surface', 'smoke', 'fabric', 'paint', 'sparks',
  'clouds timelapse', 'street food', 'bookshelf', 'stairs', 'window light',
  'bridge', 'airport', 'hotel room', 'swimming pool', 'countryside',
];

/**
 * Portrait, long enough to cut a 5 second window out, and DELIBERATELY the
 * small rendition.
 *
 * The first version of this asked for 1080-wide files and pulled 14MB per clip,
 * which is 7GB for a pool of 500. These are shown at gaussian blur sigma 40
 * with the colour drained out: a 640 wide source and a 1080 wide source are the
 * same picture once that is applied, because the blur throws away far more
 * detail than the downscale does. Small is not a compromise here, it is free.
 */
function pickFile(video) {
  if (video.duration < 7) return null;
  const files = (video.video_files ?? [])
    .filter((f) => f.width && f.height && f.height > f.width)
    .filter((f) => f.width >= 480)
    .sort((a, b) => a.width - b.width);
  return files[0] ?? null;
}

async function search(query, page) {
  const url =
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}` +
    `&per_page=80&page=${page}&orientation=portrait&size=medium`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { Authorization: KEY } });
    if (res.ok) return res.json();
    if (res.status === 429) {
      // Pexels allows 200 requests an hour. Backing off is cheaper than losing
      // the run; the whole thing is resumable anyway.
      console.log(`  rate limited, waiting 60s`);
      await new Promise((r) => setTimeout(r, 60_000));
      continue;
    }
    console.log(`  search ${res.status} on "${query}" p${page}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  return null;
}

async function download(url, path) {
  const res = await fetch(url);
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  // A truncated download is worse than a missing one: it lands in the pool and
  // every opening built from it is broken. Write only what arrived whole.
  if (buf.length < 200_000) return false;
  writeFileSync(path, buf);
  return true;
}

const have = () => readdirSync(POOL).filter((f) => f.endsWith('.mp4')).length;
console.log(`pool has ${have()} clips, target ${TARGET}`);

let page = 1;
outer: while (have() < TARGET) {
  for (const q of QUERIES) {
    if (have() >= TARGET) break outer;
    const data = await search(q, page);
    if (!data?.videos?.length) continue;
    let added = 0;
    for (const v of data.videos) {
      if (have() >= TARGET) break;
      const f = pickFile(v);
      if (!f) continue;
      const path = join(POOL, `px${v.id}.mp4`);
      if (existsSync(path) && statSync(path).size > 200_000) continue;
      if (await download(f.link, path)) added++;
    }
    console.log(`${q} p${page}: +${added}  (pool ${have()})`);
  }
  page++;
  if (page > 6) break; // 40 queries x 6 pages is far more than 500 usable clips
}

console.log(`done: ${have()} clips in ${POOL}`);
