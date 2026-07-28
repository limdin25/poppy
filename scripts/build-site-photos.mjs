#!/usr/bin/env node
// Builds the demo-site photography into public/site/.
//
// Run by hand when the photo set changes:
//   node scripts/build-site-photos.mjs
//
// WHY THE FILES ARE COMMITTED RATHER THAN FETCHED AT RUNTIME
// The page must stay self-contained: no third-party host, no CDN round trip on
// a lead's phone, no privacy leak to Pexels about who opened the page. So the
// originals are downloaded once, processed, and served from our own origin as
// relative URLs. This script is the reproducible record of which photograph is
// which, which is the only reason it is committed rather than run ad hoc.
//
// LICENCE
// Pexels: free for commercial use, modification allowed, no attribution
// required. We are not reselling the images, we are using them as site
// imagery, which the licence covers.
//
// THE SELECTION RULE IS A TRUTH RULE, NOT A TASTE RULE
// Hands, tools, materials, the job in progress. NEVER a posed model on a studio
// background and never anything that reads as "our team", because it is not
// their team. A wrench on a pipe states the ordinary scope of the trade. A
// smiling model in branded hi-vis states a staff member who does not exist.
// After the sale the owner replaces all of these in the editor.

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

/** Must match --duo-base in render.ts, or the fallback plane will not match. */
const DUOTONE = { r: 0x2f, g: 0x6a, b: 0xa8 };

const OUT_DIR = join(process.cwd(), 'public', 'site');

/** Max bytes per file. A 400KB hero on mobile data is a lost sale. */
const BUDGET = 115_000;

const ROLES = {
  // Portrait-ish: the hero is seen on a phone far more than on a desktop.
  // Sized against the budget below, not against what looks generous.
  hero: { w: 1200, h: 1500 },
  work: { w: 1000, h: 1333 },
  outcome: { w: 1400, h: 933 },
};

// profileKey -> role -> { id, alt }
// alt text describes the PHOTOGRAPH, never the business. "A plumber fixing a
// pipe" would assert this is them.
const SETS = {
  plumbing: {
    hero: { id: 6419128, alt: 'Close-up of hands tightening a pipe fitting under a sink' },
    work: { id: 29226620, alt: 'Gloved hands fitting a radiator valve' },
    outcome: { id: 6920614, alt: 'A finished bathroom with a basin and bath' },
  },
  electrical: {
    hero: { id: 257736, alt: 'A hand working inside a consumer unit full of wiring' },
    work: { id: 32497160, alt: 'An electrician checking a fuse board on a wall' },
  },
  building: {
    hero: { id: 31762405, alt: 'A roofer working on the roof of a red brick building' },
    work: { id: 37704240, alt: 'Two workers on a pitched roof against the sky' },
    outcome: { id: 31763541, alt: 'Rows of terracotta roof tiles being laid' },
  },
  interiors: {
    hero: { id: 8481698, alt: 'A hand holding a paintbrush loaded with white paint' },
    work: { id: 5799047, alt: 'A paint roller and brushes resting on a surface' },
  },
  locksmith: {
    hero: { id: 35287856, alt: 'Hands cutting a key on a key-cutting machine' },
    work: { id: 28119421, alt: 'Close-up of a lock cylinder and its key' },
    outcome: { id: 830899, alt: 'A stainless steel handle and lock on a blue door' },
  },
  'pest-control': {
    hero: { id: 38680283, alt: 'A paper wasp nest built under the eaves of a building' },
    work: { id: 69221, alt: 'A rat inside a wire trap' },
  },
  // Used when the trade has no profile of its own. Deliberately the plainest
  // frame in the set: a wrench on rough timber was the obvious pick and it
  // could not be compressed under the budget at any usable quality, because it
  // is texture edge to edge. A hand against a flat wall costs a third as much
  // and says the same thing.
  neutral: {
    hero: { id: 8481698, alt: 'A hand holding a brush at work against a plain wall' },
  },
};

const src = (id) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1600`;

async function build(profileKey, role, entry) {
  const { w, h } = ROLES[role];
  const res = await fetch(src(entry.id), { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${profileKey}/${role}: pexels ${entry.id} returned ${res.status}`);
  const input = Buffer.from(await res.arrayBuffer());

  const out = join(OUT_DIR, `${profileKey}-${role}.webp`);

  // Step the quality down PER IMAGE rather than globally. A busy photograph (a
  // roof full of tiles) costs far more bytes than a plain one at the same
  // quality, and dropping every image to suit the worst one throws away
  // fidelity on the ones that were already inside the budget.
  let size = Infinity;
  for (const quality of [66, 58, 50, 42]) {
    await sharp(input)
      .resize(w, h, { fit: 'cover', position: 'attention' })
      // Contrast lift FIRST, so the midtones do not go flat once tinted.
      .linear(1.06, -8)
      // Duotone. tint() replaces chroma while preserving luminance, which is
      // what makes six photographs by six photographers, shot under a yellow
      // studio light, a red gel and an overcast sky, read as one commissioned
      // shoot.
      //
      // DO NOT call .greyscale() first. It is the obvious thing to reach for
      // and it silently destroys the effect: greyscale collapses the image to
      // one channel, tint then has no chroma to write, and the files come out
      // black and white with no error. Verified by channel means, 107/107/107
      // greyscaled versus 70/109/154 without.
      .tint(DUOTONE)
      .webp({ quality })
      .toFile(out);
    ({ size } = await stat(out));
    if (size <= BUDGET) return { file: `${profileKey}-${role}.webp`, size, quality };
  }

  throw new Error(
    `${profileKey}-${role}.webp is ${Math.round(size / 1024)}KB even at quality 42, over the ` +
      `${Math.round(BUDGET / 1024)}KB budget. Choose a less busy photograph rather than ship it.`,
  );
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = {};
  let total = 0;

  for (const [profileKey, roles] of Object.entries(SETS)) {
    manifest[profileKey] = {};
    for (const [role, entry] of Object.entries(roles)) {
      const { file, size, quality } = await build(profileKey, role, entry);
      manifest[profileKey][role] = { file, alt: entry.alt, pexels: entry.id };
      total += size;
      console.log(`${file.padEnd(28)} ${String(Math.round(size / 1024)).padStart(4)}KB  q${quality}`);
    }
  }

  await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n${Object.keys(SETS).length} trades, ${Math.round(total / 1024)}KB total.`);
  console.log('Alt text and paths live in src/core/site-demo/photos.ts, keep them in step.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
