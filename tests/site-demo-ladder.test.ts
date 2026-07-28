import { describe, it, expect } from 'vitest';
import {
  nextLadderStep,
  ladderCopy,
  LADDER_STAGES,
  type LadderPage,
  type LadderContext,
  type LadderStageKey,
  resolveLadderConfig,
  DEFAULT_LADDER_CONFIG,
} from '../src/core/site-demo/ladder';

const T0 = Date.parse('2026-07-28T09:00:00.000Z');
const at = (msOffset: number) => new Date(T0 + msOffset);
const HOUR = 3_600_000;
const MIN = 60_000;

const page = (over: Partial<LadderPage> = {}): LadderPage => ({
  state: 'sent',
  sent_at: new Date(T0).toISOString(),
  first_opened_at: null,
  first_engaged_at: null,
  checkout_sent_at: null,
  last_call_at: null,
  outbound_call_attempts: 0,
  chat_count: 0,
  call_count: 0,
  automation: {},
  ...over,
});

const ctx = (over: Partial<LadderContext> = {}): LadderContext => ({
  now: at(0),
  ownerFirst: 'Matthew',
  businessName: 'MJR Plumbing',
  url: 'https://heyelsie.com/s/mjr-plumbing',
  demoNumber: '07576 558278',
  ...over,
});

const fired = (...stages: LadderStageKey[]) =>
  Object.fromEntries(stages.map((s) => [s, { count: 1, last_at: new Date(T0).toISOString() }]));

describe('track A: the link was never opened', () => {
  it('waits two hours before the first nudge', () => {
    expect(nextLadderStep(page(), ctx({ now: at(HOUR) })).kind).toBe('none');
    const due = nextLadderStep(page(), ctx({ now: at(2 * HOUR) }));
    expect(due).toMatchObject({ kind: 'sms', stage: 'unopened_1' });
  });

  it('waits a full day before the second', () => {
    const p = page({ automation: fired('unopened_1') });
    expect(nextLadderStep(p, ctx({ now: at(12 * HOUR) })).kind).toBe('none');
    expect(nextLadderStep(p, ctx({ now: at(24 * HOUR) }))).toMatchObject({
      kind: 'sms',
      stage: 'unopened_2',
    });
  });

  // Two touches on someone who never even opened it. Chasing further is how a
  // cold outreach number gets reported.
  it('stops for good after two, and never escalates to a call', () => {
    const p = page({ automation: fired('unopened_1', 'unopened_2') });
    const r = nextLadderStep(p, ctx({ now: at(400 * HOUR) }));
    expect(r).toEqual({ kind: 'none', reason: 'unopened_exhausted' });
  });
});

describe('track B: opened, but no call and no chat', () => {
  const opened = (over: Partial<LadderPage> = {}) =>
    page({
      state: 'opened',
      first_opened_at: new Date(T0 + HOUR).toISOString(),
      automation: fired('unopened_1'),
      ...over,
    });

  // The highest value moment in the funnel: they are still looking at it.
  it('fires ten minutes after the open, not two hours', () => {
    expect(nextLadderStep(opened(), ctx({ now: at(HOUR + 9 * MIN) })).kind).toBe('none');
    expect(nextLadderStep(opened(), ctx({ now: at(HOUR + 10 * MIN) }))).toMatchObject({
      kind: 'sms',
      stage: 'engage_1',
    });
  });

  // The bug a single nudge counter would have caused: this lead was already
  // nudged twice while the link sat unopened.
  it('is not starved by nudges already spent on the unopened track', () => {
    const p = opened({ automation: fired('unopened_1', 'unopened_2') });
    expect(nextLadderStep(p, ctx({ now: at(HOUR + 10 * MIN) }))).toMatchObject({
      kind: 'sms',
      stage: 'engage_1',
    });
  });

  it('then reinforces after two hours', () => {
    const p = opened({ automation: fired('unopened_1', 'engage_1') });
    expect(nextLadderStep(p, ctx({ now: at(HOUR + 30 * MIN) })).kind).toBe('none');
    expect(nextLadderStep(p, ctx({ now: at(3 * HOUR) }))).toMatchObject({
      kind: 'sms',
      stage: 'engage_2',
    });
  });
});

