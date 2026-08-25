// Read a walkthrough recording, price it, write the builder's list.
//
// Hugo, 2026-08-25: Pedro sits at the computer with Rightmove open, screen
// records himself going through the photos, and talks. "This page gonna take
// the text he's saying and then it's gonna spit out the message for the builder
// and our version of the costs."
//
// THE SPLIT, AND IT IS NOT NEGOTIABLE. The model does LANGUAGE: it reads a
// rambling voice note and says which jobs on our rate card it describes. This
// route does MONEY: it prices those jobs from the card in
// src/features/crm/lib/refurbCard.ts and nowhere else. That is already the rule
// across this system (BRRR_STRATEGY: "the CRM extracts the facts from the call,
// which is language work, and sends them over. It never does the arithmetic"),
// and here it means a model that mishears cannot invent a number. The worst it
// can do is pick the wrong line, which is visible on screen next to the words
// it heard, and correctable.
//
// The vocabulary in the prompt is GENERATED FROM THE CARD, so a new rate-card
// line cannot exist in the maths but be invisible to the reader.
//
// GATE: `wk_is_agent_or_admin`, the same one Pedro's other presses use, for the
// same reason api/crm/find-builders.ts gives at length. Pricing a refurb is his
// job and admin-gating it is how the builder panel ended up blank for him.

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import { callLLM } from '../lib/llm.js';
import {
  cardVocabulary, estimate, builderBrief, parseReadResult, composeTranscript,
  type ReadResult, type SectionAnswer,
} from '../../src/features/crm/lib/refurbCard.js';

// 300, NOT 60, AND THAT IS NOT PADDING.
//
// Hugo hit a 504 on his first real use. Fourteen filled-in boxes is a long
// transcript, and the reader answers with a line, a plain-English detail and a
// verbatim quote for every job it finds. On claude-sonnet-5, which thinks
// before it answers, one call can run well past a minute. `maxDuration: 60` was
// copied from the shorter CRM routes without checking that.
//
// api/lib/llm.ts already carries the scar of this exact failure: "unbounded
// thinking is how ... fetch-ballpark blew the 25 second edge ceiling into a
// 504". The thinking here has been capped at the floor since the first version.
// The remaining time is the answer itself, so the ceiling had to move.
export const config = { maxDuration: 300 };

/** Stop reading and answer honestly rather than letting the gateway kill us.
 *
 *  A 504 is the worst outcome available: the gateway answers with an HTML error
 *  page, so the browser cannot even parse a reason out of it, and Pedro loses
 *  everything he just dictated with nothing to act on. Leaving room to return a
 *  real JSON error means he gets a sentence telling him what to do next. */
const DEADLINE_MS = 270_000;

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MODEL = 'claude-sonnet-5';

/** The same gate as api/crm/find-builders.ts: a CRM agent or an admin. */
async function requireAgent(req: Request): Promise<true | Response> {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: userResp } = await sb.auth.getUser(jwt);
  if (!userResp?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const caller = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return Response.json({ error: 'CRM access required' }, { status: 403 });
  return true;
}

const SYSTEM = [
  'You are a UK refurbishment estimator reading somebody talk their way through the photographs of a house on Rightmove. He is not a builder and he is not in the house. He is describing what he can see in pictures.',
  '',
  'Your ONLY job is to turn what he said into a list of jobs from the fixed list below. You never price anything. Prices are worked out after you, from our own rate card, so a number in your output would be ignored anyway.',
  '',
  'THE FIXED LIST. These keys are the only ones that exist. A job you cannot express with one of these keys must go in `unknowns` as a sentence, NEVER invented as a key.',
  '',
  cardVocabulary(),
  '',
  'HARD RULES.',
  '1. Only include a job the recording actually supports. He is looking at photographs, so "the kitchen looks dated" is enough for a kitchen, and silence about the fuse board is NOT enough for a rewire. An invented job becomes real money on a real offer.',
  '2. `confidence` is honest and it matters more than being thorough. Use "seen" when he plainly describes it in a photograph, "likely" when it follows from what he described, and "guess" when you are inferring it from the age or the style of the house. Anything you are inferring must be "guess".',
  '3. `heard` is a short quote from his own words that justifies the line, so a human can check you. Never write a quote he did not say.',
  '4. Whole-house lines are charged once for the whole property. Use `portion` 1 when the whole house needs it, or roughly the fraction of the house that does (0.5 for about half). Never list a whole-house line more than once.',
  '5. `qty` is only for item lines and only when there is genuinely more than one, for example two bathrooms.',
  '6. MOST REFURBS NEED DECORATING, FLOORING AND SKIPS. If he describes any real work at all, those are usually right, but say so with confidence "likely" rather than "seen" unless he mentions them.',
  '7. skim_patch is the normal choice for tired walls. Only use replaster when he describes bare, blown or damaged plaster. NEVER return both.',
  '8. `unknowns` is the honest half of the answer: list what photographs genuinely cannot show for THIS house. Damp behind furniture, the state of the fuse board, whether the boiler works, roof timbers, drains. Be specific to what he described, not a generic list.',
  '9. `band` is one of turnkey, cosmetic, modernisation, full_refurb, derelict, based on the whole picture.',
  '10. Long dashes, curly quotes and ellipsis characters are forbidden in your output. Use plain commas and full stops.',
  '',
  'Return ONLY a JSON object, no prose, no code fences:',
  '{"band":"...","summary":"one or two plain sentences a non-builder would understand","items":[{"key":"...","where":"...","detail":"one line a builder can quote against","qty":1,"portion":1,"confidence":"seen","heard":"..."}],"unknowns":["..."]}',
].join('\n');

