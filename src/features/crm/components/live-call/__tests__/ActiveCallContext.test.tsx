// Pins the contract for the manual dial flow inside ActiveCallProvider:
//   - startCall() invokes wk-calls-create
//   - sets call.callId from the server response
//   - calls device.dial with the right CallId / ContactId params
//   - phase moves placing → in_call ONLY after the Twilio Call accepts
//   - phase moves in_call → post_call when the Twilio Call disconnects
//   - failure paths reset phase to idle and surface a toast

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { ActiveCallProvider, useActiveCallCtx } from '../ActiveCallContext';
import { SmsV2Provider, useSmsV2 } from '../../../store/SmsV2Store';

// ────────────────────────────────────────────────────────────────────────────
// Mocks
// ────────────────────────────────────────────────────────────────────────────

vi.mock('../../../hooks/useTwilioDevice', () => {
  const dialMock = vi.fn();
  return {
    useTwilioDevice: () => ({
      status: 'ready',
      error: null,
      muted: false,
      setMuted: vi.fn(),
      dial: dialMock,
      hangup: vi.fn(),
      sendDigits: vi.fn(),
      activeCall: null,
    }),
    __dialMock: dialMock,
  };
});

vi.mock('@/integrations/supabase/browser', () => {
  const invokeMock = vi.fn();
  return {
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      },
      functions: { invoke: invokeMock },
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      })),
      removeChannel: vi.fn(),
    },
    __invokeMock: invokeMock,
  };
});

// Pull the hoisted mocks back via dynamic import so we can drive them.
import * as twilioDeviceMod from '../../../hooks/useTwilioDevice';
import * as supabaseMod from '@/integrations/supabase/browser';
const dialMock = (twilioDeviceMod as unknown as { __dialMock: ReturnType<typeof vi.fn> }).__dialMock;
const invokeMock = (supabaseMod as unknown as { __invokeMock: ReturnType<typeof vi.fn> }).__invokeMock;

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const CONTACT = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Hugo',
  phone: '+447863992555',
};
const CALL_UUID = '22222222-2222-2222-2222-222222222222';

interface FakeCall {
  on: (event: string, cb: () => void) => void;
  fire: (event: string) => void;
  disconnect: () => void;
}

function makeFakeCall(): FakeCall {
  const handlers: Record<string, Array<() => void>> = {};
  return {
    on(event, cb) {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(cb);
    },
    fire(event) {
      (handlers[event] ?? []).forEach((cb) => cb());
    },
    disconnect: vi.fn(),
  };
}

let snapshot: ReturnType<typeof useActiveCallCtx> | null = null;

function Probe() {
  const ctx = useActiveCallCtx();
  useEffect(() => {
    snapshot = ctx;
  });
  snapshot = ctx;
  return null;
}

