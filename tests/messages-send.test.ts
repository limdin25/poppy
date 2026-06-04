import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Canned rows per table for the mocked supabase.
let state: Record<string, { row?: unknown; list?: unknown[] }> = {};

const resendSend = vi.fn().mockResolvedValue({ id: 'resend-1' });
let fetchMock: ReturnType<typeof vi.fn>;

function makeSupabase() {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      insert: () => builder,
      update: () => builder,
      delete: () => builder,
      limit: () => Promise.resolve({ data: state[table]?.list ?? [], error: null }),
      maybeSingle: () => Promise.resolve({ data: state[table]?.row ?? null, error: null }),
      single: () => Promise.resolve({ data: state[table]?.row ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    };
    return builder;
  };
  return { from };
}

function jsonReq(body: unknown): Request {
  return new Request('https://app.heyelsie.com/api/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-jwt' },
    body: JSON.stringify(body),
  });
}

async function loadHandler(): Promise<(r: Request) => Promise<Response>> {
  return (await import('../api/messages/send')).default;
}

beforeEach(() => {
  state = {
    conversations: { row: { id: 'c1', business_id: 'biz-1', contact_id: 'ct1', channel: 'email', is_group: false, unipile_chat_id: null } },
    contacts: { row: { id: 'ct1', phone: null, whatsapp: null, email: 'caller@example.com', name: 'Caller' } },
    messages: { row: { id: 'msg-1' }, list: [] },
    channels: { row: null },
  };
  resendSend.mockClear();

  vi.resetModules();
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  vi.stubEnv('UNIPILE_TOKEN', 'uni-token');
  vi.stubEnv('UNIPILE_DSN', 'api.unipile.test');

  fetchMock = vi.fn(() => Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify({ email_id: 'unipile-1' })),
  }));
  vi.stubGlobal('fetch', fetchMock);

  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => makeSupabase() }));
  vi.doMock('../api/lib/auth', () => ({ requireAuth: () => Promise.resolve({ businessId: 'biz-1', userId: 'u1' }) }));
  vi.doMock('../src/integrations/resend/client', () => ({ sendEmail: resendSend }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('messages/send email transport', () => {
  it('sends via Resend when sender=resend, without needing a connected inbox', async () => {
    state.channels = { row: null }; // no connected Unipile email account
    const handler = await loadHandler();
    const res = await handler(jsonReq({ conversationId: 'c1', body: 'Here is your quote', sender: 'resend' }));
    expect(res.status).toBe(200);
    expect(resendSend).toHaveBeenCalledOnce();
    expect(resendSend.mock.calls[0][0]).toBe('caller@example.com');
    // Unipile must NOT be called on the Resend path
    const unipileCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('unipile'));
    expect(unipileCalls).toHaveLength(0);
  });

  it('sends via the connected Gmail (Unipile) when sender=gmail', async () => {
    state.channels = { row: { id: 'ch1', unipile_account_id: 'acc-1' } };
    const handler = await loadHandler();
    const res = await handler(jsonReq({ conversationId: 'c1', body: 'Hello', sender: 'gmail' }));
    expect(res.status).toBe(200);
    expect(resendSend).not.toHaveBeenCalled();
    const emailCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/v1/emails'));
    expect(emailCalls).toHaveLength(1);
  });

  it('errors when sender=gmail but no inbox is connected', async () => {
    state.channels = { row: null };
    const handler = await loadHandler();
    const res = await handler(jsonReq({ conversationId: 'c1', body: 'Hello', sender: 'gmail' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('No connected email channel');
    expect(resendSend).not.toHaveBeenCalled();
  });
});
