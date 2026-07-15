// Caller — type definitions
//
// Split into three sections:
//   - Database  (shapes that mirror wk_* tables; source of truth is RLS + types.ts)
//   - UI        (shapes used by components / pages)
//   - Service   (shapes used by hooks + edge function payloads)
//
// Phase 1: ports the legacy smsv2/types/index.ts surface so stub pages
// type-check. Phase 2+ refactors into discriminated unions where the
// legacy union types proved too loose (ActivityEvent, CoachEvent).

// ─────────────────────────────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────────────────────────────

export type AgentStatus = 'available' | 'busy' | 'idle' | 'offline';
export type CallDirection = 'inbound' | 'outbound';
export type CallStatus =
  | 'ringing'
  | 'connected'
  | 'completed'
  | 'missed'
  | 'voicemail'
  | 'failed';

export interface Agent {
  id: string;
  name: string;
  email: string;
  extension: string;
  role: 'admin' | 'agent' | 'viewer';
  status: AgentStatus;
  callsToday: number;
  answeredToday: number;
  avgDurationSec: number;
  spendPence: number;
  limitPence: number;
  isAdmin?: boolean;
  answerRatePct?: number;
  smsSentToday?: number;
  showOnLeaderboard?: boolean;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  ownerAgentId?: string;
  pipelineColumnId?: string;
  tags: string[];
  isHot: boolean;
  dealValuePence?: number;
  customFields: Record<string, string>;
  createdAt: string;
  lastContactAt?: string;
}

export interface SmsMessage {
  id: string;
  contactId: string;
  direction: CallDirection;
  body: string;
  sentAt: string;
  agentId?: string;
}

export interface CallRecord {
  id: string;
  contactId: string;
  agentId: string;
  direction: CallDirection;
  status: CallStatus;
  startedAt: string;
  durationSec: number;
  recordingUrl?: string;
  hasTranscript: boolean;
  aiSummary?: string;
  costPence: number;
  dispositionColumnId?: string;
  agentNote?: string;
}

export interface TranscriptLine {
  id: string;
  speaker: 'agent' | 'caller';
  text: string;
  ts: number;
}

export interface PipelineColumn {
  id: string;
  pipelineId: string;
  name: string;
  colour: string;
  icon: string;
  position: number;
  isDefaultOnTimeout?: boolean;
  requiresFollowup?: boolean;
  callScriptId?: string;
  coachProfileId?: string;
  automation: ColumnAutomation;
}

export interface ColumnAutomation {
  sendSms: boolean;
  smsTemplateId?: string;
  createTask: boolean;
  taskTitle?: string;
  taskDueInHours?: number;
  retryDial: boolean;
  retryInHours?: number;
  addTag: boolean;
  tag?: string;
  moveToPipelineId?: string;
}

export interface Pipeline {
  id: string;
  name: string;
  scope: string;
  columns: PipelineColumn[];
}

export interface Campaign {
  id: string;
  name: string;
  pipelineId: string;
  ownerAgentId: string;
  totalLeads: number;
  doneLeads: number;
  connectedLeads: number;
  voicemailLeads: number;
  pendingLeads: number;
  dialingLeads: number;
  missedLeads: number;
  skippedLeads: number;
  mode: 'parallel' | 'power' | 'manual';
  parallelLines: number;
  aiCoachEnabled: boolean;
  aiCoachPromptId?: string;
  scriptMd?: string;
  autoAdvanceSeconds: number;
}

export interface SmsTemplate {
  id: string;
  name: string;
  bodyMd: string;
  mergeFields: string[];
}

export interface NumberRecord {
  id: string;
  e164: string;
  label: string;
  capabilities: ('voice' | 'sms')[];
  assignedAgentId?: string;
  rotationPoolId?: string;
  maxCallsPerMinute: number;
  cooldownSecondsAfterCall: number;
  recordingEnabled: boolean;
}

export interface KillSwitch {
  id: string;
  kind: 'all_dialers' | 'agent_dialer' | 'ai_coach' | 'outbound';
  scopeAgentId?: string;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  reason?: string;
}

export interface Task {
  id: string;
  contactId: string;
  title: string;
  dueAt: string;
  assignedAgentId: string;
  done: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────

export type CoachKind = 'objection' | 'suggestion' | 'question' | 'warning';

export interface CoachEvent {
  id: string;
  kind: CoachKind;
  title: string;
  body: string;
  ts: number;
}

export interface DialerLeg {
  id: string;
  line: number;
  contactId: string;
  contactName: string;
  phone: string;
  status: 'dialing' | 'ringing' | 'connecting' | 'connected' | 'voicemail' | 'no_answer';
  startedAt: number;
}

// ─────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────

export type ActivityKind =
  | 'call_inbound'
  | 'call_outbound'
  | 'call_missed'
  | 'sms_inbound'
  | 'sms_outbound'
  | 'voicemail'
  | 'note'
  | 'stage_moved'
  | 'tag_added'
  | 'task_created'
  | 'outcome_applied';

export interface ActivityEvent {
  id: string;
  contactId: string;
  kind: ActivityKind;
  title: string;
  body?: string;
  ts: string;
  agentId?: string;
  refId?: string;
}