describe('track C: we ring them', () => {
  const stalled = (over: Partial<LadderPage> = {}) =>
    page({
      state: 'opened',
      first_opened_at: new Date(T0).toISOString(),
      automation: fired('engage_1', 'engage_2'),
      ...over,
    });

  it('waits a day after the open before dialling', () => {
    expect(nextLadderStep(stalled(), ctx({ now: at(12 * HOUR) })).kind).toBe('none');
    expect(nextLadderStep(stalled(), ctx({ now: at(24 * HOUR) }))).toMatchObject({
      kind: 'call',
      stage: 'ai_call_1',
      attempt: 1,
    });
  });

  it('spaces the second call hours after the first', () => {
    const p = stalled({
      automation: fired('engage_1', 'engage_2', 'ai_call_1'),
      outbound_call_attempts: 1,
      last_call_at: new Date(T0 + 24 * HOUR).toISOString(),
    });
    expect(nextLadderStep(p, ctx({ now: at(26 * HOUR) })).kind).toBe('none');
    expect(nextLadderStep(p, ctx({ now: at(28 * HOUR) }))).toMatchObject({
      kind: 'call',
      stage: 'ai_call_2',
      attempt: 2,
    });
  });

  it('stops at the cap rather than calling forever', () => {
    const p = stalled({
      automation: fired('engage_1', 'engage_2', 'ai_call_1', 'ai_call_2'),
      outbound_call_attempts: 2,
      last_call_at: new Date(T0).toISOString(),
    });
    expect(nextLadderStep(p, ctx({ now: at(999 * HOUR) })).kind).toBe('none');
  });

  it('honours a lowered cap from settings immediately', () => {
    const p = stalled({ outbound_call_attempts: 1, automation: fired('engage_1', 'engage_2', 'ai_call_1') });
    expect(nextLadderStep(p, ctx({ now: at(99 * HOUR), config: { max_outbound_calls: 1 } }))).toEqual({
      kind: 'none',
      reason: 'calls_exhausted',
    });
  });

  it('never dials someone who never opened the link', () => {
    const p = page({ automation: fired('unopened_1', 'unopened_2', 'engage_1', 'engage_2') });
    expect(nextLadderStep(p, ctx({ now: at(999 * HOUR) })).kind).not.toBe('call');
  });
});

describe('the ladder stands down', () => {
  it('when the lead chatted', () => {
    const p = page({ state: 'opened', first_opened_at: new Date(T0).toISOString(), chat_count: 1 });
    expect(nextLadderStep(p, ctx({ now: at(99 * HOUR) }))).toEqual({ kind: 'none', reason: 'engaged' });
  });

  it('when the lead rang the number', () => {
    const p = page({ state: 'engaged', first_opened_at: new Date(T0).toISOString(), call_count: 1 });
    expect(nextLadderStep(p, ctx({ now: at(99 * HOUR) }))).toEqual({ kind: 'none', reason: 'engaged' });
  });

  // A reply means a human is in the conversation. The machine must not talk
  // over an agent mid-thread.
  it('when the lead texted us back', () => {
    const p = page();
    const replied = ctx({ now: at(99 * HOUR), lastInboundAt: new Date(T0 + HOUR).toISOString() });
    expect(nextLadderStep(p, replied)).toEqual({ kind: 'none', reason: 'lead_replied' });
  });

  it('but not for an inbound message from before we ever sent the link', () => {
    const p = page();
    const old = ctx({ now: at(3 * HOUR), lastInboundAt: new Date(T0 - 5 * HOUR).toISOString() });
    expect(nextLadderStep(p, old).kind).toBe('sms');
  });

  it('once a checkout link is in their hands', () => {
    expect(nextLadderStep(page({ state: 'checkout_sent' }), ctx({ now: at(99 * HOUR) }))).toEqual({
      kind: 'none',
      reason: 'checkout_sent',
    });
  });

  it('once they have paid', () => {
    expect(nextLadderStep(page({ state: 'converted' }), ctx({ now: at(99 * HOUR) }))).toEqual({
      kind: 'none',
      reason: 'converted',
    });
  });

  it('when the link was never actually sent', () => {
    expect(nextLadderStep(page({ sent_at: null, state: 'created' }), ctx())).toEqual({
      kind: 'none',
      reason: 'not_sent',
    });
  });
});

