import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../src/prompts/system-builder';
import type { Business, Service, FAQ, CallInfoType } from '../src/prompts/system-builder';

const BUSINESS: Business = {
  name: 'Smith & Sons Plumbing',
  industry: 'Plumbing',
  address: '12 High Street, Brighton BN1 1AA',
  phone: '+447426495169',
  website: 'https://smithplumbing.co.uk',
  greeting: "Hello, Smith & Sons Plumbing, you're speaking with Elsie. How can I help?",
  tone: 'friendly',
};

const SERVICES: Service[] = [
  { name: 'Emergency Plumbing', description: '24/7 callouts', price_from: 80, bookable: true },
  { name: 'Boiler Service', description: 'Annual service', price_from: 65, price_to: 120, bookable: true },
  { name: 'Drain Unblocking', bookable: false },
];

const FAQS: FAQ[] = [
  { question: 'What are your hours?', answer: 'Mon–Fri 8am–6pm, Sat 9am–1pm.' },
  { question: 'Do you offer free quotes?', answer: 'Yes, no-obligation quotes for all work.' },
];

const CALL_INFO: CallInfoType[] = [
  { name: 'Caller name', fields: [{ name: 'full_name', type: 'text', required: true }], enabled: true },
  { name: 'Email', fields: [{ name: 'email', type: 'email', required: false }], enabled: true },
  { name: 'Budget', fields: [{ name: 'budget', type: 'text' }], enabled: false },
];

