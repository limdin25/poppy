// Everything the system knows about one deal, in one object.
//
// Layer 1 of the Deal Manager (docs/AI_DEAL_MANAGER_PLAN.md). Deterministic,
// no AI, no network, no clock of its own: every input is passed in, so the
// whole thing is testable with fixtures.
//
// WHY IT IS A SEPARATE LAYER. This is the ONLY thing the Manager is ever
// shown. That is what makes the fences checkable rather than hopeful: if a
// figure is not in this object, the Manager never saw it, so a figure it names
// that is not in here is provably invented and the answer is thrown away.
//
// The five gaps this exists to close, in the order they cost money:
//   1. nothing watches a deal BETWEEN events, so a card sits in Ready for
//      call 2 for four days and nobody notices
//   2. a branch's email reply changes no instruction anywhere
//   3. the overnight machine never says "a branch you know just cut the price"
//   4. past Offer accepted there is no code at all
//   5. Pedro's day has a queue order but no priorities

// The ONE import, and it is a pure function: compCount reads the three
// different shapes valuation.py has written comparables in over time. Counting
// them again here would be a fourth opinion about what a comparable is, and
// that miscount is exactly how Welwyn Park Road reported "no sold comparables
// on file" beside a real valuation.
import { compCount } from './next-step-brief.js';
import { readDealMoney } from './brrr-offer.js';

/** Everything that can be true about a deal, gathered from the tables. */
export interface DealStateInput {
  property: {
    id: string;
    address?: string | null;
    status?: string | null;
    asking_price?: number | null;
    bedrooms?: number | null;
    /** The engine's deal blob. Money is READ from here, never derived. */
    deal?: Record<string, unknown> | null;
    /** The deterministic brief. The Manager may never override it. */
    brief?: Record<string, unknown> | null;
    /** Hugo's own instruction. Outranks anything generated. */
    pinned_note?: string | null;
    qualification?: Record<string, unknown> | null;
    assigned_builder_id?: string | null;
    viewing_at?: string | null;
    viewing_quote?: number | null;
    updated_at?: string | null;
    /** For the investor pack gate: the pack needs the plan, not just photos. */
    floorplan_urls?: unknown;
  };
  contact?: {
    id: string;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    pipeline_column_id?: string | null;
    custom_fields?: Record<string, string> | null;
    stage_moved_at?: string | null;
    last_contact_at?: string | null;
  } | null;
  /** Current board column name, resolved by the caller. */
  columnName?: string | null;
  /** Every call to this branch, newest first. */
  calls?: Array<{
    id: string;
    created_at?: string | null;
    direction?: string | null;
    disposition?: string | null;
    duration_sec?: number | null;
    /** Pedro's own words about the call. "call back monday" is an
     *  appointment, and it lives nowhere else. */
    agent_note?: string | null;
  }>;
  /** The newest call to this branch that has a transcript, whole. This is what
   *  gives the brain ears: without it the checklist is all it can see, and an
   *  unlogged 12 minute discovery call reads as "nothing was ever gathered". */
  lastConversation?: {
    call_id?: string | null;
    at?: string | null;
    duration_sec?: number | null;
    note?: string | null;
    transcript?: string | null;
  } | null;
  /** What the machine's own ballpark run came back with, stored by the sweep.
   *  Refusals included: "the engine refuses a figure on this evidence" is a
   *  result, not an absence. */
  ballparkPreview?: Record<string, unknown> | null;
  /** Every message in and out on this branch's contacts, newest first. */
  messages?: Array<{
    id: string;
    created_at?: string | null;
    direction?: string | null;
    channel?: string | null;
    subject?: string | null;
    body?: string | null;
  }>;
  /** Pending or snoozed follow-ups for this contact. */
  followups?: Array<{
    id: string;
    due_at?: string | null;
    note?: string | null;
    status?: string | null;
  }>;
  /** Builders whose coverage includes this house's outcode. */
  builderMatches?: Array<{ id: string; name?: string | null }>;
  /** Passed in, never read off the wall clock, so tests are stable. */
  now: Date;
}