describe('one stage at a time, exactly once', () => {
  it('never returns the same stage twice once it is recorded', () => {
    const seen: string[] = [];
    let p = page();
    for (let i = 0; i < 12; i++) {
      // walk far enough forward that timing is never the blocker
      const r = nextLadderStep(p, ctx({ now: at(500 * HOUR) }));
      if (r.kind === 'none') break;
      seen.push(r.stage);
      p = { ...p, automation: { ...p.automation, [r.stage]: { count: 1 } } };
      if (r.kind === 'call') p = { ...p, outbound_call_attempts: p.outbound_call_attempts + 1 };
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.every((s) => LADDER_STAGES.includes(s as LadderStageKey))).toBe(true);
  });
});

describe('copy', () => {
  it('greets by first name when we have one', () => {
    expect(ladderCopy('unopened_1', ctx())).toContain('Hi Matthew,');
  });

  // wk_contacts.name is the COMPANY. Greeting a company by name reads as spam.
  it('drops the greeting cleanly when we only know the company', () => {
    const body = ladderCopy('unopened_1', ctx({ ownerFirst: null }));
    expect(body.startsWith('Hi, ')).toBe(true);
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('null');
  });

  it('puts the link in both unopened nudges and the number in both engage nudges', () => {
    const c = ctx();
    expect(ladderCopy('unopened_1', c)).toContain(c.url);
    expect(ladderCopy('unopened_2', c)).toContain(c.url);
    expect(ladderCopy('engage_1', c)).toContain(c.demoNumber);
    expect(ladderCopy('engage_2', c)).toContain(c.demoNumber);
  });
});

// The flow canvas edits platform_settings.site_demo_ladder. If these timings
// were hardcoded, changing them on the canvas would relabel a picture without
// changing what the system does.
describe('timings come from config, never from constants', () => {
  it('honours a shortened first nudge', () => {
    const fast = ctx({ now: at(30 * 60_000), config: { unopened_1_hours: 0.5 } });
    expect(nextLadderStep(page(), fast)).toMatchObject({ kind: 'sms', stage: 'unopened_1' });
    // and the default would still be waiting
    expect(nextLadderStep(page(), ctx({ now: at(30 * 60_000) })).kind).toBe('none');
  });

  it('honours a lengthened engage window', () => {
    const p = page({ state: 'opened', first_opened_at: new Date(T0).toISOString(), automation: fired('unopened_1') });
    const slow = ctx({ now: at(20 * 60_000), config: { engage_1_minutes: 60 } });
    expect(nextLadderStep(p, slow).kind).toBe('none');
    expect(nextLadderStep(p, ctx({ now: at(20 * 60_000) })).kind).toBe('sms');
  });

  it('honours a raised call cap from config', () => {
    const p = page({
      state: 'opened',
      first_opened_at: new Date(T0).toISOString(),
      automation: fired('engage_1', 'engage_2', 'ai_call_1'),
      outbound_call_attempts: 2,
      last_call_at: new Date(T0).toISOString(),
    });
    expect(nextLadderStep(p, ctx({ now: at(99 * HOUR), config: { max_outbound_calls: 3 } }))).toMatchObject({
      kind: 'call',
      stage: 'ai_call_2',
    });
  });

  it('falls back to the documented defaults when the key is absent', () => {
    const withNull = nextLadderStep(page(), ctx({ now: at(2 * HOUR), config: null }));
    const withNothing = nextLadderStep(page(), ctx({ now: at(2 * HOUR) }));
    expect(withNull).toEqual(withNothing);
    expect(withNull).toMatchObject({ kind: 'sms', stage: 'unopened_1' });
  });

  it('ignores rubbish in a saved config rather than breaking the cron', () => {
    const junk = { unopened_1_hours: -5, engage_1_minutes: NaN, max_outbound_calls: 'lots' };
    const r = nextLadderStep(page(), ctx({ now: at(2 * HOUR), config: junk as never }));
    expect(r).toMatchObject({ kind: 'sms', stage: 'unopened_1' });
  });
});

describe('resolveLadderConfig', () => {
  it('fills every gap so a partial save cannot break anything', () => {
    expect(resolveLadderConfig({ engage_1_minutes: 5 })).toEqual({
      ...DEFAULT_LADDER_CONFIG,
      engage_1_minutes: 5,
    });
    expect(resolveLadderConfig(null)).toEqual(DEFAULT_LADDER_CONFIG);
  });
});
