// Pins the mute contract for ActiveCallProvider.
//   - toggleMute() actually calls .mute(true) on the active TwilioCall
//   - second toggleMute() calls .mute(false)
//   - the SDK's 'mute' event drives React state (so the icon never lies)
//
// In production, Hugo reported the UI label flipped but the callee still
// heard him. The fix wires call.on('mute', cb) so React state reflects
// the SDK's actual track.enabled value, and toggleMute reads the SDK's
// isMuted() instead of stale React state.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { ActiveCallProvider, useActiveCallCtx } from '../ActiveCallContext';
import { SmsV2Provider, useSmsV2 } from '../../../store/SmsV2Store';

// Shared fake-Device list used by the twilio-voice mock below. Tests push
// the fakeCall they construct; the mock exposes it via getDeviceCalls so
// muteAllCalls iterates the right thing.
const fakeDeviceCalls: Array<{ mute: (s: boolean) => void; disconnect: () => void }> = [];

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
      const wasMuted = obj._muted;
      obj._muted = shouldMute;
      if (wasMuted !== shouldMute) {
        obj.fire('mute', shouldMute, obj);
      }
    }),
    isMuted: vi.fn(() => obj._muted),
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

beforeEach(() => {
  snapshot = null;
  fakeDeviceCalls.length = 0;
  dialMock.mockReset();
  invokeMock.mockReset();
});

describe('ActiveCallProvider toggleMute', () => {
  it('calls .mute(true) on the active TwilioCall on first toggle', async () => {
    const fakeCall = makeFakeCall();
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
    expect(snapshot!.phase).toBe('in_call');

    await act(async () => {
      snapshot!.toggleMute();
    });

    expect(fakeCall.mute).toHaveBeenCalledWith(true);
    expect(snapshot!.muted).toBe(true);
  });

  it('calls .mute(false) on the second toggle', async () => {
    const fakeCall = makeFakeCall();
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

    await act(async () => {
      snapshot!.toggleMute();
    });
    await act(async () => {
      snapshot!.toggleMute();
    });

    expect(fakeCall.mute).toHaveBeenNthCalledWith(1, true);
    expect(fakeCall.mute).toHaveBeenNthCalledWith(2, false);
    expect(snapshot!.muted).toBe(false);
  });

  it('reflects an SDK-emitted mute event in React state (truth follows the SDK)', async () => {
    // Real-world case: another tab / SDK internal flow flips mute. We must
    // not show a stale icon. The 'mute' event from the Call object should
    // drive `muted`.
    const fakeCall = makeFakeCall();
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
    expect(snapshot!.muted).toBe(false);

    // SDK reports muted (e.g. user toggled mute another way, or the SDK
    // re-applied state after a track replacement).
    await act(async () => {
      fakeCall._muted = true;
      fakeCall.fire('mute', true, fakeCall);
    });

    expect(snapshot!.muted).toBe(true);
  });
});
