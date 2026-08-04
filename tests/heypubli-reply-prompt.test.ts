import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nonGsm7 } from '../api/lib/sms-charset';

// Hugo 2026-08-03, on a lead who was asked for their Instagram handle: "first
// you have to ask, do you mind sharing your Instagram so we can analyse the
// page. Get them to share the Instagram first, and then take it from there."
// And on scope: "we are talking about this number only, this number is for
// HeyPubli, period."
//
// Hugo 2026-08-04, reading the drafts that followed: "the AI is currently a
// liability. First it's ignoring the images... second it's lying about the
// niches, telling leads they can choose their own, but that's a hard no...
// finally the memory is non-existent." Four defects, three of them code, all
// four pinned below.
//
// The prompt is a row in wk_ai_reply_settings, not code, so the migration that
// sets it is the artefact to test. Same shape as tests/message-copy.test.ts:
// the rule is enforced by failing the build, not by trusting anyone to
// remember it.

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const SEED = 'supabase/migrations/20260803000002_heypubli_reply_prompt.sql';
// The LIVE wording is whichever migration ran last against this row.
const MIGRATION = 'supabase/migrations/20260804000001_heypubli_prompt_overhaul.sql';
const seedSql = read(SEED);
const sql = read(MIGRATION);
const prompt = sql.match(/\$prompt\$([\s\S]*?)\$prompt\$/)?.[1] ?? '';

describe('the HeyPubli number prompt', () => {
  it('is keyed on the number, and leaves the default row alone', () => {
    expect(prompt.length).toBeGreaterThan(500);
    expect(seedSql).toMatch(/insert into wk_ai_reply_settings/);
    expect(sql).toMatch(/where id = '\+447460035763'/);
    // The bug this replaced: overwriting 'default' pointed every trade lead
    // with no campaign at the Instagram pitch. No migration may touch it.
    for (const s of [seedSql, sql]) {
      expect(s).not.toMatch(/where id = 'default'/);
    }
  });

  it('runs handle, then look at the page, then offer, in that order', () => {
    const handle = prompt.indexOf('STEP 1, THE HANDLE');
    const vet = prompt.indexOf('STEP 2, LOOK AT THE PAGE');
    const offer = prompt.indexOf('STEP 3, THE OFFER');
    expect(handle).toBeGreaterThan(-1);
    expect(vet).toBeGreaterThan(handle);
    expect(offer).toBeGreaterThan(vet);
    expect(prompt).toMatch(/never skip ahead/);
  });

  it('pitches nothing and sends no link until the handle is in', () => {
    const step1 = prompt.slice(
      prompt.indexOf('STEP 1, THE HANDLE'),
      prompt.indexOf('STEP 2, LOOK AT THE PAGE'),
    );
    expect(step1).toMatch(/no offer/i);
    expect(step1).toMatch(/no links/i);
    expect(step1).not.toMatch(/heypubli\.com\/signup/);
    expect(prompt.indexOf('heypubli.com/signup')).toBeGreaterThan(prompt.indexOf('STEP 3, THE OFFER'));
  });

  // Hugo 2026-08-04: "it's lying about the niches, telling leads they can
  // choose their own, but that's a hard no." A real draft told a lead "Great
  // question, yes you do!" when asked whether they pick their niche.
  it('states the niche rule as a hard no, and never as a choice', () => {
    expect(prompt).toMatch(/They do not choose their niche/);
    expect(prompt).toMatch(/Never tell them they can/);
    expect(prompt).toMatch(/not a menu to order from/);
    // The samples framing, in Hugo's own words.
    expect(prompt).toMatch(/videos on our site are samples/);
    // And the general guard, so the next unanswered question is not the next
    // invented answer.
    expect(prompt).toMatch(/NEVER INVENT AN ANSWER/);
    expect(prompt).toMatch(/say you will check/i);
  });

  it('tells it to read the chat before asking anything again', () => {
    expect(prompt).toMatch(/READ THE WHOLE CHAT BEFORE YOU TYPE/);
    expect(prompt).toMatch(/Never ask for something they have already given you/);
  });

  it('tells it that it can see images, and to take the handle off one', () => {
    expect(prompt).toMatch(/YOU CAN SEE IMAGES/);
    expect(prompt).toMatch(/take the handle straight off it/);
  });

  it('asks for a human voice and names the robot phrases to avoid', () => {
    expect(prompt).toMatch(/HOW YOU TALK/);
    expect(prompt).toMatch(/great question/i);
    expect(prompt).toMatch(/Vary how you open/);
  });

  it('carries the commission facts the site itself prints', () => {
    expect(prompt).toContain('40% commission');
    expect(prompt).toContain('$108');
    expect(prompt).toContain('$43.20');
  });

  it('refuses the income promise HeyPubli refuses in its own copy', () => {
    expect(prompt).toMatch(/NEVER PROMISE EARNINGS/);
    expect(prompt).toMatch(/earn little or nothing/);
    expect(prompt).toMatch(/earning while you sleep/);
  });

  it('has no trace of the other offer in it', () => {
    for (const ghost of [/Google review/i, /HeyElsie/i, /plumber/i, /£/]) {
      expect(prompt).not.toMatch(ghost);
    }
  });

  it('obeys the long-dash rule, in the prompt and about the reply', () => {
    expect(nonGsm7(prompt)).toEqual([]);
    expect(prompt).toMatch(/never use a long dash/);
  });
});

