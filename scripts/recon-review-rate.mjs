// Reconnaissance: estimate the true (Google-verified) ≤65-review rate across the
// named-owner plumber rows, so we know if 1000 sub-65 leads are achievable and
// roughly the enrichment cost. Samples evenly across the whole CSV. Cheap.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Papa from 'papaparse';

const KEY = process.env.GOOGLE_PLACES_KEY;
const SAMPLE = Number(process.argv[2] || 60);
const MAX = 65;
const REFERER = 'https://poppy-henna.vercel.app/';
const clean = (v) => String(v ?? '').trim();
const pick = (row, h) => { for (const k of Object.keys(row)) if (k.replace(/^﻿/, '').toLowerCase().trim() === h) return row[k]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const raw = readFileSync(join(homedir(), 'Desktop', 'UK_Plumbers_Leads_2026-07-21.csv'), 'utf8').replace(/^﻿/, '');
const rows = Papa.parse(raw, { header: true, skipEmptyLines: true }).data.filter((r) => clean(pick(r, 'owner name 1 (man)')));
console.log(`${rows.length} named-owner rows. Sampling ${SAMPLE} evenly…`);

const step = Math.floor(rows.length / SAMPLE);
let checked = 0, le65 = 0, gt65 = 0, notFound = 0;
for (let i = 0; i < rows.length && checked < SAMPLE; i += step) {
  const r = rows[i];
  const q = encodeURIComponent([clean(pick(r, 'company name')), clean(pick(r, 'town/city'))].filter(Boolean).join(' '));
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${q}&inputtype=textquery&fields=user_ratings_total&key=${KEY}`;
  try {
    const j = await (await fetch(url, { headers: { Referer: REFERER } })).json();
    const c = j.candidates?.[0];
    if (!c || typeof c.user_ratings_total !== 'number') notFound++;
    else if (c.user_ratings_total <= MAX) le65++;
    else gt65++;
  } catch { notFound++; }
  checked++;
  await sleep(110);
}
const rate = le65 / (le65 + gt65 || 1);
console.log(`Checked ${checked}: ≤65=${le65}, >65=${gt65}, notFound=${notFound}`);
console.log(`True ≤65 rate (of found): ${(rate * 100).toFixed(0)}%`);
console.log(`Projected ≤65 leads in the full ${rows.length}: ~${Math.round(rows.length * rate * ((le65 + gt65) / checked))}`);
console.log(`To collect 1000 ≤65 → scan ~${Math.round(1000 / (rate * ((le65 + gt65) / checked)))} rows (~that many Google calls).`);
