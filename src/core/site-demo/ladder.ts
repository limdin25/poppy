// The escalation ladder: what, if anything, is due for this lead right now.
//
// PURE. No supabase import, no clock of its own, no side effect. The cron, the
// unit tests and the CRM board all call this one function, so the schedule can
// never drift between what we do and what we show. Same reasoning as
// api/lib/vsl-sequence.ts.
//
// ONE LADDER, ONE STAGE AT A TIME. Every lead is in exactly one place, and
// each stage fires exactly once because the caller records it in
// wk_site_pages.automation before sending.

export type LadderStageKey =
  | 'unopened_1'
  | 'unopened_2'
  | 'engage_1'
  | 'engage_2'
  | 'ai_call_1'
  | 'ai_call_2';

export interface LadderPage {
  state: string;
  sent_at: string | null;
  first_opened_at: string | null;
  first_engaged_at: string | null;
  checkout_sent_at: string | null;
  last_call_at: string | null;
  outbound_call_attempts: number;
  chat_count: number;
  call_count: number;
  automation: Record<string, { count?: number; last_at?: string } | undefined> | null;
}

export interface LadderContext {
  now: Date;
  ownerFirst?: string | null;
  businessName: string;
  /** The public site URL. */
  url: string;
  /** The demo receptionist number, in the form a human would read. */
  demoNumber: string;
  /**
   * When the lead last texted us back. A reply means a human is in the
   * conversation and the machine stands down: nothing below fires afterwards.
   */
  lastInboundAt?: string | null;
  /** From settings. Two, then we leave them alone. */
  maxOutboundCalls: number;
}

export type LadderAction =
  | { kind: 'none'; reason: string }
  | { kind: 'sms'; stage: LadderStageKey; body: string }
  | { kind: 'call'; stage: LadderStageKey; attempt: number };

const HOUR = 3_600_000;
const MINUTE = 60_000;

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

const done = (page: LadderPage, stage: LadderStageKey): boolean =>
  Boolean(page.automation && page.automation[stage]);

/** First name if we have one, otherwise a greeting that does not need one. */
function hi(ownerFirst?: string | null): string {
  const n = String(ownerFirst || '').trim();
  return n ? `Hi ${n}, ` : 'Hi, ';
}

/**
 * The nudge copy. Straight punctuation only, no long dashes and no curly
 * quotes: one of either drops an SMS from 160 characters a segment to 70, so
 * a two part text quietly becomes three on every single send.
 * tests/site-demo-copy.test.ts fails the build over it.
 */
export function ladderCopy(stage: LadderStageKey, ctx: LadderContext): string {
  const who = hi(ctx.ownerFirst);
  switch (stage) {
    case 'unopened_1':
      return `${who}did you get the link to the website I built for ${ctx.businessName}? Here it is again: ${ctx.url}`;
    case 'unopened_2':
      return `${who}I will leave this with you. The site for ${ctx.businessName} is here if you want a look: ${ctx.url}`;
    case 'engage_1':
      return `${who}glad you had a look. Try ringing ${ctx.demoNumber} from this phone and you will hear the AI answer as ${ctx.businessName}.`;
    case 'engage_2':
      return `${who}the number on your site is ${ctx.demoNumber}. Give it a ring and it will answer as ${ctx.businessName}, so you can hear what your customers would get.`;
    default:
      return `${who}the site for ${ctx.businessName} is here: ${ctx.url}`;
  }
}

/**
 * What is due for this page right now, or none.
 *
 * The caller is still responsible for every guard that is not about timing:
 * suppression, do_not_call, the outbound kill switch, quiet hours and the
 * master switch. This function only answers "where are they in the ladder".
 */
export function nextLadderStep(page: LadderPage, ctx: LadderContext): LadderAction {
  const now = ctx.now.getTime();

  // Terminal and near-terminal states. Nothing chases a lead who already bought
  // or who already has a checkout link in hand.
  if (page.state === 'converted') return { kind: 'none', reason: 'converted' };
  if (page.state === 'checkout_sent') return { kind: 'none', reason: 'checkout_sent' };

  // Engagement short-circuits the whole ladder. A lead who chatted or rang the
  // number is having a conversation; the close happens there, not here.
  if (page.state === 'engaged' || page.chat_count > 0 || page.call_count > 0) {
    return { kind: 'none', reason: 'engaged' };
  }

  const sentAt = ms(page.sent_at);
  if (!sentAt) return { kind: 'none', reason: 'not_sent' };

  // A human is in the conversation. Stand down rather than talk over them.
  const inbound = ms(ctx.lastInboundAt);
  if (inbound && inbound >= sentAt) return { kind: 'none', reason: 'lead_replied' };

  const openedAt = ms(page.first_opened_at);

  // ---- Track A: the link was never opened. Two touches, then stop.
  if (!openedAt) {
    if (!done(page, 'unopened_1')) {
      if (now < sentAt + 2 * HOUR) return { kind: 'none', reason: 'too_soon' };
      return { kind: 'sms', stage: 'unopened_1', body: ladderCopy('unopened_1', ctx) };
    }
    if (!done(page, 'unopened_2')) {
      if (now < sentAt + 24 * HOUR) return { kind: 'none', reason: 'too_soon' };
      return { kind: 'sms', stage: 'unopened_2', body: ladderCopy('unopened_2', ctx) };
    }
    // Two touches on a lead who never even opened it. That is enough.
    return { kind: 'none', reason: 'unopened_exhausted' };
  }

  // ---- Track B: opened, but no call and no chat.
  // The 10 minute trigger is the highest value moment in the funnel: they are
  // still looking at it. Everything after this is a fallback.
  if (!done(page, 'engage_1')) {
    if (now < openedAt + 10 * MINUTE) return { kind: 'none', reason: 'too_soon' };
    return { kind: 'sms', stage: 'engage_1', body: ladderCopy('engage_1', ctx) };
  }
  if (!done(page, 'engage_2')) {
    if (now < openedAt + 2 * HOUR) return { kind: 'none', reason: 'too_soon' };
    return { kind: 'sms', stage: 'engage_2', body: ladderCopy('engage_2', ctx) };
  }

  // ---- Track C: we ring them. Capped, and spaced.
  const maxCalls = Math.max(0, ctx.maxOutboundCalls);
  if (page.outbound_call_attempts >= maxCalls) {
    return { kind: 'none', reason: 'calls_exhausted' };
  }
  if (!done(page, 'ai_call_1')) {
    if (now < openedAt + 24 * HOUR) return { kind: 'none', reason: 'too_soon' };
    return { kind: 'call', stage: 'ai_call_1', attempt: 1 };
  }
  if (!done(page, 'ai_call_2')) {
    const lastCall = ms(page.last_call_at) ?? openedAt;
    if (now < lastCall + 4 * HOUR) return { kind: 'none', reason: 'too_soon' };
    return { kind: 'call', stage: 'ai_call_2', attempt: 2 };
  }

  return { kind: 'none', reason: 'ladder_complete' };
}

/** Every stage, in order. Used by the board to render progress. */
export const LADDER_STAGES: LadderStageKey[] = [
  'unopened_1',
  'unopened_2',
  'engage_1',
  'engage_2',
  'ai_call_1',
  'ai_call_2',
];

export const LADDER_STAGE_LABELS: Record<LadderStageKey, string> = {
  unopened_1: 'Nudge 1, not opened',
  unopened_2: 'Nudge 2, not opened',
  engage_1: 'Nudge 1, opened',
  engage_2: 'Nudge 2, opened',
  ai_call_1: 'AI call 1',
  ai_call_2: 'AI call 2',
};
