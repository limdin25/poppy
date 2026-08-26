// assemble-worker.mjs: the factory floor.
//
// Runs forever. Every tick it does two jobs:
//
//   BUILD    scheduled posts going out soon that have no file yet get one:
//            a fresh blurred opening, the account's body, one of 640 end cards.
//   PURGE    posts that have already gone out have their file deleted.
//
// The purge is not housekeeping. At fifty a day across 74 accounts this makes
// 3,700 files a day at ~15MB, which is 55GB a day. Without the purge the disk
// fills inside a week and every account fails at once.
//
// DEGRADES, NEVER STOPS. scheduled_posts.media_url already holds the plain body
// render when this worker gets there. If a post cannot be assembled, that row is
// left exactly as it was and the publisher posts the plain version. A pipeline
// that quietly does something slightly worse beats one that does nothing.
//
// Run:  node scripts/assemble-worker.mjs
// Once: node scripts/assemble-worker.mjs --once --limit=3

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemblePost, probeDuration } from './lib/assemble.mjs';

const VIDEO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POOL = join(VIDEO_DIR, 'blur-pool');
const CARDS = join(VIDEO_DIR, 'assets', 'card-bank');
const BODIES = join(VIDEO_DIR, 'out', 'bodies');
const BUILT = join(VIDEO_DIR, 'out', 'built');
const PLATES = join(VIDEO_DIR, 'out', 'plates');
for (const d of [BODIES, BUILT, PLATES]) mkdirSync(d, { recursive: true });

// Env, same two-hosts arrangement as the render worker: .env.local on the Mac,
// systemd EnvironmentFile on the VPS. Real env always wins.
for (const f of [join(VIDEO_DIR, '..', 'heypubli', '.env.local'), join(VIDEO_DIR, '..', '.env')]) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_0-9]+)="?([^"]*)"?$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* absent is normal on the VPS */ }
}
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const BUCKET = 'creator-videos';
const REST = `${SUPABASE_URL}/rest/v1`;

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=')[1] : d;
};
const ONCE = process.argv.includes('--once');
const LIMIT = Number(arg('limit', 25));
/** How far ahead to build. Far enough that a slow tick never misses a slot,
 *  close enough that a day's worth of files is never on disk at once. */
const LOOKAHEAD_MIN = Number(arg('lookahead', 180));
const TICK_MS = 30_000;
/** A file is safe to delete this long after it published. Outstand fetches the
 *  URL when it posts; deleting the instant we see "published" has raced. */
const PURGE_AFTER_MIN = 45;

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

