// smsv2 — sandbox calling + CRM workspace types
// All types are mock-only (Phase 0 UI). Backend wiring happens in Phase 1.

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
  /** PR 54 (Hugo 2026-04-27): % of today's calls that were
   *  answered (answered ÷ max(1, callsToday) × 100). Computed in
   *  useAgentsToday so the dashboard column renders without
   *  client-side math at every row. */
  answerRatePct?: number;
  /** PR 54: outbound wk_sms_messages count for this agent today. */
  smsSentToday?: number;
  /** PR 109: when false, agent is hidden from the leaderboard surfaces.
   *  Defaults to true for back-compat with rows that pre-date the column. */
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
  fromE164?: string;
  toE164?: string;
}

export interface TranscriptLine {
  id: string;
  speaker: 'agent' | 'caller';
  text: string;
  ts: number; // seconds from call start
}

export interface CoachEvent {
  id: string;
  kind: 'objection' | 'suggestion' | 'question' | 'warning';
  title: string;
  body: string;
  ts: number;
}

export interface PipelineColumn {
  id: string;
  pipelineId: string;
  name: string;
  colour: string; // hex
  icon: string; // lucide name
  position: number; // 1-9 keyboard hint
  isDefaultOnTimeout?: boolean;
  /** PR 18: stages with requires_followup = true (Nurturing, Callback,
   *  Interested) prompt the agent for a follow-up datetime + note when
   *  a contact is moved into them. The follow-up surfaces in the
   *  persistent banner UI (PR 19) until done or dismissed. */
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
  /** Sum of every wk_dialer_queue row for this campaign across all 7
   *  statuses (pending + dialing + connected + voicemail + missed +
   *  done + skipped). Was previously `pending + done` only, which
   *  silently dropped missed/skipped/dialing rows from the UI rollup
   *  and made it look like 9 leads disappeared after Tajul ran a
   *  campaign. Hugo 2026-04-28. */
  totalLeads: number;
  /** Terminal / "attempted, no live conversation" — done + missed +
   *  skipped. Used for the "Done" mini-stat on the dialer card. Does
   *  NOT include connected (separate stat) or voicemail (separate
   *  stat). */
  doneLeads: number;
  connectedLeads: number;
  voicemailLeads: number;
  /** PR (Hugo 2026-04-28): expose every queue bucket so the UI can
   *  show queue=pending without subtracting from totalLeads (the old
   *  arithmetic only worked when totalLeads = pending + done). */
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
  /** wk_dialer_campaigns.is_active — false = paused (dialer refuses to
   *  start). Mapped from the row's snake_case `is_active` by
   *  rowToCampaign; the Settings UI reads this to show Active/Paused and
   *  the dialer filters on it. Hugo PR 60 (2026-04-27). */
  isActive: boolean;
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

export interface ActivityEvent {
  id: string;
  contactId: string;
  kind:
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
  title: string;
  body?: string;
  ts: string;
  agentId?: string;
  refId?: string;
}

export interface Task {
  id: string;
  contactId: string;
  title: string;
  dueAt: string;
  assignedAgentId: string;
  done: boolean;
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
