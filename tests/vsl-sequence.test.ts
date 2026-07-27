import { describe, it, expect } from 'vitest';
import {
  nextSequenceStep,
  funnelDepth,
  DEFAULT_VSL_RULES,
  VSL_SEQUENCE,
  SEQUENCE_BY_PRIORITY,
  SALES_RULE_KEYS,
  SEQUENCE_MAX_SALES_SENDS,
  SEQUENCE_MIN_GAP_HOURS,
  type SequencePage,
  type VslRuleKey,
} from '../api/lib/vsl-sequence';
import { nonGsm7 } from '../api/lib/sms-charset';

// Hugo's follow-up sequence, 2026-07-27. Fourteen messages plus the welcome,
// each with its own delay off its own anchor stamp.
//
// The three things that will break it if nobody watches:
//   1. several messages come due in the same minute and only one may send
//   2. a lead who replied, or paid, must never be nagged again
//   3. a message that mentions the tracking (or carries an emoji) ships

// Comfortably after SEQUENCE_EPOCH: every fixture below counts back from T, and
// anything landing before the epoch is (correctly) never enrolled at all.
const T = new Date('2026-08-10T12:00:00Z');
const now = T.getTime();
const ago = (ms: number) => new Date(now - ms).toISOString();
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const page = (over: Partial<SequencePage> = {}): SequencePage => ({
  sent_at: ago(5 * MIN),
  first_opened_at: null,
  play_at: null,
  watched_at: null,
  completed_at: null,
  cta_clicked_at: null,
  checkout_started_at: null,
  paid_at: null,
  watched_pct: 0,
  automation: {},
  ...over,
});

const ask = (p: SequencePage, over: Partial<Parameters<typeof nextSequenceStep>[1]> = {}) =>
  nextSequenceStep(p, { rules: DEFAULT_VSL_RULES, now: T, ...over });

/** A send already on the books, `whenAgo` ms ago. */
const booked = (entries: Array<[VslRuleKey, number]>) =>
  Object.fromEntries(entries.map(([k, whenAgo]) => [k, { count: 1, last_at: ago(whenAgo) }]));

