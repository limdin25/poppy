// seed-coach-facts.mjs — feed the LIVE AI coach everything it needs to answer
// a plumber correctly, so it stops improvising ("random answers").
//
// The problem it fixes (Hugo 2026-07-22): the ~50 approved objection rebuttals
// live in src/features/crm/data/salesObjections.ts, but that file only powers
// the *Objections tab*. The live AI coach reads its knowledge ONLY from the
// wk_coach_facts table. So any objection not in the handful of product facts
// there got an off-script, invented answer. This script syncs the full
// objections + FAQ (verbatim, from the one-call script) INTO wk_coach_facts,
// plus a clean set of product facts ("what we're selling"). The whole table is
// injected into every coach prompt, so the coach now has the approved answer to
// hand for everything.
//
// Idempotent: deletes the keys it manages, then re-inserts. Re-run any time
// salesObjections.ts changes. Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Usage:  node scripts/seed-coach-facts.mjs           (seed)
//         node scripts/seed-coach-facts.mjs --list     (print the KB, no writes)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://loggyxryrhqsbtqpteog.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LIST_ONLY = process.argv.includes('--list');

// ── Core PRODUCT facts — WHAT WE SELL (the coach quotes only from these) ──
const PRODUCT = [
  ['what_we_sell', 'What we sell', `A done-for-you Google Reviews service for local trades (brand: HeyElsie). We get a plumber more genuine 5-star Google reviews from their real past and future customers, on autopilot — which lifts their Google Maps ranking so more people find them and call them first.`, ['what is this', 'what are you selling', 'what do you do', 'what is it', 'what are you offering']],
  ['how_it_works', 'How it works', `They send us their past-customer list (name + mobile). We text and email each one a personalised review request (with an image showing their name), chase the ones who forget, reply to every review that comes in, and post the best ones to their socials. Every new customer is added automatically from then on.`, ['how does it work', 'how does this work', 'what happens', 'how do you do it', 'walk me through']],
  ['whats_included', "What's included", `Every month: automated review-request texts + emails to every customer, personalised images (30% higher reply rate), auto-chasing the ones who forget, replies to every Google review, the best reviews posted to social, and a first wave that reactivates ALL their past customers.`, ['what do i get', "what's included", 'what does it do', 'what am i paying for', 'everything included']],
  ['why_reviews', 'Why reviews matter', `Reviews are about 80% of how Google decides who ranks locally. 33% of clicks go to the #1 map result, 84% to the top three, and almost none to page two. More reviews = higher rank = more calls. When someone searches for a plumber they ring the one with the most reviews first, before they scroll.`, ['why reviews', "reviews don't matter", 'do reviews matter', 'why does it matter', 'ranking', 'how does google rank']],
  // The agent NEVER reads the monthly tiers out (motion changed 2026-07-26 —
  // the video does the pricing). These two facts used to restore the retired
  // tier-quoting copy every time this script was re-run, silently reverting
  // scripts/seed-audit-call-motion.sql. Keep them tier-free.
  ['pound_entry', 'Price', `It starts at a pound — that covers their first 10 days. The monthly price comes after, and the VIDEO shows the options; do NOT read the tiers out on the phone. If pushed: "it starts at a pound, the video walks you through the rest."`, ['how much', 'cost', 'price', 'pricing', 'per month', 'a month', 'monthly', "what's it cost", 'how much is it', 'how much again']],
  ['free_trial', 'First 10 days', `£1 starts their first 10 days — a real charge, not a trick, and nothing else comes off until day 10. No contract, cancel any time before then.`, ['free trial', 'trial', 'free', 'how long free', 'charged', 'when do i pay', 'is it free']],
  ['no_contract', 'No contract', `No contract at all, cancel any time with one message — no notice, no penalty.`, ['contract', 'tied in', 'commitment', 'cancel', 'notice period', 'locked in']],
  ['price_rise', 'Price going up / discounts', `Honest urgency + price-lock: this is the LOWEST the price will be. We're taking a few more plumbers on at this rate and then it goes up, and whatever they start on they keep even when later joiners pay more. Only ever say this because the price genuinely rises — NEVER a fake "last spot / closing this week" deadline (illegal in the UK).`, ['discount', 'deal', 'cheaper', 'any offers', 'can you do a deal', 'price going up', 'best price', 'reduce the price']],
  ['what_we_need', 'What we need from them', `Just their past-customer list — names + mobile numbers (email too if they have it). No card details, nothing sensitive. If they use Jobber/QuickBooks/etc. we pull it from there; otherwise 40–50 recent customers is plenty. We text a 2-minute form after the call.`, ['what do you need', 'customer list', 'my customers', 'what do i give you', 'data', 'send you']],
  ['why_a_pound', 'Why £1', `The £1 starts their first 10 days and proves the card works. It is a real charge, not a trick, and the monthly price only begins after the 10 days. It exists so nobody has to make a big decision on a cold call.`, ['why a pound', 'whats the catch', "what's the catch", 'only a pound', 'one pound']],
  ['already_have_their_number', 'Never ask for their number', `We DIALLED them, so we already have the mobile — never ask "is this the best number for a text?". It sounds like we bought a list. Only take a number if THEY volunteer a different one.`, ['best number', 'what number', 'which number', 'send it to', 'text it to']],
  ['google_access', 'Google access / ownership', `We ask for management access to their Google Business Profile so we can post, reply to reviews and update the listing. We can NOT delete it or take ownership, and they can remove us in 30 seconds any time. They keep full ownership.`, ['google access', 'access to my google', 'management access', 'do i still own', 'ownership', 'take over my google']],
  ['personalised_image', 'Personalised image (30% uplift)', `The review request includes a personalised image with the customer's name on it. Tested across 100,000 messages it got a 30% higher reply rate than a plain link — people trust it, they don't think it's spam.`, ['image', 'personalised', 'reply rate', 'how do you get them to leave', 'get reviews', 'how do people reply']],
  ['timing_results', 'How fast results come', `Reviews start landing within a few days; the Google ranking climbs over the following weeks. We never promise the number-one spot or guaranteed results.`, ['how long', 'how fast', 'when will i see', 'how soon', 'results', 'when do reviews come']],
  ['reviews_are_real', 'Reviews are genuine (not fake)', `100% genuine reviews from their actual customers — never fake or bought. We just make it effortless for a real customer to leave one.`, ['fake', 'bought reviews', 'are these real', 'genuine', 'is it legal', 'fake reviews']],
  ['bad_reviews', 'Bad reviews / compliance', `We never hide, filter or block bad reviews (illegal in the UK) and don't need to. Happy customers massively outnumber unhappy ones, so more reviews drown out the odd low one — and the moment anyone's unhappy the owner gets a heads-up to put it right before it festers.`, ['bad reviews', 'negative review', 'hide reviews', 'block reviews', "won't this bring bad", 'delete bad review']],
  ['not_google', 'We are NOT Google', `Completely independent — we do NOT work for or represent Google. If asked, say so plainly. We just help get more reviews onto their OWN Google profile and climb the rankings; Google won't ring them to help, that's the gap we fill.`, ['are you google', 'from google', 'part of google', 'google service', 'work for google', 'google themselves']],
  ['company', 'Company registration', `Registered UK company: ULINC UNICO GROUP LTD, company number 11197856, registered office 483 Green Lanes, London N13 4BS, trading as HeyElsie. Verifiable on Companies House any time.`, ['legit', 'is this legit', 'real company', 'registered', 'scam', 'who are you', 'companies house', 'dodgy', 'prove']],
];

