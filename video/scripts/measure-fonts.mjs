// measure-fonts.mjs: read the real cap height and advance widths out of each face.
//
//   cd /Users/hugo/Whats/Poppy/video && node scripts/measure-fonts.mjs
//
// Writes src/variants/font-metrics.json, which fonts.test.ts compares against
// the values declared in fonts.ts. If a declared number is wrong, line breaking
// is estimated wrong, and a hook the test believed fits in three lines overflows
// its box in a finished video. So the numbers are measured, not typed.
//
// WHY IT DOWNLOADS TTF WHEN WE SHIP WOFF2, AND WHY FROM GITHUB.
//
// opentype.js reads ttf, otf and woff, but not woff2: that needs a Brotli-based
// table decompressor it does not bundle, and no such package is installed here.
// woff2 is a lossless repacking of the same tables, so measuring the ttf gives
// identical numbers.
//
// The obvious source, asking the Google Fonts CSS API with an old user-agent,
// does NOT work. It answers from a /l/font endpoint with no file extension and
// serves a format whose magic bytes are neither sfnt nor woff2, which
// opentype.js would parse as garbage. So the fonts come from the canonical OFL
// source instead, github.com/google/fonts, which serves plain ttf.
//
// STATIC FILES ARE PREFERRED OVER VARIABLE ONES, and that matters. A variable
// font's default instance is usually Regular, so measuring one reports
// Regular's advance widths for a face we render at ExtraBold. ExtraBold is
// meaningfully wider, so the estimates would come out optimistic and hooks would
// overflow. Where no static file exists the variable one is measured and the
// output records `variable: true` against it, so the inaccuracy is visible
// rather than assumed away.

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const VIDEO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(VIDEO_DIR, 'src', 'variants', 'font-metrics.json');

const GH = 'https://raw.githubusercontent.com/google/fonts/main';
const API = 'https://api.github.com/repos/google/fonts/contents';
const HEADERS = { 'User-Agent': 'elsie-variant-factory' };

const WANTED = [
  { key: 'inter-tight', slug: 'intertight', stem: 'InterTight', weight: 'ExtraBold' },
  { key: 'archivo', slug: 'archivo', stem: 'Archivo', weight: 'ExtraBold' },
  { key: 'anton', slug: 'anton', stem: 'Anton', weight: 'Regular' },
  { key: 'bricolage', slug: 'bricolagegrotesque', stem: 'BricolageGrotesque', weight: 'ExtraBold' },
  { key: 'space-grotesk', slug: 'spacegrotesk', stem: 'SpaceGrotesk', weight: 'Bold' },
  { key: 'sora', slug: 'sora', stem: 'Sora', weight: 'ExtraBold' },
  { key: 'manrope', slug: 'manrope', stem: 'Manrope', weight: 'ExtraBold' },
  { key: 'playfair', slug: 'playfairdisplay', stem: 'PlayfairDisplay', weight: 'ExtraBold' },
  { key: 'instrument-serif', slug: 'instrumentserif', stem: 'InstrumentSerif', weight: 'Italic' },
  { key: 'schibsted', slug: 'schibstedgrotesk', stem: 'SchibstedGrotesk', weight: 'ExtraBold' },
];

// The characters the hook bank and the end card actually use. Measuring the mean
// advance over these rather than over the whole charset is the point: a font's
// average across every glyph it ships says nothing about how wide OUR words are.
const CORPUS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,'";

async function listTtfs(slug) {
  const out = [];
  for (const sub of ['', '/static']) {
    const res = await fetch(`${API}/ofl/${slug}${sub}`, {
      headers: { ...HEADERS, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) continue;
    const json = await res.json();
    if (!Array.isArray(json)) continue;
    for (const f of json) if (f.name.endsWith('.ttf')) out.push(`ofl/${slug}${sub}/${f.name}`);
  }
  if (out.length === 0) throw new Error(`no ttf found under ofl/${slug}`);
  return out;
}

function pick(paths, w) {
  const exact = paths.find((p) => p.endsWith(`/${w.stem}-${w.weight}.ttf`));
  if (exact) return { path: exact, variable: false };
  const anyStatic = paths.find((p) => p.includes('/static/'));
  if (anyStatic) return { path: anyStatic, variable: false };
  return { path: paths[0], variable: true };
}

const metrics = {};
for (const w of WANTED) {
  process.stdout.write(`${w.key} ... `);
  const chosen = pick(await listTtfs(w.slug), w);
  const res = await fetch(`${GH}/${chosen.path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} downloading ${chosen.path}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const magic = buf.subarray(0, 4).toString('binary');
  if (!['\x00\x01\x00\x00', 'true', 'OTTO'].includes(magic)) {
    throw new Error(`${w.key}: not an sfnt font, magic ${JSON.stringify(magic)}`);
  }

  const f = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  const upm = f.unitsPerEm;

  // Cap height from OS/2 where the font declares it, otherwise the actual height
  // of a capital H, which is what cap height means anyway.
  let capHeight = f.tables.os2?.sCapHeight;
  if (!capHeight) capHeight = f.charToGlyph('H')?.getBoundingBox?.()?.y2 ?? upm * 0.7;

  let total = 0;
  let n = 0;
  for (const ch of CORPUS) {
    const g = f.charToGlyph(ch);
    if (g && typeof g.advanceWidth === 'number') {
      total += g.advanceWidth;
      n += 1;
    }
  }

  metrics[w.key] = {
    capHeightEm: Number((capHeight / upm).toFixed(4)),
    avgAdvanceEm: Number((total / n / upm).toFixed(4)),
    source: chosen.path,
    variable: chosen.variable,
  };
  console.log(
    `cap ${metrics[w.key].capHeightEm} advance ${metrics[w.key].avgAdvanceEm}` +
      `${chosen.variable ? '  (VARIABLE, advance is the default instance)' : ''}`,
  );
}

writeFileSync(OUT, `${JSON.stringify(metrics, null, 2)}\n`);
console.log(`\nwrote ${OUT}`);
