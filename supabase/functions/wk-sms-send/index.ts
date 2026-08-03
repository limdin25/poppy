// wk-sms-send — outbound SMS for /crm. PR 50, Hugo 2026-04-27.
//
// Body:
//   { contact_id: string, body: string, from_e164?: string }
//
// 1. Verify JWT, look up the agent.
// 2. Resolve the wk_contact to get phone.
// 3. POST to Twilio Messages.create.
// 4. INSERT a wk_sms_messages row with direction='outbound' +
//    twilio_sid + status mapped from Twilio's response.
// 5. Return { message_id, twilio_sid }.
//
// Companion to wk-sms-incoming. Both write into the same table.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface SendBody {
  contact_id: string;
  body: string;
  // Optional — defaults to the workspace's first voice/SMS-enabled
  // wk_numbers row. Pass when an agent has multiple lines.
  from_e164?: string;
  /** PR 96 (Hugo 2026-04-28): when set, resolve from-line via
   *  wk_campaign_numbers (channel='sms') for this campaign, mirroring
   *  the other channel send paths. Falls through to from_e164 then
   *  workspace default. */
  campaign_id?: string;
  /** Public URL to a file in crm-attachments bucket. Sent as Twilio MMS MediaUrl. */
  attachment_url?: string;
  /** 2026-08-02: 'whatsapp' sends through Twilio's WhatsApp channel from the
   *  ONE Meta-registered sender (see WHATSAPP_SENDER_E164 below). Same door
   *  as SMS, the two numbers just get a whatsapp: prefix. Anything else (or
   *  absent) is plain SMS, exactly as before. */
  channel?: 'sms' | 'whatsapp';
  /** 2026-08-03: send a Meta-APPROVED WhatsApp template (Twilio Content sid,
   *  HX...). This is the ONLY thing that may open a conversation more than
   *  24 hours after the lead's last message, so a template send deliberately
   *  skips the 24h window check. It costs money per message (unlike a free
   *  in-window reply), and Twilio kills an unapproved template send
   *  ASYNCHRONOUSLY, so approval is verified here before spending. */
  content_sid?: string;
  /** Values for the template's {{1}}, {{2}} ... blanks, keyed by number. */
  content_variables?: Record<string, string>;
}

// The one number registered with Meta as a WhatsApp Business sender (Twilio
// Console -> Messaging -> Senders -> WhatsApp senders, status ONLINE,
// registered 2026-08-02). Every WhatsApp send MUST leave from a registered
// sender or Twilio rejects it with 63007, so per-agent SMS lines don't apply
// here. Env-overridable for when more senders get registered; the number
// itself is public config, not a secret.
const WHATSAPP_SENDER_E164 = Deno.env.get('WHATSAPP_SENDER_E164') || '+447460035763';

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Normalise a loosely-typed phone into E.164. UK contacts are often stored in
// national format (07…) which Twilio rejects (error 21211); default unknown
// leading-zero numbers to +44.
function normalizeE164(raw: string): string {
  let s = (raw ?? '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (s.startsWith('00')) return '+' + s.slice(2);
  if (s.startsWith('0')) return '+44' + s.slice(1); // UK national
  return '+' + s;
}

// Rough country class for from/to matching: GB (+44) vs North America (+1).
const countryClass = (e164: string): string =>
  e164.startsWith('+44') ? 'gb' : e164.startsWith('+1') ? 'na' : 'other';

const TEMPLATE_VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;

/** Fill a template's {{1}}, {{2}} ... so the CRM stores what the lead
 *  actually received, not the placeholder text. */
function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(TEMPLATE_VAR_RE, (_m, n: string) => vars[n] ?? '');
}

/** GET from Twilio, keeping the STATUS. "Twilio was rude to us" (429, 500,
 *  bad creds, network) and "Twilio says that template does not exist" (404)
 *  are different facts, and telling an agent their approved template is
 *  missing because of a rate limit sends them off to rebuild it for nothing. */
