// Webhook isolation on the shared Stripe account: only app='ugc' events act,
// everything else 200-ignores, credits come from the pricing canon.

import { describe, it, expect } from 'vitest';
import { decideWebhook } from '../../src/core/stripeWebhook';
import { PACK_CREDITS } from '../../src/core/pricing';

function session(metadata: Record<string, string> | null, extra: Record<string, unknown> = {}) {
  return {
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_123', metadata, amount_total: 4900, payment_status: 'paid', ...extra } },
  };
}

describe('decideWebhook', () => {
  it('a ugc session applies the pack from the canon', () => {
    const d = decideWebhook(session({ app: 'ugc', user_id: 'u1' }));
    expect(d).toEqual({
      action: 'apply_purchase',
      sessionId: 'cs_123',
      userId: 'u1',
      credits: PACK_CREDITS,
      amountPence: 4900,
    });
  });

  it('sessions from OTHER apps on the shared account are ignored', () => {
    expect(decideWebhook(session({ vsl_page_id: 'x' })).action).toBe('ignore');
    expect(decideWebhook(session({ app: 'site-demo', user_id: 'u1' })).action).toBe('ignore');
    expect(decideWebhook(session(null)).action).toBe('ignore');
  });

  it('an unpaid session is ignored even with the right metadata', () => {
    expect(decideWebhook(session({ app: 'ugc', user_id: 'u1' }, { payment_status: 'unpaid' })).action).toBe('ignore');
  });

  it('a session missing user_id is ignored rather than guessed', () => {
    expect(decideWebhook(session({ app: 'ugc' })).action).toBe('ignore');
  });

  it('a ugc-marked refund claws back; unmarked refunds are ignored', () => {
    const refund = {
      type: 'charge.refunded',
      data: { object: { metadata: { app: 'ugc', session_id: 'cs_123' } } },
    };
    expect(decideWebhook(refund)).toEqual({ action: 'clawback', sessionId: 'cs_123' });
    expect(decideWebhook({ type: 'charge.refunded', data: { object: { metadata: {} } } }).action).toBe('ignore');
  });

  it('unknown event types are ignored', () => {
    expect(decideWebhook({ type: 'invoice.created', data: { object: {} } }).action).toBe('ignore');
  });
});
