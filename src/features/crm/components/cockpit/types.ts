// What the cockpit's endpoints hand back.
//
// Mirrors the shapes built in api/crm/cockpit.ts. Kept as one small module
// with no React in it so the structural test in tests/ can import it: nothing
// under src/features/crm is in the vitest run.

export type Who = 'PEDRO' | 'HUGO' | 'VA' | 'NOBODY';
export type CheckLevel = 'pass' | 'warn' | 'block';

export interface StressCheck {
  id: string;
  level: CheckLevel;
  title: string;
  /** Written for a human and printed VERBATIM next to a disabled button. */
  detail: string;
  evidence: string[];
}

export interface StressReport {
  action: string;
  ok: boolean;
  level: CheckLevel;
  blocked: string[];
  warned: string[];
  checks: StressCheck[];
  counter?: {
    position: 'raise' | 'hold' | 'pass';
    newOffer: number | null;
    reason: string;
    code: string;
  };
}

export interface CockpitDeal {
  propertyId: string;
  contactId: string | null;
  contactName: string | null;
  branchPhone: string | null;
  branchEmail: string | null;
  address: string | null;
  status: string | null;
  column: string | null;

  attention: number;
  action: string;
  who: Who;
  instruction: string;
  /** How sure the brain is of its decision. Null on fallback briefs. */
  confidence: 'high' | 'medium' | 'low' | null;
  evidence: string[];
  source: 'manager' | 'fallback';
  assessedAt: string | null;
  /** The instruction was written against a state that has since moved. Still
   *  shown, because a slightly old instruction beats a blank card. */
  stale: boolean;

  flags: string[];

  repliedSinceBrief: boolean;
  lastInboundPreview: string | null;
  lastInboundAt: string | null;
  hoursSinceTouch: number | null;

  brief: {
    step: string | null;
    doNow: string[];
    blockers: string[];
    confidence: string | null;
    writtenAt: string | null;
  };
  pinnedNote: string | null;
  money: {
    asking: number | null; gdv: number | null; tmv: number | null;
    open: number | null; ceiling: number | null; refurb: number | null;
    /** The engine's own label: the works cost is a stand-in, nobody has read
     *  the condition. A provisional band never ships in an offer. */
    refurbAssumed: boolean;
    /** The ceiling Hugo WROTE in the pinned note. His ruling governs. */
    pinnedCeiling: number | null;
    compsTier: string | null; figuresOnFile: number[];
  };
  checklist: { answered: number; total: number; missing: string[] };
  followups: { nextDueAt: string | null; overdue: boolean; note: string | null };
  builder: { matches: number; booked: boolean; viewingAt: string | null; quote: number | null };
  pack: { compsCount: number; rentComp: boolean; floorplans: boolean };
  /** The machine's own homework: the stored ballpark run, refusals included. */
  ballpark: {
    ran: boolean; ok: boolean; at: string | null;
    open: number | null; ceiling: number | null; gdv: number | null;
    refurb: number | null; tier: string | null;
    refusal: string | null; refusalDetail: string | null;
  } | null;
  allowedActions: string[];
  stateHash: string;

  /** ONE CARD PER BRANCH. When the branch holds more than one live house, the
   *  card is the highest-attention one and the rest ride along here; the
   *  client switches between them without a second card existing. List
   *  responses only. */
  others?: Array<{
    propertyId: string; address: string | null;
    attention: number; column: string | null;
  }>;
}

export interface CockpitListResponse {
  managerEnabled: boolean;
  generatedAt: string;
  deals: CockpitDeal[];
  /** What was deliberately kept OUT, and why, so nobody wonders where the
   *  other hundred and forty cards went. Counts BRANCHES, not houses, so the
   *  arithmetic matches what Hugo counts on the pipeline board. */
  setAside: {
    calling_list: number; never_spoke: number;
    closed_door: number; finished: number; off_board: number;
    /** Approved and booked: waiting on a callback time, not on a decision. */
    scheduled: number;
    /** We replied in writing; the ball is in their court. */
    waiting_reply?: number;
  };
}

/** One thing that happened on a deal: a call with its recording, an email
 *  either way, a button pressed, or the machine's own reasoning. */
export interface TimelineEntry {
  id: string;
  at: string;
  kind: 'call' | 'email_in' | 'email_out' | 'sms_in' | 'sms_out'
    | 'assessment' | 'fallback_refused'
    | 'action_executed' | 'action_blocked' | 'human_note';
  title: string;
  body: string | null;
  durationSec?: number | null;
  outcome?: string | null;
  recordingUrl?: string | null;
  transcript?: Array<{ speaker: string; body: string }> | null;
  subject?: string | null;
  attention?: number | null;
  action?: string | null;
  who?: Who | null;
  flags?: string[];
  evidence?: string[];
  refusedReason?: string | null;
  checks?: StressCheck[] | null;
  blocked?: boolean;
  source?: string | null;
}

export interface CalendarItem {
  id: string;
  kind: 'followup' | 'viewing';
  at: string;
  overdue: boolean;
  title: string;
  note: string | null;
  contactId: string | null;
  contactName: string | null;
  propertyId: string | null;
  address: string | null;
}

export interface DealLogEntry {
  id: string;
  at: string;
  kind: 'assessment' | 'fallback_refused' | 'action_executed' | 'action_blocked' | 'human_note';
  trigger: string | null;
  action: string | null;
  who: Who | null;
  attention: number | null;
  instruction: string | null;
  flags: string[];
  evidence: string[];
  column: string | null;
  source: 'manager' | 'fallback' | 'human';
  refusedReason: string | null;
  blocked: boolean;
  checks: StressCheck[] | null;
  executedBy: 'server' | 'client' | null;
  note: string | null;
}

export interface CockpitDealResponse {
  managerEnabled: boolean;
  generatedAt: string;
  deal: CockpitDeal;
  log: DealLogEntry[];
  /** The whole file: calls with recordings, emails, presses, reasoning. */
  timeline: TimelineEntry[];
  /** Every stage a human may move this card to. The server is the authority;
   *  the client holds no copy of the board. */
  stages: Array<{ id: string; name: string; sort_order: number }>;
  reports: Record<string, StressReport>;
  allowedActions: string[];
  actions: Array<{ action: string; label: string; executedBy: 'server' | 'client' | 'none' }>;
}

/** What POST /api/crm/cockpit-action answers with.
 *
 *  A business refusal is HTTP 200 with ok:false, not an error status: a
 *  refusal is normal operation, the same principle api/crm/deal-manager.ts
 *  already lives by, and the UI prints `detail` next to a disabled button. */
export interface CockpitActionResponse {
  ok: boolean;
  report: StressReport;
  refused?: string;
  detail?: string;
  /** Set when the action has to be finished by the browser (a call, a send). */
  execute?: { how: 'client'; via: string; payload: Record<string, unknown> };
  draft?: { subject: string; body: string };
  /** On the ballpark gate: the callback slot read from Pedro's call note,
   *  prefilled so one press books him. */
  suggestedDueAt?: string;
  logEntry?: DealLogEntry;
}
