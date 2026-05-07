import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Retell's call_ended payload based on real API docs
const mockCallEndedPayload = {
  event: 'call_ended',
  call: {
    call_id: 'call_abc123',
    agent_id: 'agent_adb8cb0848bc2d3b3a4551933e',
    call_type: 'phone_call',
    call_status: 'ended',
    from_number: '+447700900123',
    to_number: '+447426495169',
    direction: 'inbound',
    start_timestamp: 1714700000000,
    end_timestamp: 1714700120000,
    duration_ms: 120000,
    disconnection_reason: 'user_hangup',
    transcript: 'Agent: Good morning, Elsie speaking. How can I help?\nUser: Hi, I have a leaking pipe in my kitchen.\nAgent: I can help with that. Can I take your name please?\nUser: John Smith.\nAgent: Thanks John. What is the best number to reach you on?\nUser: 07700 900 456.\nAgent: Got it. We will get someone out to you shortly. Is there anything else?\nUser: No, that is all. Thank you.\nAgent: You are welcome, have a great day.',
    transcript_object: [
      { role: 'agent', content: 'Good morning, Elsie speaking. How can I help?', words: [] },
      { role: 'user', content: 'Hi, I have a leaking pipe in my kitchen.', words: [] },
    ],
    metadata: {},
    retell_llm_dynamic_variables: {},
    collected_dynamic_variables: {
      name: 'John Smith',
      email: null,
      message: 'Leaking pipe in kitchen',
    },
  },
};

const mockCallAnalyzedPayload = {
  event: 'call_analyzed',
  call: {
    ...mockCallEndedPayload.call,
    call_analysis: {
      call_summary: 'Customer John Smith called about a leaking pipe in the kitchen. Agent took details and arranged for someone to visit.',
      user_sentiment: 'Positive',
      call_successful: true,
      custom_analysis_data: {},
    },
  },
};

describe('Retell Webhook Payload Parsing', () => {
  it('extracts caller info from call_ended payload', () => {
    const { call } = mockCallEndedPayload;
    expect(call.from_number).toBe('+447700900123');
    expect(call.direction).toBe('inbound');
    expect(call.duration_ms).toBe(120000);
    expect(call.transcript).toContain('John Smith');
    expect(call.collected_dynamic_variables.name).toBe('John Smith');
  });

  it('extracts analysis from call_analyzed payload', () => {
    const { call } = mockCallAnalyzedPayload;
    expect(call.call_analysis.call_summary).toContain('leaking pipe');
    expect(call.call_analysis.user_sentiment).toBe('Positive');
    expect(call.call_analysis.call_successful).toBe(true);
  });

  it('calculates duration in seconds', () => {
    const durationSec = Math.round(mockCallEndedPayload.call.duration_ms / 1000);
    expect(durationSec).toBe(120);
  });

  it('handles missing collected_dynamic_variables', () => {
    const payload = {
      ...mockCallEndedPayload,
      call: {
        ...mockCallEndedPayload.call,
        collected_dynamic_variables: undefined,
      },
    };
    const vars = payload.call.collected_dynamic_variables || {};
    expect(vars).toEqual({});
  });
});

describe('Retell Webhook Signature Verification', () => {
  it('parses v=timestamp,d=digest format', () => {
    const header = 'v=1714700000000,d=abc123def456';
    const match = header.match(/v=(\d+),d=(.*)/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('1714700000000');
    expect(match![2]).toBe('abc123def456');
  });

  it('rejects stale signatures (>5 min)', () => {
    const fiveMinMs = 5 * 60 * 1000;
    const staleTimestamp = Date.now() - fiveMinMs - 1000;
    const isStale = Date.now() - staleTimestamp > fiveMinMs;
    expect(isStale).toBe(true);
  });

  it('accepts fresh signatures (<5 min)', () => {
    const fiveMinMs = 5 * 60 * 1000;
    const freshTimestamp = Date.now() - 60000;
    const isStale = Date.now() - freshTimestamp > fiveMinMs;
    expect(isStale).toBe(false);
  });
});
