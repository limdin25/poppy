// fetch-fonts.mjs: download the woff2 files the variation factory renders with.
//
//   cd /Users/hugo/Whats/Poppy/video && node scripts/fetch-fonts.mjs
//
// Run once per machine. The files land in video/public/fonts/ (gitignored) and
// a lock file of sha256 hashes is written to src/variants/fonts.lock.json, which
// IS committed. fonts.test.ts compares the two, so a font that silently changed
// underneath us fails the build rather than quietly reflowing every hook.
//
// WHY DOWNLOAD AT BUILD TIME RATHER THAN FETCH AT RENDER TIME. @remotion/google-fonts
// pulls binaries from fonts.gstatic.com on every render. That gives every worker
// a network dependency on every render, and a failed fetch produces a video in a
// fallback typeface, silently. Google also serves different subsets per
// user-agent, so two workers on different Chromium builds get different files,
// glyph metrics differ, and the same seed wraps a hook to two lines on one
// machine and three on another. Downloading once, pinning the hash, and loading
// from disk removes all of that.
//
// The URLs below are resolved from the Google Fonts CSS API with a modern
// user-agent, which is what makes it return woff2 rather than ttf.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VIDEO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(VIDEO_DIR, 'public', 'fonts');
const LOCK = join(VIDEO_DIR, 'src', 'variants', 'fonts.lock.json');

// A modern Chrome UA. With anything older the CSS API serves ttf, and the files
// come out three times the size for identical glyphs.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** family, weight, style, and the filename fonts.ts expects. */
const WANTED = [
  { family: 'Inter Tight', weight: 800, italic: false, file: 'InterTight-ExtraBold.woff2' },
  { family: 'Archivo', weight: 800, italic: false, file: 'Archivo-ExtraBold.woff2' },
  { family: 'Anton', weight: 400, italic: false, file: 'Anton-Regular.woff2' },
  { family: 'Bricolage Grotesque', weight: 800, italic: false, file: 'BricolageGrotesque-ExtraBold.woff2' },
  { family: 'Space Grotesk', weight: 700, italic: false, file: 'SpaceGrotesk-Bold.woff2' },
  { family: 'Sora', weight: 800, italic: false, file: 'Sora-ExtraBold.woff2' },
  { family: 'Manrope', weight: 800, italic: false, file: 'Manrope-ExtraBold.woff2' },
  { family: 'Playfair Display', weight: 800, italic: false, file: 'PlayfairDisplay-ExtraBold.woff2' },
  { family: 'Instrument Serif', weight: 400, italic: true, file: 'InstrumentSerif-Italic.woff2' },
  { family: 'Schibsted Grotesk', weight: 800, italic: false, file: 'SchibstedGrotesk-ExtraBold.woff2' },
];

function cssUrl({ family, weight, italic }) {
  const name = family.replace(/ /g, '+');
  const axis = italic ? `ital,wght@1,${weight}` : `wght@${weight}`;
  return `https://fonts.googleapis.com/css2?family=${name}:${axis}&display=swap`;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

mkdirSync(OUT_DIR, { recursive: true });

const lock = {};
for (const w of WANTED) {
  const target = join(OUT_DIR, w.file);
  if (existsSync(target)) {
    lock[w.file] = createHash('sha256').update(readFileSync(target)).digest('hex');
    console.log(`have ${w.file}`);
    continue;
  }
  process.stdout.write(`fetching ${w.family} ${w.weight}${w.italic ? ' italic' : ''} ... `);
  const css = await fetchText(cssUrl(w));
  // Take the LAST src url in the sheet: the API lists subsets in order and the
  // latin block comes last, which is the one that has the characters we use.
  const urls = [...css.matchAll(/url\((https:\/\/[^)]+\.woff2)\)/g)].map((m) => m[1]);
  if (urls.length === 0) throw new Error(`no woff2 in the CSS for ${w.family}`);
  const res = await fetch(urls[urls.length - 1], { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} downloading ${w.family}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(target, buf);
  lock[w.file] = createHash('sha256').update(buf).digest('hex');
  console.log(`${(buf.length / 1024).toFixed(1)}kb`);
}

writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
console.log(`\nwrote ${LOCK}`);