async function handleWeb(req: Request): Promise<Response> {
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405 });
  const gate = await requireAgent(req);
  if (gate !== true) return gate;

  let body: {
    sections?: SectionAnswer[];
    transcript?: string;
    address?: string;
    floorAreaSqm?: number | null;
    includeBudget?: boolean;
  };
  try { body = await req.json() as typeof body; }
  catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }); }

  // Sections are the real input: one box per part of the property, labelled, so
  // the reader can say WHERE each job is. `transcript` stays accepted for a
  // caller that already has one blob of text.
  const transcript = Array.isArray(body.sections) && body.sections.length
    ? composeTranscript(body.sections)
    : String(body.transcript ?? '').trim();

  if (transcript.length < 40) {
    return Response.json({
      error: 'There is not enough here to price yet. Fill in a few more parts of the property and try again.',
    }, { status: 400 });
  }

  const user = [
    body.address ? `THE HOUSE: ${body.address}` : 'THE HOUSE: address not given.',
    body.floorAreaSqm ? `FLOOR AREA: ${body.floorAreaSqm} square metres.` : '',
    '',
    'WHAT HE SAID GOING THROUGH THE PHOTOGRAPHS, ONE PART OF THE PROPERTY AT A TIME.',
    'The HEADINGS IN CAPITALS are which part he was looking at. Use them for `where` on',
    'each job. A part of the property with no heading below is one he did not describe,',
    'so say what you could not judge about it in `unknowns` rather than assuming it is fine.',
    '',
    transcript.slice(0, 24_000),
  ].filter(Boolean).join('\n');

  // Up to three attempts, but ONLY while there is real time left. A retry
  // started with forty seconds on the clock is not a retry, it is a 504 with
  // extra steps, and Pedro loses everything he dictated.
  //
  // This route must never answer with a made-up estimate either: an empty
  // result he can see is recoverable, a confident wrong number is not.
  const started = Date.now();
  const timeLeft = () => DEADLINE_MS - (Date.now() - started);

  let read: ReadResult | null = null;
  let attempts = 0;
  // 70 seconds is roughly one unhurried read on a long transcript. Below that,
  // starting another one is a coin flip we would lose.
  while (!read && attempts < 3 && timeLeft() > 70_000) {
    if (attempts > 0) await new Promise((r) => setTimeout(r, 1200 * attempts));
    attempts++;
    const raw = await callLLM(MODEL, SYSTEM, [{ role: 'user', content: user }], 3500,
      { thinkingBudget: 1024 });
    if (raw) {
      read = parseReadResult(raw);
      if (!read) console.warn('[refurb-estimate] unparseable read:', raw.slice(0, 400));
    }
  }
  if (!read) {
    const ranOut = timeLeft() <= 70_000;
    console.warn(`[refurb-estimate] no read after ${attempts} attempt(s), ${Math.round((Date.now() - started) / 1000)}s elapsed`);
    return Response.json({
      error: ranOut
        ? 'That took too long to read, which usually means there is a lot of text. Everything you typed is still on the page. Try pressing the button again, and if it happens twice, shorten the longest boxes.'
        : 'The reader could not make sense of that. Everything you typed is still on the page, so try the button again.',
    }, { status: 504 });
  }

  // ---- the money, computed HERE and by no model -------------------------
  const est = estimate(read.items, { floorAreaSqm: body.floorAreaSqm ?? null });
  est.unknowns = read.unknowns;

  const brief = builderBrief(est.lines, {
    address: body.address ?? '',
    includeBudget: body.includeBudget !== false,
    budget: est.budget,
    unknowns: read.unknowns,
  });

  return Response.json({
    ok: true,
    band: read.band ?? null,
    summary: read.summary ?? null,
    estimate: est,
    // Kept beside the lines so a human can check every job against the words
    // that produced it. This is the difference between a tool and a black box.
    heard: read.items.map((i) => ({ key: i.key, heard: i.heard, confidence: i.confidence })),
    brief,
  });
}

// NODE, NOT EDGE, AND THAT IS WHY THIS ADAPTER EXISTS.
//
// The read can take 30 seconds or more, so this function needs `maxDuration`,
// and `maxDuration` means a Node serverless function. A Node function is handed
// `IncomingMessage`/`ServerResponse`, NOT the Web `Request`/`Response` that
// `runtime: 'edge'` routes like api/crm/cockpit.ts get.
//
// Shipping it with a Web-style signature and a Node config is a 500 on every
// call, `TypeError: req.headers.get is not a function`, thrown before the auth
// check so it does not even 401. It typechecks perfectly, because the signature
// is a promise about a runtime the config quietly opted out of. Caught in
// production on 2026-08-25, five minutes after the first deploy.
//
// Same adapter, same reason, as api/crm/find-builders.ts.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(',') : String(v);
  }
  const out = await handleWeb(new Request(`http://internal${req.url ?? '/'}`, {
    method: req.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  }));
  res.statusCode = out.status;
  out.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await out.arrayBuffer()));
}
