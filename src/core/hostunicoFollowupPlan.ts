import type { FollowupConfig } from './hostunicoFollowup';

export const FOLLOWUP_ZONE = 'Europe/London';
export type FollowupStatus = 'scheduled' | 'edited' | 'skipped' | 'sent' | 'cancelled' | 'sending' | 'check_inbox';
export interface ReportFollowupItem {
  id?: string; step_key: string; channel: 'sms' | 'email'; body: string; subject: string;
  scheduled_for: string; enabled: boolean; version: number; status?: FollowupStatus;
  armed_at?: string | null; sent_at?: string | null; cancel_reason?: string | null;
}
export function londonInput(iso: string | number) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: FOLLOWUP_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (key: string) => parts.find(p => p.type === key)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
export function londonInstant(local: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error('Choose a date and time.');
  const guess = Date.parse(local + ':00Z');
  if (!Number.isFinite(guess)) throw new Error('Choose a valid date.');
  const offset = new Intl.DateTimeFormat('en-GB', { timeZone: FOLLOWUP_ZONE, timeZoneName: 'longOffset' }).formatToParts(guess).find(p => p.type === 'timeZoneName')?.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offset || 'GMT');
  const minutes = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1) : 0;
  const iso = new Date(guess - minutes * 60000).toISOString();
  if (londonInput(iso) !== local) throw new Error('Choose a valid London date and time.');
  return iso;
}
function nextSendTime(at: number) {
  const local = londonInput(Math.ceil(at / 60000) * 60000);
  if (local.slice(11) < '09:00') return londonInstant(local.slice(0, 10) + 'T09:00');
  if (local.slice(11) >= '20:00') {
    const tomorrow = new Date(Date.parse(local.slice(0, 10) + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
    return londonInstant(tomorrow + 'T09:00');
  }
  return londonInstant(local);
}
export function buildFollowupPlan(config: FollowupConfig, context: { name: string; property: string; reportUrl: string; channel: 'sms' | 'email' }, now = Date.now()): ReportFollowupItem[] {
  let anchor = now;
  return config.steps.map(step => {
    const at = nextSendTime(anchor + step.waitHours * 3600000); anchor = Date.parse(at);
    const name = context.name.trim().split(/\s+/)[0];
    const greeting = name ? `Hi ${name},` : 'Hi,';
    return { step_key: step.id, channel: context.channel, subject: context.channel === 'email' ? `Your Hostunico report for ${context.property}` : '',
      body: `${greeting} just following up on your Hostunico report for ${context.property}. ${step.text}\n\n${context.reportUrl}`,
      scheduled_for: at, enabled: true, version: 0 };
  });
}
export const editableFollowup = (item: ReportFollowupItem) => !item.status || ['scheduled', 'edited', 'skipped'].includes(item.status);
export const skipFollowupPlan = (items: ReportFollowupItem[]) => items.map(i => editableFollowup(i) ? { ...i, enabled: false } : i);
export function validateFollowupPlan(items: ReportFollowupItem[], now = Date.now()): string | null {
  if (!Array.isArray(items) || items.length < 1 || items.length > 8 || new Set(items.map(i => i.step_key)).size !== items.length) return 'Refresh the follow-up plan.';
  for (const i of items) {
    if (!/^step\d+$/.test(i.step_key) || !['sms', 'email'].includes(i.channel) || typeof i.enabled !== 'boolean' || !Number.isInteger(i.version)) return 'Refresh the follow-up plan.';
    if (!editableFollowup(i) || !i.enabled) continue;
    if (!Number.isFinite(Date.parse(i.scheduled_for)) || Date.parse(i.scheduled_for) <= now) return 'Choose a future date and time for each follow-up.';
    const time = londonInput(i.scheduled_for).slice(11);
    if (time < '09:00' || time >= '20:00') return 'Follow-ups must be between 09:00 and 20:00 London time.';
    if (typeof i.body !== 'string' || !i.body.trim() || i.body.length > (i.channel === 'sms' ? 1600 : 10000)) return 'Add a message to each enabled follow-up (SMS: 1,600 characters maximum).';
    if (i.channel === 'email' && (!i.subject?.trim() || i.subject.length > 200)) return 'Add an email subject (200 characters maximum).';
  }
  return null;
}