describe('the reply route routes on the number', () => {
  const route = read('api/crm/ai-reply.ts');

  it('reads the number row for the prompt, keyed on the line they texted', () => {
    expect(route).toMatch(/WHATSAPP_SENDER_E164 \|\| '\+447460035763'/);
    expect(route).toMatch(/\.eq\('id', replyFrom\)/);
  });

  it('takes ONLY the prompt from that row, never the safety rails', () => {
    const numberRead = route.match(/from\('wk_ai_reply_settings'\)[\s\S]{0,120}?\.eq\('id', replyFrom\)/)?.[0] ?? '';
    expect(numberRead).toMatch(/\.select\('system_prompt'\)/);
    expect(route).toMatch(/withinHours\(s\.hours_start, s\.hours_end, s\.days, s\.timezone\)/);
    expect(route).toMatch(/s\.max_replies_per_contact/);
  });

  it('fails the job rather than falling back to the other offer', () => {
    expect(route).toMatch(/number_prompt_failed/);
  });

  it('lets a hand-written campaign prompt still win', () => {
    expect(route).toMatch(/heypubliNumber && cfg\.source !== 'campaign'/);
    expect(route).toMatch(/numberPrompt \|\| cfg\.system_prompt/);
  });

  it('never asks a creator to ring a line nobody answers', () => {
    expect(route).toMatch(/Never ask them to ring you and never give out a phone number/);
  });

  it('keeps the reviews video funnel off this number, and only this number', () => {
    expect(route).toMatch(/wk_vsl_pages/);
    expect(route).toMatch(/cfg\.source === 'campaign' \|\| heypubli\s*\?\s*\{ data: null \}/);
  });
});

describe('what the model is actually shown', () => {
  const route = read('api/crm/ai-reply.ts');
  const llm = read('api/lib/llm.ts');
  const media = read('api/lib/twilio-media.ts');

  it('sends the picture, not just the caption', () => {
    expect(route).toMatch(/fetchTwilioMedia/);
    expect(route).toMatch(/type: 'image'/);
    expect(llm).toMatch(/media_type: string; data: string/);
  });

  it('keeps a caption-less photo in the history instead of dropping it', () => {
    // The original bug: `.filter((m) => m.content)` deleted image-only
    // messages, so the lead looked like they had said nothing and the model
    // asked the same question again.
    expect(route).not.toMatch(/\.filter\(\(m\) => m\.content\)/);
    expect(route).toMatch(/could not be loaded/);
  });

  it('never replays an unsent draft as something we said', () => {
    expect(route).toMatch(/m\.status === 'draft'\) continue/);
  });

  it('remembers more than a handful of messages', () => {
    const history = Number(route.match(/const HISTORY = (\d+)/)?.[1] ?? 0);
    expect(history).toBeGreaterThanOrEqual(30);
  });

  it('caps how many images ride along, or the thread grows without bound', () => {
    expect(route).toMatch(/const MAX_IMAGES = \d+/);
  });

  it('pins the media host in ONE place, shared with the inbox route', () => {
    // media_urls holds a webhook-supplied URL. Fetching it with our Twilio
    // credentials attached is an SSRF hole unless the host is pinned, and two
    // copies of that rule is one copy too many.
    expect(media).toMatch(/TWILIO_MEDIA_HOST = 'api\.twilio\.com'/);
    expect(read('api/crm/media.ts')).toMatch(/ALLOWED_HOST = TWILIO_MEDIA_HOST/);
    expect(media).toMatch(/redirect: 'manual'/);
  });

  it('only sends image types the model accepts', () => {
    expect(media).toMatch(/image\/jpeg', 'image\/png', 'image\/gif', 'image\/webp/);
  });
});