async function twilioGet(
  url: string,
): Promise<{ status: number; data: Record<string, unknown> | null }> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`) },
    });
    if (!res.ok) return { status: res.status, data: null };
    try {
      return { status: res.status, data: await res.json() };
    } catch {
      return { status: 0, data: null };
    }
  } catch {
    return { status: 0, data: null };
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const auth = req.headers.get('authorization') ?? '';
    const jwt = auth.replace(/^Bearer\s+/i, '');
    if (!jwt) return json(401, { error: 'Missing bearer token' });

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: userResp, error: userErr } = await supa.auth.getUser(jwt);
    if (userErr || !userResp?.user) return json(401, { error: 'Invalid token' });
    const agentId = userResp.user.id;

    let payload: SendBody;
    try {
      payload = await req.json() as SendBody;
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }

    const contactId = (payload.contact_id ?? '').trim();
    const body = (payload.body ?? '').trim();
    const contentSid = (payload.content_sid ?? '').trim();
    // A template send carries no free text: the wording is fixed by the
    // version Meta approved, only the blanks travel.
    const isTemplate = contentSid.length > 0;
    if (!contactId) return json(400, { error: 'contact_id required' });
    if (!body && !isTemplate) return json(400, { error: 'body required' });
    if (body.length > 1600) return json(400, { error: 'body too long (max 1600 chars)' });

    // Resolve contact's phone.
    const { data: contact, error: contactErr } = await supa
      .from('wk_contacts')
      .select('id, phone, name')
      .eq('id', contactId)
      .maybeSingle();
    if (contactErr) return json(500, { error: contactErr.message });
    if (!contact) return json(404, { error: 'Contact not found' });

    const toE164 = normalizeE164((contact.phone as string | null) ?? '');
    if (!toE164) return json(400, { error: 'Contact has no phone number' });

    // A recorded opt-out (they texted STOP, wk-sms-incoming tagged them)
    // blocks every manual send on every channel. On SMS the carrier is a
    // partial backstop; on WhatsApp there is none, and enough Report/Block
    // taps rate-limits then bans the ONE registered sender for everyone.
    const { data: dnt } = await supa
      .from('wk_contact_tags')
      .select('tag')
      .eq('contact_id', contactId)
      .eq('tag', 'do-not-text')
      .maybeSingle();
    if (dnt) {
      return json(409, { error: 'This lead opted out (texted STOP). Sending is blocked.' });
    }

    // One-agent-per-lead lock (2026-07-28): once ANY agent has texted or
    // called this contact, no OTHER agent may text it. Admin sends never
    // check or set the lock, so Hugo can always follow up on any lead.
    const { data: adminRow } = await supa
      .from('admin_users')
      .select('email')
      .eq('email', userResp.user.email ?? '')
      .maybeSingle();
    const { data: senderProfile } = await supa
      .from('profiles')
      .select('workspace_role')
      .eq('id', agentId)
      .maybeSingle();
    const isAdminSender = !!adminRow || senderProfile?.workspace_role === 'admin';
    if (!isAdminSender && senderProfile?.workspace_role === 'agent') {
      const { data: lockedAgent } = await supa.rpc('wk_contact_locked_agent', { p_contact: contactId });
      if (lockedAgent && lockedAgent !== agentId) {
        return json(409, { error: 'This lead has already been contacted by another agent — send blocked.' });
      }
    }

    const isWhatsApp = payload.channel === 'whatsapp';

    // Resolve sender number. Precedence (same order as the send_sms job
    // handler in wk-jobs-worker — the two paths must route alike):
    //   0. channel 'whatsapp' → ALWAYS the registered WhatsApp sender.
    //      The per-agent / per-campaign SMS lines are not WhatsApp-capable,
    //      so none of the SMS resolution below applies.
    //   1. explicit from_e164 (caller pinned)
    //   2. campaign_id → first wk_campaign_numbers row whose wk_numbers
    //      row is sms_enabled
    //   3. workspace default — first sms_enabled wk_numbers row
    let fromE164 = isWhatsApp ? WHATSAPP_SENDER_E164 : (payload.from_e164 ?? '').trim();

    // Security: an explicit from_e164 must be a CRM-owned, SMS-enabled
    // number. Without this, a logged-in agent could pin a client's
    // receptionist caller-ID (e.g. a UK Retell line, sms_enabled=false)
    // and send SMS spoofing it. The campaign/default paths below only ever
    // pick sms_enabled wk_numbers rows, so they are already safe.
    // Skipped for WhatsApp: the from is OUR constant above, never caller
    // input, and the registered sender need not be sms_enabled in wk_numbers.
    if (fromE164 && !isWhatsApp) {
      const { data: ownedNumber } = await supa
        .from('wk_numbers')
        .select('e164')
        .eq('e164', fromE164)
        .eq('channel', 'sms')
        .eq('sms_enabled', true)
        .maybeSingle();
      if (!ownedNumber) {
        return json(403, { error: 'from_e164 is not a CRM-owned SMS-enabled number' });
      }
    }

    if (!fromE164 && payload.campaign_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: pinned } = await (supa.from('wk_campaign_numbers' as any) as any)
        .select('priority, number_id, wk_numbers(id, e164, channel, sms_enabled, is_active)')
        .eq('campaign_id', payload.campaign_id)
        .order('priority', { ascending: true });
      const pinnedRows = (pinned ?? []) as Array<{
        priority: number;
        number_id: string;
        wk_numbers: { id: string; e164: string; channel: string; sms_enabled: boolean; is_active: boolean } | null;
      }>;
      for (const r of pinnedRows) {
        const n = r.wk_numbers;
        if (n && n.channel === 'sms' && n.sms_enabled && n.is_active) {
          fromE164 = n.e164;
          break;
        }
      }
    }

    // 2.5. The sending agent's assigned number(s) (wk_number_agents). Prefer a
    //      number whose country matches the destination (UK contact -> the
    //      agent's UK number), then their primary, then any. This is what lets
    //      an admin hand each agent their own line(s).
    if (!fromE164) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: assigned } = await (supa.from('wk_number_agents' as any) as any)
        .select('is_primary, wk_numbers(e164, channel, sms_enabled, is_active)')
        .eq('agent_id', agentId);
      const rows = ((assigned ?? []) as Array<{
        is_primary: boolean;
        wk_numbers: { e164: string; channel: string; sms_enabled: boolean; is_active: boolean } | null;
      }>).filter((r) => r.wk_numbers && r.wk_numbers.channel === 'sms' && r.wk_numbers.sms_enabled && r.wk_numbers.is_active);
      if (rows.length) {
        const dest = countryClass(toE164);
        const match = rows.find((r) => countryClass(r.wk_numbers!.e164) === dest);
        const primary = rows.find((r) => r.is_primary);
        fromE164 = (match ?? primary ?? rows[0]).wk_numbers!.e164;
      }
    }

    // 3. Workspace default: prefer one whose country matches the destination,
    //    else the first SMS-enabled number.
    if (!fromE164) {
      const { data: nums } = await supa
        .from('wk_numbers')
        .select('e164')
        .eq('sms_enabled', true)
        .eq('is_active', true)
        .order('created_at', { ascending: true });
      const list = ((nums ?? []) as Array<{ e164: string }>).map((n) => n.e164);
      const dest = countryClass(toE164);
      fromE164 = list.find((e) => countryClass(e) === dest) ?? list[0] ?? '';
    }
    if (!fromE164) {
      return json(503, { error: 'No SMS-enabled number configured (wk_numbers)' });
    }

    // WhatsApp 24h-window pre-check. Twilio ACCEPTS an out-of-window
    // free-form message (201, queued) and only fails it asynchronously with
    // 63016, so waiting for the create call to error is waiting forever.
    // Refuse HERE, synchronously, when the lead has no inbound WhatsApp in
    // the last 24 hours. An approved template is the ONE exception, which is
    // exactly what it is for, so a template send skips this check.
    if (isWhatsApp && !isTemplate) {
      const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: lastIn } = await supa
        .from('wk_sms_messages')
        .select('id')
        .eq('contact_id', contactId)
        .eq('direction', 'inbound')
        .eq('channel', 'whatsapp')
        .gte('created_at', dayAgo)
        .limit(1)
        .maybeSingle();
      if (!lastIn) {
        return json(400, {
          error:
            'WhatsApp only allows free replies within 24 hours of the lead\'s last WhatsApp message, and this lead has none in that window. The message would be silently dropped. They need to message first, or an approved template is required.',
        });
      }
    }

    // C2: honour the global kill switch + daily SMS cap before spending.
    const { data: gate } = await supa.rpc('wk_outbound_sms_allowed');
    if (gate && (gate as { allowed?: boolean }).allowed === false) {
      return json(429, { error: 'Outbound sending is blocked', detail: gate });
    }

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      return json(503, { error: 'Twilio creds not set on edge function secrets' });
    }

    // Approved-template send: verify with Twilio BEFORE spending, because an
    // unapproved template fails the same asynchronous way 63016 does (201
    // queued, killed later), which reads as success in the UI. Two GETs cost
    // a moment; a silently dropped message costs a lead.
    const templateVars = payload.content_variables ?? {};
    let renderedTemplate = '';
    if (isTemplate) {
      if (!isWhatsApp) {
        return json(400, { error: 'Approved templates are a WhatsApp feature. Send SMS as normal text.' });
      }
      if (!/^HX[0-9a-f]{32}$/i.test(contentSid)) {
        return json(400, { error: 'content_sid must be a Twilio Content sid (HX...)' });
      }
      if (payload.attachment_url) {
        return json(400, { error: 'A template cannot carry an attachment. Send the file once the lead replies.' });
      }
      const approval = await twilioGet(
        `https://content.twilio.com/v1/Content/${contentSid}/ApprovalRequests`,
      );
      if (approval.status === 404) {
        return json(400, { error: 'That template no longer exists on the WhatsApp sender.' });
      }
      if (!approval.data) {
        return json(502, {
          error: 'Could not check that template with Twilio just now. Nothing was sent, try again in a moment.',
        });
      }
      const waStatus = String(
        ((approval.data.whatsapp ?? {}) as Record<string, unknown>).status ?? '',
      ).toLowerCase();
      if (waStatus !== 'approved') {
        return json(400, {
          error: waStatus
            ? `That template is "${waStatus}" with Meta, not approved yet. Only an approved template can open a conversation.`
            : 'That template has not been sent to Meta for approval yet.',
        });
      }
      const content = await twilioGet(`https://content.twilio.com/v1/Content/${contentSid}`);
      if (!content.data) {
        return json(502, {
          error: 'Could not read that template from Twilio just now. Nothing was sent, try again in a moment.',
        });
      }
      const types = (content.data.types ?? {}) as Record<string, { body?: string }>;
      const templateBody = String(types['twilio/text']?.body ?? '');
      if (!templateBody) {
        return json(502, { error: 'Could not read that template\'s wording from Twilio.' });
      }
      const needed = [...new Set(
        [...templateBody.matchAll(TEMPLATE_VAR_RE)].map((m) => m[1]),
      )];
      const missing = needed.filter((n) => !(templateVars[n] ?? '').trim());
      if (missing.length) {
        return json(400, {
          error: `Fill in every blank first (missing ${missing.map((n) => `{{${n}}}`).join(', ')}).`,
        });
      }
      renderedTemplate = renderTemplate(templateBody, templateVars);
    }

    // POST to Twilio Messages.create.
    // MMS (MediaUrl) only works in US/Canada. UK numbers get the
    // attachment as a clickable link appended to the body instead.
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth64 = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    let smsBody = body;
    if (payload.attachment_url) {
      smsBody = `${body}\n\n${payload.attachment_url}`;
    }
    // WhatsApp rides the same Messages API with a whatsapp: prefix on both
    // numbers. The DB rows keep BARE e164 (matching how wk-sms-incoming
    // stores them after stripping the prefix), only the wire call differs.
    const form = new URLSearchParams({
      To: isWhatsApp ? `whatsapp:${toE164}` : toE164,
      From: isWhatsApp ? `whatsapp:${fromE164}` : fromE164,
      // Delivery fate comes back through wk-sms-status and updates the row,
      // so 'queued' stops being a forever-state and the inbox ticks are real.
      StatusCallback: `${SUPABASE_URL}/functions/v1/wk-sms-status`,
    });
    if (isTemplate) {
      // ContentSid REPLACES Body: the approved wording lives at Meta, we only
      // send its id and the blanks.
      form.set('ContentSid', contentSid);
      form.set('ContentVariables', JSON.stringify(templateVars));
    } else {
      form.set('Body', smsBody);
    }
    const twResp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth64}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (!twResp.ok) {
      const errText = await twResp.text();
      console.error('[wk-sms-send] twilio error', twResp.status, errText);
      // 63016 = free-form message outside the 24h customer service window.
      // Say so in plain words, "Twilio 400" teaches the agent nothing.
      if (errText.includes('63016')) {
        return json(502, {
          error:
            'WhatsApp rejected this: more than 24 hours since the lead last messaged. They must text first, or the message needs an approved template.',
        });
      }
      return json(502, { error: `Twilio ${twResp.status}: ${errText}` });
    }
    const twJson = await twResp.json() as {
      sid?: string;
      status?: string;
    };

    // Persist the outbound row. We always write, even if Twilio's
    // response is unparseable — the message has left.
    const { data: inserted, error: insErr } = await supa
      .from('wk_sms_messages')
      .insert({
        contact_id: contactId,
        direction: 'outbound',
        // PR 96: was implicit (DB default 'sms'); now explicit so the
        // row carries its channel like every other send path and the
        // inbox channel-glyph rendering is correct.
        channel: isWhatsApp ? 'whatsapp' : 'sms',
        // A template's row stores the FILLED-IN wording, so the thread shows
        // what the lead read, not "Hi {{1}}".
        body: isTemplate ? renderedTemplate : body,
        twilio_sid: twJson.sid ?? null,
        external_id: twJson.sid ?? null,
        from_e164: fromE164,
        to_e164: toE164,
        status: twJson.status ?? 'queued',
        created_by: agentId,
        attachment_url: payload.attachment_url ?? null,
      })
      .select('id')
      .single();

    if (insErr) {
      console.error('[wk-sms-send] db insert failed (twilio sent though)', insErr);
      return json(200, {
        twilio_sid: twJson.sid ?? null,
        warning: 'sent via Twilio but local insert failed',
      });
    }

    // Bump wk_contacts.last_contact_at so the inbox sorts correctly.
    await supa
      .from('wk_contacts')
      .update({ last_contact_at: new Date().toISOString() })
      .eq('id', contactId);

    return json(200, {
      message_id: inserted?.id,
      twilio_sid: twJson.sid ?? null,
      status: twJson.status ?? 'queued',
    });
  } catch (e) {
    console.error('[wk-sms-send] threw', e);
    return json(500, { error: e instanceof Error ? e.message : 'Internal error' });
  }
});
