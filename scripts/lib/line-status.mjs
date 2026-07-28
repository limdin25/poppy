// Live mobile-network screen for every lead-import script.
//
// WHY THIS EXISTS. Hugo, 2026-07-28: Maria cold-texted 100 UK plumbers and 5 of
// the numbers were dead on the network. scripts/lib/verify-phone.mjs cannot
// catch that. It is libphonenumber, an OFFLINE rulebook: it proves a number is a
// well-formed, allocated GB mobile, it has no idea whether anyone still pays the
// bill. Twilio Lookup's line_type_intelligence does not catch it either (all 8
// dead numbers came back valid:true, type:mobile, on real carriers). Only
// Lookup's line_status asks the subscriber's own operator, and tested on those
// exact numbers it was right: 7 of 8 dead = "inactive", 91 of 91 delivered =
// "reachable", zero false positives.
//
// This is a REPUTATION gate, not a cost gate. Undeliverable-number rate is one
// of the things a UK carrier judges a new long code on, and Hugo, 2026-07-28:
// "yes let build this ... to keep our reputation right". The 4p of wasted texts
// is not the point.
//
// GATE ORDER, CHEAPEST FIRST. Every script runs the free checks before this one,
// so money is only ever spent on a number that has already survived everything
// else: format/line type (offline, free) -> Google Places, website and review
// checks -> line_status (paid, LAST).
//
// THREE SAFETY RAILS, all added 2026-07-28 after a review of the first build:
//   1. SPEND CAP. Over LINE_STATUS_MAX_SPEND (default GBP 15) the run stops
//      before buying anything and prints the exact command to allow more.
//   2. ANSWER-RATE GUARD. Under half the attempted lookups answering means the
//      screen did not run: it says so in a banner and exits non-zero, instead of
//      handing back an unscreened list that looks screened.
//   3. HONEST BILLING. The cost line counts lookups that ANSWERED. A run where
//      everything failed reports GBP 0.00, because that is what happened.
//
// This is the .mjs twin of the canonical TypeScript implementation in
// api/lib/twilio-lookup.ts (the scripts are plain ESM and cannot import a .ts).
// tests/line-status.test.ts asserts BOTH against the same rules, so the two
// cannot drift apart silently.

import { readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** Fill missing keys from the repo .env, so a script Hugo runs with only
 *  SUPABASE_* on the command line still gets the Twilio credentials. Without
 *  this the screen would silently fail open on every run, which is the one
 *  outcome worse than not building it. Secrets stay in the gitignored .env. */
export function loadRepoEnv() {
  try {
    for (const line of readFileSync(resolve(REPO, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // no .env (CI, a fresh clone). Env vars may still be set another way.
  }
}

// Same 7 days as api/lib/twilio-lookup.ts, and deliberately NOT the 90 days the
// line-TYPE cache uses. A line type is a fact about the numbering plan and never
// really changes. A line status is live state: a subscription alive today can be
// cut off next week, so a 90-day-old "reachable" would quietly re-open the exact
// hole this screen closes. One working week keeps a mid-campaign re-run free.
export const LINE_STATUS_CACHE_TTL_DAYS = 7;

// Measured on Hugo's own account 2026-07-28 (Twilio usage category
// "line-status-lookups"): 117 lookups billed GBP 0.61893 = GBP 0.00529 each,
// so GBP 5.29 per 1,000. Twilio quotes usage BEFORE VAT, so budget GBP 6.35
// per 1,000 until someone confirms whether this account is VAT-charged.
export const LINE_STATUS_GBP_PER_LOOKUP = 0.0053;

// SPEND CAP. Nothing here ever spends more than this in one run without Hugo
// typing a bigger number himself.
//
// Why a cap at all: these scripts run unattended and the estimate used to be a
// line of text nobody had to agree to. assign-agent-batches.mjs defaults to
// 1000 leads x 2 agents = 2,000 lookups, and pointing any of them at the full
// 11,707-row plumber CSV would have quietly bought 11,707 lookups (about GBP
// 62) off one mistyped argument.
//
// GBP 15 is about 2,830 numbers: comfortably more than any normal batch, far
// less than a runaway. Override per run with LINE_STATUS_MAX_SPEND=<pounds>.
export const LINE_STATUS_MAX_SPEND_GBP = 15;

// ANSWER-RATE FLOOR. Below this share of attempted lookups coming back, the
// screen is treated as NOT HAVING RUN (see screenLineStatus). Half is generous:
// a healthy run answers ~100%, and a broken one (bad credentials, Lookup not
// enabled, Twilio down) answers 0%. Nothing lands in between by accident.
export const LINE_STATUS_MIN_ANSWER_RATE = 0.5;

const CONCURRENCY = 20;

/** The cap in force for this run. Read at call time, never at import time, so
 *  loadRepoEnv() and a command-line override both count. */
export function maxSpendGbp() {
  const raw = process.env.LINE_STATUS_MAX_SPEND;
  // An unset OR empty var means "use the default". Number('') is 0, which would
  // otherwise set the cap to zero pounds and block every run.
  if (raw === undefined || String(raw).trim() === '') return LINE_STATUS_MAX_SPEND_GBP;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : LINE_STATUS_MAX_SPEND_GBP;
}

/**
 * Pure: is this run about to spend more than the cap allows?
 * `lookups` is the number of PAID lookups (cache hits are free and excluded).
 */
export function spendCheck(lookups, capGbp = maxSpendGbp()) {
  const estimateGbp = lookups * LINE_STATUS_GBP_PER_LOOKUP;
  return {
    lookups,
    estimateGbp,
    capGbp,
    over: estimateGbp > capGbp,
    // What to pass to get through, rounded up to a whole pound so Hugo has a
    // round number to type and a little headroom.
    suggestGbp: Math.max(1, Math.ceil(estimateGbp)),
  };
}

/**
 * Pure: did enough lookups actually answer for the screen to count as run?
 *
 * ZERO ATTEMPTED IS NOT A FAILURE. A list that is 100% cached answers nothing
 * because it asked nothing, and that is the cheapest possible good outcome.
 */
export function answerVerdict(attempted, answered, minRate = LINE_STATUS_MIN_ANSWER_RATE) {
  if (attempted <= 0) return { attempted: 0, answered: 0, rate: 1, ok: true, reason: 'nothing_to_look_up' };
  const rate = answered / attempted;
  return { attempted, answered, rate, ok: rate >= minRate, reason: rate >= minRate ? 'ok' : 'too_few_answered' };
}

const RULE = '='.repeat(72);

/** A banner Hugo cannot scroll past. Plain ASCII, no long dashes. */
function banner(title, lines) {
  return ['', RULE, `  ${title}`, RULE, ...lines.map((l) => `  ${l}`), RULE, ''].join('\n');
}

/** The command that is running, ready to paste back with an env var in front. */
function rerunCommand(envPrefix) {
  const abs = process.argv[1];
  let script = 'scripts/<your-script>.mjs';
  if (abs) {
    const rel = relative(REPO, abs);
    // A script outside the repo relatives to ../../.. nonsense. Show its real path.
    script = rel && !rel.startsWith('..') ? rel : abs;
  }
  const args = process.argv.slice(2).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a));
  return `${envPrefix} node ${[script, ...args].join(' ')}`;
}

/** Print the banner and stop the run. Never called on a path that has already
 *  written to the CRM: both callers are before any spend or any insert. */
function abort(title, lines) {
  console.error(banner(title, lines));
  process.exit(1);
}

/**
 * Pure decision: should this number be screened out of a campaign?
 *
 * WE SCREEN ON EXACTLY ONE STATUS: "inactive". Twilio returns five.
 *
 *   inactive    - the operator has no subscriber on this number, or it is not a
 *                 real number. Dead. This is the only one we drop.
 *
 *   unreachable - a REAL, PAYING subscriber whose handset is switched off or out
 *                 of signal RIGHT NOW. NEVER screen these out. A plumber under a
 *                 floor, in a basement, on a plane or on a flat battery is a live
 *                 lead: the network queues the SMS and delivers it when the phone
 *                 comes back. Dropping "unreachable" destroys good leads, and it
 *                 does it silently.
 *
 *   active      - alive on the network (not necessarily reachable this second).
 *   reachable   - alive and connected right now.
 *   unknown     - Twilio could not reach the operator. Absence of evidence, not
 *                 evidence of death. Keep the lead.
 *
 * Returns true (alive), false (dead, drop) or null (no answer, keep and warn).
 */
export function lineAlive(status) {
  if (!status) return null;
  const s = String(status).toLowerCase();
  if (s === 'inactive') return false;               // the one and only screen-out
  if (s === 'reachable' || s === 'active') return true;
  if (s === 'unreachable') return true;             // switched off right now, still a real subscriber
  return null;                                      // 'unknown' or anything new: fail OPEN
}

function supabaseHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function cacheRead(e164s) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const map = new Map();
  if (!url || !key || e164s.length === 0) return map;
  const cutoff = Date.now() - LINE_STATUS_CACHE_TTL_DAYS * 86400_000;
  for (let i = 0; i < e164s.length; i += 100) {
    const chunk = e164s.slice(i, i + 100);
    const filter = `in.(${chunk.map((n) => `"${n}"`).join(',')})`;
    try {
      const res = await fetch(
        `${url}/rest/v1/phone_line_status_cache?select=e164,line_status,error_code,checked_at&e164=${encodeURIComponent(filter)}`,
        { headers: supabaseHeaders(key) },
      );
      if (!res.ok) continue;
      const rows = await res.json();
      for (const row of rows ?? []) {
        if (new Date(row.checked_at).getTime() < cutoff) continue;
        map.set(row.e164, row.line_status);
      }
    } catch {
      // cache is best-effort; a miss just costs one lookup
    }
  }
  return map;
}

async function cacheWrite(entries) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || entries.length === 0) return;
  const now = new Date().toISOString();
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100).map((e) => ({ ...e, checked_at: now }));
    try {
      await fetch(`${url}/rest/v1/phone_line_status_cache?on_conflict=e164`, {
        method: 'POST',
        headers: { ...supabaseHeaders(key), Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(chunk),
      });
    } catch {
      // best-effort
    }
  }
}

