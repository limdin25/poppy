// The builder board: who is going to which house, and what is about to go wrong.
//
// Pure on purpose. Every rule here was paid for by a viewing that failed in the
// first week of real bookings, and a rule that lives inside a component is a
// rule nobody tests. See tests/builder-board.test.ts.
//
// THE ONE FINDING THAT SHAPED THE WHOLE SCREEN. Six viewings happened on 26 and
// 27 August; a builder turned up at three. The three that failed were the ones
// where a builder said yes and was never told which door to knock on:
//
//   CJS Builders  "I'm happy to do this for you. What number am I meeting you
//                  at?" ... on the day: "Assume today's meet isn't on? No
//                  address."
//   PZ Builders   confirmed the slot, asked three times, then on the morning:
//                 "Is this afternoon's meeting still going ahead? If so will
//                  require the address please."
//   Staffs Lofts  "What number Oxford gardens is it and I will book it in the
//                  diary."
//
// So the loudest thing on a card is not its stage. It is whether the man has
// the address.

export type BuilderStage = 'to_do' | 'chasing' | 'talking' | 'coming' | 'booked' | 'been' | 'no';

export interface StageSpec {
  id: BuilderStage;
  title: string;
  hint: string;
}

/** Pedro's words, not the database's. `status` already holds what the wire did
 *  ('sent', 'replied', 'declined'); these are where the MAN is. */
export const STAGES: StageSpec[] = [
  { id: 'to_do',   title: 'To do',    hint: 'Nobody has tried him yet' },
  { id: 'chasing', title: 'Chasing',  hint: 'Texted or rung, no answer yet' },
  { id: 'talking', title: 'Talking',  hint: 'He came back to us' },
  { id: 'coming',  title: 'Coming',   hint: 'He said yes to a day' },
  { id: 'booked',  title: 'Booked',   hint: 'This is the man for this viewing' },
  { id: 'been',    title: 'Been',     hint: 'He walked the house' },
  { id: 'no',      title: 'No',       hint: 'Not doing this one' },
];

export const STAGE_IDS: BuilderStage[] = STAGES.map((s) => s.id);

export function isBuilderStage(v: string): v is BuilderStage {
  return (STAGE_IDS as string[]).includes(v);
}

export interface BoardCard {
  outreachId: string;
  propertyId: string;
  builderId: string;
  builderName: string;
  builderPhone: string;
  contactId: string | null;
  stage: BuilderStage;
  status: string;
  channel: string;
  callOutcome: string | null;
  sentAt: string | null;
  repliedAt: string | null;
  declinedAt: string | null;
  agreedAt: string | null;
  comeBackAt: string | null;
  comeBackNote: string | null;
  attendedAt: string | null;
  quoteAmount: number | null;
  quoteNote: string | null;
  chargesAmount: number | null;
  addressSentAt: string | null;
  lastInboundAt: string | null;
  lastInboundBody: string;
  lastOutboundAt: string | null;
  /** He came back AFTER the viewing. Strong evidence he went, never proof. */
  reportedAt: string | null;
  /** Pictures he sent us. An empty body with media on it is not an empty
   *  message, and treating it as one is exactly what hid JL Brickwork's ten
   *  photographs of 81 Lisle Road. */
  mediaCount: number;
  mediaMessageIds: string[];
}

export interface BoardHouse {
  propertyId: string;
  address: string;
  viewingAddress: string | null;
  viewingAt: string | null;
  houseNumberKnown: boolean;
  assignedBuilderId: string | null;
  cards: BoardCard[];
}

// ---------------------------------------------------------------------------
// Alerts. Each one is a sentence Pedro can act on, never a code.
// ---------------------------------------------------------------------------

export type AlertKind =
  | 'reported'
  | 'no_address'
  | 'unanswered'
  | 'wrong_day'
  | 'come_back_due'
  | 'charges';

export interface Alert {
  kind: AlertKind;
  /** 'stop' is red and means the viewing fails if nobody acts. */
  tone: 'stop' | 'warn';
  text: string;
}

/** Only the stages where somebody has actually agreed to turn up. A builder in
 *  Chasing does not need the address yet, and flagging him would train Pedro to
 *  ignore the flag that matters. */
const NEEDS_ADDRESS: BuilderStage[] = ['coming', 'booked'];

/** He came back after the viewing and nobody has marked him as having gone.
 *  First, above everything: this is the whole point of inviting him. */
export function reportedButNotMarked(card: BoardCard): boolean {
  return Boolean(card.reportedAt) && card.stage !== 'been' && card.stage !== 'no';
}

