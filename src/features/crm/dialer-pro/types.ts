export type DialerPhase =
  | 'idle'
  | 'dialing'
  | 'ringing'
  | 'connected'
  | 'wrap_up'
  | 'paused';

export interface QueueLead {
  id: string;
  contactId: string;
  phone: string;
  name: string;
  priority: number;
  attempts: number;
  scheduledFor: string | null;
  status: 'pending' | 'dialing' | 'done' | 'missed';
  campaignId: string;
  pipelineColumnId: string | null;
  queueRowId: string;
}

export interface DialerState {
  phase: DialerPhase;
  currentLead: QueueLead | null;
  currentCallSid: string | null;
  currentCallId: string | null;
  startedAt: number | null;
  durationSec: number | null;
  isMuted: boolean;
  isOnHold: boolean;
  pauseAfterCall: boolean;
  campaignId: string | null;
  autoPace: boolean;
  pacingDelaySec: number;
  sessionStarted: boolean;
  endReason: string | null;
  error: string | null;
  pacingDeadlineMs: number | null;
}

export type DialerAction =
  | { type: 'DIAL_START'; lead: QueueLead; callId: string }
  | { type: 'RINGING' }
  | { type: 'CONNECTED' }
  | { type: 'CALL_ENDED'; reason: string; error?: string }
  | { type: 'OUTCOME_DONE' }
  | { type: 'PACING_ARMED'; deadlineMs: number }
  | { type: 'PACING_CLEARED' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'MUTE_TOGGLE' }
  | { type: 'HOLD_TOGGLE' }
  | { type: 'SET_CAMPAIGN'; campaignId: string }
  | { type: 'SET_AUTO_PACE'; value: boolean }
  | { type: 'SET_PACING_DELAY'; seconds: number }
  | { type: 'PAUSE_AFTER_CALL'; value: boolean };
