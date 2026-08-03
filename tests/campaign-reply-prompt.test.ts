import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  mergeReplySettings,
  type GlobalReplySettings,
  type CampaignReplyOverride,
} from '../api/lib/campaign-reply-settings';

// Hugo, 2026-07-28: "every campaign should have own reply prompt".
//
// Agent Maria cold-texted 100 UK plumbers a WEBSITE opener:
//   "Hey Kevin, this is Pedro. I saw you on Google and noticed you dont have a
//    website. I know this is kinda random, but I built you one :). Wanna see it?"
// Six replied. Every draft the AI wrote pitched GOOGLE REVIEWS, because
// wk_ai_reply_settings is a single global row (id = 'default') read by every
// campaign. Kevin at PM Plumbing said "Yeah sure" and the draft waiting in the
// inbox opened with "Just to be straight with you, I'm not Pedro and I can't
// share a website". Nothing was sent, the global mode is 'draft'.
//
// The fix is a per-campaign override on wk_campaign_ai_settings, resolved
// through wk_dialer_queue (the only durable lead-to-campaign link: there is no
// campaign_id on wk_sms_messages and broadcast_id is NULL on every row).

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const MIGRATION = 'supabase/migrations/20260728000004_campaign_sms_reply_prompt.sql';
const mig = read(MIGRATION);
// The review fixes: paused campaigns resolve, anon loses EXECUTE by name, and
// the prompt gains the "I already have a website" branch.
const FIXES = 'supabase/migrations/20260728000005_campaign_reply_prompt_fixes.sql';
const fixes = read(FIXES);
const route = read('api/crm/ai-reply.ts');
const lib = read('api/lib/campaign-reply-settings.ts');
const hook = read('src/features/crm/hooks/useSmsReplySettings.ts');
const settingsPage = read('src/features/crm/pages/SettingsPage.tsx');

const GLOBAL: GlobalReplySettings = {
  enabled: true,
  mode: 'draft',
  model: 'claude-sonnet-4-6',
  system_prompt: 'GLOBAL REVIEWS PITCH',
};

const override = (o: Partial<CampaignReplyOverride>): CampaignReplyOverride => ({
  sms_reply_prompt: null,
  sms_reply_mode: null,
  sms_reply_model: null,
  sms_reply_enabled: null,
  ...o,
});

describe('a campaign answers with its own prompt', () => {
  it('uses the campaign prompt over the global one', () => {
    const cfg = mergeReplySettings(GLOBAL, 'camp-1', override({ sms_reply_prompt: 'YOU ARE PEDRO' }));
    expect(cfg.system_prompt).toBe('YOU ARE PEDRO');
    expect(cfg.source).toBe('campaign');
    expect(cfg.campaign_id).toBe('camp-1');
  });

  it('inherits when the campaign prompt is empty or blank', () => {
    // The editor clears an override by emptying the box. Blank must not mean
    // "answer this lead with no instructions at all".
    for (const p of ['', '   ', '\n\t ']) {
      const cfg = mergeReplySettings(GLOBAL, 'camp-1', override({ sms_reply_prompt: p }));
      expect(cfg.system_prompt).toBe('GLOBAL REVIEWS PITCH');
      expect(cfg.source).toBe('global');
    }
  });

  it('leaves a campaign with no row completely untouched', () => {
    // The whole "never break what works" clause: 22 of the 55 contacts that have
    // ever texted in have no queue row at all.
    const cfg = mergeReplySettings(GLOBAL, null, null);
    expect(cfg).toEqual({
      enabled: true,
      mode: 'draft',
      model: 'claude-sonnet-4-6',
      system_prompt: 'GLOBAL REVIEWS PITCH',
      campaign_id: null,
      source: 'global',
    });
  });
});

