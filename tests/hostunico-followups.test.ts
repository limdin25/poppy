import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HOSTUNICO_FOLLOWUP, sequencePosition, validFollowupConfig } from '../src/core/hostunicoFollowup';
import { hostunicoFlowGraph } from '../src/features/crm/lib/hostunicoFlowGraph';
import { safeReplyClassification } from '../api/lib/hostunico-reply-intent';
import { nonGsm7 } from '../api/lib/sms-charset';
import { actionLabel } from '../src/features/crm/lib/callbackList';
import { hostunicoCountry, hostunicoPriceCopy } from '../supabase/functions/_shared/hostunico-pricing';
const sent = '2026-09-01T10:00:00Z';
const base = { contact_id: 'lead', report_sent_at: sent, sent_steps: {} };
const hour = 3600000;
describe('manual Hostunico follow-up schedule', () => {
  it('waits 24 hours and never skips unsent steps, however late Pedro is', () => {
    expect(sequencePosition(base, undefined, Date.parse(sent) + 23 * hour).node).toBe('wait_step1');
    expect(sequencePosition(base, undefined, Date.parse(sent) + 24 * hour).node).toBe('step1');
    expect(sequencePosition(base, undefined, Date.parse(sent) + 400 * hour).node).toBe('step1');
  });
  it('anchors the next wait to actual human sending and stops after the third send', () => {
    const l = { ...base, sent_steps: { step1: '2026-09-03T10:00:00Z', step2: '2026-09-06T10:00:00Z' } };
    expect(sequencePosition({ ...base, sent_steps: { step1: l.sent_steps.step1 } }, undefined, Date.parse('2026-09-05T09:59:00Z')).node).toBe('wait_step2');
    expect(sequencePosition(l, undefined, Date.parse('2026-09-11T10:00:00Z')).node).toBe('step3');
    expect(sequencePosition({ ...l, sent_steps: { ...l.sent_steps, step3: '2026-09-12T10:00:00Z' } }).node).toBe('cold');
  });
  it.each(['wait_step1', 'step1', 'step2', 'step3'])('a reply at %s stops the schedule and has the same priority-strip label', (node) => {
    const sent_steps = node === 'step2' ? { step1: sent } : node === 'step3' ? { step1: sent, step2: sent } : {};
    const before = { ...base, sent_steps };
    const now = Date.parse(sent) + (node === 'wait_step1' ? 1 : 200) * hour;
    expect(sequencePosition(before, undefined, now).node).toBe(node);
    const reply = { ...before, replied_at: new Date(now).toISOString(), intent: 'positive' as const };
    expect(sequencePosition(reply, undefined, now).node).toBe('replied');
    expect(sequencePosition(reply, undefined, now).step).toBeNull();
    expect(actionLabel({ contactId: 'lead', name: 'Lead', phone: '', leadType: null, kind: 'sms', cameBackAt: reply.replied_at, missed: false, preview: 'Interested', intent: reply.intent })).toBe('Call this lead');
    const graph = hostunicoFlowGraph(HOSTUNICO_FOLLOWUP, [reply], now);
    expect(graph.nodes.find((n) => n.id === 'replied')!.data.leads).toEqual([reply]);
  });
  it('keeps steps 2 and 3 unapproved and every outbound draft GSM-7 safe', () => {
    expect(HOSTUNICO_FOLLOWUP.steps.map((s) => s.approved)).toEqual([true, false, false]);
    for (const s of HOSTUNICO_FOLLOWUP.steps) expect(nonGsm7(s.text)).toEqual([]);
    expect(validFollowupConfig(HOSTUNICO_FOLLOWUP)).toBe(true);
    expect(validFollowupConfig({ ...HOSTUNICO_FOLLOWUP, steps: [{ ...HOSTUNICO_FOLLOWUP.steps[0], waitHours: -1 }] })).toBe(false);
  });
  it('reuses the strip RPC and realtime source, with no automated sending or calendar imports', () => {
    const hook = readFileSync('src/features/crm/hooks/useCallbacks.ts', 'utf8');
    expect(hook).toContain(".rpc('wk_callbacks_open'");
    expect(hook).toContain("table: 'sa_report_followups'");
    const migration = readFileSync('supabase/migrations/20260930000004_hostunico_followups.sql', 'utf8');
    expect(migration).toContain('after insert or update of status on wk_sms_messages');
    expect(migration).toContain('after insert or update of answered_at,duration_sec,contact_id on wk_calls');
    expect(migration).not.toMatch(/net\.http|cron\.schedule|insert into wk_jobs/);
    const api = readFileSync('api/crm/sa-followups.ts', 'utf8');
    expect(api).toContain("if (internal && action !== 'classify')");
    expect(api).toContain("if (action !== 'send')");
    expect(api).not.toMatch(/calendar|createBooking|bookCall/);
  });
});
describe('reply classification is conservative', () => {
  it.each([
    ['Yes, can we get started?', 'positive', 0.95, 'positive'],
    ['Not interested thanks', 'negative', 0.96, 'negative'],
    ['Wrong number', 'negative', 0.99, 'negative'],
    ['How much is it?', 'neutral', 0.95, 'neutral'],
    ['not now, maybe later', 'positive', 0.99, 'neutral'],
    ['STOP', 'positive', 0.99, 'negative'],
    ['👍', 'positive', 0.99, 'neutral'],
    ['Maybe', 'positive', 0.65, 'neutral'],
  ])('%s routes to %s safely', (text, intent, confidence, expected) => {
    expect(safeReplyClassification(text as string, { intent, confidence, reason: 'Message intent.' }).intent).toBe(expected);
  });
  it('cannot override an explicit opt-out and malformed responses stay neutral', () => {
    expect(safeReplyClassification('Please stop texting me', '{}').optOut).toBe(true);
    expect(safeReplyClassification('Hello', 'not JSON').intent).toBe('neutral');
  });
});
describe('display pricing only', () => {
  it('detects a UK lead, allows an override and keeps unknown currency in pounds', () => {
    expect(hostunicoCountry(null, '+447700900123')).toBe('GB');
    expect(hostunicoCountry('US', '+447700900123')).toBe('US');
    expect(hostunicoPriceCopy()).toContain('£29');
    expect(hostunicoPriceCopy('US')).toContain('$29');
    expect(hostunicoPriceCopy()).toContain('management fee is 9%');
    expect(hostunicoPriceCopy()).toContain('9% + VAT');
    expect(hostunicoPriceCopy()).not.toMatch(/registration|current billing|pending/i);
  });
});
