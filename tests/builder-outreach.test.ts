// The outreach engine's pure half, plus the pins that keep the risky parts
// honest: the invite text must pass the same validation the WhatsApp admin
// panel enforces (or Meta submission fails on day one), a blocked draft must
// never send, and the confirm press is the ONE road into 'Viewing booked'.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  OUTREACH_DEFAULTS, loadOutreachSettingsFrom, viewingTimeLabel,
  blockedReasonFor, belowDiscountRule, MIN_DISCOUNT_FOR_BUILDER,
  inviteVars, renderPreview, ukDay,
  INVITE_TEMPLATE_TEXT, MORNING_TEMPLATE_TEXT, VIEWING_BOOKED_COLUMN,
} from '../api/lib/builder-outreach.js';
import { templateProblem, extractTemplateVars, prefillTemplateVars } from '../src/features/crm/lib/waTemplates.js';

const SRC = readFileSync('api/lib/builder-outreach.ts', 'utf8');

describe('the invite template', () => {
  it('passes the same validation the WhatsApp admin panel enforces', () => {
    expect(templateProblem('builder_viewing_invite', INVITE_TEMPLATE_TEXT)).toBeNull();
  });
  it('uses vars 1..3 with no gaps and neither starts nor ends on a blank', () => {
    expect(extractTemplateVars(INVITE_TEMPLATE_TEXT)).toEqual(['1', '2', '3']);
    expect(/^\{\{/.test(INVITE_TEMPLATE_TEXT)).toBe(false);
    expect(/\}\}$/.test(INVITE_TEMPLATE_TEXT)).toBe(false);
  });
  it('renders the preview a human reads before approving', () => {
    // Hugo's own wording, 2026-08-20: "we need something simpler."
    const body = renderPreview(INVITE_TEMPLATE_TEXT, {
      '1': 'Pedro', '2': '12 High Street, Wigan', '3': 'Thursday 21 August at 2:30pm',
    });
    expect(body).toContain('this is Pedro');
    expect(body).toContain('give us a quote at 12 High Street, Wigan');
    expect(body).not.toContain('{{');
  });
});