export function alertsFor(card: BoardCard, house: BoardHouse, now: number = Date.now()): Alert[] {
  const out: Alert[] = [];

  // JL Brickwork walked 81 Lisle Road and sent ten photographs and a written
  // condition report the next day. The board had him in Coming, on a viewing
  // two days past, saying he "said yes but is not booked in".
  if (reportedButNotMarked(card)) {
    out.push({
      kind: 'reported',
      tone: 'stop',
      text: card.mediaCount > 0
        ? `He came back after the viewing with ${card.mediaCount} photo${card.mediaCount > 1 ? 's' : ''}. Read it and mark him Been.`
        : 'He came back after the viewing. Read it and mark him Been.',
    });
  }

  // A man who reported back plainly found the house, so nagging about the
  // address would be the board arguing with the evidence in front of it.
  if (NEEDS_ADDRESS.includes(card.stage) && !card.addressSentAt && !card.reportedAt) {
    out.push({
      kind: 'no_address',
      tone: 'stop',
      text: house.houseNumberKnown
        ? 'He has not been sent the house number'
        : 'No house number on this property yet, so nobody can be sent one',
    });
  }

  // He spoke last and nobody answered. The same read-time comparison the inbox
  // uses, and it is what would have caught M Riding builders texting "I won't
  // be able to make tomorrow" against a house that still read as covered.
  if (card.lastInboundAt && newer(card.lastInboundAt, card.lastOutboundAt)) {
    out.push({
      kind: 'unanswered',
      tone: card.stage === 'booked' || card.stage === 'coming' ? 'stop' : 'warn',
      text: `He said something and nobody has answered: "${trim(card.lastInboundBody, 80)}"`,
    });
  }

  // Fox Built: "I'm not available this Friday, I can do Wednesday 2nd September
  // at 5pm." Marked as coming, to a day that was not the viewing.
  if (card.agreedAt && house.viewingAt && !sameMinute(card.agreedAt, house.viewingAt)) {
    out.push({
      kind: 'wrong_day',
      tone: 'warn',
      text: `He agreed to ${ukWhen(card.agreedAt)}, the viewing is ${ukWhen(house.viewingAt)}`,
    });
  }

  if (card.comeBackAt && new Date(card.comeBackAt).getTime() <= now) {
    out.push({
      kind: 'come_back_due',
      tone: 'warn',
      text: card.comeBackNote
        ? `Ring him back today: ${trim(card.comeBackNote, 60)}`
        : 'Ring him back today, he asked us to',
    });
  }

  if (card.chargesAmount && card.chargesAmount > 0) {
    out.push({
      kind: 'charges',
      tone: 'warn',
      text: `He charges ${money(card.chargesAmount)} to attend`,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// The lane header. This is the answer to "which builder is on which house".
// ---------------------------------------------------------------------------

export type HouseState = 'covered' | 'at_risk' | 'uncovered' | 'done';

export interface HouseVerdict {
  state: HouseState;
  /** The whole point of the header: readable without clicking anything. */
  line: string;
  builderName: string | null;
  hoursAway: number | null;
  urgent: boolean;
}

const URGENT_HOURS = 48;

export function verdictFor(house: BoardHouse, now: number = Date.now()): HouseVerdict {
  const hoursAway = house.viewingAt
    ? (new Date(house.viewingAt).getTime() - now) / 3_600_000
    : null;
  const past = hoursAway !== null && hoursAway < 0;
  const urgent = hoursAway !== null && hoursAway >= 0 && hoursAway <= URGENT_HOURS;

  const been = house.cards.filter((c) => c.stage === 'been');
  if (been.length > 0) {
    const quoted = been.filter((c) => c.quoteAmount != null);
    return {
      state: 'done',
      builderName: been[0].builderName,
      hoursAway,
      urgent: false,
      line: quoted.length > 0
        ? `${been[0].builderName} walked it, ${money(quoted[0].quoteAmount as number)}`
        : `${been[0].builderName} walked it, no price back yet`,
    };
  }

  // Somebody came back after the viewing and nobody has marked him as gone.
  // Ranked above every stage, because a man who did the job outranks a board
  // column that says he did not. Hugo, reading the first build: "Lisle looks
  // its already done and builder send photo via whatsapp."
  const reported = house.cards.filter(reportedButNotMarked);
  if (reported.length > 0) {
    const r = reported[0];
    return {
      state: 'at_risk',
      builderName: r.builderName,
      hoursAway,
      urgent: false,
      line: r.mediaCount > 0
        ? `${r.builderName} went and sent ${r.mediaCount} photos, mark him Been`
        : `${r.builderName} came back after the viewing, mark him Been`,
    };
  }

  const booked = house.cards.filter((c) => c.stage === 'booked');
  if (booked.length === 0) {
    const coming = house.cards.filter((c) => c.stage === 'coming');
    if (coming.length > 0) {
      return {
        state: 'at_risk',
        builderName: coming[0].builderName,
        hoursAway,
        urgent,
        line: `${coming[0].builderName} said yes but is not booked in`,
      };
    }
    return {
      state: 'uncovered',
      builderName: null,
      hoursAway,
      urgent,
      line: past ? 'Nobody went' : 'Nobody booked',
    };
  }

  const first = booked[0];
  const stops = alertsFor(first, house, now).filter((a) => a.tone === 'stop');
  if (stops.length > 0) {
    return {
      state: 'at_risk',
      builderName: first.builderName,
      hoursAway,
      urgent,
      line: `${first.builderName}, but ${lower(stops[0].text)}`,
    };
  }
  return {
    state: 'covered',
    builderName: first.builderName,
    hoursAway,
    urgent,
    line: `${first.builderName} is booked`,
  };
}

/** Soonest viewing first, and a house nobody is going to outranks a house that
 *  is sorted. Recency is the wrong order here: it buries tomorrow's empty
 *  viewing under one that is three weeks out. */
export function orderHouses(houses: BoardHouse[], now: number = Date.now()): BoardHouse[] {
  const rank: Record<HouseState, number> = { at_risk: 0, uncovered: 1, covered: 2, done: 3 };
  return [...houses].sort((a, b) => {
    const va = verdictFor(a, now);
    const vb = verdictFor(b, now);
    const ua = va.urgent && va.state !== 'covered' && va.state !== 'done';
    const ub = vb.urgent && vb.state !== 'covered' && vb.state !== 'done';
    if (ua !== ub) return ua ? -1 : 1;
    if (rank[va.state] !== rank[vb.state]) return rank[va.state] - rank[vb.state];
    return time(a.viewingAt) - time(b.viewingAt);
  });
}

/** Within a column: the loudest card first, then the newest thing said. */
export function orderCards(cards: BoardCard[], house: BoardHouse, now: number = Date.now()): BoardCard[] {
  return [...cards].sort((a, b) => {
    const sa = alertsFor(a, house, now).some((x) => x.tone === 'stop');
    const sb = alertsFor(b, house, now).some((x) => x.tone === 'stop');
    if (sa !== sb) return sa ? -1 : 1;
    const ia = time(a.lastInboundAt);
    const ib = time(b.lastInboundAt);
    if (ia !== ib) return ib - ia;
    return a.builderName.localeCompare(b.builderName);
  });
}

export function cardsInStage(house: BoardHouse, stage: BuilderStage, now?: number): BoardCard[] {
  return orderCards(house.cards.filter((c) => c.stage === stage), house, now);
}

/** A house has one slot. Dragging a second builder into Booked has to say so
 *  rather than silently swap, or two men turn up at one door. */
export function bookedOther(house: BoardHouse, outreachId: string): BoardCard | null {
  return house.cards.find((c) => c.stage === 'booked' && c.outreachId !== outreachId) ?? null;
}

/** One builder, two viewings, same hour. It has already happened once. */
export function clashingHouses(houses: BoardHouse[]): Map<string, string[]> {
  const byBuilder = new Map<string, { at: number; address: string }[]>();
  for (const h of houses) {
    if (!h.viewingAt) continue;
    for (const c of h.cards) {
      if (c.stage !== 'booked' && c.stage !== 'coming') continue;
      const at = new Date(c.agreedAt ?? h.viewingAt).getTime();
      const list = byBuilder.get(c.builderId) ?? [];
      list.push({ at, address: h.address });
      byBuilder.set(c.builderId, list);
    }
  }
  const out = new Map<string, string[]>();
  for (const [builderId, slots] of byBuilder) {
    if (slots.length < 2) continue;
    const clash = slots.some((a, i) =>
      slots.some((b, j) => i !== j && Math.abs(a.at - b.at) < 3 * 3_600_000));
    if (clash) out.set(builderId, slots.map((s) => s.address));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Small shared formatting. UK time always: Pedro works from the Philippines and
// 2pm has to stay 2pm.
// ---------------------------------------------------------------------------

export function ukWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).replace(':00', '');
}

export function countdown(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'No time booked';
  const ms = new Date(iso).getTime() - now;
  if (ms < 0) {
    const h = Math.round(-ms / 3_600_000);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `in ${Math.max(1, Math.round(ms / 60_000))}m`;
  if (h < 24) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}

export function money(n: number): string {
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}

function time(iso: string | null): number {
  return iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY;
}

function newer(a: string, b: string | null): boolean {
  return !b || new Date(a).getTime() > new Date(b).getTime();
}

function sameMinute(a: string, b: string): boolean {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 60_000;
}

function trim(s: string, n: number): string {
  const clean = (s ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n - 1)}.` : clean;
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
