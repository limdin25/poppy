import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nonGsm7 } from '../api/lib/sms-charset';

// Hugo 2026-08-03, looking at a real draft in his inbox: a lead who filled in
// the HeyPubli form on Instagram was answered with the Google-reviews pitch.
// "First you have to ask, do you mind sharing your Instagram so we can analyse
// the page. Get them to share the Instagram first, and then take it from
// there." And on scope: "we are talking about this number only, this number is
// for HeyPubli, period."
//
// The prompt is a row in wk_ai_reply_settings, not code, so the migration that
// seeds it is the artefact to test. Same shape as tests/message-copy.test.ts:
// the rule is enforced by failing the build, not by trusting anyone to
// remember it.

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

// The row is seeded by ...0002 and rewritten by ...0003. The LIVE wording is
// whichever migration ran last, so that is the one under test.
const SEED = 'supabase/migrations/20260803000002_heypubli_reply_prompt.sql';
const MIGRATION = 'supabase/migrations/20260803000003_heypubli_handle_vet_scale.sql';
const seedSql = read(SEED);
const sql = read(MIGRATION);
// Just the prompt, not the surrounding commentary.
const prompt = sql.match(/\$prompt\$([\s\S]*?)\$prompt\$/)?.[1] ?? '';

describe('the HeyPubli number prompt', () => {
  it('is keyed on the number, and leaves the default row alone', () => {
    expect(prompt.length).toBeGreaterThan(500);
    expect(seedSql).toMatch(/insert into wk_ai_reply_settings/);
    expect(sql).toMatch(/where id = '\+447460035763'/);
    // The bug this replaced: overwriting 'default' pointed every trade lead
    // with no campaign at the Instagram pitch. Neither migration may touch it.
    for (const s of [seedSql, sql]) {
      expect(s).not.toMatch(/where id = 'default'/);
    }
  });

  it('runs handle, then vet, then scale, in that order and no other', () => {
    // Hugo 2026-08-03: "the goal is to handle, vet the page, and scale. Lock
    // that in." Prose let the model decide it had vetted enough and jump to the
    // link; named steps are checkable.
    const handle = prompt.indexOf('STEP 1, THE HANDLE');
    const vet = prompt.indexOf('STEP 2, VET THE PAGE');
    const scale = prompt.indexOf('STEP 3, SCALE');
    expect(handle).toBeGreaterThan(-1);
    expect(vet).toBeGreaterThan(handle);
    expect(scale).toBeGreaterThan(vet);
    expect(prompt).toMatch(/never skip ahead/);
  });

  it('pitches nothing and sends no link until the handle is in', () => {
    const handle = prompt.indexOf('STEP 1, THE HANDLE');
    const vet = prompt.indexOf('STEP 2, VET THE PAGE');
    const step1 = prompt.slice(handle, vet);
    expect(step1).toMatch(/Instagram handle/);
    expect(step1).toMatch(/Do not explain the offer/);
    expect(step1).toMatch(/do not send any link/i);
    // The signup link belongs to step 3 and nowhere earlier.
    expect(step1).not.toMatch(/heypubli\.com\/signup/);
    expect(prompt.indexOf('heypubli.com/signup')).toBeGreaterThan(prompt.indexOf('STEP 3, SCALE'));
  });

  it('vets on engagement, never on follower count', () => {
    expect(prompt).toMatch(/professional or creator account/);
    expect(prompt).toMatch(/organic engagement/);
    expect(prompt).toMatch(/Follower count does not matter/);
    expect(prompt).toMatch(/bought followers|fake engagement/);
  });

  it('carries the commission facts the site itself prints', () => {
    expect(prompt).toContain('40% commission');
    expect(prompt).toContain('$108');
    expect(prompt).toContain('$43.20');
  });

  it('refuses the income promise HeyPubli refuses in its own copy', () => {
    // nextpubli/features/landing-page/copy.ts flags "earning while you sleep"
    // as the most reported phrase in this ad category, and earnings.ts states
    // plainly that not one creator has been paid.
    expect(prompt).toMatch(/Never promise earnings/);
    expect(prompt).toMatch(/earn little or nothing/);
    expect(prompt).toMatch(/earning while you sleep/);
  });

  it('says the no-phone rule exactly once, and it is the route that says it', () => {
    // Duplicating it here is how the two copies drift apart. The route appends
    // it for this number, and tests below pin that.
    expect(prompt).not.toMatch(/never give out a phone number/i);
  });

  it('has no trace of the other offer in it', () => {
    for (const ghost of [/Google review/i, /HeyElsie/i, /plumber/i, /£/]) {
      expect(prompt).not.toMatch(ghost);
    }
  });

  it('obeys the long-dash rule, in the prompt and about the reply', () => {
    // A model copies the punctuation it is shown, so a long dash in here is a
    // long dash in the message a lead gets, at 70 characters a segment
    // instead of 160.
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
    // Hours, caps, handoff keywords and the delay stay on 'default'. Splitting
    // them per number multiplies the ways a lead gets texted at midnight.
    const numberRead = route.match(/from\('wk_ai_reply_settings'\)[\s\S]{0,120}?\.eq\('id', replyFrom\)/)?.[0] ?? '';
    expect(numberRead).toMatch(/\.select\('system_prompt'\)/);
    expect(route).toMatch(/withinHours\(s\.hours_start, s\.hours_end, s\.days, s\.timezone\)/);
    expect(route).toMatch(/s\.max_replies_per_contact/);
  });

  it('fails the job rather than falling back to the other offer', () => {
    // Same rule as the campaign reads: an error means "we do not know which
    // offer", not "use the other one". Falling through would draft the reviews
    // pitch at a creator, which is the entire bug.
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
    // The block still exists for every other line. Hugo: "don't have to delete
    // anything else, keep the code."
    expect(route).toMatch(/wk_vsl_pages/);
    expect(route).toMatch(/cfg\.source === 'campaign' \|\| heypubli\s*\?\s*\{ data: null \}/);
  });
});