export interface DealState {
  propertyId: string;
  address: string | null;
  status: string | null;
  board: {
    column: string | null;
    movedAt: string | null;
    hoursInColumn: number | null;
  };
  money: {
    asking: number | null;
    gdv: number | null;
    tmv: number | null;
    open: number | null;
    ceiling: number | null;
    refurb: number | null;
    /** TRUE when the engine says the works cost is a STAND-IN, not a survey:
     *  `deal.refurb.basis === 'provisional'` means nobody has read the
     *  condition and a default is holding the seat until the call. A band
     *  priced on a stand-in may rank deals; it may never leave the building
     *  in an offer. Hugo, 16 Aug: "the refurb hardcoded, this is wrong". */
    refurbAssumed: boolean;
    /** A ceiling Hugo has WRITTEN in the pinned note ("never past 102,800").
     *  His ruling outranks the engine's band: the engine prices the house,
     *  Hugo prices the appetite. Null when the note names none. */
    pinnedCeiling: number | null;
    compsTier: string | null;
    /** Every figure that is legitimately on this deal's file. The fence in
     *  section 5 checks the Manager's words against exactly this list. */
    figuresOnFile: number[];
  };
  brief: {
    step: string | null;
    doNow: string[];
    blockers: string[];
    confidence: string | null;
    writtenAt: string | null;
  };
  pinnedNote: string | null;
  calls: {
    count: number;
    lastAt: string | null;
    lastOutcome: string | null;
    hoursSinceLast: number | null;
    /** How many of those calls were an actual CONVERSATION, as opposed to a
     *  voicemail or a phone nobody picked up.
     *
     *  This is the difference between a deal and a dial. A branch rung four
     *  times with four voicemails has no deal on it, and it belongs in the
     *  calling list rather than in front of somebody deciding things. */
    connected: number;
    lastConnectedAt: string | null;
    hoursSinceConnected: number | null;
    /** Pedro's note on the newest call that has one. "call back monday" is an
     *  appointment the brain must respect, and it lives nowhere else. */
    lastNote: string | null;
  };
  /** What was actually SAID on the newest recorded call, capped. Ground truth:
   *  a question answered in here is answered, whether or not anybody filled
   *  the checklist in afterwards. Null when no call has a transcript. */
  conversation: {
    at: string | null;
    durationSec: number | null;
    note: string | null;
    transcript: string;
  } | null;
  /** The homework the MACHINE already did: the sweep's ballpark run. When
   *  `ran` and `ok`, the decision is to CONFIRM these numbers, never to ask
   *  a human to go and fetch them. When `ran` and not `ok`, the refusal is
   *  the honest result and the cure goes in the next call. */
  ballpark: {
    ran: boolean;
    ok: boolean;
    at: string | null;
    open: number | null;
    ceiling: number | null;
    gdv: number | null;
    refurb: number | null;
    tier: string | null;
    refusal: string | null;
    refusalDetail: string | null;
  } | null;
  writing: {
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    /** THE GAP THAT COST MONEY. True when the branch has written to us since
     *  the brief was written, so the instruction on the card predates their
     *  answer. Lexi rejected an offer at 08:38 and the card still said "chase
     *  the agent" seven hours later. */
    replySinceBrief: boolean;
    lastInboundPreview: string | null;
    /** THE CONVERSATION ITSELF, oldest first, capped. Added 2026-08-17 after
     *  Hugo caught a "best and final" draft that answered none of what the
     *  branch had actually written: the full thread was loaded from the
     *  database on every sweep and then thrown away right here, so the email
     *  writer only ever saw a 400-character preview of the newest message.
     *  An email that does not answer the thread is not a reply, it is a
     *  broadcast. NOT in the hash (already represented by lastInboundAt /
     *  lastOutboundAt). */
    thread: Array<{
      at: string | null;
      direction: 'inbound' | 'outbound';
      subject: string | null;
      body: string;
    }>;
  };
  followups: {
    nextDueAt: string | null;
    overdue: boolean;
    hoursOverdue: number | null;
    note: string | null;
  };
  checklist: {
    answered: number;
    total: number;
    missing: string[];
    /** WHAT THE BRANCH ACTUALLY SAID, one line per answered key, each with the
     *  agent's own words where the call listener recorded them. Added
     *  2026-08-18: the state carried only the COUNT, so the brain knew "5 of
     *  12" while the answers themselves ("offer just accepted, no longer
     *  available") sat unread in the qualification blob. Distilled facts
     *  survive transcript caps and old calls; the transcript alone does not. */
    heard: string[];
  };
  builder: {
    matches: number;
    booked: boolean;
    viewingAt: string | null;
    quote: number | null;
  };
  /** What the investor pack has and has not got. Facts, not a judgement: the
   *  gate that reads them (api/lib/deal-stress-test.ts) blocks on every missing
   *  line, because past Offer accepted a missing fact is the whole business's
   *  reputation rather than an inconvenience. */
  pack: {
    compsCount: number;
    rentComp: boolean;
    floorplans: boolean;
  };
  clock: {
    lastTouchAt: string | null;
    hoursSinceTouch: number | null;
    /** Nothing has happened for long enough that the silence IS the problem. */
    stale: boolean;
  };
}