describe('the 8am morning confirmation', () => {
  it('passes the same validation, and Meta will not take a trailing variable', () => {
    expect(templateProblem('builder_viewing_morning', MORNING_TEMPLATE_TEXT)).toBeNull();
    // The lesson from 20 Aug: a body ending on a blank was REJECTED by Meta
    // even with punctuation after it, so this one closes on a word.
    expect(MORNING_TEMPLATE_TEXT.trim().endsWith('.')).toBe(true);
    expect(/\{\{\d+\}\}\W*$/.test(MORNING_TEMPLATE_TEXT.trim())).toBe(false);
  });
  it('NEVER greets by name: the roster holds companies, not people', () => {
    // Hugo, 2026-08-20: "we cannot have the name". "Good morning MH Building &
    // Roofing Services Ltd" is a mail merge, not a message.
    expect(extractTemplateVars(MORNING_TEMPLATE_TEXT)).toEqual(['1']);
    expect(MORNING_TEMPLATE_TEXT).toContain('Good morning, just want to confirm');
    const body = renderPreview(MORNING_TEMPLATE_TEXT, { '1': 'Oundle Road' });
    expect(body).toBe('Good morning, just want to confirm we are still good for the viewing today at Oundle Road. Thanks.');
  });
  it('the day is UK wall time, so a late-evening viewing is not tomorrow', () => {
    // 23:30 UTC on 20 Aug is 00:30 on the 21st in London (BST).
    expect(ukDay(new Date('2026-08-20T23:30:00Z'))).toBe('2026-08-21');
    expect(ukDay(new Date('2026-08-20T09:00:00Z'))).toBe('2026-08-20');
  });
  it('stamps before sending, so a lost response cannot double-text at 8:05', () => {
    const stampAt = SRC.indexOf('morning_sent_at: new Date().toISOString()');
    const sendAt = SRC.indexOf('ContentSid: sid');
    expect(stampAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(stampAt);
  });
});

describe('viewingTimeLabel', () => {
  it('formats UK wall time, never the server timezone', () => {
    // 13:30 UTC in August is 14:30 in London (BST).
    expect(viewingTimeLabel('2026-08-20T13:30:00Z')).toBe('Thursday 20 August at 2:30pm');
  });
  it('an unparseable time renders empty rather than "Invalid Date" to a builder', () => {
    expect(viewingTimeLabel('not a date')).toBe('');
  });
});

describe('blockedReasonFor', () => {
  const settings = { ...OUTREACH_DEFAULTS, invite_sid: `HX${'0'.repeat(32)}` };
  // A priced deal well clear of the rule, so these cases test the thing they
  // are named after rather than tripping the discount gate below.
  const priced = { offer: { open: 61_000, max: 68_400 }, reprice: { gdv: 140_000 } };
  const prop = {
    id: 'p1', address: '12 High St, Wigan WN1 1AA',
    viewing_at: '2026-08-20T13:30:00Z', asking_price: 95_000, deal: priced,
  };
  it('no viewing time blocks the draft, in words the panel shows verbatim', () => {
    expect(blockedReasonFor({ ...prop, viewing_at: null }, settings)).toBe('no_viewing_time');
    expect(blockedReasonFor({ ...prop, viewing_at: '' }, settings)).toBe('no_viewing_time');
  });
  it('a missing or malformed template sid blocks the draft', () => {
    expect(blockedReasonFor(prop, { ...settings, invite_sid: '' })).toBe('template_pending');
    expect(blockedReasonFor(prop, { ...settings, invite_sid: 'not-a-sid' })).toBe('template_pending');
  });
  it('both present means the draft may send', () => {
    expect(blockedReasonFor(prop, settings)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// THE FLOOR GATE
// ---------------------------------------------------------------------------
//
// Hugo, 2026-08-20: "Nothing today refuses to send a builder to a house whose
// known floor is above our ceiling." The fact was captured on call one, filled
// in from the transcript, and printed on the ballpark screen. Nothing read it.
describe('the vendor floor gate on a builder draft', () => {
  const settings = { ...OUTREACH_DEFAULTS, invite_sid: `HX${'0'.repeat(32)}` };
  const prop = {
    id: 'p1', address: '12 High St, Wigan WN1 1AA',
    viewing_at: '2026-08-20T13:30:00Z', asking_price: 95_000,
  };
  const ceiling68 = { offer: { open: 61_000, max: 68_400 }, reprice: { gdv: 140_000 } };

  it('refuses the draft when the vendor has already turned down more than our ceiling', () => {
    expect(blockedReasonFor(
      { ...prop, deal: ceiling68, qualification: { rejected_offer: '72000' } },
      settings,
    )).toBe('floor_above_ceiling');
  });

  it('refuses at the ceiling too: our maximum cannot beat a refusal of our maximum', () => {
    expect(blockedReasonFor(
      { ...prop, deal: ceiling68, qualification: { rejected_offer: '68400' } },
      settings,
    )).toBe('floor_above_ceiling');
  });

  it('a refusal BELOW our ceiling is a deal, not a block', () => {
    expect(blockedReasonFor(
      { ...prop, deal: ceiling68, qualification: { rejected_offer: '64000' } },
      settings,
    )).toBeNull();
  });

  it('the floor is checked before the waits: it is the one reason that never clears itself', () => {
    expect(blockedReasonFor(
      { ...prop, viewing_at: null, deal: ceiling68, qualification: { rejected_offer: '72000' } },
      settings,
    )).toBe('floor_above_ceiling');
  });

  it('no rejected offer is a PASS: most houses have never had one', () => {
    expect(blockedReasonFor({ ...prop, deal: ceiling68 }, settings)).toBeNull();
    expect(blockedReasonFor({ ...prop, deal: ceiling68, qualification: {} }, settings)).toBeNull();
    expect(blockedReasonFor(
      { ...prop, deal: ceiling68, qualification: { rejected_offer: 'nothing turned down' } },
      settings,
    )).toBeNull();
  });

  it('no ceiling on file is a PASS: there is nothing to compare a floor against', () => {
    // The FLOOR gate has nothing to say here and must stay quiet. It does not
    // follow that the draft may send: since 2026-08-20 a house with no priced
    // offer is refused by its own reason, which is the honest one. Asserting
    // "not blocked by the floor" is what this test has always meant.
    expect(blockedReasonFor(
      { ...prop, deal: {}, qualification: { rejected_offer: '72000' } },
      settings,
    )).not.toBe('floor_above_ceiling');
  });

  it("Hugo's written maximum in the pinned note outranks the engine's ceiling, both ways", () => {
    // He has ruled we may go to 75,000, so a refusal of 72,000 is workable.
    expect(blockedReasonFor(
      {
        ...prop, deal: ceiling68, qualification: { rejected_offer: '72000' },
        pinned_note: 'Roof is the whole story. Never past 75,000.',
      },
      settings,
    )).toBeNull();
    // And a ruling BELOW the engine's band blocks what the engine would allow.
    expect(blockedReasonFor(
      {
        ...prop, deal: ceiling68, qualification: { rejected_offer: '64000' },
        pinned_note: 'max 62,000 on this one, the street is soft.',
      },
      settings,
    )).toBe('floor_above_ceiling');
  });
});

describe('every road onto a house passes the same gate', () => {
  // Three ways a builder gets spent: the invite send, the panel's hand-pick,
  // and the cockpit's book_builder press. A gate on one of them is a gate on
  // none of them.
  it('the send path re-reads the floor rather than trusting a five-minute-old row', () => {
    const floorAt = SRC.indexOf('const floorRefusal = await floorRefusalFor(sb, r.property_id)');
    const twilioAt = SRC.indexOf('api.twilio.com/2010-04-01');
    expect(floorAt).toBeGreaterThan(-1);
    expect(twilioAt).toBeGreaterThan(floorAt);
  });
  it('confirm checks BEFORE it flips the status, so a refusal leaves the row alone', () => {
    const checkAt = SRC.indexOf('const floorRefusal = await floorRefusalFor(sb, r.property_id)');
    const flipAt = SRC.indexOf("status: 'confirmed', confirmed_at");
    expect(checkAt).toBeGreaterThan(-1);
    expect(flipAt).toBeGreaterThan(checkAt);
  });
  it('the hand-picked assign is gated before anything is written', () => {
    const assignAt = SRC.indexOf('export async function assignBuilderToProperty');
    const gateAt = SRC.indexOf('floorRefusalFor(sb, propertyId)');
    const writeAt = SRC.indexOf('assigned_builder_id: r.builder_id');
    expect(gateAt).toBeGreaterThan(assignAt);
    expect(writeAt).toBeGreaterThan(gateAt);
  });
  it("the cockpit's book_builder press is gated too", () => {
    const cockpit = readFileSync('api/crm/cockpit-action.ts', 'utf8');
    const caseAt = cockpit.indexOf("case 'book_builder'");
    const gateAt = cockpit.indexOf('floorRefusalFor(supabase, state.propertyId)');
    const writeAt = cockpit.indexOf('assigned_builder_id: body.builderId');
    expect(gateAt).toBeGreaterThan(caseAt);
    expect(writeAt).toBeGreaterThan(gateAt);
  });
  it('the sweep selects the columns the gate needs, or it could never fire', () => {
    const cron = readFileSync('api/cron/builder-outreach.ts', 'utf8');
    // Anchored on brrr_properties rather than the exact column order, which
    // changed on 2026-08-21 when source_property_id was added so the sweep can
    // look up the measured discount a discovery house carries instead of a
    // valuation it does not have.
    const select = cron.match(/\.select\('id, source_property_id, address, viewing_at[^']*'\)/)?.[0] ?? '';
    for (const col of ['deal', 'qualification', 'pinned_note', 'asking_price', 'source_property_id']) {
      expect(select, col).toContain(col);
    }
    // And it must actually read the discount, or every discovery house is
    // refused for want of proof it already has.
    expect(cron).toContain('wk_raw_leads');
    expect(cron).toContain('discount');
  });
});

describe('settings', () => {
  it('defaults are manual-first with a daily cap: the auto/manual gate is a flag, not a fork', () => {
    expect(OUTREACH_DEFAULTS.auto_send).toBe(false);
    expect(OUTREACH_DEFAULTS.daily_cap).toBeGreaterThan(0);
  });
  it('bad JSON in platform_settings falls back to the defaults', () => {
    expect(loadOutreachSettingsFrom('not json')).toEqual(OUTREACH_DEFAULTS);
    expect(loadOutreachSettingsFrom('{"auto_send":true}').auto_send).toBe(true);
  });
});

describe('inviteVars', () => {
  it('fills sender, address and UK-time viewing slot', () => {
    const vars = inviteVars({ id: 'p1', address: ' 12 High St ', viewing_at: '2026-08-20T13:30:00Z' });
    expect(vars['2']).toBe('12 High St');
    expect(vars['3']).toBe('Thursday 20 August at 2:30pm');
  });
});

describe('pins on the send and confirm paths', () => {
  it('a blocked draft can never reach Twilio', () => {
    // sendOutreachRow refuses on blocked_reason before any network call.
    expect(SRC).toMatch(/if \(r\.blocked_reason\) return/);
  });
  it('template approval is verified with a synchronous GET before spending', () => {
    expect(SRC).toContain('/ApprovalRequests');
    expect(SRC).toMatch(/waStatus !== 'approved'/);
  });
  it('the message row goes in BEFORE the wire call, the ai-reply double-send rule', () => {
    const insertAt = SRC.indexOf("status: 'sending'");
    const twilioAt = SRC.indexOf('api.twilio.com/2010-04-01');
    expect(insertAt).toBeGreaterThan(-1);
    expect(twilioAt).toBeGreaterThan(insertAt);
  });
  it('the do-not-text tag blocks a builder send like every other send path', () => {
    expect(SRC).toContain("'do-not-text'");
  });
  it('confirm moves the branch card into Viewing booked, on its own board only', () => {
    expect(VIEWING_BOOKED_COLUMN).toBe('Viewing booked');
    expect(SRC).toContain("pipelineId ? q.eq('pipeline_id', pipelineId) : q");
    expect(SRC).toContain("stage_move_source: 'agent'");
  });
  it('only UK mobiles are drafted: WhatsApp cannot reach a landline', () => {
    expect(SRC).toMatch(/isUkMobile/);
  });
});

describe('sending a template by hand when the 24h window is shut', () => {
  it('fills the blanks from the thread, so nobody retypes an address', () => {
    // Hugo, 2026-08-20: by Friday the builder has not written in 24 hours, so
    // the approved template IS the message and the picker has to arrive
    // filled in. Meaning comes from the words before the blank, because a
    // Meta template numbers its variables and names nothing.
    const vars = prefillTemplateVars(MORNING_TEMPLATE_TEXT, {
      person: 'Dave', address: 'Oundle Road, Birmingham', viewingTime: 'Friday at 2:00pm', sender: 'Pedro',
    });
    expect(vars).toEqual({ '1': 'Oundle Road, Birmingham' });
  });

  it('reads all three roles out of the invite template', () => {
    const vars = prefillTemplateVars(INVITE_TEMPLATE_TEXT, {
      person: 'Dave', address: '12 High St', viewingTime: 'Friday at 2:00pm', sender: 'Pedro',
    });
    expect(vars).toEqual({ '1': 'Pedro', '2': '12 High St', '3': 'Friday at 2:00pm' });
  });

  it('leaves an unrecognised blank EMPTY rather than guessing', () => {
    // A blank box is a question. A wrong address is a builder at the wrong
    // house, so nothing is invented to fill a gap.
    const vars = prefillTemplateVars('Your reference is {{1}} and the code is {{2}}.', {
      person: 'Dave', address: '12 High St',
    });
    expect(vars['2']).toBe('');
  });

  it('keeps the old behaviour for templates that predate the rule', () => {
    // {{1}} with no lead-in is still the person being written to.
    expect(prefillTemplateVars('Hi {{1}}, quick question about your listing.', { person: 'Dave' }))
      .toEqual({ '1': 'Dave' });
  });
});


// ---------------------------------------------------------------------------
// THE DISCOUNT GATE. The last thing before somebody else's afternoon is spent.
// ---------------------------------------------------------------------------
//
// Hugo, 2026-08-20: "we are booking viewings and wasting people's time and this
// needs to stop now."
//
// Wootton Street, Bedworth is the case. Pedro spent twenty minutes on the phone
// and the branch agreed to arrange a builder, on a house asking GBP 140,000
// that its own road values at about GBP 148,000. That is 5.3 percent. The card
// said 21.2 percent because it was written before the road evidence existed,
// and every gate between the card and the builder was about the vendor's floor,
// the viewing time and the Meta template. None of them asked whether the house
// was still a deal.
describe('the discount gate on a builder draft', () => {
  const settings = { ...OUTREACH_DEFAULTS, invite_sid: `HX${'0'.repeat(32)}` };
  const base = {
    id: 'p1', address: 'Wootton Street, Bedworth CV12 9DX',
    viewing_at: '2026-08-21T13:00:00Z',
  };

  it('refuses Wootton Street: 5.3 percent under is not a deal', () => {
    expect(blockedReasonFor({
      ...base, asking_price: 140_000,
      deal: { offer: { open: 100_000, max: 118_000 }, reprice: { gdv: 147_818 } },
    }, settings)).toBe('below_discount_rule');
  });

  it('refuses just under the line, wherever the line currently is', () => {
    // Built from MIN_DISCOUNT_FOR_BUILDER rather than a hardcoded 20 or 15, so
    // the case keeps testing the boundary through a floor change instead of
    // silently becoming a test of the middle of the range. The floor moved
    // 0.20 -> 0.15 on 2026-08-21 and this is the assertion that had to be
    // rewritten rather than renumbered.
    const asking = 160_000;
    const justUnder = asking / (1 - (MIN_DISCOUNT_FOR_BUILDER - 0.01));
    expect(blockedReasonFor({
      ...base, asking_price: asking,
      deal: { offer: { open: 100_000, max: 118_000 }, reprice: { gdv: justUnder } },
    }, settings)).toBe('below_discount_rule');
  });

  it('lets one through that is exactly ON the line', () => {
    const asking = 160_000;
    const onTheLine = asking / (1 - MIN_DISCOUNT_FOR_BUILDER);
    expect(blockedReasonFor({
      ...base, asking_price: asking,
      deal: { offer: { open: 100_000, max: 118_000 }, reprice: { gdv: onTheLine } },
    }, settings)).toBeNull();
  });

  it('lets a real one through', () => {
    expect(blockedReasonFor({
      ...base, asking_price: 190_000,
      deal: { offer: { open: 128_802, max: 145_572 }, reprice: { gdv: 276_111 } },
    }, settings)).toBeNull();
  });

  it('a DISCOVERY house passes on its measured discount alone', () => {
    // The fault this replaced, found hours after I wrote it. Call one books the
    // builder and deliberately fetches no ballpark (Hugo, 20 Aug), so
    // brrr_properties.deal is {} on exactly the houses that now reach a builder
    // first. Demanding a priced OFFER blocked every one of them forever:
    // Oxford Gardens (27%) and Stevenson Avenue (20%) both sat refused.
    expect(blockedReasonFor({
      ...base, asking_price: 190_000, deal: {}, discount: 0.27,
    }, settings)).toBeNull();
  });

  it('and a discovery house UNDER the floor is still refused on that discount', () => {
    expect(blockedReasonFor({
      ...base, asking_price: 140_000, deal: {}, discount: 0.053,
    }, settings)).toBe('below_discount_rule');
  });

  it('nothing at all is a refusal: no valuation and no discount', () => {
    // An asking price on its own proves nothing. This is the shape the nine
    // withdrawn bands left behind on 2026-08-20: a house we could not price.
    expect(blockedReasonFor({
      ...base, asking_price: 149_999, deal: {},
    }, settings)).toBe('not_proven_a_deal');
  });

  it('a VALUED house still passes on its valuation, as it always did', () => {
    expect(blockedReasonFor({
      ...base, asking_price: 149_999,
      deal: { offer: { open: 90_000, max: 105_000 }, reprice: { gdv: 214_984 } },
    }, settings)).toBeNull();
  });

  it('an UNVALUED house is not judged by the discount gate', () => {
    // "We have not priced it" is not the same as "it is a bad deal". It still
    // cannot send, but it must say the honest reason.
    expect(blockedReasonFor({ ...base, asking_price: 140_000 }, settings))
      .toBe('not_proven_a_deal');
    expect(belowDiscountRule({ ...base, asking_price: 140_000 })).toBe(false);
  });

  it('the floor still outranks it: a refused vendor is the older refusal', () => {
    expect(blockedReasonFor({
      ...base, asking_price: 140_000,
      deal: { offer: { open: 100_000, max: 118_000 }, reprice: { gdv: 147_818 } },
      qualification: { rejected_offer: '130000' },
    }, settings)).toBe('floor_above_ceiling');
  });
});
