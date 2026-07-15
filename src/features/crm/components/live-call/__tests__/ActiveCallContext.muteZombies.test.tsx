// Pins the multi-call mute contract: when the Twilio Device is maintaining
// more than one Call (zombies from earlier dials, dialer-winner overlaps,
// missed disconnects), toggleMute must mute EVERY Call — not just the most
// recent ref. Without this, prior leaked Calls keep streaming the agent's
// mic and the callee still hears them after the icon flips.
//
// Hugo's repro on 2026-04-26 was exactly this: console showed
//   [mute] toggle { wasMuted: false, next: true }
//   [mute] sdk event true
// — proving the active Call was muted — but he was still audible to the
// callee, because previous test calls were still alive in device.calls.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { ActiveCallProvider, useActiveCallCtx } from '../ActiveCallContext';
import { SmsV2Provider, useSmsV2 } from '../../../store/SmsV2Store';

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
      // Remove from the fake device's call list when disconnected.
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

// Module-level state shared with the twilio-voice mock so getDeviceCalls /
// muteAllCalls / disconnectAllCalls operate on the same fake list the test
// pushes into.
const fakeDeviceCalls: FakeCall[] = [];

vi.mock('@/integrations/twilio/voice-browser', () => ({
  addIncomingCallListener: vi.fn(() => () => {}),
  getDeviceCalls: () => [...fakeDeviceCalls],
  muteAllCalls: (shouldMute: boolean) => {
    for (const c of fakeDeviceCalls) c.mute(shouldMute);
    return shouldMute && fakeDeviceCalls.length > 0;
  },
  disconnectAllCalls: () => {
    // .disconnect() splices out, so iterate a copy.
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
      activeCall: fakeDeviceCalls[fakeDeviceCalls.length - 1] ?? null,
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

describe('ActiveCallProvider toggleMute — multi-Call zombies', () => {
  it('mutes every Call on the Device, not just the active ref', async () => {
    const zombie = makeFakeCall();
    const live = makeFakeCall();
    // Zombie was already alive when we placed the new dial. The fix in
    // startCall calls disconnectAllCalls() before the new dial, but this
    // test is specifically about toggleMute resilience: simulate the case
    // where, at the moment the user clicks Mute, the device still has
    // multiple Calls (e.g. realtime broadcast just added one, or a tab
    // hand-off raced).

    invokeMock.mockResolvedValue({
      data: { call_id: CALL_UUID, allowed: true },
      error: null,
    });
    dialMock.mockImplementation(async () => {
      // Simulate the device.connect() path that appends a Call to the list.
      fakeDeviceCalls.push(live);
      return live;
    });

    renderProvider();
    await waitFor(() => snapshot && expect(snapshot).not.toBeNull());

    await act(async () => {
      await snapshot!.startCall(CONTACT.id);
    });

    // After startCall, our disconnectAllCalls() ran; only `live` remains.
    // Re-introduce a zombie to simulate a Call that re-appeared (e.g. an
    // inbound broadcast race) so we can assert toggleMute hits it too.
    fakeDeviceCalls.push(zombie);

    await act(async () => {
      fakeDeviceCalls.find((c) => c === live)?.fire('accept');
    });

    await act(async () => {
      snapshot!.toggleMute();
    });

    expect(live.mute).toHaveBeenCalledWith(true);
    expect(zombie.mute).toHaveBeenCalledWith(true);
  });

  it('startCall does NOT pre-disconnect existing Calls (regression: pre-eviction killed new dials)', async () => {
    // Hugo's regression on 2026-04-26: pre-dial disconnectAllCalls() caused
    // new dials to never reach Twilio's TwiML endpoint (status stuck at
    // 'queued', twilio_call_sid null, phone never rang). Zombie cleanup
    // now happens only on endCall, never before a fresh dial.
    const zombie = makeFakeCall();
    const live = makeFakeCall();
    fakeDeviceCalls.push(zombie);

    invokeMock.mockResolvedValue({
      data: { call_id: CALL_UUID, allowed: true },
      error: null,
    });
    dialMock.mockImplementation(async () => {
      fakeDeviceCalls.push(live);
      return live;
    });

    renderProvider();
    await waitFor(() => snapshot && expect(snapshot).not.toBeNull());

    await act(async () => {
      await snapshot!.startCall(CONTACT.id);
    });

    // Zombie must NOT be auto-disconnected at startCall — that path broke
    // the new dial in production. The new live call is added alongside.
    expect(zombie.disconnect).not.toHaveBeenCalled();
    expect(fakeDeviceCalls).toContain(live);
    expect(fakeDeviceCalls).toContain(zombie);
  });

  it('a prior Call disconnect does NOT stomp on a freshly placed call (regression for "hangs up immediately")', async () => {
    // Hugo's repro on 2026-04-26: after PR #547 added disconnectAllCalls()
    // at the start of every dial, recalling immediately sent the new call
    // to post_call. Root cause: the prior Call's lifecycle listeners
    // (attached in the previous startCall) ran setPhase('post_call') on
    // disconnect — even though the disconnecting Call was no longer the
    // active one. The fix gates every listener on activeTwilioCallRef
    // equality so old Calls cannot mutate state for the live one.
    const firstCall = makeFakeCall();
    invokeMock.mockResolvedValue({
      data: { call_id: CALL_UUID, allowed: true },
      error: null,
    });
    dialMock.mockImplementationOnce(async () => {
      fakeDeviceCalls.push(firstCall);
      return firstCall;
    });

    renderProvider();
    await waitFor(() => snapshot && expect(snapshot).not.toBeNull());

    // First dial completes and the call is up.
    await act(async () => { await snapshot!.startCall(CONTACT.id); });
    await act(async () => { firstCall.fire('accept'); });
    expect(snapshot!.phase).toBe('in_call');

    // Second dial: should evict the first Call AND start a new one.
    const secondCall = makeFakeCall();
    dialMock.mockImplementationOnce(async () => {
      fakeDeviceCalls.push(secondCall);
      return secondCall;
    });

    await act(async () => { await snapshot!.startCall(CONTACT.id); });

    // Replay: the SDK fires 'disconnect' on the first (now-evicted) Call
    // asynchronously after disconnectAllCalls. Without the guard, this
    // would set phase to 'post_call' and stomp on the new call.
    await act(async () => { firstCall.fire('disconnect'); });

    // The new call must STILL be in 'placing' (or 'in_call' after its own
    // accept), never 'post_call' or 'idle'.
    expect(snapshot!.phase).not.toBe('post_call');
    expect(snapshot!.phase).not.toBe('idle');
    expect(snapshot!.call).not.toBeNull();
  });

  it('endCall disconnects every Call on the Device', async () => {
    const live = makeFakeCall();
    const second = makeFakeCall();

    invokeMock.mockResolvedValue({
      data: { call_id: CALL_UUID, allowed: true },
      error: null,
    });
    dialMock.mockImplementation(async () => {
      fakeDeviceCalls.push(live);
      return live;
    });

    renderProvider();
    await waitFor(() => snapshot && expect(snapshot).not.toBeNull());

    await act(async () => {
      await snapshot!.startCall(CONTACT.id);
    });
    fakeDeviceCalls.push(second); // sneaks in mid-call

    await act(async () => {
      snapshot!.endCall();
    });

    expect(live.disconnect).toHaveBeenCalled();
    expect(second.disconnect).toHaveBeenCalled();
    expect(fakeDeviceCalls).toEqual([]);
  });
});