/** The board columns that mean NOBODY ACTUALLY SPOKE. A call dispositioned
 *  into one of these is a dial, not a conversation. */
export const NO_CONVERSATION_COLUMNS = ['Voicemail', 'No pickup', 'Not interested'];

/** Did this call reach a human?
 *
 *  The disposition is the honest answer where there is one, because it is what
 *  the agent said happened after the call ended. Where a call was never
 *  dispositioned, a minute of talking is taken as a conversation: nobody
 *  listens to a voicemail greeting for sixty seconds. */
function isConnectedCall(k: { disposition?: string | null; duration_sec?: number | null }): boolean {
  const d = (k.disposition ?? '').trim();
  if (d) return !NO_CONVERSATION_COLUMNS.includes(d);
  return (k.duration_sec ?? 0) >= 60;
}

/** How long a deal may sit with nobody touching it before it is stale.
 *  Three working days: long enough not to nag, short enough that a deal
 *  cannot quietly die in Ready for call 2. */
export const STALE_HOURS = 72;

/** A 12 minute discovery call transcribes to about 8,000 characters, so this
 *  keeps a whole normal call. A marathon is trimmed from the FRONT: the greeting
 *  and hold music small talk go, the answers and the close stay. */
export const TRANSCRIPT_CAP = 9_000;

/** How much of the email thread rides on the state: the six newest messages,
 *  each capped. Sized for the email WRITER, which needs to answer what was
 *  said, not to archive it.
 *
 *  RAISED FROM 900 TO 2,400 ON 2026-08-17, measured rather than guessed.
 *
 *  Our own offer email on Welwyn Park Road is 1,029 characters, and the
 *  sentence that says HOW THE PURCHASE COMPLETES ("these company accounts
 *  together with a bridging facility") starts at character 875. At 900 the
 *  brain read our own email as ending mid word, "The purchase completes us",
 *  so the only thing it could see about money was a statement total of 102,071
 *  under an offer of 103,600. It duly believed the branch's complaint that the
 *  funds fell short and ordered Hugo to produce a bigger statement, on a deal
 *  where we had already explained the bridge in writing.
 *
 *  The tail of an email is where the terms live: the funding structure, the
 *  condition, the one question we asked. Cutting it is not trimming, it is
 *  deleting the part that matters. 2,400 keeps a long offer email whole, and
 *  six of them is still a quarter of the transcript cap. */
export const THREAD_MESSAGES = 6;
export const THREAD_BODY_CAP = 2_400;

/** Cut, and SAY it was cut. A truncation nobody can see reads as the whole
 *  message, which is how a half sentence became a fact about our money. */
function capBody(text: string): string {
  const t = text.trim();
  if (t.length <= THREAD_BODY_CAP) return t;
  return `${t.slice(0, THREAD_BODY_CAP)}\n(the rest of this message is not shown)`;
}

function capTranscript(text: string): string {
  const t = text.trim();
  if (t.length <= TRANSCRIPT_CAP) return t;
  return '(start of call trimmed)\n' + t.slice(t.length - TRANSCRIPT_CAP);
}

/** The condition and motivation questions the call is supposed to establish.
 *  Missing ones become blockers, never assumptions. */