describe('mode: a campaign may be more cautious than the workspace, never less', () => {
  const AUTO: GlobalReplySettings = { ...GLOBAL, mode: 'auto' };

  it('inherits the global mode when the campaign sets none', () => {
    expect(mergeReplySettings(GLOBAL, 'camp-1', override({})).mode).toBe('draft');
    expect(mergeReplySettings(AUTO, 'camp-1', override({})).mode).toBe('auto');
  });

  it('a campaign can NOT auto send while the workspace says draft', () => {
    // The whole point of the workspace switch. mode used to be a plain
    // override, so one campaign box could start texting real leads with nobody
    // reading them while the workspace switch still read 'draft'.
    const cfg = mergeReplySettings(GLOBAL, 'camp-1', override({ sms_reply_mode: 'auto' }));
    expect(cfg.mode).toBe('draft');
  });

  it('lets one campaign stay on draft while the workspace is auto', () => {
    expect(mergeReplySettings(AUTO, 'camp-1', override({ sms_reply_mode: 'draft' })).mode).toBe('draft');
  });

  it('auto needs BOTH sides on auto', () => {
    expect(mergeReplySettings(AUTO, 'camp-1', override({ sms_reply_mode: 'auto' })).mode).toBe('auto');
  });

  it('ignores a mode value that is neither draft nor auto', () => {
    const bad = override({ sms_reply_mode: 'send' as unknown as 'auto' });
    expect(mergeReplySettings(GLOBAL, 'camp-1', bad).mode).toBe('draft');
    // and a junk value on an auto workspace inherits auto rather than crashing
    expect(mergeReplySettings(AUTO, 'camp-1', bad).mode).toBe('auto');
  });

  it('never returns anything but draft or auto', () => {
    for (const g of [GLOBAL, AUTO]) {
      for (const m of [null, 'draft', 'auto', '', 'send'] as unknown[]) {
        const cfg = mergeReplySettings(g, 'c', override({ sms_reply_mode: m as 'auto' }));
        expect(['draft', 'auto']).toContain(cfg.mode);
      }
    }
  });
});

describe('a paused campaign goes quiet, it does not fall back to the global pitch', () => {
  // Pausing a finished blast the morning after is the natural thing to do.
  // The resolver used to return NULL for a paused campaign, which read as "this
  // lead has no campaign" and answered a website opener with the reviews pitch.
  it('is_active false switches replies off, prompt or no prompt', () => {
    expect(mergeReplySettings(GLOBAL, 'camp-1', override({ sms_reply_prompt: 'YOU ARE PEDRO' }), false).enabled)
      .toBe(false);
    expect(mergeReplySettings(GLOBAL, 'camp-1', null, false).enabled).toBe(false);
  });

  it('is_active true changes nothing', () => {
    expect(mergeReplySettings(GLOBAL, 'camp-1', override({}), true).enabled).toBe(true);
  });

  it('null means not known, so the two switches decide on their own', () => {
    expect(mergeReplySettings(GLOBAL, 'camp-1', override({}), null).enabled).toBe(true);
    expect(mergeReplySettings(GLOBAL, null, null).enabled).toBe(true);
  });

  it('a paused campaign never lends the workspace prompt to its leads', () => {
    // enabled false is what the route returns on, so the prompt is never used.
    const cfg = mergeReplySettings(GLOBAL, 'camp-1', override({}), false);
    expect(cfg.enabled).toBe(false);
    expect(cfg.campaign_id).toBe('camp-1');
  });
});

describe('enabled is an AND, never an override', () => {
  it('a campaign can switch itself off', () => {
    expect(mergeReplySettings(GLOBAL, 'camp-1', override({ sms_reply_enabled: false })).enabled).toBe(false);
  });

  it('a campaign can NOT switch itself on when the workspace is off', () => {
    // wk-sms-incoming will not even enqueue a job when the global switch is off,
    // so a campaign-level true is dead config. Reading it as an override means
    // someone flips a campaign on and files a bug that nothing fires.
    const g: GlobalReplySettings = { ...GLOBAL, enabled: false };
    expect(mergeReplySettings(g, 'camp-1', override({ sms_reply_enabled: true })).enabled).toBe(false);
  });

  it('null means follow the workspace', () => {
    expect(mergeReplySettings(GLOBAL, 'camp-1', override({})).enabled).toBe(true);
  });
});

describe('model falls back the same way', () => {
  it('uses the campaign model when set', () => {
    expect(mergeReplySettings(GLOBAL, 'c', override({ sms_reply_model: 'gpt-5.4-mini' })).model)
      .toBe('gpt-5.4-mini');
  });

  it('inherits on empty', () => {
    expect(mergeReplySettings(GLOBAL, 'c', override({ sms_reply_model: '  ' })).model)
      .toBe('claude-sonnet-4-6');
  });

  it('a model override alone does not claim the prompt came from the campaign', () => {
    // source drives whether the reviews VSL paragraph is appended in the route.
    expect(mergeReplySettings(GLOBAL, 'c', override({ sms_reply_model: 'x' })).source).toBe('global');
  });
});

