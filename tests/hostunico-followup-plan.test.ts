import { describe, expect, it } from 'vitest';
import { HOSTUNICO_FOLLOWUP } from '../src/core/hostunicoFollowup';
import { buildFollowupPlan, validateFollowupPlan, londonInput, londonInstant, skipFollowupPlan } from '../src/core/hostunicoFollowupPlan';

const now = Date.parse('2026-10-06T10:15:00Z');
const context = { name: 'Alex', property: '24 Test Street', reportUrl: 'https://hostunico.com/r/test', channel: 'sms' as const };
describe('the reviewed report follow-up plan', () => {
  it('defaults to the existing cumulative 24, 48 and 120 hour waits, all on', () => {
    const plan = buildFollowupPlan(HOSTUNICO_FOLLOWUP, context, now);
    expect(plan.map((i) => i.scheduled_for)).toEqual(['2026-10-07T10:15:00.000Z', '2026-10-09T10:15:00.000Z', '2026-10-14T10:15:00.000Z']);
    expect(plan.every((i) => i.enabled && i.channel === 'sms')).toBe(true);
    expect(plan[0].body).toContain('Hi Alex,');
    expect(plan[0].body).toContain('24 Test Street');
    expect(plan[0].body).toContain(context.reportUrl);
    expect(validateFollowupPlan(plan, now)).toBeNull();
  });
  it('keeps edited dates and exact edited text, including email subjects', () => {
    const plan = buildFollowupPlan(HOSTUNICO_FOLLOWUP, { ...context, channel: 'email' }, now);
    plan[0] = { ...plan[0], scheduled_for: londonInstant('2026-10-08T16:30'), body: 'Hi Alex, the answer we discussed.', subject: 'Your question' };
    expect(validateFollowupPlan(plan, now)).toBeNull();
    expect(londonInput(plan[0].scheduled_for)).toBe('2026-10-08T16:30');
    expect(plan[0].body).toBe('Hi Alex, the answer we discussed.');
  });
  it('skips every item or an individual item without losing its draft', () => {
    const plan = buildFollowupPlan(HOSTUNICO_FOLLOWUP, context, now);
    plan[1].enabled = false;
    expect(plan.filter((i) => i.enabled)).toHaveLength(2);
    const skipped = skipFollowupPlan(plan);
    expect(skipped.every((i) => !i.enabled)).toBe(true);
    expect(skipped.map((i) => i.body)).toEqual(plan.map((i) => i.body));
    expect(validateFollowupPlan(skipped, now + 20 * 86400000)).toBeNull();
  });
  it('moves night defaults to 9am London and handles the clock change', () => {
    const plan = buildFollowupPlan(HOSTUNICO_FOLLOWUP, context, Date.parse('2026-10-23T21:00:00Z'));
    expect(londonInput(plan[0].scheduled_for)).toBe('2026-10-25T09:00');
    expect(londonInstant('2026-10-26T09:00')).toBe('2026-10-26T09:00:00.000Z');
    expect(londonInstant('2026-07-01T09:00')).toBe('2026-07-01T08:00:00.000Z');
  });
  it.each(['2026-10-05T10:00:00Z', '2026-10-07T06:00:00Z', '2026-10-07T19:00:00Z', 'not a date'])('rejects past or night sends: %s', (at) => {
    const plan = buildFollowupPlan(HOSTUNICO_FOLLOWUP, context, now);
    plan[0].scheduled_for = at;
    expect(validateFollowupPlan(plan, now)).toBeTruthy();
  });
  it('rejects duplicate steps and empty enabled messages', () => {
    const plan = buildFollowupPlan(HOSTUNICO_FOLLOWUP, context, now);
    expect(validateFollowupPlan([plan[0], plan[0]], now)).toBeTruthy();
    plan[0].body = '  ';
    expect(validateFollowupPlan(plan, now)).toBeTruthy();
  });
});
