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
    compsTier: string | null; figuresOnFile: number[];
  };
  checklist: { answered: number; total: number; missing: string[] };
  followups: { nextDueAt: string | null; overdue: boolean; note: string | null };
  builder: { matches: number; booked: boolean; viewingAt: string | null; quote: number | null };
  pack: { compsCount: number; rentComp: boolean; floorplans: boolean };
  allowedActions: string[];
  stateHash: string;
}

export interface CockpitListResponse {
  managerEnabled: boolean;
  generatedAt: string;
  deals: CockpitDeal[];
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
  logEntry?: DealLogEntry;
}
