import { createClient } from '@supabase/supabase-js';
import { callLLM } from '../lib/llm.js';
import {
  mergeReplySettings,
  type CampaignReplyOverride,
} from '../lib/campaign-reply-settings.js';

export const config = { runtime: 'edge' };

// Inline Twilio send (edge-safe: btoa, no Buffer) so this route doesn't pull
// in the whole Twilio client module.
async function sendSMS(from: string, to: string, body: string): Promise<{ sid?: string; status?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<{ sid?: string; status?: string }>;
}

/**
 * CRM AI warm-up reply. Called by the wk-jobs-worker `ai_reply` handler (which
 * fires after the configured delay). Re-checks the full guards, generates a
 * reply with the closer's pitch prompt, and either drafts it (VA approves) or
 * auto-sends. All storage is in wk_* tables. Auth = the Supabase service key
 * (the only caller is the trusted worker).
 */
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const HISTORY = 10;

function withinHours(hoursStart: number, hoursEnd: number, days: string[], tz: string): boolean {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || 'Europe/London', weekday: 'short', hour: '2-digit', hour12: false,
  }).formatToParts(now);
  const day = parts.find((p) => p.type === 'weekday')?.value || '';
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  if (days && days.length && !days.includes(day)) return false;
  // 0/24 window = always on.
  if (hoursStart === 0 && (hoursEnd === 24 || hoursEnd === 0)) return true;
  return hour >= hoursStart && hour < hoursEnd;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '');
  const jobsKey = process.env.CRM_JOBS_KEY || '';
  if (bearer !== process.env.SUPABASE_SERVICE_ROLE_KEY && (!jobsKey || bearer !== jobsKey)) {
    return json(401, { error: 'Unauthorized' });
  }

  let payload: { contact_id?: string; to_e164?: string; from_e164?: string };
  try { payload = await req.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  const contactId = (payload.contact_id || '').trim();
  const replyFrom = (payload.to_e164 || '').trim(); // the CRM number the lead texted
  if (!contactId) return json(400, { error: 'contact_id required' });

  // Settings.
  const { data: s } = await supabase.from('wk_ai_reply_settings').select('*').eq('id', 'default').maybeSingle();
  if (!s || !s.enabled) return json(200, { skipped: 'disabled' });

  // Contact.
  const { data: c } = await supabase
    .from('wk_contacts')
    // custom_fields carries owner_name, the PERSON. `name` is the COMPANY.
    .select('id, name, phone, ai_enabled, ai_reply_count, pipeline_column_id, custom_fields')
    .eq('id', contactId).maybeSingle();
  if (!c) return json(200, { skipped: 'no_contact' });
  if (c.ai_enabled === false) return json(200, { skipped: 'contact_disabled' });
  if ((c.ai_reply_count ?? 0) >= (s.max_replies_per_contact ?? 5)) return json(200, { skipped: 'max_replies' });
  if (!withinHours(s.hours_start, s.hours_end, s.days, s.timezone)) return json(200, { skipped: 'out_of_hours' });

  // Message history (oldest first).
  //
  // Read BEFORE the campaign gate on purpose. The two guards under it are the
  // stand-down rails, and they have to run even when this campaign has replies
  // switched off. With the campaign early return first, a lead who answered
  // "stop" or "call me" inside a switched-off campaign was never flagged, and
  // switching that campaign back on later resumed AI replies to someone who had
  // already asked for a human.
  const { data: msgs } = await supabase
    .from('wk_sms_messages')
    .select('direction, body, ai_generated, created_by, created_at')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(HISTORY);
  const history = (msgs ?? []).reverse() as Array<{ direction: string; body: string; ai_generated: boolean; created_by: string | null; created_at: string }>;
  if (!history.length) return json(200, { skipped: 'no_history' });

  // Auto-off: a human (agent) replied after the last inbound, so stand down.
  // Compare timestamps (order-independent) rather than array position.
  const ms = (t: string) => new Date(t).getTime();
  const inboundTimes = history.filter((m) => m.direction === 'inbound').map((m) => ms(m.created_at));
  const lastInboundTime = inboundTimes.length ? Math.max(...inboundTimes) : null;
  if (s.auto_off_on_human_reply && lastInboundTime !== null) {
    const humanAfter = history.some(
      (m) => m.direction === 'outbound' && !m.ai_generated && ms(m.created_at) > lastInboundTime,
    );
    if (humanAfter) {
      await supabase.from('wk_contacts').update({ ai_enabled: false }).eq('id', contactId);
      return json(200, { skipped: 'human_replied' });
    }
  }

  // Handoff keyword in the last inbound, so stand down + flag.
  const lastInboundMsg = history.filter((m) => m.direction === 'inbound').slice(-1)[0];
  const lastInbound = (lastInboundMsg?.body || '').toLowerCase();
  if ((s.handoff_keywords || []).some((k: string) => k && lastInbound.includes(k.toLowerCase()))) {
    await supabase.from('wk_contacts').update({ ai_enabled: false }).eq('id', contactId);
    return json(200, { skipped: 'handoff_keyword' });
  }

  // Which campaign is this thread? Hugo 2026-07-28: "every campaign should have
  // own reply prompt". Maria's WEBSITE opener ("this is Pedro, I built you one")
  // was being answered with the Google REVIEWS pitch, because the row above is a
  // single global row shared by every campaign.
  //
  // Only the prompt, the mode, the model and an off switch are per-campaign.
  // Everything else above and below stays global on purpose: hours/days/timezone,
  // max_replies_per_contact, reply_delay_seconds (wk-sms-incoming),
  // handoff_keywords, auto_off_on_human_reply and auto_off_on_booking are safety
  // rails, not pitch, and splitting them per campaign multiplies the ways a lead
  // gets texted at midnight.
  //
  // Every one of the three reads below is checked for an error and fails the
  // job. Ignoring the error is not "no campaign", it is "we do not know which
  // campaign", and the fallback for that used to be the GLOBAL REVIEWS PITCH,
  // which is the exact bug this feature exists to prevent. A stale PostgREST
  // schema cache, a transient 5xx or a grant change all land here. The worker
  // retries 5 times then marks the job dead with last_error, and nothing has
  // been written or sent at this point, so a retry cannot double-text a lead.
  const { data: campaignId, error: campaignErr } = await supabase.rpc('wk_sms_reply_campaign', {
    p_contact: contactId,
    p_number: replyFrom || null,
  });
  if (campaignErr) {
    console.error('[ai-reply] campaign resolve FAILED, no reply drafted', {
      contact_id: contactId, number: replyFrom, error: campaignErr.message,
    });
    return json(503, { error: 'campaign_lookup_failed', detail: campaignErr.message });
  }

  let override: CampaignReplyOverride | null = null;
  let campaignActive: boolean | null = null;
  if (campaignId) {
    const { data: ov, error: ovErr } = await supabase
      .from('wk_campaign_ai_settings')
      .select('sms_reply_prompt, sms_reply_mode, sms_reply_model, sms_reply_enabled')
      .eq('campaign_id', campaignId as string)
      .maybeSingle();
    if (ovErr) {
      console.error('[ai-reply] campaign reply settings read FAILED, no reply drafted', {
        contact_id: contactId, campaign_id: campaignId, error: ovErr.message,
      });
      return json(503, { error: 'campaign_settings_failed', detail: ovErr.message });
    }
    override = (ov as CampaignReplyOverride | null) ?? null;

    // Paused campaigns still resolve (the resolver no longer filters on
    // is_active) and count as reply-disabled. Pausing a finished blast the
    // morning after is the natural thing to do, and it used to make the lead
    // fall through to the global reviews pitch instead of going quiet.
    const { data: camp, error: campErr } = await supabase
      .from('wk_dialer_campaigns')
      .select('is_active')
      .eq('id', campaignId as string)
      .maybeSingle();
    if (campErr) {
      console.error('[ai-reply] campaign row read FAILED, no reply drafted', {
        contact_id: contactId, campaign_id: campaignId, error: campErr.message,
      });
      return json(503, { error: 'campaign_state_failed', detail: campErr.message });
    }
    campaignActive = (camp as { is_active?: boolean } | null)?.is_active ?? null;
  }

  const cfg = mergeReplySettings(
    {
      enabled: !!s.enabled,
      mode: s.mode === 'auto' ? 'auto' : 'draft',
      model: s.model || '',
      system_prompt: s.system_prompt || '',
    },
    (campaignId as string | null) ?? null,
    override,
    campaignActive,
  );
  // sms_reply_enabled is an AND with the global switch, and a paused campaign is
  // an AND too, so this only fires when a campaign was switched off or paused by
  // hand. Either way the answer is silence, never the global pitch.
  if (!cfg.enabled) {
    return json(200, {
      skipped: campaignActive === false ? 'campaign_paused' : 'campaign_disabled',
      campaign_id: cfg.campaign_id,
    });
  }

  // Build the LLM messages: inbound=user, outbound=assistant.
  //
  // The name model: wk_contacts.name is the COMPANY, custom_fields.owner_name
  // is the PERSON. Taking the first word of `name` greeted Ryan at "James
  // brothers plumbing" as "James", mid-conversation, live, on 2026-07-27,
  // right after our own opener had correctly called him Ryan. Owner first,
  // and only fall back to the company word when there is no owner on file.
  const ownerName = String(
    (c.custom_fields as Record<string, unknown> | null)?.owner_name ?? '',
  ).trim();
  const firstName = (ownerName || (c.name || '')).trim().split(/\s+/)[0] || '';
  const llmMessages = history.map((m) => ({
    role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: m.body || '',
  })).filter((m) => m.content);

  // Honour the global kill switch + daily SMS cap (same gate the SMS send
  // functions use). Kill switch = hard stop (skip generation entirely). Daily
  // cap blocks auto-sends only; drafts don't consume the cap.
  const { data: gate } = await supabase.rpc('wk_outbound_sms_allowed');
  const blocked = !!gate && (gate as { allowed?: boolean }).allowed === false;
  if (blocked && (gate as { reason?: string }).reason === 'killswitch') {
    return json(200, { skipped: 'killswitch' });
  }

  let systemPrompt = cfg.system_prompt || '';
  if (firstName) systemPrompt += `\n\nThe lead's first name is ${firstName}.`;

  // The callback number, spelled out. Without this the prompt asked for a
  // call-back while never saying which line it was texting from, and the model
  // filled the hole with the literal text "[number]", which reached a draft in
  // Hugo's inbox on 2026-07-27.
  systemPrompt += replyFrom
    ? `\n\nYou are texting from ${replyFrom}. If you ask them to ring you, use exactly that number and no other.`
    : '\n\nYou do not know which number this text came from, so never invent a number. Say "just reply here" or "give us a ring on the number this text came from" instead.';

  // VSL context: if this lead has a video page, tell the model exactly where
  // they are in the funnel so the reply pushes toward the £1 close (their
  // page link included) instead of generic chat.
  //
  // Skipped when the campaign brought its own prompt. This block is the reviews
  // funnel written out longhand, and bolting it onto a campaign prompt is the
  // exact bug this feature exists to stop: the website campaign would go back to
  // pitching reviews at £1 halfway through its own reply.
  const { data: vsl } = cfg.source === 'campaign'
    ? { data: null }
    : await supabase
      .from('wk_vsl_pages')
      .select('slug, state, watched_pct, owner_first, business_name')
      .eq('contact_id', contactId)
      .maybeSingle();
  if (vsl) {
    const vslUrl = `https://heyelsie.com/${vsl.slug}`;
    const stage: Record<string, string> = {
      created: 'has not been sent their video yet',
      sent: 'was texted their personalised video but has not opened it',
      opened: `opened their video page but has only watched ${vsl.watched_pct || 0}%`,
      watched: 'watched their video but has not tapped the sign-up button',
      cta_clicked: 'tapped the button but did not pick a plan',
      checkout_started: 'reached the payment page but did not finish, likely hesitating at the card',
      paid: 'has already signed up and paid, so help them get set up and do NOT sell',
    };
    systemPrompt += `\n\nVIDEO FUNNEL CONTEXT: this lead (${vsl.owner_first || 'owner'} at ${vsl.business_name}) ${stage[vsl.state] || vsl.state}. Their personal video page is ${vslUrl}. Include it when nudging them to watch or sign up. Goal: get them to watch, then tap the button (it's £1 for the first 10 days, we set everything up for them). Keep it warm and human, never pushy.`;
  }

  const reply = (await callLLM(cfg.model || 'claude-sonnet-4-6', systemPrompt, llmMessages, 300)).trim();
  if (!reply) return json(200, { skipped: 'empty_reply' });

  const draft = cfg.mode === 'draft';
  let status = 'draft';
  const toPhone = c.phone as string;
  const fromNumber = replyFrom || null;

  if (!draft) {
    if (blocked) return json(200, { skipped: 'blocked', reason: (gate as { reason?: string }).reason });
    if (!fromNumber) return json(200, { skipped: 'no_from_number' });
    // Insert the row BEFORE calling Twilio so a worker retry after a lost
    // response can't regenerate a different reply and double-send the lead.
    const { data: pending } = await supabase.from('wk_sms_messages').insert({
      contact_id: contactId, direction: 'outbound', channel: 'sms', body: reply,
      from_e164: fromNumber, to_e164: toPhone, status: 'sending', ai_generated: true,
    }).select('id').single();
    let sent: { sid?: string; status?: string };
    try {
      sent = await sendSMS(fromNumber, toPhone, reply);
    } catch (e) {
      // Send failed, so mark the row and return 200 (NOT 500) so the worker
      // doesn't retry, regenerate and double-send. A dropped AI reply beats a
      // duplicate text to the lead.
      if (pending?.id) await supabase.from('wk_sms_messages').update({ status: 'failed' }).eq('id', pending.id);
      return json(200, { skipped: 'send_failed', error: e instanceof Error ? e.message : String(e) });
    }
    status = sent?.sid ? 'sent' : 'queued';
    if (pending?.id) {
      await supabase.from('wk_sms_messages').update({
        twilio_sid: sent?.sid ?? null, external_id: sent?.sid ?? null, status,
      }).eq('id', pending.id);
    }
  } else {
    await supabase.from('wk_sms_messages').insert({
      contact_id: contactId, direction: 'outbound', channel: 'sms', body: reply,
      from_e164: fromNumber || '', to_e164: toPhone, status: 'draft', ai_generated: true,
    });
  }

  await supabase.from('wk_contacts').update({
    ai_reply_count: (c.ai_reply_count ?? 0) + 1,
    ai_reply_last_at: new Date().toISOString(),
    last_contact_at: new Date().toISOString(),
  }).eq('id', contactId);

  return json(200, {
    ok: true,
    mode: cfg.mode,
    status,
    campaign_id: cfg.campaign_id,
    prompt_source: cfg.source,
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
