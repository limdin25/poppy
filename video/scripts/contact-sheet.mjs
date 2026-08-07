// contact-sheet.mjs: render one frame from many variants into a single grid.
//
//   cd /Users/hugo/Whats/Poppy/video && node scripts/contact-sheet.mjs
//   node scripts/contact-sheet.mjs --count=6 --frame=200 --cta
//
// NOTHING AUTOMATED SUBSTITUTES FOR THIS. The test suite proves no frame can be
// unreadable, that families never collide, that hooks fit. It cannot tell you
// that number 17 is ugly. Somebody has to look at two dozen at once, and this is
// what they look at.
//
// Uses one bundle and one browser for the whole sheet, which is the same pooling
// the batch renderer uses, so this doubles as a smoke test of that path.

import { bundle } from '@remotion/bundler';
import { ensureBrowser, openBrowser, renderStill, selectComposition } from '@remotion/renderer';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const VIDEO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(VIDEO_DIR, 'out', 'contact');
const SOURCES = JSON.parse(readFileSync(join(VIDEO_DIR, 'src', 'variants', 'sources.json'), 'utf8'));

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};
const COUNT = Number(arg('count', 6));
// Frame 40 is not arbitrary. A contact sheet is only honest if every tile shows
// a hook at FULL opacity, and an arbitrary frame can land mid-transition: at
// frame 200 one variant showed grey text and read as a contrast failure when its
// measured contrast was in fact the best in the batch.
//
// The first hook fades in by frame hookInFrame + 6 (at most 16) and the earliest
// any hook can start fading out is hookInFrame + hookHoldFrames - 10, which with
// the minimum hold of 60 is frame 54. So 40 sits inside the first hook's hold
// window for every seed the recipe can produce.
const FRAME = Number(arg('frame', 40));
const CTA = process.argv.includes('--cta');
const COLS = Number(arg('cols', 6));
const THUMB_W = 360;

mkdirSync(OUT_DIR, { recursive: true });

console.log('bundling ...');
const serveUrl = await bundle({ entryPoint: join(VIDEO_DIR, 'src', 'index.ts') });
await ensureBrowser();
const browser = await openBrowser('chrome', { chromeMode: 'headless-shell' });

const tiles = [];
try {
  for (const src of SOURCES) {
    for (let i = 0; i < COUNT; i++) {
      const inputProps = {
        sourceId: src.id,
        variantIndex: i,
        seed: 0,
        recipeVersion: 1,
      };
      const composition = await selectComposition({
        serveUrl,
        id: 'VariantVideo',
        inputProps,
        puppeteerInstance: browser,
      });
      // For the end card sheet, pick a frame inside it rather than a fixed
      // number: every source has a different body length.
      const frame = CTA ? composition.durationInFrames - 180 : FRAME;
      const out = join(OUT_DIR, `${src.id}-${String(i).padStart(3, '0')}.png`);
      await renderStill({
        composition,
        serveUrl,
        output: out,
        frame,
        inputProps,
        puppeteerInstance: browser,
        imageFormat: 'png',
      });
      tiles.push({ file: out, label: `${src.id} #${i}` });
      process.stdout.write(`${src.id}#${i} `);
    }
  }
} finally {
  await browser.close({ silent: true });
}
console.log('');

// Compose the grid. sharp is already a repo dependency, used by the reviews
// image pipeline, so this adds nothing to install.
const rows = Math.ceil(tiles.length / COLS);
const thumbH = Math.round((THUMB_W * 1920) / 1080);
const sheet = sharp({
  create: {
    width: COLS * THUMB_W,
    height: rows * thumbH,
    channels: 3,
    background: { r: 18, g: 18, b: 20 },
  },
});

const composites = [];
for (let i = 0; i < tiles.length; i++) {
  composites.push({
    input: await sharp(tiles[i].file).resize(THUMB_W, thumbH).toBuffer(),
    left: (i % COLS) * THUMB_W,
    top: Math.floor(i / COLS) * thumbH,
  });
}

const target = join(VIDEO_DIR, 'out', CTA ? 'contact-sheet-cta.png' : 'contact-sheet.png');
await sheet.composite(composites).png().toFile(target);
rmSync(OUT_DIR, { recursive: true, force: true });

console.log(`\n${tiles.length} variants -> ${target}`);
console.log(tiles.map((t) => t.label).join('  '));