async function db(path, init = {}) {
  const res = await fetch(`${REST}/${path}`, {
    ...init,
    headers: { ...H, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  // PostgREST answers a plain insert with 201 and an EMPTY body unless asked for
  // a representation. Calling .json() on that throws "Unexpected end of JSON
  // input", which surfaced as every post failing for no stated reason.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---- ingredients -------------------------------------------------------------

/** The pool, indexed once at startup. Every clip contributes a window per
 *  second, so 511 clips is tens of thousands of distinct openings. */
function indexPool() {
  const clips = readdirSync(POOL).filter((f) => f.endsWith('.mp4'));
  const windows = [];
  for (const f of clips) {
    let d;
    try { d = probeDuration(join(POOL, f)); } catch { continue; }
    if (!Number.isFinite(d) || d < 6) continue;
    for (let t = 0; t + 5.2 <= d - 0.4; t += 1) windows.push({ clip: f, at: Number(t.toFixed(2)) });
  }
  return windows;
}

const CARD_FILES = readdirSync(CARDS).filter((f) => f.endsWith('.png'));
const CARDS_BY_CTA = {
  link: CARD_FILES.filter((f) => f.startsWith('link_')).sort(),
  nolink: CARD_FILES.filter((f) => f.startsWith('nolink_')).sort(),
};

/** Deterministic 32-bit mix, so the same post always builds the same file and a
 *  bad one can be reproduced rather than guessed at. */
function mix(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Download once, keep. A body is reused for every post that plays that master,
 *  so this is the difference between one download and fifty. */
async function fetchBody(url, cacheName) {
  const path = join(BODIES, cacheName);
  if (existsSync(path) && statSync(path).size > 500_000) return path;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`body fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500_000) throw new Error(`body too small: ${buf.length}`);
  writeFileSync(path, buf);
  return path;
}

async function upload(localPath, remotePath) {
  const body = readFileSync(localPath);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${remotePath}`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'video/mp4', 'x-upsert': 'true' },
      body,
    });
    if (res.ok) return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${remotePath}`;
    log(`  upload attempt ${attempt}: ${res.status}`);
    await new Promise((r) => setTimeout(r, 4000 * attempt));
  }
  throw new Error('upload failed after 3 attempts');
}

/** Draw the account's next hook and claim it in the same breath. The claim is an
 *  insert into a table with a (profile, hook) primary key, so two workers racing
 *  for the same hook cannot both win: the loser gets a duplicate-key error and
 *  moves to the next one. */
async function claimHook(profileId) {
  const used = await db(`hook_uses?select=hook_id&profile_id=eq.${profileId}&limit=100000`);
  const usedIds = new Set(used.map((u) => u.hook_id));
  const bank = await db('hook_lines?select=id,beat1,beat2,beat3&retired_at=is.null&order=created_at&limit=2000');
  if (!bank.length) return null;

  // EVERY ACCOUNT STARTS SOMEWHERE ELSE IN THE BANK.
  //
  // Walking it from the top was right for one account and wrong for a fleet:
  // 74 accounts all walked from the top, so they all drew hook 1, then hook 2,
  // and six posts built in the same minute carried four copies of one line.
  // That is precisely the clustering the whole system exists to avoid, and it
  // is worse than a repeated video because the words are what a person reads.
  //
  // The offset is derived from the account, so it is stable: an account keeps
  // its own place in the bank across restarts, and still sees every line once
  // before it sees any line twice.
  const offset = mix(profileId) % bank.length;
  const ordered = [...bank.slice(offset), ...bank.slice(0, offset)];
  for (const h of ordered) {
    if (usedIds.has(h.id)) continue;
    try {
      await db('hook_uses', {
        method: 'POST',
        body: JSON.stringify({ profile_id: profileId, hook_id: h.id }),
      });
      return h;
    } catch (e) {
      if (String(e.message).includes('duplicate')) continue;
      throw e;
    }
  }
  return null; // bank exhausted for this account: the writer needs to run
}

/** The three transparent text plates, drawn by the look engine. It prints its
 *  own plan, and the timings come back out of it so the render and the plan can
 *  never disagree. */
function drawPlates(seed, hook, outPrefix) {
  const texts = JSON.stringify([hook.beat1, hook.beat2, hook.beat3].map((b) => b.split('\n')));
  const outs = [1, 2, 3].map((i) => `${outPrefix}-${i}.png`);
  const stdout = execFileSync(
    'python3',
    [join(VIDEO_DIR, 'scripts', 'lib', 'hook_plates.py'), seed, texts, ...outs],
    { encoding: 'utf8' },
  );
  return { plan: JSON.parse(stdout.trim()), plates: outs };
}

// ---- build -------------------------------------------------------------------

async function buildOne(post, pool) {
  const seed = `post:${post.id}`;
  const rnd = mix(seed);

  const render = post.render_url;
  if (!render) throw new Error('no body render for this master and account');

  const hook = await claimHook(post.profile_id);
  if (!hook) throw new Error('hook bank exhausted for this account');

  const cta = post.has_clickable_link ? 'link' : 'nolink';
  const cards = CARDS_BY_CTA[cta];
  const card = cards[rnd % cards.length];
  const win = pool[(rnd >>> 7) % pool.length];
  // 5.5 to 6.5 seconds, so two posts closing on the same card still do not
  // close identically.
  const cardSeconds = Number((5.5 + ((rnd >>> 13) % 100) / 100).toFixed(2));

  const { plan, plates } = drawPlates(seed, hook, join(PLATES, post.id));
  const bodyPath = await fetchBody(render, `${post.master_video_id}-${post.profile_id}.mp4`);
  const out = join(BUILT, `${post.id}.mp4`);

  try {
    assemblePost({
      render: bodyPath,
      clip: join(POOL, win.clip),
      at: win.at,
      plates,
      beats: [plan.beat1, plan.beat2, plan.beat3],
      blur: plan.blur,
      dim: plan.dim,
      card: join(CARDS, card),
      cardSeconds,
      out,
    });
    const url = await upload(out, `built/${post.id}.mp4`);
    await db(`scheduled_posts?id=eq.${post.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        assembled_url: url,
        assembled_at: new Date().toISOString(),
        media_url: url, // the publisher reads this; now it gets the good one
        hook_id: hook.id,
        card_file: card,
        blur_clip: win.clip,
        blur_at: win.at,
      }),
    });
    return { card, clip: win.clip, at: win.at };
  } finally {
    for (const p of plates) rmSync(p, { force: true });
    rmSync(out, { force: true });
  }
}

