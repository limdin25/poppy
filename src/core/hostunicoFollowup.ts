export type ReplyIntent = 'positive' | 'negative' | 'neutral';
export interface FollowupStep { id: string; label: string; waitHours: number; text: string; approved: boolean }
export interface FollowupConfig { steps: FollowupStep[]; branches: { intent: ReplyIntent; target: 'replied' | 'cold'; label: string }[] }
export const HOSTUNICO_FOLLOWUP: FollowupConfig = {
  steps: [
    { id: 'step1', label: 'Step 1', waitHours: 24, text: 'Did the numbers match what you expected?', approved: true },
    { id: 'step2', label: 'Step 2', waitHours: 48, text: 'Would a quick walkthrough of onboarding help?', approved: false },
    { id: 'step3', label: 'Step 3', waitHours: 120, text: 'Shall I leave this with you for now?', approved: false },
  ],
  branches: [
    { intent: 'positive', target: 'replied', label: 'Call this lead' },
    { intent: 'neutral', target: 'replied', label: 'Needs a human look' },
    { intent: 'negative', target: 'cold', label: 'Not interested' },
  ],
};
export interface SequenceLead {
  contact_id: string; report_sent_at: string; sent_steps: Record<string, string>;
  replied_at?: string | null; intent?: ReplyIntent | null; reason?: string | null;
  confidence?: number | null; classification_pending?: boolean; overridden_at?: string | null;
  reply_body?: string | null; reply_kind?: string | null; cold_at?: string | null;
  send_state?: string | null; name?: string; phone?: string;
}
export function sequencePosition(lead: SequenceLead, config = HOSTUNICO_FOLLOWUP, now = Date.now()) {
  if (lead.replied_at) {
    const branch = config.branches.find((b) => b.intent === (lead.intent || 'neutral'));
    return { node: branch?.target || 'replied', label: branch?.label || 'Needs a human look', dueAt: null, step: null };
  }
  if (lead.cold_at) return { node: 'cold', label: 'Cold', dueAt: null, step: null };
  let anchor = lead.report_sent_at;
  for (const step of config.steps) {
    if (lead.sent_steps[step.id]) { anchor = lead.sent_steps[step.id]; continue; }
    const dueAt = new Date(Date.parse(anchor) + step.waitHours * 3600000).toISOString();
    const due = now >= Date.parse(dueAt);
    return { node: due ? step.id : `wait_${step.id}`, label: due ? `${step.label} due` : 'Waiting', dueAt, step };
  }
  return { node: 'cold', label: 'Cold', dueAt: null, step: null };
}
export function replySignal(intent?: ReplyIntent | null) {
  return intent === 'positive' ? 'Call this lead' : intent === 'negative' ? 'Not interested' : 'Needs a human look';
}
export function validFollowupConfig(value: unknown): value is FollowupConfig {
  const c = value as FollowupConfig;
  return !!c && Array.isArray(c.steps) && c.steps.length > 0 && c.steps.length <= 8
    && new Set(c.steps.map((s) => s.id)).size === c.steps.length
    && c.steps.every((s) => /^step[0-9]+$/.test(s.id) && typeof s.label === 'string' && s.label.length <= 50
      && Number.isFinite(s.waitHours) && s.waitHours >= 1 && s.waitHours <= 720
      && typeof s.text === 'string' && s.text.length > 0 && s.text.length <= 600 && typeof s.approved === 'boolean')
    && Array.isArray(c.branches) && ['positive', 'negative', 'neutral'].every((intent) => c.branches.some((b) => b.intent === intent))
    && c.branches.every((b) => ['positive', 'negative', 'neutral'].includes(b.intent) && ['replied', 'cold'].includes(b.target) && typeof b.label === 'string' && b.label.length <= 80);
}
