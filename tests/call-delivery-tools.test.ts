import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mutable rows the mocked supabase returns for the `channels` lookups.
let channelRow: Record<string, unknown> | null = null;

const sendNotification = vi.fn().mockResolvedValue({ id: 'email-1' });
const sendSMS = vi.fn().mockResolvedValue({ sid: 'sms-1' });
const sendToChat = vi.fn().mockResolvedValue({ id: 'wa-1' });
const webSearch = vi.fn().mockResolvedValue({
  answer: '42',
  results: [{ title: 'Answer', url: 'https://x', content: 'forty two' }],
});

function makeSupabase() {
  const chain = (data: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'or', 'order', 'limit']) c[m] = () => c;
    c.single = () => Promise.resolve({ data: data(), error: null });
    c.maybeSingle = () => Promise.resolve({ data: data(), error: null });
    return c;
  };
  return { from: (table: string) => chain(() => (table === 'channels' ? channelRow : null)) };
}

const TOOL_SECRET = 'secret-xyz';

function req(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://app.heyelsie.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
const authed = { 'x-tool-secret': TOOL_SECRET };

async function load(path: string): Promise<(r: Request) => Promise<Response>> {
  return (await import(path)).default;
}

beforeEach(() => {
  channelRow = null;
  sendNotification.mockClear();
  sendSMS.mockClear();
  sendToChat.mockClear();
  webSearch.mockClear();

  vi.resetModules();
  vi.stubEnv('TOOL_SECRET', TOOL_SECRET);
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');

  vi.doMock('@supabase/supabase-js', () => ({ createClient: () => makeSupabase() }));
  vi.doMock('../src/integrations/resend/client', () => ({ sendNotification }));
  vi.doMock('../src/integrations/twilio/client', () => ({ sendSMS }));
  vi.doMock('../src/integrations/unipile/client', () => ({ sendToChat }));
  vi.doMock('../src/integrations/tavily/client', () => ({ webSearch }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('@supabase/supabase-js');
});

describe('send-email tool', () => {
  it('rejects calls without the tool secret', async () => {
    const handler = await load('../api/tools/send-email');
    const res = await handler(req('/api/tools/send-email?bid=biz-1', { args: { to_email: 'a@b.com', body: 'hi' } }));
    expect(res.status).toBe(401);
  });

  it('rejects an invalid email address', async () => {
    const handler = await load('../api/tools/send-email');
    const res = await handler(req('/api/tools/send-email?bid=biz-1', { args: { to_email: 'not-an-email', body: 'hi' } }, authed));
    expect(res.status).toBe(400);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('sends the email and returns a spoken confirmation', async () => {
    const handler = await load('../api/tools/send-email');
    const res = await handler(req('/api/tools/send-email?bid=biz-1', {
      args: { to_email: 'caller@example.com', subject: 'Your quote', body: 'Here is your quote.' },
    }, authed));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.spoken).toContain('caller@example.com');
    expect(sendNotification).toHaveBeenCalledWith('caller@example.com', 'Your quote', 'Here is your quote.');
  });
});

describe('send-sms tool', () => {
  it('400s when the message is missing (before any send)', async () => {
    const handler = await load('../api/tools/send-sms');
    const res = await handler(req('/api/tools/send-sms?bid=biz-1', { args: { to_phone: '+447111' } }, authed));
    expect(res.status).toBe(400);
    expect(sendSMS).not.toHaveBeenCalled();
  });

  it('409s when no voice number is configured', async () => {
    channelRow = null; // no connected voice channel
    const handler = await load('../api/tools/send-sms');
    const res = await handler(req('/api/tools/send-sms?bid=biz-1', { args: { to_phone: '+447111', message: 'hi' } }, authed));
    expect(res.status).toBe(409);
  });

  it('sends from the connected voice number', async () => {
    channelRow = { config: { phone: '+447426495169' } };
    const handler = await load('../api/tools/send-sms');
    const res = await handler(req('/api/tools/send-sms?bid=biz-1', { args: { to_phone: '+447111222333', message: 'See you then' } }, authed));
    expect(res.status).toBe(200);
    expect(sendSMS).toHaveBeenCalledWith('+447426495169', '+447111222333', 'See you then');
  });
});

describe('send-whatsapp tool', () => {
  it('409s when WhatsApp is not connected', async () => {
    channelRow = null;
    const handler = await load('../api/tools/send-whatsapp');
    const res = await handler(req('/api/tools/send-whatsapp?bid=biz-1', { args: { to_phone: '+447111', message: 'hi' } }, authed));
    expect(res.status).toBe(409);
  });

  it('sends via the connected Unipile account', async () => {
    channelRow = { unipile_account_id: 'acc-9' };
    const handler = await load('../api/tools/send-whatsapp');
    const res = await handler(req('/api/tools/send-whatsapp?bid=biz-1', { args: { to_phone: '+447111222333', message: 'On my way' } }, authed));
    expect(res.status).toBe(200);
    expect(sendToChat).toHaveBeenCalledWith('acc-9', '+447111222333', 'On my way');
  });
});

describe('web-search tool', () => {
  it('400s on an empty query', async () => {
    const handler = await load('../api/tools/web-search');
    const res = await handler(req('/api/tools/web-search?bid=biz-1', { args: { query: '' } }, authed));
    expect(res.status).toBe(400);
  });

  it('returns the answer and sources for the agent to speak', async () => {
    const handler = await load('../api/tools/web-search');
    const res = await handler(req('/api/tools/web-search?bid=biz-1', { args: { query: 'meaning of life' } }, authed));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.answer).toBe('42');
    expect(json.spoken).toBe('42');
    expect(json.sources[0].url).toBe('https://x');
    expect(webSearch).toHaveBeenCalledWith('meaning of life', 3);
  });
});
