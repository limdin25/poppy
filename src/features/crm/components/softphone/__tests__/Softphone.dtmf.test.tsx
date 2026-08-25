// Pins the keypad on the softphone's mid-call bar.
//
// Hugo 2026-08-25: on a live call the switchboard asked him to press a number
// to go forward, and the soft dialer had no keys on it. The bar carried Mute
// and End and nothing else.
//
// What is pinned here:
//   - mid-call, a Keypad button exists
//   - it is shut by default (the bar keeps its old size)
//   - pressing it reveals the keypad, and a digit goes out as one tone
//   - it is not offered when there is no call to send a tone on

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';

const sendDigit = vi.fn((d: string) => d);

const ctxState = {
  phase: 'in_call' as 'idle' | 'placing' | 'in_call' | 'post_call',
  call: null as null | {
    contactId: string;
    contactName: string;
    phone: string;
    startedAt: number;
    callId?: string | null;
  },
  durationSec: 12,
  fullScreen: false,
  muted: false,
  previewContactId: null as string | null,
};

vi.mock('../../live-call/ActiveCallContext', () => ({
  useActiveCallCtx: () => ({
    ...ctxState,
    setFullScreen: vi.fn(),
    startCall: vi.fn(),
    endCall: vi.fn(),
    clearCall: vi.fn(),
    applyOutcome: vi.fn(),
    resumeFromBroadcast: vi.fn(),
    toggleMute: vi.fn(),
    sendDigit,
  }),
}));

vi.mock('../../../hooks/useTwilioDevice', () => ({
  useTwilioDevice: () => ({
    status: 'ready',
    error: null,
    muted: false,
    setMuted: vi.fn(),
    dial: vi.fn(),
    hangup: vi.fn(),
    sendDigits: vi.fn(),
    activeCall: null,
  }),
}));

vi.mock('../../../hooks/useSpendLimit', () => ({
  useSpendLimit: () => ({
    spendPence: 0,
    limitPence: 1000,
    isAdmin: false,
    isLimitReached: false,
    percentUsed: 0,
    blocked: false,
    reason: null,
    loading: false,
  }),
}));

vi.mock('../../../hooks/useCurrentAgent', () => ({
  useCurrentAgent: () => ({
    agent: { id: 'u1', name: 'Hugo', email: 'hugo@heyelsie.com' },
    firstName: 'Hugo',
    talkRatioPercent: 0,
    loading: false,
  }),
}));

vi.mock('../../../hooks/useCallerId', () => ({
  useCallerId: () => ({
    numbers: [],
    defaultId: null,
    setCallerId: vi.fn(),
    loading: false,
  }),
}));

vi.mock('../../live-call/LiveCallScreen', () => ({
  default: () => <div data-testid="live-call-screen" />,
}));

import Softphone from '../Softphone';
import { SmsV2Provider } from '../../../store/SmsV2Store';

function Wrap({ children }: { children: ReactNode }) {
  return <SmsV2Provider>{children}</SmsV2Provider>;
}

const IN_CALL = {
  contactId: 'c1',
  contactName: 'Wilcox Estates',
  phone: '+441204803639',
  startedAt: Date.now(),
  callId: '22222222-2222-2222-2222-222222222222',
};

beforeEach(() => {
  sendDigit.mockClear();
  ctxState.phase = 'in_call';
  ctxState.fullScreen = false;
  ctxState.call = { ...IN_CALL };
});

// Queries are bound to document.body, so a leftover render from the previous
// test would make every getByTitle ambiguous.
afterEach(() => cleanup());

describe('Softphone mid-call keypad', () => {
  it('offers a Keypad button during a call, shut by default', () => {
    const { getByText, queryByTestId } = render(<Wrap><Softphone /></Wrap>);
    expect(getByText('Keypad')).not.toBeNull();
    expect(queryByTestId('softphone-dtmf-keypad')).toBeNull();
  });

  it('opens the keys and sends the pressed digit down the call', () => {
    const { getByText, getByTitle, getByTestId } = render(<Wrap><Softphone /></Wrap>);

    fireEvent.click(getByText('Keypad'));
    expect(getByTestId('softphone-dtmf-keypad')).not.toBeNull();

    fireEvent.click(getByTitle('Send 1'));
    expect(sendDigit).toHaveBeenCalledWith('1');
    expect(sendDigit).toHaveBeenCalledTimes(1);
  });

  it('shows what was sent, so the agent can see the menu choice landed', () => {
    const { getByText, getByTitle, getByTestId } = render(<Wrap><Softphone /></Wrap>);

    fireEvent.click(getByText('Keypad'));
    fireEvent.click(getByTitle('Send 2'));
    fireEvent.click(getByTitle('Send #'));

    expect(getByTestId('softphone-dtmf-keypad').textContent).toContain('2#');
  });

  it('does not offer the keypad when the call is only ringing', () => {
    ctxState.phase = 'placing';
    const { queryByText } = render(<Wrap><Softphone /></Wrap>);
    expect(queryByText('Keypad')).toBeNull();
  });
});