async function buildTick(pool) {
  const until = new Date(Date.now() + LOOKAHEAD_MIN * 60_000).toISOString();
  const rows = await db(
    'scheduled_posts?select=id,profile_id,master_video_id,scheduled_at' +
      '&assembled_url=is.null&status=eq.pending&master_video_id=not.is.null' +
      `&scheduled_at=lte.${until}&order=scheduled_at&limit=${LIMIT}`,
  );
  if (!rows.length) return 0;

  // Everything these rows need, in two reads rather than two per row.
  const profileIds = [...new Set(rows.map((r) => r.profile_id))];
  const masterIds = [...new Set(rows.map((r) => r.master_video_id))];
  const renders = await db(
    `creator_video_renders?select=master_id,profile_id,video_url,status` +
      `&profile_id=in.(${profileIds.join(',')})&master_id=in.(${masterIds.join(',')})`,
  );
  const renderBy = new Map(
    renders.filter((r) => r.status === 'ready' && r.video_url)
      .map((r) => [`${r.master_id}:${r.profile_id}`, r.video_url]),
  );
  // Whether the account's Skool link is actually clickable decides which of the
  // two endings it gets. The bio sweep already stamps this; nothing here reads
  // Instagram.
  const progress = await db(
    `onboarding_progress?select=profile_id,completed_at&step=eq.bio&profile_id=in.(${profileIds.join(',')})`,
  );
  const linked = new Set(progress.filter((p) => p.completed_at).map((p) => p.profile_id));

  let built = 0;
  for (const r of rows) {
    const post = {
      ...r,
      render_url: renderBy.get(`${r.master_video_id}:${r.profile_id}`) ?? null,
      has_clickable_link: linked.has(r.profile_id),
    };
    try {
      const what = await buildOne(post, pool);
      built++;
      log(`  built ${r.id.slice(0, 8)} card=${what.card} clip=${what.clip}@${what.at}`);
    } catch (e) {
      // Left untouched on purpose: media_url still holds the plain body render,
      // so this post goes out in the old format rather than not going out.
      log(`  SKIP ${r.id.slice(0, 8)}: ${String(e.message).split('\n')[0]}`);
    }
  }
  return built;
}

// ---- purge -------------------------------------------------------------------

async function purgeTick() {
  const before = new Date(Date.now() - PURGE_AFTER_MIN * 60_000).toISOString();
  const rows = await db(
    'scheduled_posts?select=id,assembled_url&status=eq.published' +
      `&assembled_url=not.is.null&assembled_purged_at=is.null&published_at=lte.${before}&limit=200`,
  );
  let gone = 0;
  for (const r of rows) {
    const key = r.assembled_url.split(`/public/${BUCKET}/`)[1];
    if (key) {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
        method: 'DELETE', headers: H,
      });
      // A 404 means it is already gone, which is the state we wanted anyway.
      if (!res.ok && res.status !== 404) { log(`  purge ${res.status} on ${key}`); continue; }
    }
    await db(`scheduled_posts?id=eq.${r.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ assembled_purged_at: new Date().toISOString() }),
    });
    gone++;
  }
  return gone;
}

// ---- loop --------------------------------------------------------------------

log(`indexing the blur pool ...`);
const pool = indexPool();
log(`pool: ${pool.length} windows, cards: ${CARDS_BY_CTA.link.length} link / ${CARDS_BY_CTA.nolink.length} nolink`);
if (!pool.length) { console.error('blur pool is empty'); process.exit(1); }

do {
  try {
    const built = await buildTick(pool);
    const purged = await purgeTick();
    if (built || purged) log(`tick: built ${built}, purged ${purged}`);
  } catch (e) {
    log(`tick failed: ${String(e.message).split('\n')[0]}`);
  }
  if (!ONCE) await new Promise((r) => setTimeout(r, TICK_MS));
} while (!ONCE);