export const CHECKLIST_KEYS = [
  'still_available', 'why_selling', 'motivation', 'condition_notes',
  'condition_band', 'water', 'tenure', 'floor_area',
  // 'offers_received' used to sit here and is NOT a key on Qualification, so
  // nothing could ever answer it and the completeness score was permanently
  // one short. Replaced 2026-08-15 by the two keys that do exist and that the
  // ballpark now actually reads.
  'rejected_offer', 'agent_comparable', 'rent_estimate', 'best_price_indicated',
] as const;

/** Where the call listener files each answer's evidence quote, inside
 *  `qualification`. Defined HERE because deal-state owns the checklist
 *  vocabulary and call-extract already imports it; call-extract re-exports it
 *  so its own callers are unchanged. Underscored so no checklist key can ever
 *  collide with it. */
export const HEARD_KEY = '_heard';

/** The branch's answers, rendered for a model: one line per answered checklist
 *  key, with the quote the call listener stored beside it when there is one.
 *
 *  Hugo, 2026-08-18, listening to the Pearson Street recording next to the
 *  email that went out: "If there is a floor plan, why would you ask for the
 *  floor plan on the email? And also the EPC, she also mentioned the EPC. So
 *  the call didn't hear." Amy had said, on the call, that the floor plan was
 *  on the advert, that the EPC was online, and that an offer had just been
 *  accepted; the email asked for a walkthrough, the floor plan and the EPC.
 *  The distilled answers existed by then and reached NOTHING that writes.
 *
 *  This is the one renderer both the brain and the email writer read, so what
 *  the call established cannot again be known by half the system. Returns ''
 *  when nothing has been answered, so callers can drop the block cleanly. */
export function heardFactsBlock(
  qualification: Record<string, unknown> | null | undefined,
): string {
  const q = qualification ?? {};
  const heard = (q[HEARD_KEY] ?? {}) as Record<string, { quote?: string | null }>;
  const lines: string[] = [];
  for (const key of CHECKLIST_KEYS) {
    const v = String(q[key] ?? '').trim();
    if (!v) continue;
    const quote = String(heard[key]?.quote ?? '').trim();
    const label = key.replace(/_/g, ' ');
    lines.push(quote
      ? `- ${label}: ${v} (they said: "${quote.slice(0, 200)}")`
      : `- ${label}: ${v}`);
  }
  return lines.join('\n');
}

const hoursBetween = (from: string | null | undefined, to: Date): number | null => {
  if (!from) return null;
  const t = Date.parse(from);
  if (Number.isNaN(t)) return null;
  return Math.round(((to.getTime() - t) / 3_600_000) * 10) / 10;
};

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Read a nested key off the engine's deal blob without deriving anything. */
const dig = (deal: Record<string, unknown> | null | undefined, ...path: string[]): unknown => {
  let cur: unknown = deal;
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
};

