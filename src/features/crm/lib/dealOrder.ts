// dealOrder: which instruction the pipeline card shows, the brain's newest
// order or the call-outcome brief, whichever is fresher.
//
// Hugo, 2026-08-17: the cockpit said "Reply holding at 96,375" while the DDM
// card said "Renegotiate" and "Ring Doug", both written before the branch's
// reply. "It's not informing what to do on the pipeline."
//
// Pure on purpose, so the whole decision is testable without a browser
// (tests/deal-orders-on-board.test.ts). The pinned note is NOT decided here:
// Hugo's standing ruling always renders, above whichever line wins.

import type { NextStepBrief } from '../../../../api/lib/next-step-brief';

/** One row from the wk_deal_orders RPC, the board's only safe door into the
 *  brain's log. For a non-admin a hidden judgement arrives with `instruction`
 *  null and, when it is Hugo's lane, `blockedOnHugo` true. */
export interface DealOrder {
  instruction: string | null;
  action: string | null;
  who: string | null;
  confidence: string | null;
  /** When the brain judged (ISO). */
  at: string;
  blockedOnHugo: boolean;
}

export interface OrderedStep {
  /** 'order' = the brain's line, 'brief' = the call-outcome line,
   *  'hugo' = the deal is alive and waiting on Hugo, nothing else showable. */
  kind: 'order' | 'brief' | 'hugo';
  text: string;
  /** For the tooltip on a brain order. */
  confidence?: string | null;
  at?: string | null;
}

/** The line the card shows. Freshest information wins in either direction:
 *  a call outcome pressed a minute ago knows more than last night's sweep,
 *  and a judgement made after the branch replied knows more than a brief
 *  written before it. */
export function orderedStep(
  brief: NextStepBrief | null | undefined,
  order: DealOrder | null | undefined,
): OrderedStep | null {
  const briefStep = brief?.do_now?.[0] ?? null;
  const briefAt = Date.parse(brief?.written_at ?? '');
  const orderAt = Date.parse(order?.at ?? '');
  const orderFresher = Number.isFinite(orderAt)
    && (!Number.isFinite(briefAt) || orderAt > briefAt);

  if (order && orderFresher) {
    if (order.instruction?.trim()) {
      return {
        kind: 'order', text: order.instruction.trim(),
        confidence: order.confidence, at: order.at,
      };
    }
    // A hidden judgement: never fall back to the stale brief (that is the
    // Zest bug), say whose move it is when we may, else show nothing new.
    if (order.blockedOnHugo) return { kind: 'hugo', text: 'Hugo is on this one' };
  }
  if (briefStep) return { kind: 'brief', text: briefStep };
  return null;
}
