// Pins the post-call guard:
//   - When phase=='post_call' but call.callId is NOT a real UUID, the orange
//     "Pick outcome for …" button does NOT render.
//   - When phase=='post_call' AND call.callId IS a real UUID, the button
//     renders normally.

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

// Mocks must hoist; module factory pattern returns the API and the call ref.
const ctxState = {
  phase: 'post_call' as 'idle' | 'placing' | 'in_call' | 'post_call',
  call: null as null | { contactId: string; contactName: string; phone: string; startedAt: number; callId?: string | null },
  durationSec: 0,
  fullScreen: false,
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

vi.mock('../../live-call/LiveCallScreen', () => ({
  default: () => <div data-testid="live-call-screen" />,
}));

import Softphone from '../Softphone';
import { SmsV2Provider } from '../../../store/SmsV2Store';

function Wrap({ children }: { children: ReactNode }) {
  return <SmsV2Provider>{children}</SmsV2Provider>;
}

describe('Softphone post-call guard', () => {
  it('does NOT render the Pick outcome button when callId is null', () => {
    ctxState.phase = 'post_call';
    ctxState.fullScreen = false;
    ctxState.call = {
      contactId: 'c1',
      contactName: 'Sarah',
      phone: '+447700900111',
      startedAt: Date.now(),
      callId: null,
    };

    const { queryByText } = render(<Wrap><Softphone /></Wrap>);
    expect(queryByText(/Pick outcome/i)).toBeNull();
  });

  it('does NOT render the Pick outcome button when callId is non-UUID (mock id)', () => {
    ctxState.phase = 'post_call';
    ctxState.fullScreen = false;
    ctxState.call = {
      contactId: 'c1',
      contactName: 'Sarah',
      phone: '+447700900111',
      startedAt: Date.now(),
      callId: 'manual-1714567890000',
    };

    const { queryByText } = render(<Wrap><Softphone /></Wrap>);
    expect(queryByText(/Pick outcome/i)).toBeNull();
  });

  it('renders the Pick outcome button when callId is a real UUID', () => {
    ctxState.phase = 'post_call';
    ctxState.fullScreen = false;
    ctxState.call = {
      contactId: 'c1',
      contactName: 'Sarah',
      phone: '+447700900111',
      startedAt: Date.now(),
      callId: '22222222-2222-2222-2222-222222222222',
    };

    const { queryByText } = render(<Wrap><Softphone /></Wrap>);
    expect(queryByText(/Pick outcome for Sarah/i)).not.toBeNull();
  });
});