describe('every step fires at the delay Hugo wrote', () => {
  // page state -> the key that must be due at exactly its delay.
  const CASES: Array<{ key: VslRuleKey; delay: number; p: SequencePage }> = [
    // A. sent, never opened: 2h / 24h / 72h off sent_at
    { key: 'sent_not_opened_2h', delay: 2 * HOUR, p: page({ sent_at: ago(2 * HOUR) }) },
    {
      key: 'sent_not_opened_24h', delay: 24 * HOUR,
      p: page({ sent_at: ago(24 * HOUR), automation: booked([['sent_not_opened_2h', 25 * HOUR]]) }),
    },
    {
      key: 'sent_not_opened_72h', delay: 72 * HOUR,
      p: page({
        sent_at: ago(72 * HOUR),
        automation: booked([['sent_not_opened_2h', 70 * HOUR], ['sent_not_opened_24h', 25 * HOUR]]),
      }),
    },
    // B. opened, never played: 2h / 24h off first_opened_at
    {
      key: 'opened_not_played_2h', delay: 2 * HOUR,
      p: page({ sent_at: ago(3 * HOUR), first_opened_at: ago(2 * HOUR) }),
    },
    {
      key: 'opened_not_played_24h', delay: 24 * HOUR,
      p: page({
        sent_at: ago(25 * HOUR), first_opened_at: ago(24 * HOUR),
        automation: booked([['opened_not_played_2h', 25 * HOUR]]),
      }),
    },
    // C. played, stopped under halfway: 4h off play_at
    {
      key: 'played_under_50_4h', delay: 4 * HOUR,
      p: page({ sent_at: ago(5 * HOUR), first_opened_at: ago(5 * HOUR), play_at: ago(4 * HOUR), watched_pct: 22 }),
    },
    // D. watched past halfway: 2h off watched_at
    {
      key: 'watched_50_2h', delay: 2 * HOUR,
      p: page({
        sent_at: ago(3 * HOUR), first_opened_at: ago(3 * HOUR), play_at: ago(3 * HOUR),
        watched_at: ago(2 * HOUR), watched_pct: 62,
      }),
    },
    // E. watched nearly all of it: 30m
    {
      key: 'watched_90_30m', delay: 30 * MIN,
      p: page({
        sent_at: ago(HOUR), first_opened_at: ago(HOUR), play_at: ago(HOUR),
        watched_at: ago(30 * MIN), watched_pct: 94,
      }),
    },
    // F. watched it all: 30m off completed_at
    {
      key: 'watched_100_30m', delay: 30 * MIN,
      p: page({
        sent_at: ago(HOUR), first_opened_at: ago(HOUR), play_at: ago(HOUR),
        watched_at: ago(31 * MIN), completed_at: ago(30 * MIN), watched_pct: 100,
      }),
    },
    // G. watched it all, still no trial: 24h off completed_at
    {
      key: 'watched_100_no_trial_24h', delay: 24 * HOUR,
      p: page({
        sent_at: ago(25 * HOUR), first_opened_at: ago(25 * HOUR), play_at: ago(25 * HOUR),
        watched_at: ago(24 * HOUR), completed_at: ago(24 * HOUR), watched_pct: 100,
        automation: booked([['watched_100_30m', 25 * HOUR]]),
      }),
    },
    // H. tapped the button, never reached checkout: 2h
    {
      key: 'cta_no_checkout_2h', delay: 2 * HOUR,
      p: page({
        sent_at: ago(3 * HOUR), first_opened_at: ago(3 * HOUR), play_at: ago(3 * HOUR),
        watched_at: ago(3 * HOUR), completed_at: ago(3 * HOUR), watched_pct: 100,
        cta_clicked_at: ago(2 * HOUR),
      }),
    },
    // I. checkout started, not paid: 30m / 24h
    {
      key: 'checkout_abandoned_30m', delay: 30 * MIN,
      p: page({
        sent_at: ago(HOUR), cta_clicked_at: ago(40 * MIN), checkout_started_at: ago(30 * MIN),
      }),
    },
    {
      key: 'checkout_abandoned_24h', delay: 24 * HOUR,
      p: page({
        sent_at: ago(25 * HOUR), cta_clicked_at: ago(25 * HOUR), checkout_started_at: ago(24 * HOUR),
        automation: booked([['checkout_abandoned_30m', 25 * HOUR]]),
      }),
    },
    // J. nothing at all for seven days: the goodbye
    {
      key: 'dormant_7d', delay: 7 * DAY,
      p: page({
        sent_at: ago(7 * DAY),
        automation: booked([
          ['sent_not_opened_2h', 7 * DAY], ['sent_not_opened_24h', 6 * DAY], ['sent_not_opened_72h', 4 * DAY],
        ]),
      }),
    },
    // K. the welcome, a minute after the money lands
    {
      key: 'paid_welcome', delay: MIN,
      p: page({
        sent_at: ago(2 * DAY), checkout_started_at: ago(2 * DAY), paid_at: ago(MIN),
      }),
    },
  ];

  for (const { key, delay, p } of CASES) {
    it(`${key} is due at its delay and not a minute before`, () => {
      expect(ask(p).due?.key).toBe(key);
      // Rewind the clock by a minute: the same page must not be due yet.
      const early = nextSequenceStep(p, {
        rules: DEFAULT_VSL_RULES,
        now: new Date(now - (delay > MIN ? MIN : 30_000)),
      });
      expect(early.due?.key ?? null).not.toBe(key);
    });
  }

  it('covers every rule in the sequence', () => {
    expect(CASES.map((c) => c.key).sort()).toEqual(Object.keys(DEFAULT_VSL_RULES).sort());
  });
});