describe('buildSystemPrompt', () => {
  it('includes business name in identity line', () => {
    const prompt = buildSystemPrompt(BUSINESS, [], [], []);
    expect(prompt).toContain('# You are the AI receptionist for Smith & Sons Plumbing');
  });

  it('includes all business details', () => {
    const prompt = buildSystemPrompt(BUSINESS, [], [], []);
    expect(prompt).toContain('Industry: Plumbing');
    expect(prompt).toContain('Address: 12 High Street, Brighton BN1 1AA');
    expect(prompt).toContain('Phone: +447426495169');
    expect(prompt).toContain('Website: https://smithplumbing.co.uk');
  });

  it('includes greeting', () => {
    const prompt = buildSystemPrompt(BUSINESS, [], [], []);
    expect(prompt).toContain("you're speaking with Elsie. How can I help?");
  });

  it('includes tone', () => {
    const prompt = buildSystemPrompt(BUSINESS, [], [], []);
    expect(prompt).toContain('Speak in a friendly tone');
  });

  it('defaults tone to professional when not set', () => {
    const biz = { ...BUSINESS, tone: undefined };
    const prompt = buildSystemPrompt(biz, [], [], []);
    expect(prompt).toContain('Speak in a professional tone');
  });

  it('includes services with prices and bookable flag', () => {
    const prompt = buildSystemPrompt(BUSINESS, SERVICES, [], []);
    expect(prompt).toContain('**Emergency Plumbing**');
    expect(prompt).toContain('24/7 callouts');
    expect(prompt).toContain('(from £80)');
    expect(prompt).toContain('[BOOKABLE]');
    expect(prompt).toContain('(from £65 to £120)');
    expect(prompt).toContain('**Drain Unblocking**');
    expect(prompt).not.toMatch(/Drain Unblocking.*\[BOOKABLE\]/);
  });

  it('includes FAQs', () => {
    const prompt = buildSystemPrompt(BUSINESS, [], FAQS, []);
    expect(prompt).toContain('**Q: What are your hours?**');
    expect(prompt).toContain('A: Mon–Fri 8am–6pm, Sat 9am–1pm.');
    expect(prompt).toContain('**Q: Do you offer free quotes?**');
  });

  it('includes only enabled call info types', () => {
    const prompt = buildSystemPrompt(BUSINESS, [], [], CALL_INFO);
    expect(prompt).toContain('### Caller name');
    expect(prompt).toContain('full_name (text)');
    expect(prompt).toContain('*required*');
    expect(prompt).toContain('### Email');
    expect(prompt).not.toContain('### Budget');
  });

  it('includes behaviour rules', () => {
    const prompt = buildSystemPrompt(BUSINESS, [], [], []);
    expect(prompt).toContain('NEVER make up information');
    expect(prompt).toContain('NEVER quote a price');
    expect(prompt).toContain('NEVER book or confirm an appointment');
  });

  it('includes channel-specific rules when channel is provided', () => {
    const prompt = buildSystemPrompt(BUSINESS, [], [], [], 'VOICE');
    expect(prompt).toContain('Keep responses SHORT');
    expect(prompt).toContain('max 2 sentences per turn');
  });

  it('builds a complete prompt with all sections', () => {
    const prompt = buildSystemPrompt(BUSINESS, SERVICES, FAQS, CALL_INFO, 'VOICE');
    expect(prompt).toContain('# You are the AI receptionist');
    expect(prompt).toContain('## Business details');
    expect(prompt).toContain('## Greeting');
    expect(prompt).toContain('## Tone');
    expect(prompt).toContain('## Services offered');
    expect(prompt).toContain('## Frequently Asked Questions');
    expect(prompt).toContain('## Information to collect');
    expect(prompt).toContain('## Behaviour rules');
    expect(prompt).toContain('## Channel: VOICE');
  });

  it('omits empty sections gracefully', () => {
    const biz: Business = { name: 'Bare Bones Ltd' };
    const prompt = buildSystemPrompt(biz, [], [], []);
    expect(prompt).toContain('# You are the AI receptionist for Bare Bones Ltd');
    expect(prompt).not.toContain('## Business details');
    expect(prompt).not.toContain('## Greeting');
    expect(prompt).not.toContain('## Services offered');
    expect(prompt).not.toContain('## Frequently Asked Questions');
    expect(prompt).not.toContain('## Information to collect');
    expect(prompt).toContain('## Behaviour rules');
  });

  it('includes booking section when bookable services exist', () => {
    const prompt = buildSystemPrompt(BUSINESS, SERVICES, [], []);
    expect(prompt).toContain('## Booking');
    expect(prompt).toContain('check_availability');
    expect(prompt).toContain('book_appointment');
  });

  it('omits booking section when no bookable services', () => {
    const nonBookable = [{ name: 'Consulting', bookable: false }];
    const prompt = buildSystemPrompt(BUSINESS, nonBookable, [], []);
    expect(prompt).not.toContain('## Booking');
  });

  it('uses custom working days when provided', () => {
    const prompt = buildSystemPrompt(BUSINESS, [], [], [], undefined, undefined, 'Europe/London', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(prompt).toContain('Mon, Tue, Wed, Thu, Fri, Sat, Sun');
    expect(prompt).not.toContain('Saturday and Sunday) are not available');
  });

  it('includes timezone in booking instructions', () => {
    const prompt = buildSystemPrompt(BUSINESS, SERVICES, [], [], undefined, undefined, 'Europe/London');
    expect(prompt).toContain('Europe/London');
    expect(prompt).toContain('UTC');
  });

  it('defaults to Mon-Fri when no working days provided', () => {
    const prompt = buildSystemPrompt(BUSINESS, [], [], []);
    expect(prompt).toContain('Monday to Friday');
  });
});

describe('sync-prompt API contract', () => {
  it('POST with valid auth returns 200 when everything is set up', async () => {
    const res = await callSyncPrompt({ businessId: 'test-biz-123' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('includes services, FAQs, call_info_types in prompt sent to Retell', async () => {
    await callSyncPrompt({ businessId: 'test-biz-123' });
    const lastCall = mockRetellFetch.mock.calls.find(
      (c: [string, RequestInit]) => c[0].includes('update-retell-llm')
    );
    expect(lastCall).toBeDefined();
    const sentBody = JSON.parse(lastCall![1].body as string);
    expect(sentBody.general_prompt).toContain('Emergency Plumbing');
    expect(sentBody.general_prompt).toContain('What are your hours?');
    expect(sentBody.general_prompt).toContain('Caller name');
  });

  it('sends Retell-format model id (claude-4.6-sonnet, not claude-sonnet-4-6)', async () => {
    await callSyncPrompt({ businessId: 'test-biz-123' });
    const lastCall = mockRetellFetch.mock.calls.find(
      (c: [string, RequestInit]) => c[0].includes('update-retell-llm')
    );
    const sentBody = JSON.parse(lastCall![1].body as string);
    expect(sentBody.model).toBe('claude-4.6-sonnet');
  });

  it('appends ai_system_prompt as custom instructions when set', async () => {
    mockBusinessData.ai_system_prompt = 'Custom prompt override';
    await callSyncPrompt({ businessId: 'test-biz-123' });
    const lastCall = mockRetellFetch.mock.calls.find(
      (c: [string, RequestInit]) => c[0].includes('update-retell-llm')
    );
    const sentBody = JSON.parse(lastCall![1].body as string);
    expect(sentBody.general_prompt).toContain('## Custom instructions from the business owner');
    expect(sentBody.general_prompt).toContain('Custom prompt override');
    expect(sentBody.general_prompt).toContain('Emergency Plumbing');
    mockBusinessData.ai_system_prompt = null;
  });
});

// --- Test helpers: mock Supabase + Retell for the API handler ---

import { vi, beforeEach } from 'vitest';

let mockRetellFetch: ReturnType<typeof vi.fn>;

const mockBusinessData: Record<string, unknown> = {
  name: 'Smith & Sons Plumbing',
  industry: 'Plumbing',
  address: '12 High Street',
  phone: '+447426495169',
  website: 'https://smithplumbing.co.uk',
  greeting: 'Hello!',
  tone: 'friendly',
  ai_system_prompt: null,
};

const mockServicesData = [
  { name: 'Emergency Plumbing', description: '24/7', price_from: 80, price_to: null, bookable: true },
];

const mockFaqsData = [
  { question: 'What are your hours?', answer: 'Mon–Fri 8–6' },
];

const mockCallInfoData = [
  { name: 'Caller name', enabled: true, fields: [{ name: 'full_name', type: 'text', required: true }] },
];

const mockChannelConfig = {
  config: { retell_llm_id: 'llm_test123', retell_agent_id: 'agent_test456' },
};

function makeMockSupabase() {
  const chainable = (finalData: unknown) => {
    const chain: Record<string, unknown> = {};
    const methods = ['select', 'eq', 'or', 'order', 'single', 'limit', 'maybeSingle'];
    for (const m of methods) {
      chain[m] = vi.fn(() => chain);
    }
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: finalData, error: null });
    return chain;
  };

  return {
    from: vi.fn((table: string) => {
      if (table === 'channels') return chainable(mockChannelConfig);
      if (table === 'businesses') return chainable(mockBusinessData);
      if (table === 'services') return chainable(mockServicesData);
      if (table === 'faqs') return chainable(mockFaqsData);
      if (table === 'call_info_types') return chainable(mockCallInfoData);
      if (table === 'knowledge_sources') return chainable([]);
      if (table === 'agents') return chainable(null);
      return chainable(null);
    }),
  };
}

let handler: (req: Request) => Promise<Response>;

beforeEach(async () => {
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  vi.stubEnv('RETELL_API_KEY', 'test-retell-key');

  mockRetellFetch = vi.fn((url: string) => {
    if (typeof url === 'string' && url.includes('list-phone-numbers')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
        text: () => Promise.resolve('[]'),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ llm_id: 'llm_test123' }),
      text: () => Promise.resolve('ok'),
    });
  });

  vi.stubGlobal('fetch', mockRetellFetch);

  vi.doMock('@supabase/supabase-js', () => ({
    createClient: () => makeMockSupabase(),
  }));

  vi.doMock('../api/lib/auth', () => ({
    requireAuth: () => Promise.resolve({ userId: 'user-123', businessId: 'test-biz-123' }),
  }));

  const mod = await import('../api/agent/sync-prompt');
  handler = mod.default;
});

async function callSyncPrompt(body: Record<string, unknown>): Promise<Response> {
  const req = new Request('https://test.local/api/agent/sync-prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handler(req);
}
