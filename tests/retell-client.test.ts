import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the Retell API client functions
// We mock fetch globally since these are API calls

let mockFetchResponse: { ok: boolean; status: number; body: unknown };

beforeEach(() => {
  mockFetchResponse = { ok: true, status: 200, body: {} };
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({
      ok: mockFetchResponse.ok,
      status: mockFetchResponse.status,
      json: () => Promise.resolve(mockFetchResponse.body),
      text: () => Promise.resolve(JSON.stringify(mockFetchResponse.body)),
    })
  ));
  vi.stubEnv('RETELL_API_KEY', 'test_key_123');
});

describe('Retell LLM API', () => {
  it('creates LLM with general_prompt and returns llm_id', async () => {
    mockFetchResponse = {
      ok: true,
      status: 201,
      body: { llm_id: 'llm_test123', version: 1 },
    };

    const res = await fetch('https://api.retellai.com/create-retell-llm', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test_key_123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        general_prompt: 'You are the AI receptionist for Test Business.',
        model: 'gpt-4.1-mini',
        general_tools: [{ name: 'end_call', type: 'end_call' }],
      }),
    });

    const data = await res.json();
    expect(data.llm_id).toBe('llm_test123');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.retellai.com/create-retell-llm',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('updates LLM prompt', async () => {
    mockFetchResponse = {
      ok: true,
      status: 200,
      body: { llm_id: 'llm_test123', version: 2 },
    };

    const res = await fetch('https://api.retellai.com/update-retell-llm/llm_test123', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer test_key_123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        general_prompt: 'Updated prompt here.',
      }),
    });

    const data = await res.json();
    expect(data.version).toBe(2);
  });
});

describe('Retell Agent API', () => {
  it('creates agent referencing an llm_id', async () => {
    mockFetchResponse = {
      ok: true,
      status: 201,
      body: { agent_id: 'agent_test456' },
    };

    const res = await fetch('https://api.retellai.com/create-agent', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test_key_123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agent_name: 'Test Receptionist',
        response_engine: {
          type: 'retell-llm',
          llm_id: 'llm_test123',
        },
        voice_id: 'retell-Willa',
        language: 'en-GB',
      }),
    });

    const data = await res.json();
    expect(data.agent_id).toBe('agent_test456');
  });

  it('updates agent webhook_url', async () => {
    mockFetchResponse = {
      ok: true,
      status: 200,
      body: { agent_id: 'agent_test456', webhook_url: 'https://poppy-henna.vercel.app/api/webhooks/retell' },
    };

    const res = await fetch('https://api.retellai.com/update-agent/agent_test456', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer test_key_123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        webhook_url: 'https://poppy-henna.vercel.app/api/webhooks/retell',
      }),
    });

    const data = await res.json();
    expect(data.webhook_url).toBe('https://poppy-henna.vercel.app/api/webhooks/retell');
  });
});

describe('Retell Phone Import API', () => {
  it('imports existing Twilio number with termination URI', async () => {
    mockFetchResponse = {
      ok: true,
      status: 201,
      body: {
        phone_number: '+447426495169',
        phone_number_type: 'custom',
        inbound_agent_id: 'agent_test456',
      },
    };

    const res = await fetch('https://api.retellai.com/import-phone-number', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test_key_123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone_number: '+447426495169',
        termination_uri: 'retellerminationsipuri.pstn.twilio.com',
        inbound_agents: [{ agent_id: 'agent_test456', weight: 1 }],
      }),
    });

    const data = await res.json();
    expect(data.phone_number).toBe('+447426495169');
    expect(data.phone_number_type).toBe('custom');
  });
});