export function buildDealState(input: DealStateInput): DealState {
  const { property: p, contact, now } = input;
  const deal = p.deal ?? null;

  // ---- money, all READ, none derived ---------------------------------
  // ONE reader (brrr-offer.ts readDealMoney), because hand-rolled reads here
  // had no flat-shape fallback for the band and read refurb.low while the
  // dialer read refurb.estimate: same deal, different numbers (16 Aug audit).
  const money = readDealMoney({ asking_price: p.asking_price, deal });
  const asking = money.asking;
  const gdv = money.gdv;
  const tmv = money.tmv;
  const open = money.open;
  const ceiling = money.ceiling;
  const refurb = money.refurb;
  const ladder = money.ladder;
  const figuresOnFile = [
    asking, gdv, tmv, open, ceiling, refurb,
    num(p.viewing_quote),
    ...ladder,
    // HUGO'S OWN FIGURES COUNT AS ON FILE. Found on Orion Way, 16 Aug: the
    // offer actually put to the vendor (96,375) and the ladder Hugo decided
    // (99,588 / 102,800) lived only in the pinned note, while the engine's
    // file held an older band, so the brain was forbidden from naming the
    // very numbers Hugo had ruled. A figure in the pinned note is a decision,
    // not an invention. Naming is all this unlocks: SENDING a figure is still
    // gated by the stress test and the ceiling fences.
    ...figuresIn(p.pinned_note ?? ''),
  ].filter((n): n is number => n !== null);

  // ---- the brief ------------------------------------------------------
  const brief = p.brief ?? null;
  const briefWrittenAt = (dig(brief, 'written_at') as string | null) ?? null;
  const doNow = ((dig(brief, 'do_now') as string[] | null) ?? []).filter(Boolean);
  const blockers = ((dig(brief, 'blockers') as string[] | null) ?? []).filter(Boolean);

  // ---- calls ----------------------------------------------------------
  const calls = [...(input.calls ?? [])].sort(
    (a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
  );
  const lastCall = calls[0] ?? null;
  const connectedCalls = calls.filter(isConnectedCall);
  const lastConnected = connectedCalls[0] ?? null;
  const lastNoted = calls.find((k) => String(k.agent_note ?? '').trim() !== '') ?? null;

  const convo = input.lastConversation ?? null;
  const conversation = convo && String(convo.transcript ?? '').trim()
    ? {
      at: convo.at ?? null,
      durationSec: convo.duration_sec ?? null,
      note: (convo.note ?? '').trim() || null,
      transcript: capTranscript(String(convo.transcript)),
    }
    : null;

  // ---- the machine's own homework -------------------------------------
  const bp = input.ballparkPreview ?? null;
  const bpEngine = (bp && typeof bp.engine === 'object' ? bp.engine : null) as Record<string, unknown> | null;
  const ballpark = bp
    ? {
      ran: true,
      ok: bp.ok === true,
      at: (bp.at as string | null) ?? null,
      open: num(bpEngine?.open),
      ceiling: num(bpEngine?.ceiling),
      gdv: num(bpEngine?.gdv),
      refurb: num(bpEngine?.refurb),
      tier: (bpEngine?.comps_tier as string | null) ?? null,
      refusal: bp.ok === true ? null : String(bp.reason ?? 'refused'),
      refusalDetail: bp.ok === true ? null : String(bp.detail ?? '').slice(0, 300) || null,
    }
    : null;
  // The machine's own run put these numbers on the table, so the brain may
  // NAME them ("I ran the ballpark: open 65,157"). The ceiling fences still
  // keep the walk-away out of anything outbound.
  if (ballpark?.ok) {
    for (const n of [ballpark.open, ballpark.ceiling, ballpark.gdv, ballpark.refurb]) {
      if (n !== null) figuresOnFile.push(n);
    }
  }

  // ---- writing --------------------------------------------------------
  const messages = [...(input.messages ?? [])].sort(
    (a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
  );
  const lastInbound = messages.find((m) => m.direction === 'inbound') ?? null;
  const lastOutbound = messages.find((m) => m.direction === 'outbound') ?? null;
  // The reply-is-waiting test: their last message is newer than BOTH the brief
  // and our last outbound. The brief-only compare was a trap measured live on
  // 2026-08-16: briefs are written by the per-house outcome press, which is
  // almost never used (2 presses across 208 houses, every brief NULL), so
  // "newer than a null brief" meant ANY inbound ever, forever, and one old
  // email would have pinned a wiped branch into the cockpit for good. An
  // inbound we have since written back to is answered, not waiting. If neither
  // timestamp exists the inbound still counts: the safe wrong answer is "look
  // at it".
  const answeredAt = Math.max(
    briefWrittenAt ? Date.parse(briefWrittenAt) : 0,
    lastOutbound?.created_at ? Date.parse(lastOutbound.created_at) : 0,
  );
  const replySinceBrief = Boolean(
    lastInbound?.created_at
    && Date.parse(lastInbound.created_at) > answeredAt,
  );

  // The conversation itself, oldest first so it reads the way a person reads a
  // thread. Six newest messages, each capped: enough to answer what was
  // actually said, small enough that a chatty branch cannot blow the prompt.
  const thread = messages.slice(0, THREAD_MESSAGES).reverse()
    .filter((m) => String(m.body ?? '').trim())
    .map((m) => ({
      at: m.created_at ?? null,
      direction: (m.direction === 'inbound' ? 'inbound' : 'outbound') as 'inbound' | 'outbound',
      subject: m.subject ?? null,
      body: capBody(String(m.body)),
    }));

  // ---- follow-ups -----------------------------------------------------
  const live = (input.followups ?? []).filter(
    (f) => f.status === 'pending' || f.status === 'snoozed' || !f.status,
  ).sort((a, b) => String(a.due_at ?? '').localeCompare(String(b.due_at ?? '')));
  const nextFollowup = live[0] ?? null;
  const overdueHours = nextFollowup?.due_at
    ? hoursBetween(nextFollowup.due_at, now)
    : null;

  // ---- checklist ------------------------------------------------------
  const q = (p.qualification ?? {}) as Record<string, unknown>;
  const missing = CHECKLIST_KEYS.filter((k) => {
    const v = q[k];
    return v === undefined || v === null || String(v).trim() === '';
  });

  // ---- the clock ------------------------------------------------------
  const touches = [
    lastCall?.created_at, lastInbound?.created_at, lastOutbound?.created_at,
    contact?.last_contact_at, p.updated_at,
  ].filter(Boolean) as string[];
  const lastTouchAt = touches.length
    ? touches.reduce((a, b) => (Date.parse(a) > Date.parse(b) ? a : b))
    : null;
  const hoursSinceTouch = hoursBetween(lastTouchAt, now);

  return {
    propertyId: p.id,
    address: p.address ?? null,
    status: p.status ?? null,
    board: {
      column: input.columnName ?? null,
      movedAt: contact?.stage_moved_at ?? null,
      hoursInColumn: hoursBetween(contact?.stage_moved_at, now),
    },
    money: {
      asking, gdv, tmv, open, ceiling, refurb,
      refurbAssumed: money.refurbAssumed,
      pinnedCeiling: pinnedCeilingIn(p.pinned_note ?? ''),
      compsTier: money.compsTier,
      figuresOnFile,
    },
    brief: {
      step: (dig(brief, 'step') as string | null) ?? null,
      doNow, blockers,
      confidence: (dig(brief, 'confidence', 'level') as string | null) ?? null,
      writtenAt: briefWrittenAt,
    },
    pinnedNote: p.pinned_note ?? null,
    calls: {
      count: calls.length,
      lastAt: lastCall?.created_at ?? null,
      lastOutcome: lastCall?.disposition ?? null,
      hoursSinceLast: hoursBetween(lastCall?.created_at, now),
      connected: connectedCalls.length,
      lastConnectedAt: lastConnected?.created_at ?? null,
      hoursSinceConnected: hoursBetween(lastConnected?.created_at, now),
      lastNote: lastNoted ? String(lastNoted.agent_note).trim() : null,
    },
    conversation,
    ballpark,
    writing: {
      lastInboundAt: lastInbound?.created_at ?? null,
      lastOutboundAt: lastOutbound?.created_at ?? null,
      replySinceBrief,
      lastInboundPreview: lastInbound?.body
        ? String(lastInbound.body).trim().slice(0, 400)
        : null,
      thread,
    },
    followups: {
      nextDueAt: nextFollowup?.due_at ?? null,
      overdue: overdueHours !== null && overdueHours > 0,
      hoursOverdue: overdueHours !== null && overdueHours > 0 ? overdueHours : null,
      note: nextFollowup?.note ?? null,
    },
    checklist: {
      answered: CHECKLIST_KEYS.length - missing.length,
      total: CHECKLIST_KEYS.length,
      missing: [...missing],
      heard: heardFactsBlock(q).split('\n').filter(Boolean),
    },
    builder: {
      matches: (input.builderMatches ?? []).length,
      booked: Boolean(p.assigned_builder_id),
      viewingAt: p.viewing_at ?? null,
      quote: num(p.viewing_quote),
    },
    pack: {
      compsCount: compCount(deal),
      // Either the engine worked out a rent or the branch told us one on the
      // phone. Both are a rent comparable; neither is an assumption.
      rentComp: num(dig(deal, 'rent')) !== null
        || num(dig(deal, 'rent', 'estimate')) !== null
        || String(q.rent_estimate ?? '').trim() !== '',
      floorplans: Array.isArray(p.floorplan_urls) && p.floorplan_urls.length > 0,
    },
    clock: {
      lastTouchAt,
      hoursSinceTouch,
      stale: hoursSinceTouch !== null && hoursSinceTouch >= STALE_HOURS,
    },
  };
}

// ---------------------------------------------------------------------
// THE FIGURE FENCE
// ---------------------------------------------------------------------

/** Every number the Manager wrote that could be money.
 *
 *  Small counts are ignored ("ring them in 2 days" is not a figure), and a
 *  bare four-digit number in year range is treated as a year rather than a
 *  price unless it carries a currency symbol.
 *
 *  A comma-grouped number counts WITH OR WITHOUT a currency prefix. That hole
 *  is how "They want 105,000, so offer that" walked through the fence the
 *  first time this was written: the branch's own number is exactly the kind
 *  the Manager must not repeat as an instruction.
 */
/** A NUMBER THAT IS AN IDENTIFIER IS NOT MONEY.
 *
 *  Our Companies House number is 11197856, eight digits, and on 17 Aug an email
 *  that correctly answered a branch's request for our registration details was
 *  blocked twice over: "This names GBP 11,197,856, which is not a figure the
 *  engine has for this house" and "this names a figure and no offer has been
 *  made yet". Both fences were working exactly as designed on a number that is
 *  not a price and never can be.
 *
 *  Deliberately narrow, and deliberately BARE DIGITS ONLY. A company number
 *  carries no commas, so "company number 103,600" is left alone and still
 *  caught: the fence's real job, stopping a model putting an invented price in
 *  front of a branch, loses nothing.
 */
const IDENTIFIER_NUMBERS =
  /\b(?:compan(?:y|ies)(?:\s+house)?|registration|registered)\s*(?:number|no\.?|#)?\s*:?\s*\d{4,9}\b/gi;

export function scrubIdentifiers(text: string): string {
  return String(text ?? '').replace(IDENTIFIER_NUMBERS, ' ');
}

export function figuresIn(text: string): number[] {
  const out: number[] = [];
  const re = /(GBP|£)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,9})/gi;
  for (const m of scrubIdentifiers(text).matchAll(re)) {
    const hasCurrency = Boolean(m[1]);
    const raw = m[2].replace(/,/g, '');
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1000) continue;
    const looksLikeAYear = !hasCurrency && !m[2].includes(',')
      && n >= 1900 && n <= 2099;
    if (looksLikeAYear) continue;
    out.push(n);
  }
  return out;
}

