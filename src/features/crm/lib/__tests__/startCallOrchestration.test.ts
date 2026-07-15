// Pins the contract for the manual dial path:
//   1. POST wk-calls-create  → returns { call_id, allowed }
//   2. spend gate honoured (allowed=false → no dial, no toast pollution)
//   3. dial(phone, { CallId, ContactId }) is called when allowed
//   4. result returns the call_id + the underlying TwilioCall
//   5. failures (HTTP / rejection / no-phone) surface as typed reasons +
//      a single toast — no half-state leak.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startCallOrchestration } from '../startCallOrchestration';

interface FakeCall {
  parameters: Map<string, string>;
  on: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

function fakeTwilioCall(): FakeCall {
  return {
    parameters: new Map(),
    on: vi.fn(),
    disconnect: vi.fn(),
  };
}

const VALID_PHONE = '+447863992555';
const CONTACT_UUID = '11111111-1111-1111-1111-111111111111';
const CALL_UUID = '22222222-2222-2222-2222-222222222222';

let pushToast: ReturnType<typeof vi.fn>;
let invokeCreateCall: ReturnType<typeof vi.fn>;
let dial: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pushToast = vi.fn();
  invokeCreateCall = vi.fn();
  dial = vi.fn();
});

describe('startCallOrchestration — happy path', () => {
  it('mints a call row, dials with CallId param, returns ok with call_id and TwilioCall', async () => {
    const fakeCall = fakeTwilioCall();
    invokeCreateCall.mockResolvedValue({
      data: { call_id: CALL_UUID, allowed: true },
      error: null,
    });
    dial.mockResolvedValue(fakeCall);

    const result = await startCallOrchestration(
      { contactId: CONTACT_UUID, contactName: 'Hugo', phone: VALID_PHONE },
      { invokeCreateCall, dial, pushToast }
    );

    expect(invokeCreateCall).toHaveBeenCalledWith({
      contact_id: CONTACT_UUID,
      to_phone: VALID_PHONE,
    });
    expect(dial).toHaveBeenCalledWith(VALID_PHONE, {
      CallId: CALL_UUID,
      ContactId: CONTACT_UUID,
    });
    expect(result).toEqual({ ok: true, callId: CALL_UUID, twilioCall: fakeCall });
    expect(pushToast).not.toHaveBeenCalled();
  });
});

describe('startCallOrchestration — pre-dial guards', () => {
  it('refuses when phone is empty (does not invoke or dial)', async () => {
    const result = await startCallOrchestration(
      { contactId: CONTACT_UUID, contactName: 'NoPhone', phone: '' },
      { invokeCreateCall, dial, pushToast }
    );

    expect(invokeCreateCall).not.toHaveBeenCalled();
    expect(dial).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_phone');
    expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/phone/i), 'error');
  });

  it('refuses when spend is blocked (no dial)', async () => {
    invokeCreateCall.mockResolvedValue({
      data: { allowed: false, reason: 'daily_limit_exceeded' },
      error: null,
    });

    const result = await startCallOrchestration(
      { contactId: CONTACT_UUID, contactName: 'Hugo', phone: VALID_PHONE },
      { invokeCreateCall, dial, pushToast }
    );

    expect(invokeCreateCall).toHaveBeenCalled();
    expect(dial).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('spend_blocked');
    expect(pushToast).toHaveBeenCalledWith(
      expect.stringContaining('daily_limit_exceeded'),
      'error'
    );
  });
});

describe('startCallOrchestration — server failures', () => {
  it('surfaces wk-calls-create error and never dials', async () => {
    invokeCreateCall.mockResolvedValue({
      data: null,
      error: { message: 'function timeout' },
    });

    const result = await startCallOrchestration(
      { contactId: CONTACT_UUID, contactName: 'Hugo', phone: VALID_PHONE },
      { invokeCreateCall, dial, pushToast }
    );

    expect(dial).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('create_failed');
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('function timeout'), 'error');
  });

  it('treats missing call_id as a create_failed', async () => {
    invokeCreateCall.mockResolvedValue({
      data: { allowed: true }, // no call_id field
      error: null,
    });

    const result = await startCallOrchestration(
      { contactId: CONTACT_UUID, contactName: 'Hugo', phone: VALID_PHONE },
      { invokeCreateCall, dial, pushToast }
    );

    expect(dial).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('create_failed');
  });
});

describe('startCallOrchestration — dial failures', () => {
  it('returns dial_failed when device.dial throws', async () => {
    invokeCreateCall.mockResolvedValue({
      data: { call_id: CALL_UUID, allowed: true },
      error: null,
    });
    dial.mockRejectedValue(new Error('mic permission denied'));

    const result = await startCallOrchestration(
      { contactId: CONTACT_UUID, contactName: 'Hugo', phone: VALID_PHONE },
      { invokeCreateCall, dial, pushToast }
    );

    expect(dial).toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('dial_failed');
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('mic permission denied'), 'error');
  });
});