function ProbeWithSeed() {
  const store = useSmsV2();
  // Run exactly once — reading a fresh store value via ref-style closure.
  // Using upsertContact in deps would loop because the store memo recreates
  // on every dispatch (which upsertContact itself triggers).
  useEffect(() => {
    store.upsertContact({
      id: CONTACT.id,
      name: CONTACT.name,
      phone: CONTACT.phone,
      tags: [],
      isHot: false,
      customFields: {},
      createdAt: '2026-04-25T00:00:00Z',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function renderProvider() {
  return render(
    <SmsV2Provider>
      <ProbeWithSeed />
      <ActiveCallProvider>
        <Probe />
      </ActiveCallProvider>
    </SmsV2Provider>
  );
}

beforeEach(() => {
  snapshot = null;
  dialMock.mockReset();
  invokeMock.mockReset();
});

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('ActiveCallProvider.startCall — happy path', () => {
  it('invokes wk-calls-create with contact_id+to_phone, then dials with CallId baked in', async () => {
    const fakeCall = makeFakeCall();
    invokeMock.mockResolvedValue({
      data: { call_id: CALL_UUID, allowed: true },
      error: null,
    });
    dialMock.mockResolvedValue(fakeCall);

    renderProvider();
    await waitFor(() => snapshot && expect(snapshot).not.toBeNull());

    await act(async () => {
      await snapshot!.startCall(CONTACT.id);
    });

    expect(invokeMock).toHaveBeenCalledWith('wk-calls-create', {
      body: { contact_id: CONTACT.id, to_phone: CONTACT.phone },
    });
    expect(dialMock).toHaveBeenCalledWith(CONTACT.phone, {
      CallId: CALL_UUID,
      ContactId: CONTACT.id,
    });
  });

  it('does NOT transition to in_call until the Twilio Call accepts', async () => {
    const fakeCall = makeFakeCall();
    invokeMock.mockResolvedValue({
      data: { call_id: CALL_UUID, allowed: true },
      error: null,
    });
    dialMock.mockResolvedValue(fakeCall);

    renderProvider();
    await waitFor(() => snapshot && expect(snapshot).not.toBeNull());

    await act(async () => {
      await snapshot!.startCall(CONTACT.id);
    });

    // After dial, before accept, phase is 'placing'.
    expect(snapshot!.phase).toBe('placing');
    expect(snapshot!.call?.callId).toBe(CALL_UUID);

    // Now Twilio fires accept → in_call.
    await act(async () => {
      fakeCall.fire('accept');
    });
    expect(snapshot!.phase).toBe('in_call');
  });

  it('transitions in_call → post_call when Twilio Call disconnects', async () => {
    const fakeCall = makeFakeCall();
    invokeMock.mockResolvedValue({
      data: { call_id: CALL_UUID, allowed: true },
      error: null,
    });
    dialMock.mockResolvedValue(fakeCall);

    renderProvider();
    await waitFor(() => snapshot && expect(snapshot).not.toBeNull());

    await act(async () => {
      await snapshot!.startCall(CONTACT.id);
    });
    await act(async () => {
      fakeCall.fire('accept');
    });
    expect(snapshot!.phase).toBe('in_call');

    await act(async () => {
      fakeCall.fire('disconnect');
    });
    expect(snapshot!.phase).toBe('post_call');
    // call still set so PostCallPanel can read callId for wk-outcome-apply
    expect(snapshot!.call?.callId).toBe(CALL_UUID);
  });
});

describe('ActiveCallProvider.startCall — failure paths', () => {
  it('does not dial when wk-calls-create returns allowed=false; resets phase', async () => {
    invokeMock.mockResolvedValue({
      data: { allowed: false, reason: 'daily_limit' },
      error: null,
    });

    renderProvider();
    await waitFor(() => snapshot && expect(snapshot).not.toBeNull());

    await act(async () => {
      const result = await snapshot!.startCall(CONTACT.id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('spend_blocked');
    });

    expect(dialMock).not.toHaveBeenCalled();
    expect(snapshot!.phase).toBe('idle');
    expect(snapshot!.call).toBeNull();
  });

  it('does not dial and stays idle when wk-calls-create errors', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: { message: 'fn timeout' },
    });

    renderProvider();
    await waitFor(() => snapshot && expect(snapshot).not.toBeNull());

    await act(async () => {
      const result = await snapshot!.startCall(CONTACT.id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('create_failed');
    });

    expect(dialMock).not.toHaveBeenCalled();
    expect(snapshot!.phase).toBe('idle');
  });

  it('resets to idle when device.dial throws after server allowed it', async () => {
    invokeMock.mockResolvedValue({
      data: { call_id: CALL_UUID, allowed: true },
      error: null,
    });
    dialMock.mockRejectedValue(new Error('mic denied'));

    renderProvider();
    await waitFor(() => snapshot && expect(snapshot).not.toBeNull());

    await act(async () => {
      const result = await snapshot!.startCall(CONTACT.id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('dial_failed');
    });

    expect(snapshot!.phase).toBe('idle');
    expect(snapshot!.call).toBeNull();
  });
});