async function lookupOne(e164, sid, token) {
  const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=line_status`;
  const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: auth } });
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      if (!res.ok) return { status: null, error_code: null, ok: false };
      const j = await res.json();
      const ls = j?.line_status;
      // A 200 with line_status:null means Twilio has no answer for this number.
      // "No data" is not "dead", so it fails OPEN.
      if (!ls || !ls.status) return { status: null, error_code: ls?.error_code ?? null, ok: false };
      return { status: ls.status, error_code: ls.error_code ?? null, ok: true };
    } catch {
      // network hiccup, retry once
    }
  }
  return { status: null, error_code: null, ok: false };
}

/**
 * Screen a list of E.164 numbers against the live mobile network.
 *
 * Cache-first (7-day TTL), then Twilio Lookup for the misses only, so re-running
 * a list inside the week re-bills nothing. Prints what it is about to spend
 * BEFORE it spends it, and refuses to spend past the cap at all.
 *
 * FAILS OPEN on any INDIVIDUAL number: a non-200, a network error, a 200 with no
 * line_status all keep that lead and warn. Twilio having a bad minute must never
 * silently delete a list.
 *
 * BUT IT DOES NOT FAIL OPEN ON THE WHOLE SCREEN. If fewer than half the attempted
 * lookups answer, the screen did not happen, and it says so and stops (see the
 * answer-rate guard below) instead of handing back an unscreened list that looks
 * screened. The one way to keep every number and spend nothing on purpose is
 * SKIP_LINE_STATUS=1 (alias NO_LINE_STATUS_SPEND=1), which exits cleanly.
 *
 * Stops the process, before spending or writing anything, in two cases:
 *   1. the estimate is over LINE_STATUS_MAX_SPEND (default GBP 15)
 *   2. too few lookups answered, so the screen cannot be trusted
 *
 * @param {string[]} phones  E.164 numbers that already passed the free gates
 * @param {{label?: string}} [opts]
 * @returns {Promise<{dead: Set<string>, unknown: Set<string>, statusByPhone: Map<string,string|null>,
 *                    checked: number, cached: number, attempted: number, answered: number,
 *                    billed: number, costGbp: number, skipped: boolean}>}
 */
export async function screenLineStatus(phones, opts = {}) {
  loadRepoEnv();
  const label = opts.label ? `[${opts.label}] ` : '';
  const unique = [...new Set((phones ?? []).filter(Boolean))];
  const result = {
    dead: new Set(), unknown: new Set(), statusByPhone: new Map(),
    checked: unique.length, cached: 0, attempted: 0, answered: 0,
    billed: 0, costGbp: 0, skipped: false,
  };
  if (unique.length === 0) return result;

  const cached = await cacheRead(unique);
  const misses = unique.filter((n) => !cached.has(n));
  result.cached = unique.length - misses.length;

  // Cost estimate BEFORE any money is spent.
  const estimate = (misses.length * LINE_STATUS_GBP_PER_LOOKUP).toFixed(2);
  console.log(`${label}Line-status screen: ${unique.length} number(s), ${result.cached} already cached (free), `
    + `${misses.length} to look up ~ GBP ${estimate}.`);

  // The no-spend switch. Prints the bill it would have run up, spends nothing,
  // and keeps every lead (fail open) so it can never quietly drop anyone.
  //
  // NAMES. SKIP_LINE_STATUS=1 is the original and still works. The clearer alias
  // NO_LINE_STATUS_SPEND=1 exists because "SKIP_LINE_STATUS" was being read as
  // "dry run the whole script", which it has never been: it skips ONE check, the
  // paid network screen. Everything else the script does still happens for real,
  // including writing leads to the CRM.
  const noSpend = process.env.SKIP_LINE_STATUS === '1' || process.env.NO_LINE_STATUS_SPEND === '1';
  if (noSpend) {
    console.warn(`${label}Live network screen SKIPPED on request, would have cost GBP ${estimate}. `
      + 'Every number kept UNSCREENED (dead numbers included). The rest of this script still runs for real.');
    result.skipped = true;
    for (const n of unique) result.unknown.add(n);
    return result;
  }

  // SPEND CAP, checked after the skip switch (skipping is free, so it can never
  // be blocked by a cap) and before a single lookup is bought.
  const spend = spendCheck(misses.length);
  if (spend.over) {
    abort('SPEND CAP HIT. NOTHING WAS SPENT, NOTHING WAS WRITTEN OR SENT.', [
      `This run wants ${spend.lookups} live lookup(s) = about GBP ${spend.estimateGbp.toFixed(2)}.`,
      `The cap is GBP ${spend.capGbp.toFixed(2)} (change it with LINE_STATUS_MAX_SPEND).`,
      '',
      'You have not been charged anything. Stopping here.',
      '',
      'If that spend is what you meant, re-run with a bigger cap:',
      `  ${rerunCommand(`LINE_STATUS_MAX_SPEND=${spend.suggestGbp}`)}`,
      '',
      'Or run with NO network screen and NO spend (keeps every number, dead ones included):',
      `  ${rerunCommand('SKIP_LINE_STATUS=1')}`,
      '',
      'Or ask for fewer leads. Roughly 190 numbers per GBP 1.',
    ]);
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const fresh = new Map();
  result.attempted = misses.length;
  if (misses.length > 0) {
    if (!sid || !token) {
      console.warn(`${label}No TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN, cannot screen. Keeping every number (fail open).`);
      // answered stays 0, so the guard below stops the run rather than letting an
      // unscreened list through under a cost line that says the screen ran.
    } else {
      let cursor = 0;
      const worker = async () => {
        while (cursor < misses.length) {
          const n = misses[cursor++];
          fresh.set(n, await lookupOne(n, sid, token));
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, misses.length) }, worker));
      const answered = misses.map((n) => ({ n, r: fresh.get(n) })).filter((x) => x.r?.ok);
      // BILL FROM WHAT ANSWERED, NEVER FROM WHAT WE ASKED. A run where every
      // lookup failed used to print "Billed 97 lookup(s) = GBP 0.51", which read
      // exactly like a working screen and was the loudest evidence that anything
      // had happened at all. Nothing answered, so nothing is claimed.
      result.answered = answered.length;
      result.billed = answered.length;
      result.costGbp = answered.length * LINE_STATUS_GBP_PER_LOOKUP;
      await cacheWrite(answered.map(({ n, r }) => ({ e164: n, line_status: r.status, error_code: r.error_code })));
    }
  }

  // ANSWER-RATE GUARD. Every individual failure fails open, which is right for
  // one number and catastrophic for all of them: with wrong credentials, Lookup
  // switched off on the account, or Twilio down, every number comes back
  // "unknown", every lead is kept, and the run looks identical to a clean screen.
  // A totally broken screen must not be indistinguishable from a working one.
  const verdict = answerVerdict(result.attempted, result.answered);
  if (!verdict.ok) {
    abort('LINE-STATUS SCREEN FAILED. NOTHING WAS ACTUALLY SCREENED.', [
      `Asked Twilio about ${verdict.attempted} number(s). Only ${verdict.answered} came back.`,
      '',
      'That is not a result, it is an outage. With almost nothing answering, this run',
      'cannot tell a dead number from a live one, so every number would be kept and the',
      'list would look screened when it is not.',
      '',
      'Usual causes, in the order worth checking:',
      '  1. wrong or expired TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN in .env',
      '  2. Lookup line_status not enabled on the Twilio account',
      '  3. Twilio is having an outage (check status.twilio.com)',
      '',
      `Stopping instead of importing or texting ${result.checked} unscreened number(s).`,
      '',
      'If you want to run anyway with NO screen and NO spend, and you accept that dead',
      'numbers will be texted:',
      `  ${rerunCommand('SKIP_LINE_STATUS=1')}`,
    ]);
  }

  let failed = 0;
  for (const n of unique) {
    const status = cached.has(n) ? cached.get(n) : (fresh.get(n)?.ok ? fresh.get(n).status : null);
    result.statusByPhone.set(n, status ?? null);
    const alive = lineAlive(status);
    if (alive === false) result.dead.add(n);
    else if (alive === null) { result.unknown.add(n); failed++; }
  }

  console.log(`${label}Line-status result: ${result.dead.size} dead (inactive, removed), `
    + `${unique.length - result.dead.size - failed} alive, ${failed} no answer (kept, fail open).`);
  console.log(`${label}Looked up ${result.attempted} number(s), ${result.answered} answered, `
    + `billed about GBP ${result.costGbp.toFixed(2)} (${result.cached} came free from the cache).`);
  return result;
}

/**
 * The one-liner every import script uses: keep only the numbers that are not
 * proven dead. `getPhone` pulls the E.164 out of whatever shape the script's
 * rows have.
 */
export async function dropDeadNumbers(rows, getPhone, opts = {}) {
  const screen = await screenLineStatus(rows.map(getPhone), opts);
  const kept = rows.filter((r) => !screen.dead.has(getPhone(r)));
  return { kept, screen };
}

/**
 * Say out loud when a run delivered fewer leads than were asked for.
 *
 * WHY EVERY SCRIPT NEEDS THIS. The keeper loop stops the moment it has the
 * requested count, and the paid screen then runs on that finished list and takes
 * the dead numbers back off the end. So "give me 1000" reliably hands back about
 * 950, and until now three of the four scripts said nothing about it. Hugo would
 * find out by counting rows in the CRM, or not at all.
 *
 * DELIBERATELY NOT A TOP-UP LOOP. Refilling to the target means going back to the
 * CSV and buying another round of lookups, in a loop, unattended, with no natural
 * end if the list is thin. A clear warning is the honest fix; re-running the
 * script is the top-up, and the 7-day cache makes the second run nearly free.
 *
 * @returns {boolean} true when it warned (i.e. the run came up short)
 */
export function warnIfShort(requested, delivered, opts = {}) {
  const want = Number(requested);
  if (!Number.isFinite(want) || want <= 0 || delivered >= want) return false;
  const what = opts.what || 'lead(s)';
  const label = opts.label ? ` (${opts.label})` : '';
  console.warn(banner(`SHORT${label}: YOU ASKED FOR ${want}, THIS RUN DELIVERED ${delivered}.`, [
    `${want - delivered} fewer ${what} than you asked for.`,
    '',
    'This is normal, not a crash. The list is filled first and screened after, so',
    'numbers that are dead on the network (and anything else the gates rejected)',
    'come off the end and are not replaced.',
    '',
    `Want the full ${want}? Run it again. Numbers already checked this week are`,
    'cached, so the second run costs almost nothing and tops the batch up.',
  ]));
  return true;
}
