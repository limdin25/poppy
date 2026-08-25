// Pins the DTMF contract for ActiveCallProvider.
//
// Hugo 2026-08-25: "during the call he's asking to press a number to move
// forward, but when we use the soft dialer there is no option to press any
// number." A switchboard menu ("press 1 for sales") answered the phone and
// the call was already lost, because nothing in the softphone could put a
// tone on the line.
//
// What is pinned here:
//   - sendDigit('1') reaches the live Call as sendDigits('1')
//   - it returns the digit it sent, so the UI's "Sent" history is honest
//   - with no live call it returns null and sends nothing (no crash)
//   - a call the SDK only exposes through device.calls (inbound leg and the
//     parallel-dial winner, which never populate activeTwilioCallRef) still
//     receives the tone

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor, cleanup } from '@testing-library/react';
import { useEffect } from 'react';
import { ActiveCallProvider, useActiveCallCtx } from '../ActiveCallContext';
import { SmsV2Provider, useSmsV2 } from '../../../store/SmsV2Store';

const fakeDeviceCalls: Array<{
  mute: (s: boolean) => void;
  disconnect: () => void;
  sendDigits: (d: string) => void;
}> = [];

vi.mock('@/integrations/twilio/voice-browser', () => ({
  addIncomingCallListener: vi.fn(() => () => {}),
  getDeviceCalls: () => [...fakeDeviceCalls],
  muteAllCalls: (shouldMute: boolean) => {
    for (const c of fakeDeviceCalls) c.mute(shouldMute);
    return shouldMute && fakeDeviceCalls.length > 0;
  },
  disconnectAllCalls: () => {
    for (const c of [...fakeDeviceCalls]) c.disconnect();
  },
}));

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

import * as twilioDeviceMod from '../../../hooks/useTwilioDevice';
import * as supabaseMod from '@/integrations/supabase/browser';
const dialMock = (twilioDeviceMod as unknown as { __dialMock: ReturnType<typeof vi.fn> }).__dialMock;
const invokeMock = (supabaseMod as unknown as { __invokeMock: ReturnType<typeof vi.fn> }).__invokeMock;

const CONTACT = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Hugo',
  phone: '+447863992555',
};
const CALL_UUID = '22222222-2222-2222-2222-222222222222';

interface FakeCall {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  fire: (event: string, ...args: unknown[]) => void;
  disconnect: ReturnType<typeof vi.fn>;
  mute: ReturnType<typeof vi.fn>;
  isMuted: ReturnType<typeof vi.fn>;
  sendDigits: ReturnType<typeof vi.fn>;
  _muted: boolean;
}

function makeFakeCall(): FakeCall {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const obj: FakeCall = {
    _muted: false,
    on(event, cb) {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(cb);
    },
    fire(event, ...args) {
      (handlers[event] ?? []).forEach((cb) => cb(...args));
    },
    disconnect: vi.fn(() => {
      const idx = fakeDeviceCalls.indexOf(obj);
      if (idx >= 0) fakeDeviceCalls.splice(idx, 1);
    }),
    mute: vi.fn((shouldMute: boolean) => {
      obj._muted = shouldMute;
    }),
    isMuted: vi.fn(() => obj._muted),
    sendDigits: vi.fn(),
  };
  return obj;
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

async function startAndAnswer(fakeCall: FakeCall) {
  invokeMock.mockResolvedValue({
    data: { call_id: CALL_UUID, allowed: true },
    error: null,
  });
  dialMock.mockImplementation(async () => {
    fakeDeviceCalls.push(fakeCall);
    return fakeCall;
  });

  renderProvider();
  await waitFor(() => snapshot && expect(snapshot).not.toBeNull());

  await act(async () => {
    await snapshot!.startCall(CONTACT.id);
  });
  await act(async () => {
    fakeCall.fire('accept');
  });
}

beforeEach(() => {
  snapshot = null;
  fakeDeviceCalls.length = 0;
  dialMock.mockReset();
  invokeMock.mockReset();
});

// Each test mounts its own provider; without this the previous one stays
// mounted and its Probe keeps overwriting the snapshot.
afterEach(() => cleanup());

describe('ActiveCallProvider sendDigit', () => {
  it('puts the digit on the live call and reports it back', async () => {
    const fakeCall = makeFakeCall();
    await startAndAnswer(fakeCall);
    expect(snapshot!.phase).toBe('in_call');

    let returned: string | null = null;
    await act(async () => {
      returned = snapshot!.sendDigit('1');
    });

    expect(fakeCall.sendDigits).toHaveBeenCalledWith('1');
    expect(returned).toBe('1');
  });

  it('sends * and # as well as digits, one tone per press', async () => {
    const fakeCall = makeFakeCall();
    await startAndAnswer(fakeCall);

    await act(async () => {
      snapshot!.sendDigit('2');
      snapshot!.sendDigit('*');
      snapshot!.sendDigit('#');
    });

    expect(fakeCall.sendDigits).toHaveBeenNthCalledWith(1, '2');
    expect(fakeCall.sendDigits).toHaveBeenNthCalledWith(2, '*');
    expect(fakeCall.sendDigits).toHaveBeenNthCalledWith(3, '#');
    expect(fakeCall.sendDigits).toHaveBeenCalledTimes(3);
  });

  it('returns null when there is no live call, and does not throw', async () => {
    renderProvider();
    await waitFor(() => snapshot && expect(snapshot).not.toBeNull());

    let returned: string | null = '1';
    await act(async () => {
      returned = snapshot!.sendDigit('1');
    });

    expect(returned).toBeNull();
  });

  it('still reaches a call the SDK only lists in device.calls', async () => {
    // The inbound leg and the parallel-dial winner never set
    // activeTwilioCallRef, so the fallback is the only route to them.
    const inbound = makeFakeCall();
    fakeDeviceCalls.push(inbound);

    renderProvider();
    await waitFor(() => snapshot && expect(snapshot).not.toBeNull());

    let returned: string | null = null;
    await act(async () => {
      returned = snapshot!.sendDigit('9');
    });

    expect(inbound.sendDigits).toHaveBeenCalledWith('9');
    expect(returned).toBe('9');
  });

  it('survives an SDK that throws, reporting nothing sent', async () => {
    const fakeCall = makeFakeCall();
    fakeCall.sendDigits.mockImplementation(() => {
      throw new Error('connection closed');
    });
    await startAndAnswer(fakeCall);

    let returned: string | null = '1';
    await act(async () => {
      returned = snapshot!.sendDigit('1');
    });

    expect(returned).toBeNull();
  });
});