/** The ceiling Hugo has WRITTEN in the pinned note, if any.
 *
 *  Deliberately narrow: only a figure that follows an explicit ceiling phrase
 *  counts ("never past 102,800", "no more than X", "max", "maximum",
 *  "ceiling", "never above", "up to"). Taking the biggest figure in the note
 *  would be catastrophic: Orion Way's note also quotes the ASKING price of
 *  110,000, which is precisely the number we must never pay. Several matches
 *  take the HIGHEST, because a ladder note names its cap more than once
 *  ("one step to 99,588 max ... never past 102,800") and the final rung is
 *  the ruling.
 */
export function pinnedCeilingIn(note: string): number | null {
  if (!note.trim()) return null;
  const re = /(?:never\s+(?:past|above|over)|no\s+more\s+than|max(?:imum)?(?:\s+of)?|ceiling(?:\s+(?:of|at|is))?|up\s+to)[:\s]*(?:GBP|£)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,9})/gi;
  let best: number | null = null;
  for (const m of note.matchAll(re)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n >= 1000 && (best === null || n > best)) best = n;
  }
  // "one step to 99,588 max": the figure comes BEFORE the word. Catch that
  // shape too, same phrase list, same highest-wins rule.
  const re2 = /(?:GBP|£)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,9})\s*(?:max(?:imum)?|ceiling|top|absolute\s+limit)\b/gi;
  for (const m of note.matchAll(re2)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n >= 1000 && (best === null || n > best)) best = n;
  }
  return best;
}

/** Is every figure in this text already on the deal's file?
 *
 *  The Manager may never name a figure that is not already recorded. It is not
 *  allowed to do arithmetic, split a difference, or suggest a number "around"
 *  something. A tolerance of nothing is deliberate: an offer is said out loud
 *  on a phone call and cannot be unsaid.
 */
export function figuresAreOnFile(text: string, state: DealState): boolean {
  const allowed = new Set(state.money.figuresOnFile.map((n) => Math.round(n)));
  return figuresIn(text).every((n) => allowed.has(Math.round(n)));
}
