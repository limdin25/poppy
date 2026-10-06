import { createClient } from '@supabase/supabase-js';
export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const key = process.env.CRM_JOBS_KEY;
  if (!key) return Response.json({ error: 'Follow-up sender is not configured' }, { status: 503 });
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  // An interrupted request may already have reached a provider. Never requeue it.
  const stale = await db.from('sa_report_followup_items').update({ status: 'check_inbox', updated_at: new Date().toISOString() }).eq('status', 'sending').lt('send_requested_at', new Date(Date.now() - 300000).toISOString());
  if (stale.error) return Response.json({ error: 'Could not check interrupted sends' }, { status: 503 });
  const { data: items, error } = await db.from('sa_report_followup_items').select('id,channel').in('status', ['scheduled', 'edited']).not('armed_at', 'is', null).lte('scheduled_for', new Date().toISOString()).order('scheduled_for').limit(3);
  if (error) return Response.json({ error: 'Could not load due follow-ups' }, { status: 503 });
  const results = await Promise.all((items || []).map(async item => {
    try {
      const r = await fetch(`${process.env.SUPABASE_URL}/functions/v1/${item.channel === 'email' ? 'wk-email-send' : 'wk-sms-send'}`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_followup_id: item.id }), signal: AbortSignal.timeout(20000),
      });
      const result = await r.json();
      if (!r.ok || result.error) throw new Error('Follow-up not submitted');
      return true;
    } catch {
      await db.from('sa_report_followup_items').update({ status: 'check_inbox', updated_at: new Date().toISOString() }).eq('id', item.id).eq('status', 'sending');
      return false;
    }
  }));
  return Response.json({ checked: results.length, submitted: results.filter(Boolean).length });
}