describe('the generator actually reads the merged config', () => {
  it('resolves the campaign from the contact and the number they texted', () => {
    expect(route).toMatch(/wk_sms_reply_campaign/);
    expect(route).toMatch(/p_contact: contactId/);
    expect(route).toMatch(/p_number: replyFrom \|\| null/);
  });

  it('feeds the merged prompt, model and mode to the LLM, not the global row', () => {
    // The HeyPubli number prompt (2026-08-03) sits in front of the global row in
    // the same expression, so cfg is now the fallback rather than the only
    // source. What must never appear is a read straight off `s`.
    expect(route).toMatch(/let systemPrompt = numberPrompt \|\| cfg\.system_prompt/);
    expect(route).toMatch(/callLLM\(cfg\.model/);
    expect(route).toMatch(/const draft = cfg\.mode === 'draft'/);
    expect(route).not.toMatch(/let systemPrompt = s\.system_prompt/);
    expect(route).not.toMatch(/callLLM\(s\.model/);
    expect(route).not.toMatch(/const draft = s\.mode/);
  });

  it('reads only the four sms_reply columns off the campaign row', () => {
    const sel = route.match(/\.select\('sms_reply_prompt[^']*'\)/)?.[0] ?? '';
    expect(sel.length).toBeGreaterThan(0);
    // \b on every one of these. Without it, 'sms_reply_mode' is satisfied by the
    // 'sms_reply_model' that sits next to it, so dropping the mode column from
    // the select would sail past a green test and every campaign would silently
    // inherit the workspace draft/auto switch.
    for (const col of ['sms_reply_prompt', 'sms_reply_mode', 'sms_reply_model', 'sms_reply_enabled']) {
      expect(sel.match(new RegExp(`${col}\\b`, 'g'))?.length, col).toBe(1);
    }
  });

  it('imports the merge with a .js extension, or the Vercel build breaks', () => {
    expect(route).toMatch(/from '\.\.\/lib\/campaign-reply-settings\.js'/);
  });

  it('does not bolt the reviews funnel paragraph onto a campaign prompt', () => {
    // The VSL block is the reviews pitch written out longhand, complete with the
    // £1 close. Appending it to Pedro's website prompt reintroduces the exact
    // bug this feature exists to stop.
    // The HeyPubli number skips it too: a creator has no video page, and one
    // who was texted one in an earlier life must not be sold a Google ranking.
    expect(route).toMatch(/cfg\.source === 'campaign' \|\| heypubli\s*\?\s*\{ data: null \}/);
  });
});

describe('regression guards on the reply route', () => {
  it('still tells the model the real callback number', () => {
    // tests/ai-reply-reviews.test.ts pins this too. The [number] placeholder
    // reached a live draft on 2026-07-27.
    expect(route).toMatch(/replyFrom/);
    // Widened for the HeyPubli-number clause, which sits ahead of this one in
    // the same append (that line has no phone, so it forbids the ask instead).
    expect(route).toMatch(/systemPrompt \+=[\s\S]{0,600}\$\{replyFrom\}/);
  });

  it('still greets the OWNER, not the first word of the company name', () => {
    expect(route).toMatch(/ownerName \|\| \(c\.name \|\| ''\)/);
    expect(route).toMatch(/custom_fields/);
  });

  it('keeps the safety rails global: hours, caps, handoff, human takeover', () => {
    expect(route).toMatch(/withinHours\(s\.hours_start, s\.hours_end, s\.days, s\.timezone\)/);
    expect(route).toMatch(/s\.max_replies_per_contact/);
    expect(route).toMatch(/s\.handoff_keywords/);
    expect(route).toMatch(/s\.auto_off_on_human_reply/);
  });
});

describe('a failed campaign lookup never silently uses the global pitch', () => {
  // The .rpc() and the wk_campaign_ai_settings select both used to destructure
  // { data } only. A stale PostgREST schema cache (which is what a migration
  // adding columns produces), a transient 5xx or a grant change all yield
  // data = null with no log, and null means "no campaign", which means the
  // GLOBAL REVIEWS PROMPT answers a website lead. Same class as the VSL beacon
  // insert that never read its error and was broken silently since launch.
  const errorReads = [
    ['campaign resolver', /const \{ data: campaignId, error: campaignErr \} = await supabase\.rpc\('wk_sms_reply_campaign'/, /if \(campaignErr\)/, 'campaign_lookup_failed'],
    ['campaign settings', /const \{ data: ov, error: ovErr \}/, /if \(ovErr\)/, 'campaign_settings_failed'],
    ['campaign is_active', /const \{ data: camp, error: campErr \}/, /if \(campErr\)/, 'campaign_state_failed'],
  ] as const;

  for (const [what, destructure, guard, code] of errorReads) {
    it(`reads the error off the ${what} read`, () => {
      expect(route).toMatch(destructure);
      expect(route).toMatch(guard);
    });

    it(`logs loudly and fails the job on a ${what} error`, () => {
      expect(route).toMatch(new RegExp(`return json\\(503, \\{ error: '${code}'`));
    });
  }

  it('logs every one of them with console.error, not console.log', () => {
    // Four since 2026-08-03: the three campaign reads plus the HeyPubli number
    // prompt read, which fails the same way for the same reason. A silent
    // fallback there drafts the reviews pitch at a creator.
    expect((route.match(/console\.error\('\[ai-reply\]/g) ?? []).length).toBe(4);
  });

  it('fails BEFORE anything is generated, drafted or sent', () => {
    // Nothing is written at that point, so the worker retrying (5 attempts,
    // then dead with last_error) cannot double-text a lead.
    const iErr = route.lastIndexOf("json(503, { error: 'campaign_state_failed'");
    expect(iErr).toBeGreaterThan(0);
    expect(iErr).toBeLessThan(route.indexOf('await callLLM('));
    expect(iErr).toBeLessThan(route.indexOf('sendSMS(fromNumber'));
  });
});

describe('the stand-down guards run before the campaign gate', () => {
  // With the campaign_disabled early return first, a lead inside a switched-off
  // or paused campaign who answered "stop" or "call me" was never flagged, and
  // switching that campaign back on resumed AI replies to someone who had asked
  // for a human.
  const iHistory = route.indexOf("from('wk_sms_messages')");
  const iHuman = route.indexOf("skipped: 'human_replied'");
  const iHandoff = route.indexOf("skipped: 'handoff_keyword'");
  const iResolve = route.indexOf("supabase.rpc('wk_sms_reply_campaign'");
  const iGate = route.indexOf('if (!cfg.enabled)');

  it('found every landmark', () => {
    for (const i of [iHistory, iHuman, iHandoff, iResolve, iGate]) expect(i).toBeGreaterThan(0);
  });

  it('reads the history, then both guards, then resolves the campaign', () => {
    expect(iHistory).toBeLessThan(iHuman);
    expect(iHuman).toBeLessThan(iHandoff);
    expect(iHandoff).toBeLessThan(iResolve);
    expect(iResolve).toBeLessThan(iGate);
  });

  it('still switches the contact off in both guards', () => {
    const guards = route.slice(iHistory, iResolve);
    expect((guards.match(/ai_enabled: false/g) ?? []).length).toBe(2);
  });

  it('separates a paused campaign from a hand-switched-off one in the log', () => {
    expect(route).toMatch(/skipped: campaignActive === false \? 'campaign_paused' : 'campaign_disabled'/);
  });

  it('passes the campaign is_active flag into the merge', () => {
    expect(route).toMatch(/campaignActive,\s*\n\s*\);/);
    expect(route).toMatch(/\.from\('wk_dialer_campaigns'\)\s*\n\s*\.select\('is_active'\)/);
  });
});

describe('the fix migration', () => {
  it('a paused campaign still resolves', () => {
    // The join filter was the bug: "and dc.is_active" made a paused campaign
    // return NULL, and NULL falls back to the global reviews prompt.
    const fn = fixes.split('create or replace function wk_sms_reply_campaign')[1]?.split('$fn$;')[0] ?? '';
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).toMatch(/join wk_dialer_campaigns dc on dc\.id = q\.campaign_id\s*\n/);
    expect(fn).not.toMatch(/on dc\.id = q\.campaign_id and dc\.is_active/i);
    expect(fn).not.toMatch(/where[\s\S]*dc\.is_active\s*(and|\n\s*order)/i);
  });

  it('prefers a running campaign over a paused one when a lead is in both', () => {
    const fn = fixes.split('create or replace function wk_sms_reply_campaign')[1]?.split('$fn$;')[0] ?? '';
    expect(fn).toMatch(/dc\.is_active desc,\s*\n\s*q\.created_at desc/);
  });

  it('keeps the resolver out of security definer', () => {
    const fn = fixes.split('create or replace function wk_sms_reply_campaign')[1]?.split('$fn$;')[0] ?? '';
    expect(fn).not.toMatch(/security definer/i);
  });

  it('revokes execute from anon BY NAME, not just from public', () => {
    // "revoke from public" does not touch a privilege held by a named role, and
    // Supabase ALTER DEFAULT PRIVILEGES hands anon EXECUTE on every new public
    // function. Live ACL after the first migration still read anon=X.
    expect(fixes).toMatch(/revoke all on function wk_sms_reply_campaign\(uuid, text\) from public;/i);
    expect(fixes).toMatch(/revoke all on function wk_sms_reply_campaign\(uuid, text\) from anon;/i);
    expect(fixes).toMatch(/grant execute on function wk_sms_reply_campaign\(uuid, text\) to authenticated, service_role;/i);
  });

  it('touches only the campaign that caused this, and never the global row', () => {
    expect(fixes).toMatch(/where dc\.name = 'Plumbers - Maria'/);
    expect(fixes).not.toMatch(/update wk_ai_reply_settings/i);
    expect(fixes).not.toMatch(/drop (table|column)/i);
  });

  it('is idempotent: re-applying writes nothing when the text already matches', () => {
    expect(fixes).toMatch(/on conflict \(campaign_id\) do update/i);
    expect(fixes).toMatch(/is distinct from excluded\.sms_reply_prompt/i);
  });

  it('leaves the mode alone, and never sets auto', () => {
    const seed = fixes.split('insert into wk_campaign_ai_settings')[1] ?? '';
    expect(seed).not.toMatch(/sms_reply_mode\s*=\s*excluded/i);
    expect(seed).not.toMatch(/'auto'/);
  });
});

describe('the re-seeded prompt answers "I already have a website"', () => {
  // 1 of the 6 real replies. SJC Plumbing (Ghusuddin Jalali) answered
  // "Look again" because he DOES have a site, sjcplumbingheatingandgas.co.uk.
  // It is simply not linked on his Google listing. The old prompt forbade the
  // honest answer and gave the model no branch, so it could only waffle.
  const prompt = fixes.split('$prompt$')[1] ?? '';

  it('was found at all', () => {
    expect(prompt.length).toBeGreaterThan(2000);
  });

  it('has an explicit branch for it, including "look again"', () => {
    expect(prompt).toMatch(/If they say they already have a website/);
    expect(prompt).toMatch(/tell you to look again/i);
  });

  it('accepts it plainly and apologises for the assumption', () => {
    const branch = prompt.split('If they say they already have a website')[1]?.split('\n\n')[0] ?? '';
    expect(branch).toMatch(/they are right and you were wrong/i);
    expect(branch).toMatch(/apologise briefly for assuming/i);
  });

  it('does not argue, does not ask for proof, does not pitch', () => {
    const branch = prompt.split('If they say they already have a website')[1]?.split('\n\n')[0] ?? '';
    expect(branch).toMatch(/Never argue/i);
    expect(branch).toMatch(/never ask for the address/i);
    expect(branch).toMatch(/Do not pitch/i);
    expect(branch).toMatch(/do not offer to build another one/i);
  });

  it('never claims their Google listing is wrong', () => {
    const branch = prompt.split('If they say they already have a website')[1]?.split('\n\n')[0] ?? '';
    expect(branch).toMatch(/Never tell them their Google listing is wrong/i);
  });

  it('resolves the contradiction with the stay-in-character rule', () => {
    // "Never say the website was a mistake" and "apologise for assuming" are
    // opposites unless the prompt says which one wins.
    expect(prompt).toMatch(/The one exception is the branch below for someone who already has a website/);
  });

  it('keeps every branch the first seed already had', () => {
    expect(prompt).toMatch(/You are Pedro/);
    expect(prompt).toMatch(/Never say you are not Pedro/);
    expect(prompt).toMatch(/I built you one/);
    expect(prompt).toMatch(/being finished/i);
    expect(prompt).toMatch(/Do not send, invent, guess, spell out or describe a link/i);
    expect(prompt).toMatch(/There is no link yet/);
    expect(prompt).toMatch(/no Google reviews/i);
    expect(prompt).toMatch(/wrong number/i);
    expect(prompt).toMatch(/rude, hostile or swear/i);
    expect(prompt).toMatch(/apologise once/i);
    expect(prompt).toMatch(/bot, automated or an AI/i);
    expect(prompt).toMatch(/tell them the truth/i);
    expect(prompt).toMatch(/never deny it/i);
    expect(prompt).not.toMatch(/https?:\/\//);
    expect(prompt).not.toMatch(/£99|£179|£279/);
  });
});

describe('the migration', () => {
  it('adds all four columns to the table that already has the cascade', () => {
    expect(mig).toMatch(/alter table wk_campaign_ai_settings/i);
    for (const col of ['sms_reply_prompt', 'sms_reply_mode', 'sms_reply_model', 'sms_reply_enabled']) {
      // \b: sms_reply_mode is a prefix of sms_reply_model.
      expect(mig, col).toMatch(new RegExp(`add column if not exists\\s+${col}\\b`, 'i'));
    }
  });

  it('constrains mode to draft or auto', () => {
    expect(mig).toMatch(/check \(sms_reply_mode is null or sms_reply_mode in \('draft', 'auto'\)\)/i);
  });

  it('declares the resolver and keeps it OUT of security definer', () => {
    // It reads every agent's dialer queue. The only caller is the reply route on
    // the service-role key, which bypasses RLS anyway, so DEFINER would hand
    // authenticated users that read for nothing. Same lesson as wk_vsl_advance.
    expect(mig).toMatch(/create or replace function wk_sms_reply_campaign\(p_contact uuid, p_number text\)/i);
    const fn = mig.split('create or replace function wk_sms_reply_campaign')[1]?.split('$fn$;')[0] ?? '';
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).not.toMatch(/security definer/i);
    expect(mig).toMatch(/revoke all on function wk_sms_reply_campaign\(uuid, text\) from public/i);
  });

  it('resolves through wk_dialer_queue, ranked by number then agent then recency', () => {
    const fn = mig.split('create or replace function wk_sms_reply_campaign')[1]?.split('$fn$;')[0] ?? '';
    expect(fn).toMatch(/from wk_dialer_queue q/i);
    expect(fn).toMatch(/wk_campaign_numbers/i);
    expect(fn).toMatch(/wk_campaign_agents/i);
    expect(fn).toMatch(/order by[\s\S]*q\.created_at desc/i);
    expect(fn).toMatch(/dc\.is_active/i);
  });

  it('carries the four columns through campaign duplication', () => {
    // wk_duplicate_campaign lists columns explicitly. Add a column without
    // touching it and every duplicated campaign silently loses its prompt.
    const dup = mig.split('create or replace function wk_duplicate_campaign')[1] ?? '';
    expect(dup).toMatch(/INSERT INTO wk_campaign_ai_settings/);
    const insert = dup.split('INSERT INTO wk_campaign_ai_settings')[1]?.split('INSERT INTO wk_campaign_facts')[0] ?? '';
    for (const col of ['sms_reply_prompt', 'sms_reply_mode', 'sms_reply_model', 'sms_reply_enabled']) {
      // once in the column list, once in the select list. \b matters:
      // sms_reply_mode is a prefix of sms_reply_model.
      expect(insert.match(new RegExp(`${col}\\b`, 'g'))?.length, col).toBe(2);
    }
  });

  it('seeds nothing except the campaign that caused this', () => {
    expect(mig).toMatch(/where dc\.name = 'Plumbers - Maria'/);
    expect(mig).not.toMatch(/update wk_ai_reply_settings/i);
  });
});

describe("the seeded prompt matches the opener that actually went out", () => {
  const prompt = mig.split('$prompt$')[1] ?? '';

  it('was found at all', () => {
    expect(prompt.length).toBeGreaterThan(800);
  });

  it('stays Pedro and never denies him', () => {
    expect(prompt).toMatch(/You are Pedro/);
    expect(prompt).toMatch(/Never say you are not Pedro/);
    expect(prompt).toMatch(/I built you one/);
  });

  it('does not promise a link that does not exist', () => {
    expect(prompt).toMatch(/being finished/i);
    expect(prompt).toMatch(/Do not send, invent, guess, spell out or describe a link/i);
    expect(prompt).toMatch(/There is no link yet/);
    // and no literal URL for the model to copy
    expect(prompt).not.toMatch(/https?:\/\//);
  });

  it('does not switch to the reviews pitch mid conversation', () => {
    expect(prompt).toMatch(/no Google reviews/i);
    expect(prompt).not.toMatch(/£99|£179|£279/);
  });

  it('handles wrong number and hostility by apologising once and stopping', () => {
    expect(prompt).toMatch(/wrong number/i);
    expect(prompt).toMatch(/rude, hostile or swear/i);
    expect(prompt).toMatch(/apologise once/i);
  });

  it('is honest when asked whether it is automated', () => {
    expect(prompt).toMatch(/bot, automated or an AI/i);
    expect(prompt).toMatch(/tell them the truth/i);
    expect(prompt).toMatch(/never deny it/i);
  });

  it('stays on draft, because auto sending was never authorised', () => {
    expect(mig).toMatch(/'draft'/);
    expect(mig).not.toMatch(/sms_reply_mode\s*\)\s*[\s\S]{0,400}'auto'/);
  });
});

describe('no long dashes anywhere in this feature', () => {
  // Hugo, 2026-07-27: "no long dashes ever, we don't use." Not taste: one em
  // dash flips a text from GSM-7 (160 characters a segment) to UCS-2 (70). And
  // a model copies the punctuation it is shown, so a prompt containing one
  // teaches every reply to contain one.
  const BANNED = /[–—‘’“”…]/g;

  const files: Array<[string, string]> = [
    [MIGRATION, mig],
    [FIXES, fixes],
    ['api/lib/campaign-reply-settings.ts', lib],
    ['src/features/crm/hooks/useSmsReplySettings.ts', hook],
    // The whole reply route. Three em dashes lived in the VIDEO FUNNEL CONTEXT
    // strings, which are appended to the system prompt on the global path, so
    // the model was being shown the punctuation it must never produce. Every
    // reply it wrote with one in it cost an extra SMS segment.
    ['api/crm/ai-reply.ts', route],
    // Only the new tab. The rest of SettingsPage.tsx predates the rule.
    ['SettingsPage.tsx SmsReplyTab', settingsPage.split('function SmsReplyTab')[1]?.split('function AITab')[0] ?? ''],
    // Plus the badge these tabs render, which had one in a title attribute.
    ['SettingsPage.tsx ScopeBadge', settingsPage.split('function ScopeBadge')[1]?.split('// ChannelBadge')[0] ?? ''],
  ];

  for (const [name, body] of files) {
    it(`${name} is clean`, () => {
      expect(body.length).toBeGreaterThan(0);
      expect(body.match(BANNED) ?? [], `found: ${(body.match(BANNED) ?? []).join(' ')}`).toEqual([]);
    });
  }
});

describe('the admin editor', () => {
  it('is a campaign tab, behind the admin-only settings shell', () => {
    expect(settingsPage).toMatch(/id: 'replies', label: 'AI text replies'/);
    expect(settingsPage).toMatch(/validTab === 'replies' && <SmsReplyTab campaignId=\{campaignId\} \/>/);
  });

  it('saves ONLY the sms_reply columns', () => {
    // wk_campaign_ai_settings is shared with the coach editor. Upserting the
    // whole row from either side wipes the other feature's overrides on one
    // Save, which is the deepMerge bug in a different shape.
    const save = hook.split('const save = useCallback')[1]?.split('const resetField')[0] ?? '';
    expect(save).toMatch(/onConflict: 'campaign_id'/);
    expect(save).not.toMatch(/coach_style_prompt|coach_script_prompt|live_coach_model|postcall_model/);
  });

  it('treats an empty box as inherit, not as an empty prompt', () => {
    expect(hook).toMatch(/settings\.prompt\.trim\(\) \|\| null/);
  });

  it('shows the mode the workspace will actually allow, not the one that was clicked', () => {
    // A box reading "This campaign is on auto" while the workspace holds it on
    // draft is a lie the operator acts on.
    const tab = settingsPage.split('function SmsReplyTab')[1]?.split('function AITab')[0] ?? '';
    expect(tab).toMatch(/global\.mode === 'auto' && wantedMode === 'auto' \? 'auto' : 'draft'/);
    // JSX wraps the sentence across lines, so match across the whitespace.
    expect(tab).toMatch(/only be more careful\s+than the workspace, never less/);
    expect(tab).toMatch(/heldBackByWorkspace/);
    expect(hook).toMatch(/MORE cautious than the\s+(\/\/ )?workspace, never less/);
    expect(lib).toMatch(/MORE cautious than the\s+(\* )?workspace, never less/);
  });
});
