import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Records the last insert payload per table; lookups (maybeSingle) return null so
// the helper always creates; inserts (single) return a canned id per table.
let inserts: Record<string, any> = {};
const IDS: Record<string, { id: string }> = {
  contacts: { id: 'ct-1' },
  conversations: { id: 'cv-1' },
  messages: { id: 'm-1' },
};

function makeSupabase() {
  const from = (table: string) => {
    const b: Record<string, any> = {};
    for (const m of ['select', 'eq', 'or', 'order', 'limit', 'update', 'delete']) b[m] = () => b;
    b.insert = (payload: any) => { inserts[table] = payload; return b; };
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.single = () => Promise.resolve({ data: IDS[table] ?? null, error: null });
    b.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
    return b;
  };
  return { from };
}

async function load() {
  return (await import('../api/lib/inbox-log')).logOutboundMessage;
}

beforeEach(() => {
  inserts = {};
  vi.resetModules();
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => makeSupabase() }));
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('logOutboundMessage', () => {
  it('creates an email contact + conversation + outbound message', async () => {
    const logOutboundMessage = await load();
    const out = await logOutboundMessage({
      businessId: 'biz-1', channel: 'email', toEmail: 'jane@example.com',
      body: 'Your quote is attached', subject: 'Quote', externalId: 'resend-1', via: 'resend',
    });
    expect(out).toEqual({ conversationId: 'cv-1', messageId: 'm-1' });
    expect(inserts.contacts.email).toBe('jane@example.com');
    expect(inserts.conversations.channel).toBe('email');
    expect(inserts.conversations.subject).toBe('Quote');
    expect(inserts.messages.direction).toBe('outbound');
    expect(inserts.messages.sender).toBe('ai');
    expect(inserts.messages.body).toBe('Your quote is attached');
    expect(inserts.messages.metadata.via).toBe('resend');
  });

  it('creates an SMS conversation keyed by phone', async () => {
    const logOutboundMessage = await load();
    const out = await logOutboundMessage({
      businessId: 'biz-1', channel: 'sms', toPhone: '+447111222333',
      body: 'See you at 3pm', via: 'twilio_sms',
    });
    expect(out.conversationId).toBe('cv-1');
    expect(inserts.contacts.phone).toBe('+447111222333');
    expect(inserts.conversations.channel).toBe('sms');
    expect(inserts.conversations.subject).toBeNull();
    expect(inserts.messages.metadata.via).toBe('twilio_sms');
  });

  it('creates a WhatsApp conversation and stores the number on the contact', async () => {
    const logOutboundMessage = await load();
    await logOutboundMessage({
      businessId: 'biz-1', channel: 'whatsapp', toPhone: '+447999888777',
      body: 'On my way', via: 'unipile',
    });
    expect(inserts.contacts.whatsapp).toBe('+447999888777');
    expect(inserts.conversations.channel).toBe('whatsapp');
  });
});