describe('collisions are settled by funnel depth, not by declaration order', () => {
  // Hugo watched the whole thing three hours ago. Three messages are due at
  // once, and only one of them asks for the sale.
  const watcher = page({
    sent_at: ago(4 * HOUR), first_opened_at: ago(4 * HOUR), play_at: ago(4 * HOUR),
    watched_at: ago(3 * HOUR), completed_at: ago(3 * HOUR), watched_pct: 100,
  });

  it('a naive first-match really would send the wrong one', () => {
    // The trap is real, and worse than it looks. Conditions are triggers, not
    // exclusions ("has it happened?", never "is the lead further on?"), so a
    // loop over the table in declaration order matches the 2h "did you get my
    // video" message for someone who has just watched the whole thing. Four
    // messages hold for this page at once.
    const matched = VSL_SEQUENCE.filter((r) => !r.welcome && r.when(watcher)).map((r) => r.key);
    expect(matched[0]).toBe('dormant_7d');
    expect(matched).toContain('sent_not_opened_2h');
    expect(matched).toContain('watched_50_2h');
    expect(matched).toContain('watched_100_30m');
  });

  it('sends the message that carries the £1 link', () => {
    const v = ask(watcher);
    expect(v.due?.key).toBe('watched_100_30m');
    expect(v.due?.template).toContain('{url}');
  });

  it('never slides back to the shallower messages afterwards', () => {
    // Same lead a day later, with the 100% message already on the books.
    const later = page({
      ...watcher,
      automation: booked([['watched_100_30m', 25 * HOUR]]),
    });
    const v = nextSequenceStep(later, { rules: DEFAULT_VSL_RULES, now: new Date(now + 25 * HOUR) });
    expect(v.due?.key).toBe('watched_100_no_trial_24h');
    // Not "thanks for taking the time to watch" the day after "here is the link".
    expect(['watched_50_2h', 'watched_90_30m']).not.toContain(v.due?.key);
  });

  // Adversarial review, 2026-07-27. G was originally given the deeper slot
  // because Hugo's spec lists it later. Depth is PRIORITY, not chronology: with
  // G deeper, any pass where both were overdue sent G, raised the floor above F,
  // and F never fired again. F is the only message carrying {url} and the £1
  // ask, so the design meant to protect the money message was deleting it.
  it('sends the £1 link before the check-in when both are overdue', () => {
    const bothOverdue = page({
      ...watcher,
      sent_at: ago(4 * DAY), first_opened_at: ago(4 * DAY), play_at: ago(4 * DAY),
      watched_at: ago(4 * DAY), completed_at: ago(4 * DAY), watched_pct: 100,
    });
    const v = nextSequenceStep(bothOverdue, { rules: DEFAULT_VSL_RULES, now: new Date(now) });
    expect(v.due?.key).toBe('watched_100_30m');
    expect(v.due?.template).toContain('{url}');
  });

  it('orders the whole table J < A < B < C < D < E < G < F < H < I', () => {
    expect(VSL_SEQUENCE.filter((r) => !r.welcome).map((r) => r.key)).toEqual([
      'dormant_7d',
      'sent_not_opened_2h', 'sent_not_opened_24h', 'sent_not_opened_72h',
      'opened_not_played_2h', 'opened_not_played_24h',
      'played_under_50_4h',
      'watched_50_2h',
      'watched_90_30m',
      // Same depth, so the DECLARATION order breaks the tie: F is last, the
      // reversed priority list reaches it first, and the £1 link wins.
      'watched_100_no_trial_24h',
      'watched_100_30m',
      'cta_no_checkout_2h',
      'checkout_abandoned_30m', 'checkout_abandoned_24h',
    ]);
    const depths = VSL_SEQUENCE.filter((r) => !r.welcome).map((r) => r.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    // The evaluation order is the reverse, and that is what the engine reads.
    expect(SEQUENCE_BY_PRIORITY[0].key).toBe('checkout_abandoned_24h');
    expect(SEQUENCE_BY_PRIORITY[SEQUENCE_BY_PRIORITY.length - 1].key).toBe('dormant_7d');
  });

  it('reads a lead position from the stamps, not from the state column', () => {
    expect(funnelDepth(page())).toBe(1);
    expect(funnelDepth(page({ first_opened_at: ago(MIN) }))).toBe(2);
    expect(funnelDepth(page({ play_at: ago(MIN) }))).toBe(3);
    expect(funnelDepth(page({ watched_pct: 55 }))).toBe(4);
    expect(funnelDepth(page({ watched_pct: 92 }))).toBe(5);
    expect(funnelDepth(page({ completed_at: ago(MIN) }))).toBe(6);
    expect(funnelDepth(page({ cta_clicked_at: ago(MIN) }))).toBe(8);
    expect(funnelDepth(page({ checkout_started_at: ago(MIN) }))).toBe(9);
  });
});

describe('one text per lead per rolling 24 hours', () => {
  const p = page({
    sent_at: ago(26 * HOUR),
    automation: booked([['sent_not_opened_2h', HOUR]]),
  });

  it('holds a message that is otherwise due', () => {
    const v = ask(p);
    expect(v.due).toBeNull();
    expect(v.reason).toBe('cooldown');
  });

  it('says exactly when it will go instead', () => {
    const v = ask(p);
    expect(v.next?.key).toBe('sent_not_opened_24h');
    expect(new Date(v.next!.at).getTime()).toBe(now - HOUR + SEQUENCE_MIN_GAP_HOURS * HOUR);
  });

  it('lets it through once the day is up', () => {
    const v = nextSequenceStep(p, { rules: DEFAULT_VSL_RULES, now: new Date(now + 23 * HOUR) });
    expect(v.due?.key).toBe('sent_not_opened_24h');
  });

  it('reports the following message at the honest time, not at its own delay', () => {
    // 72h has already passed for this lead, so the next message's own rule says
    // "now", but the cap will hold it for a day after the one going out today.
    const stale = page({
      sent_at: ago(80 * HOUR),
      automation: booked([['sent_not_opened_2h', 40 * HOUR]]),
    });
    const v = ask(stale);
    expect(v.due?.key).toBe('sent_not_opened_24h');
    expect(v.next?.key).toBe('sent_not_opened_72h');
    expect(new Date(v.next!.at).getTime()).toBe(now + SEQUENCE_MIN_GAP_HOURS * HOUR);
  });

  it('does not hold the welcome, which is a receipt and not a follow-up', () => {
    const paid = page({
      sent_at: ago(2 * DAY), checkout_started_at: ago(HOUR), paid_at: ago(2 * MIN),
      automation: booked([['checkout_abandoned_30m', 10 * MIN]]),
    });
    expect(ask(paid).due?.key).toBe('paid_welcome');
  });
});

describe('the caps and the stops', () => {
  it('stops for good after six sales messages', () => {
    const p = page({
      sent_at: ago(9 * DAY), first_opened_at: ago(9 * DAY), play_at: ago(9 * DAY),
      watched_at: ago(9 * DAY), completed_at: ago(9 * DAY), watched_pct: 100,
      automation: booked([
        ['sent_not_opened_2h', 8 * DAY], ['sent_not_opened_24h', 7 * DAY],
        ['opened_not_played_2h', 6 * DAY], ['watched_50_2h', 5 * DAY],
        ['watched_100_30m', 4 * DAY], ['watched_100_no_trial_24h', 3 * DAY],
      ]),
    });
    expect(SALES_RULE_KEYS.length).toBeGreaterThan(SEQUENCE_MAX_SALES_SENDS);
    const v = ask(p);
    expect(v.due).toBeNull();
    expect(v.reason).toBe('capped');
    // Not even the goodbye, which would be a seventh.
    expect(v.next).toBeNull();
  });

  it('counts the texts a lead already had under the old five-rule sequence', () => {
    // Live pages carry keys this table no longer knows (`watched_no_click` and
    // friends). Their phone does not care which version of the schedule sent
    // yesterday's text, so both the 24h gap and the ceiling count them.
    const stale = page({
      sent_at: ago(30 * HOUR),
      automation: { watched_no_click: { count: 2, last_at: ago(HOUR) } },
    });
    expect(ask(stale).reason).toBe('cooldown');

    const spent = page({
      // Recent enough to be enrolled: a page sent before SEQUENCE_EPOCH is not
      // in the sequence at all, which is a different (and stronger) answer.
      sent_at: ago(6 * DAY),
      automation: {
        sent_not_opened: { count: 4, last_at: ago(10 * DAY) },
        checkout_abandoned: { count: 2, last_at: ago(9 * DAY) },
      },
    });
    expect(ask(spent).reason).toBe('capped');
  });

  it('stops permanently the moment they reply', () => {
    const p = page({ sent_at: ago(3 * HOUR) });
    expect(ask(p).due?.key).toBe('sent_not_opened_2h');
    const v = ask(p, { lastInboundAt: ago(HOUR) });
    expect(v.due).toBeNull();
    expect(v.reason).toBe('replied');
    // And still stopped a week later.
    expect(nextSequenceStep(p, {
      rules: DEFAULT_VSL_RULES, now: new Date(now + 7 * DAY), lastInboundAt: ago(HOUR),
    }).due).toBeNull();
  });

  it('ignores a message they sent before the video went out', () => {
    const p = page({ sent_at: ago(3 * HOUR) });
    expect(ask(p, { lastInboundAt: ago(4 * HOUR) }).due?.key).toBe('sent_not_opened_2h');
  });

  it('stops the sales sequence the moment they pay, and only welcomes them', () => {
    const p = page({
      sent_at: ago(2 * DAY), first_opened_at: ago(2 * DAY), play_at: ago(2 * DAY),
      watched_at: ago(2 * DAY), completed_at: ago(2 * DAY), watched_pct: 100,
      cta_clicked_at: ago(2 * DAY), checkout_started_at: ago(2 * DAY),
      paid_at: ago(10 * MIN),
    });
    expect(ask(p).due?.key).toBe('paid_welcome');

    const welcomed = page({ ...p, automation: booked([['paid_welcome', 9 * MIN]]) });
    const v = ask(welcomed);
    expect(v.due).toBeNull();
    expect(v.reason).toBe('paid');
  });

  it('still welcomes someone who replied and then paid', () => {
    const p = page({ sent_at: ago(2 * DAY), paid_at: ago(2 * MIN) });
    expect(ask(p, { lastInboundAt: ago(DAY) }).due?.key).toBe('paid_welcome');
  });

  it('says nothing more after the goodbye', () => {
    const p = page({
      sent_at: ago(9 * DAY),
      automation: booked([['dormant_7d', DAY]]),
    });
    const v = ask(p);
    expect(v.due).toBeNull();
    expect(v.reason).toBe('closed');
  });

  it('holds everything outside quiet hours rather than texting at 3am', () => {
    const v = ask(page({ sent_at: ago(3 * HOUR) }), { insideQuietHours: false });
    expect(v.due).toBeNull();
    expect(v.reason).toBe('quiet_hours');
    expect(v.next?.key).toBe('sent_not_opened_2h');
  });

  it('sends nothing while the funnel is off or the agent has opted out', () => {
    const p = page({ sent_at: ago(3 * HOUR) });
    expect(ask(p, { enabled: false }).reason).toBe('disabled');
    expect(ask(p, { agentDisabled: true }).reason).toBe('disabled');
  });

  it('sends nothing before the video has gone out', () => {
    const v = ask(page({ sent_at: null }));
    expect(v.due).toBeNull();
    expect(v.reason).toBe('not_sent');
  });

  it('always explains itself in one printable sentence', () => {
    const v = ask(page({ sent_at: ago(MIN) }));
    expect(v.due).toBeNull();
    expect(v.reason).toBe('waiting');
    expect(v.detail.length).toBeGreaterThan(10);
    expect(v.next?.key).toBe('sent_not_opened_2h');
    expect(new Date(v.next!.at).getTime()).toBe(now - MIN + 2 * HOUR);
  });
});

describe('the copy', () => {
  const templates = Object.entries(DEFAULT_VSL_RULES) as Array<[string, { template: string }]>;

  it('never mentions the tracking', () => {
    // We know an unsettling amount about what happened on that page. Saying so
    // turns a follow-up into surveillance.
    const TELLS = /\b(saw you|i noticed|we noticed|i (?:can )?see (?:that )?you|you watched|i watched you|tracking|tracked|analytics)\b/i;
    for (const [key, r] of templates) {
      expect(`${key}: ${TELLS.test(r.template)}`).toBe(`${key}: false`);
    }
  });

  it('carries no long dash, no emoji, nothing outside GSM-7', () => {
    // One character outside the table doubles the cost of every send, forever.
    for (const [key, r] of templates) {
      expect(`${key}: ${nonGsm7(r.template).join('')}`).toBe(`${key}: `);
      expect(`${key}: ${/[—–]/.test(r.template)}`).toBe(`${key}: false`);
      // Hugo's spec had a smiley on the first message and on "what did you
      // think". Dropped on purpose: it is not GSM-7.
      expect(`${key}: ${/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(r.template)}`).toBe(`${key}: false`);
      expect(`${key}: ${/[:;]-?[)D(]/.test(r.template)}`).toBe(`${key}: false`);
    }
  });

  it('greets by first name and puts the £1 link on its own line', () => {
    for (const [key, r] of templates) {
      if (key !== 'paid_welcome') expect(`${key}: ${r.template.startsWith('Hi {first},')}`).toBe(`${key}: true`);
    }
    // Only the £1 ask carries a link: every other message lands in the same
    // thread as the original video text.
    const withUrl = templates.filter(([, r]) => r.template.includes('{url}')).map(([k]) => k);
    expect(withUrl).toEqual(['watched_100_30m']);
    expect(DEFAULT_VSL_RULES.watched_100_30m.template).toMatch(/\n\{url\}/);
  });

  it('leaves the welcome message exactly as it was', () => {
    expect(DEFAULT_VSL_RULES.paid_welcome.template).toBe(
      "Welcome aboard {first}! We're setting {business} up now and your reviews will start rolling shortly.\n\nAny questions, just message me here any time.",
    );
  });
});

// ---------------------------------------------------------------------------
// Adversarial review, 2026-07-27. Every case below TEXTED A REAL LEAD when it
// should not have. They are kept as scenarios, not as unit assertions on the
// helper that happened to be wrong, because the next regression will arrive
// through a different helper.
// ---------------------------------------------------------------------------
describe('things that must never text a lead again', () => {
  it('does not replay the opener for the whole back catalogue on deploy day', () => {
    // The new rule keys made every historical page look un-nudged while
    // sent_at stayed immutable, so the first cron run would have texted every
    // lead ever sent "just wanted to make sure you received the video" about a
    // video from weeks ago, then done it again for three more days.
    const ancient = page({ sent_at: ago(30 * DAY), automation: {} });
    const v = ask(ancient);
    expect(v.reason).toBe('pre_epoch');
    expect(v.due).toBeNull();
  });

  it('does not close the file on a lead who keeps coming back', () => {
    // Every *_at column is a FIRST touch, so a lead on their eighth visit has
    // the same first_opened_at as a lead on their first. Reading only those
    // stamps sent the goodbye message an hour after someone's latest visit.
    const spent = {
      sent_at: ago(9 * DAY),
      first_opened_at: ago(9 * DAY),
      automation: {
        opened_not_played_2h: { count: 1, last_at: ago(9 * DAY) },
        opened_not_played_24h: { count: 1, last_at: ago(8 * DAY) },
      },
    };
    expect(ask(page({ ...spent, last_event_at: ago(2 * HOUR) })).due).toBeNull();
    // The calculator is the strongest pre-purchase signal we get. Never a goodbye.
    expect(ask(page({ ...spent, last_event_at: ago(9 * DAY), calc_at: ago(6 * HOUR) })).due).toBeNull();
    // Genuinely silent still gets it, or the rule would be pointless.
    expect(ask(page({ ...spent, last_event_at: ago(9 * DAY) })).due?.key).toBe('dormant_7d');
  });

  it('does not chase a trial from someone who already paid for one', () => {
    // paid_at is only stamped when Stripe carried vsl_page_id, i.e. the button
    // on their own page. A lead closed mid-call pays through
    // wk_contacts.business_id and the page never learns about it.
    const closed = page({
      sent_at: ago(3 * DAY), first_opened_at: ago(3 * DAY), play_at: ago(3 * DAY),
      completed_at: ago(3 * DAY), watched_pct: 100,
      cta_clicked_at: ago(3 * DAY), checkout_started_at: ago(3 * DAY),
    });
    expect(nextSequenceStep(closed, { rules: DEFAULT_VSL_RULES, now: new Date(now) }).due?.key)
      .toBe('checkout_abandoned_30m');
    const v = nextSequenceStep(closed, {
      rules: DEFAULT_VSL_RULES, now: new Date(now), paidElsewhere: true,
    });
    expect(v.reason).toBe('paid');
    expect(v.due).toBeNull();
  });
});
