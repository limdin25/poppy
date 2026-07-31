// The webhook's decision, as a pure function: given a verified Stripe event,
// what happens? Isolation-by-metadata (the shared-account pattern the Elsie
// repo already uses): anything not stamped app='ugc' is ignored with a 200 so
// Stripe never retries someone else's event at us.

import { PACK_CREDITS } from './pricing';

export type WebhookDecision =
  | { action: 'ignore'; why: string }
  | { action: 'apply_purchase'; sessionId: string; userId: string; credits: number; amountPence: number }
  | { action: 'clawback'; sessionId: string };

interface StripeEventLike {
  type: string;
  data: {
    object: {
      id?: string;
      metadata?: Record<string, string> | null;
      amount_total?: number | null;
      payment_status?: string;
    };
  };
}

export function decideWebhook(event: StripeEventLike): WebhookDecision {
  const object = event.data.object;

  if (event.type === 'checkout.session.completed') {
    if (object.metadata?.['app'] !== 'ugc') {
      return { action: 'ignore', why: 'not a ugc session' };
    }
    const userId = object.metadata?.['user_id'];
    if (!userId || !object.id) return { action: 'ignore', why: 'missing user_id or session id' };
    if (object.payment_status && object.payment_status !== 'paid') {
      return { action: 'ignore', why: `payment_status ${object.payment_status}` };
    }
    return {
      action: 'apply_purchase',
      sessionId: object.id,
      userId,
      credits: PACK_CREDITS,
      amountPence: object.amount_total ?? 0,
    };
  }

  if (event.type === 'charge.refunded') {
    const sessionId = object.metadata?.['app'] === 'ugc' ? object.metadata?.['session_id'] : undefined;
    if (!sessionId) return { action: 'ignore', why: 'refund without a ugc session marker' };
    return { action: 'clawback', sessionId };
  }

  return { action: 'ignore', why: `unhandled type ${event.type}` };
}
