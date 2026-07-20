// Pure dialer state machine — extracted from useDialerMachine so vitest can
// pin it directly (tests/dialer-reducer.test.ts); src/features/crm/** is
// excluded as a test *location* but stays importable. No side-effectful
// imports allowed in this file.

import type { DialerState, DialerAction } from './types';

export const LS_KEY = 'elsie_crm_pause_dialer';

export const INITIAL: DialerState = {
  phase: 'idle',
  currentLead: null,
  currentCallSid: null,
  currentCallId: null,
  startedAt: null,
  durationSec: null,
  isMuted: false,
  isOnHold: false,
  voicemailDropped: false,
  sessionDrops: 0,
  pauseAfterCall: typeof window !== 'undefined' && localStorage.getItem(LS_KEY) === 'true',
  campaignId: null,
  autoPace: true,
  pacingDelaySec: 5,
  sessionStarted: false,
  endReason: null,
  error: null,
  pacingDeadlineMs: null,
};

export function reducer(s: DialerState, a: DialerAction): DialerState {
  switch (a.type) {
    case 'DIAL_START':
      if (s.phase !== 'idle' && s.phase !== 'paused') return s;
      return {
        ...s,
        phase: 'dialing',
        currentLead: a.lead,
        currentCallId: a.callId,
        currentCallSid: null,
        startedAt: null,
        durationSec: null,
        isMuted: false,
        isOnHold: false,
        voicemailDropped: false,
        error: null,
        endReason: null,
        pacingDeadlineMs: null,
        sessionStarted: true,
      };
    case 'RINGING':
      return s.phase === 'dialing' ? { ...s, phase: 'ringing' } : s;
    case 'CONNECTED':
      return s.phase === 'dialing' || s.phase === 'ringing'
        ? { ...s, phase: 'connected', startedAt: Date.now() }
        : s;
    case 'CALL_ENDED':
      if (s.phase !== 'dialing' && s.phase !== 'ringing' && s.phase !== 'connected') return s;
      return {
        ...s,
        phase: 'wrap_up',
        endReason: a.reason,
        error: a.error ?? null,
        durationSec: s.startedAt ? Math.floor((Date.now() - s.startedAt) / 1000) : null,
      };
    case 'OUTCOME_DONE':
      if (s.phase !== 'wrap_up') return s;
      return {
        ...s,
        phase: s.pauseAfterCall ? 'paused' : 'idle',
        error: null,
        endReason: null,
      };
    case 'PACING_ARMED':
      return { ...s, pacingDeadlineMs: a.deadlineMs };
    case 'PACING_CLEARED':
      return { ...s, pacingDeadlineMs: null };
    case 'PAUSE':
      return { ...s, phase: 'paused', pacingDeadlineMs: null };
    case 'RESUME':
      return s.phase === 'paused' ? { ...s, phase: 'idle', pacingDeadlineMs: null } : s;
    case 'STOP':
      return { ...INITIAL };
    case 'MUTE_TOGGLE':
      return { ...s, isMuted: !s.isMuted };
    case 'HOLD_TOGGLE':
      return { ...s, isOnHold: !s.isOnHold };
    case 'SET_CAMPAIGN':
      return { ...s, campaignId: a.campaignId };
    case 'SET_AUTO_PACE':
      return { ...s, autoPace: a.value };
    case 'SET_PACING_DELAY':
      return { ...s, pacingDelaySec: a.seconds };
    case 'PAUSE_AFTER_CALL':
      return { ...s, pauseAfterCall: a.value };
    case 'VOICEMAIL_DROPPED':
      // sessionDrops is a session tally — DIAL_START must not reset it.
      return { ...s, voicemailDropped: true, sessionDrops: s.sessionDrops + 1 };
  }
}