// ── Parse the approved objections + FAQ out of salesObjections.ts ──
function parseObjections() {
  const src = fs.readFileSync(path.join(REPO, 'src/features/crm/data/salesObjections.ts'), 'utf8');
  const re = /\{\s*group:\s*'([^']+)',\s*q:\s*`([\s\S]*?)`,\s*a:\s*`([\s\S]*?)`\s*\}/g;
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({ group: m[1], q: m[2].trim(), a: m[3].trim() });
  }
  return out;
}

const STOP = new Set(['the', 'and', 'you', 'your', 'for', 'are', 'was', 'that', 'this', 'they', 'them', 'with', 'from', 'have', 'has', "i'm", "it's", 'not', 'but', 'too', 'off', 'out', 'who', 'how', 'what', 'why', 'can', 'get', 'got', 'all', 'any', 'one', 'now', 'yet', 'own', 'about', 'over', 'just', 'like', 'need', 'want', 'call', 'early', 'mid', 'asked', 'nearly', 'there']);
function stripQuotes(s) { return s.replace(/^["“”'\s]+|["“”'\s]+$/g, ''); }
function slug(s) {
  return stripQuotes(s).toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).slice(0, 5).join('_') || 'x';
}
function kwFrom(q) {
  const base = stripQuotes(q).toLowerCase();
  const words = base.replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));
  return [...new Set([base.replace(/[^a-z0-9'\s]/g, '').trim(), ...words])].slice(0, 8);
}

function buildFacts() {
  const facts = [];
  PRODUCT.forEach(([key, label, value, keywords], i) => {
    facts.push({ key, label, value, keywords, sort_order: i, is_active: true, _cat: 'product' });
  });
  const objs = parseObjections();
  const seen = new Set();
  objs.forEach((o, i) => {
    const isObj = o.group === 'Objections';
    const prefix = isObj ? 'obj_' : 'faq_';
    let key = prefix + slug(o.q);
    while (seen.has(key)) key += '_' + i;
    seen.add(key);
    facts.push({
      key,
      label: stripQuotes(o.q),
      value: stripQuotes(o.a),
      keywords: kwFrom(o.q),
      sort_order: (isObj ? 100 : 200) + i,
      is_active: true,
      _cat: isObj ? 'objection' : 'faq',
    });
  });
  return facts;
}

const facts = buildFacts();

if (LIST_ONLY) {
  const byCat = { product: [], objection: [], faq: [] };
  for (const f of facts) byCat[f._cat].push(f);
  for (const cat of ['product', 'objection', 'faq']) {
    console.log(`\n\n===== ${cat.toUpperCase()} (${byCat[cat].length}) =====`);
    byCat[cat].forEach((f) => console.log(`\n• ${f.label}\n  → ${f.value}`));
  }
  console.log(`\n\nTOTAL: ${facts.length} facts`);
  process.exit(0);
}

if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set. Re-run with it in the env.');
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
// FULL wipe, not `.in('key', keys)`. Deleting only the keys this run manages
// leaves an ORPHAN behind whenever a question is reworded (the key is derived
// from the question text), and the live coach goes on quoting the old answer
// forever. That is exactly how "nothing's charged for 10 days" survived the
// move to the £1 offer. This file is the single writer for wk_coach_facts.
const del = await supa.from('wk_coach_facts').delete().neq('key', '');
if (del.error) { console.error('delete failed:', del.error.message); process.exit(1); }

// Strip the internal _cat before insert — the DB `category` column has a fixed
// CHECK enum the coach doesn't use, so we leave it NULL.
const rows = facts.map(({ _cat, ...r }) => r);
const ins = await supa.from('wk_coach_facts').insert(rows);
if (ins.error) { console.error('insert failed:', ins.error.message); process.exit(1); }

const { count } = await supa.from('wk_coach_facts').select('*', { count: 'exact', head: true }).eq('is_active', true);
console.log(`Seeded ${facts.length} coach facts (${facts.filter((f) => f._cat === 'product').length} product, ${facts.filter((f) => f._cat === 'objection').length} objections, ${facts.filter((f) => f._cat === 'faq').length} FAQ). Active facts in table now: ${count}.`);
