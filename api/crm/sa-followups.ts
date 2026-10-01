import { createClient } from '@supabase/supabase-js';
import { callLLM } from '../lib/llm.js';
import { nonGsm7 } from '../lib/sms-charset.js';
import { HOSTUNICO_CAMPAIGN } from '../lib/hostunico-report.js';
import { hostunicoOutreachAllowed, HOSTUNICO_UPLIFT_PENDING } from '../../supabase/functions/_shared/hostunico-uplift.js';
import { REPLY_CLASSIFIER_PROMPT, safeReplyClassification, explicitOptOut } from '../lib/hostunico-reply-intent.js';
import { validFollowupConfig, sequencePosition, hostunicoFollowupSms } from '../../src/core/hostunicoFollowup.js';

export const config = { runtime: 'edge' };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
function checked<T>({ data, error }: { data: T; error: unknown }): T { if (error) throw new Error('Could not save or load follow-ups.'); return data; }

export default async function handler(req: Request) {
  try {
    if (!['GET', 'POST'].includes(req.method)) return json({ error: 'Method not allowed' }, 405);
    const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const internal = !!jwt && [process.env.CRM_JOBS_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean).includes(jwt);
    const { data: auth } = internal ? { data: { user: null } } : await db.auth.getUser(jwt);
    if (!internal && !auth.user) return json({ error: 'Please sign in.' }, 401);
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    if (!internal && !checked(await caller.rpc('wk_is_agent_or_admin'))) return json({ error: 'CRM access required.' }, 403);
    const admin = !internal && checked(await caller.rpc('wk_is_admin'));
    const body = (req.method === 'POST' ? await req.json() : {}) as { action?: string; config?: unknown; contact_id?: string; intent?: string; step?: string };
    if (!body || typeof body !== 'object') return json({ error: 'A request object is required.' }, 400);
    const action = body.action || 'list';
    if (internal && action !== 'classify') return json({ error: 'Classification only.' }, 403);
    const savedConfig = checked(await db.from('sa_followup_config').select('config').eq('id', true).single()).config;
    if (!validFollowupConfig(savedConfig)) throw new Error('The follow-up flow needs an administrator review.');
    if (action === 'config' && req.method === 'POST') {
      if (!admin) return json({ error: 'Only Hugo or an administrator can approve or edit this flow.' }, 403);
      if (!validFollowupConfig(body.config) || body.config.steps.some((s: { text: string }) => nonGsm7(s.text).length || /[\u2013\u2014]/.test(s.text))) return json({ error: 'Check the steps, timing and plain SMS characters.' }, 400);
      checked(await db.from('sa_followup_config').update({ config: body.config, updated_at: new Date().toISOString() }).eq('id', true));
      return json({ ok: true });
    }
    let contactsQuery = db.from('wk_contacts').select('id,name,phone,do_not_call').eq('desk', 'sa');
    if (!internal && !admin) contactsQuery = contactsQuery.eq('owner_agent_id', auth.user!.id);
    if (body.contact_id) contactsQuery = contactsQuery.eq('id', body.contact_id);
    const contacts = checked(await contactsQuery);
    const ids = contacts.map((c) => c.id);
    if (!ids.length) return action === 'list' ? json({ leads: [], config: savedConfig, admin }) : json({ error: 'Lead not assigned to your serviced accommodation desk.' }, 403);
    let rows = checked(await db.from('sa_report_followups').select('*').in('contact_id', ids).order('report_sent_at', { ascending: false }));
    if (action === 'list') return json({ config: savedConfig, admin, leads: rows.map((r) => ({ ...r, ...contacts.find((c) => c.id === r.contact_id) })) });
    if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
    if (action === 'classify') {
      const pending = rows.filter((r) => r.classification_pending && !r.overridden_at).slice(0, 3);
      await Promise.all(pending.map(async (r) => {
        let raw = '';
        try { if (!explicitOptOut(r.reply_body || '')) raw = await callLLM('gpt-5.4-mini', REPLY_CLASSIFIER_PROMPT, [{ role: 'user', content: String(r.reply_body || '').slice(0, 4000) }], 500, { allowProviderFallback: false, reasoningEffort: 'none', jsonOutput: true, timeoutMs: 6500 }); } catch { /* Neutral keeps Pedro in control if OpenAI is unavailable. */ }
        const result = safeReplyClassification(r.reply_body || '', raw);
        const updated = checked(await db.from('sa_report_followups').update({ intent: result.intent, reason: result.reason, confidence: result.confidence, classification_pending: false, cold_at: result.intent === 'negative' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('contact_id', r.contact_id).eq('replied_at', r.replied_at).is('overridden_at', null).eq('classification_pending', true).select('contact_id'));
        if (updated.length && result.intent === 'negative') checked(await db.from('wk_contact_tags').upsert({ contact_id: r.contact_id, tag: 'not-interested' }, { onConflict: 'contact_id,tag', ignoreDuplicates: true }));
        if (updated.length && result.optOut) {
          checked(await db.from('wk_contacts').update({ do_not_call: true }).eq('id', r.contact_id));
          checked(await db.from('wk_contact_tags').upsert({ contact_id: r.contact_id, tag: 'do-not-text' }, { onConflict: 'contact_id,tag', ignoreDuplicates: true }));
        }
      }));
      return json({ classified: pending.length });
    }
    const lead = rows.find((r) => r.contact_id === body.contact_id);
    if (!lead) return json({ error: 'Report sequence not found.' }, 404);
    if (action === 'override') {
      if (!lead.replied_at || !['positive', 'negative', 'neutral'].includes(body.intent)) return json({ error: 'Choose a reply label.' }, 400);
      checked(await db.from('sa_report_followups').update({ intent: body.intent, reason: 'Label chosen by Pedro or an administrator.', confidence: 1, classification_pending: false, overridden_at: new Date().toISOString(), overridden_by: auth.user!.id, cold_at: body.intent === 'negative' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('contact_id', lead.contact_id).eq('replied_at', lead.replied_at));
      // Relabelling never removes opt-out suppression or restarts a sequence.
      return json({ ok: true });
    }
    if (action === 'log_contact') {
      checked(await db.rpc('sa_record_report_reply', { p_contact: lead.contact_id, p_at: new Date().toISOString(), p_body: 'Pedro logged contact from this lead. Review the conversation.', p_kind: 'manual' }));
      return json({ ok: true });
    }
    if (action !== 'send') return json({ error: 'Unknown action.' }, 400);
    if (!await hostunicoOutreachAllowed(db, lead.contact_id)) return json({ error: HOSTUNICO_UPLIFT_PENDING }, 409);
    const position = sequencePosition(lead, savedConfig);
    if (!position.step || position.node !== body.step || !position.step.approved) return json({ error: 'This follow-up is not due or its wording still needs Hugo approval.' }, 409);
    const sms = hostunicoFollowupSms(position.step.text);
    if (nonGsm7(sms).length) return json({ error: 'SMS copy needs plain characters.' }, 400);
    if (!checked(await db.rpc('sa_claim_followup', { p_contact: lead.contact_id, p_step: body.step }))) return json({ error: 'The lead replied, opted out, or this send is already in progress. Refresh the list.' }, 409);
    try {
      const fresh = checked(await db.from('sa_report_followups').select('replied_at').eq('contact_id', lead.contact_id).single());
      if (fresh.replied_at) {
        checked(await db.from('sa_report_followups').update({ send_state: 'idle' }).eq('contact_id', lead.contact_id));
        return json({ error: 'A reply just arrived. The follow-up has been stopped.' }, 409);
      }
      // This is called only by Pedro's Send button, through the existing human sender.
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/wk-sms-send`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contact_id: lead.contact_id, campaign_id: HOSTUNICO_CAMPAIGN, channel: 'sms', body: sms }), signal: AbortSignal.timeout(20000) });
      const sent = await response.json() as { twilio_sid?: string; status?: string };
      if (!response.ok || !sent.twilio_sid) throw new Error('Send status uncertain. Check the inbox before another attempt.');
      const now = new Date().toISOString();
      const sentSteps = { ...lead.sent_steps, [body.step]: now };
      checked(await db.from('sa_report_followups').update({ sent_steps: sentSteps, send_state: 'idle', updated_at: now }).eq('contact_id', lead.contact_id));
      if (savedConfig.steps.every((s) => sentSteps[s.id])) checked(await db.from('sa_report_followups').update({ cold_at: now }).eq('contact_id', lead.contact_id).is('replied_at', null));
      return json({ ok: true, status: sent.status });
    } catch {
      await db.from('sa_report_followups').update({ send_state: 'check_inbox' }).eq('contact_id', lead.contact_id);
      return json({ error: 'Check the inbox for delivery status. This send will not retry automatically.' }, 502);
    }
  } catch (e) { return json({ error: e instanceof Error ? e.message : 'Could not complete this action.' }, 503); }
}
