// wk-partner-api: the ONE door through which heypubli's funnel drives the shared
// WhatsApp sender. Hugo 2026-08-03.
//
// Why this exists instead of heypubli calling wk-sms-send: that function requires a real
// agent JWT and applies the one-agent-per-lead lock, both meaningless for an automated
// funnel in a different app. And why heypubli does not get its own WhatsApp stack: a
// Twilio sender can only point its inbound webhook at one URL, and it points here. One
// number, one blast radius, one control room.
//
// Auth: Bearer PARTNER_API_KEY (an edge secret), same self-auth pattern as
// wk-jobs-worker's CRM_JOBS_KEY. verify_jwt = false in config.toml.
//
// Actions (POST {action, ...}):
//   send           { to, first_name, content_sid?, body?, external_id, product }
//   message_status { external_id }
//   sender_load    {}
//
// Every refusal is a named `blocked` string, never a bare 400, so the caller's nurture
// engine can branch on it: do_not_text | daily_cap | window_closed | template_unapproved
// | kill_switch | bad_number.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
const PARTNER_API_KEY = Deno.env.get('PARTNER_API_KEY') ?? '';
const WHATSAPP_SENDER_E164 = Deno.env.get('WHATSAPP_SENDER_E164') || '+447460035763';

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const TEMPLATE_VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;

function normalizeE164(raw: string): string {
  let s = (raw ?? '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (s.startsWith('00')) return '+' + s.slice(2);
  // A leading zero is NATIONAL format, and this door serves a funnel that is
  // mostly India, Bangladesh and the Philippines. It used to assume +44, so
  // an Indian number typed as 09824840910 became +449824840910: a real and
  // completely unrelated person in Britain receiving a recruitment pitch.
  // There is no way to guess the country from the digits, so refuse. Every
  // real caller already holds a proper E.164 from WhatsApp.
  if (s.startsWith('0')) return '';
  return '+' + s;
}

function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(TEMPLATE_VAR_RE, (_, n: string) => vars[n] ?? '');
}

async function twilioGet(url: string) {
  const auth64 = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  try {
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth64}` } });
    if (res.status === 404) return { status: 404, data: null };
    if (!res.ok) return { status: res.status, data: null };
    return { status: res.status, data: (await res.json()) as Record<string, unknown> };
  } catch {
    return { status: 0, data: null };
  }
}

serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  // Self-auth: constant secret, same pattern as wk-jobs-worker.
  const auth = req.headers.get('authorization') ?? '';
  if (!PARTNER_API_KEY || auth !== `Bearer ${PARTNER_API_KEY}`) {
    return json(401, { error: 'unauthorized' });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'bad json' });
  }
  const action = String(payload.action ?? '');
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ------------------------------------------------------------
  if (action === 'sender_load') {
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await supa
      .from('wk_sms_messages')
      .select('id', { count: 'exact', head: true })
      .eq('direction', 'outbound')
      .eq('channel', 'whatsapp')
      .gte('created_at', dayAgo);
    return json(200, { ok: true, sent24h: count ?? 0 });
  }

  // ------------------------------------------------------------
  if (action === 'message_status') {
    const externalId = String(payload.external_id ?? '');
    if (!externalId) return json(400, { error: 'external_id required' });
    const { data: row } = await supa
      .from('wk_sms_messages')
      .select('id, status, twilio_sid')
      .eq('channel', 'whatsapp')
      .eq('external_id', externalId)
      .maybeSingle();
    if (!row) return json(200, { ok: false, error: 'not found' });
    return json(200, { ok: true, status: row.status, twilio_sid: row.twilio_sid });
  }

  // ------------------------------------------------------------
  if (action === 'send') {
    const toE164 = normalizeE164(String(payload.to ?? ''));
    const firstName = String(payload.first_name ?? '').trim();
    const contentSid = String(payload.content_sid ?? '');
    const freeBody = String(payload.body ?? '');
    const externalId = String(payload.external_id ?? '');
    const isTemplate = contentSid.length > 0;

    if (!toE164 || toE164.length < 8) return json(200, { ok: false, blocked: 'bad_number' });
    if (!externalId) return json(400, { error: 'external_id required' });
    if (!isTemplate && !freeBody.trim()) return json(400, { error: 'body or content_sid required' });
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      return json(503, { error: 'Twilio creds not set' });
    }

    // Idempotency: (channel, external_id) is unique in wk_sms_messages. A retry of the
    // same logical send returns the original row instead of texting twice.
    const { data: already } = await supa
      .from('wk_sms_messages')
      .select('id, twilio_sid, status')
      .eq('channel', 'whatsapp')
      .eq('external_id', externalId)
      .maybeSingle();
    if (already) {
      return json(200, {
        ok: true,
        queued: false,
        duplicate: true,
        wk_message_id: already.id,
        twilio_sid: already.twilio_sid,
      });
    }

    // Workspace-wide kill switch + daily cap, the same gate every other send
    // path calls. It FAILS CLOSED: the error used to be discarded, so an RPC
    // that errored left `allowed` null, `allowed === false` was false, and the
    // emergency stop let the message through. The one control whose whole job
    // is to stop sending must never fail by sending.
    const { data: allowed, error: allowedErr } = await supa.rpc('wk_outbound_sms_allowed');
    if (allowedErr) {
      console.error('[wk-partner-api] kill-switch check failed', allowedErr);
      return json(503, { error: 'could not check the send kill switch; nothing sent' });
    }
    const allowedObj = (allowed ?? {}) as { allowed?: boolean; reason?: string };
    if (allowedObj.allowed !== true) {
      const reason = String(allowedObj.reason ?? '');
      return json(200, {
        ok: false,
        blocked: reason.includes('cap') ? 'daily_cap' : 'kill_switch',
        error: reason,
      });
    }

    // Find or create the contact. heypubli leads are stamped so the inbound fan-out and
    // the CRM can tell them apart from Elsie's own leads.
    let contactId: string | null = null;
    const { data: existing } = await supa
      .from('wk_contacts')
      .select('id, custom_fields')
      .eq('phone', toE164)
      .maybeSingle();
    if (existing) {
      contactId = existing.id;
      const cf = (existing.custom_fields ?? {}) as Record<string, unknown>;
      if (cf.product !== 'heypubli') {
        await supa
          .from('wk_contacts')
          .update({ custom_fields: { ...cf, product: 'heypubli' } })
          .eq('id', existing.id);
      }
    } else {
      const { data: created, error: createErr } = await supa
        .from('wk_contacts')
        .insert({
          name: firstName || toE164,
          phone: toE164,
          custom_fields: { product: 'heypubli', owner_name: firstName, source: 'heypubli_funnel' },
        })
        .select('id')
        .maybeSingle();
      if (createErr) {
        // 23505: raced another insert on the unique phone. Re-read.
        const { data: raced } = await supa
          .from('wk_contacts')
          .select('id')
          .eq('phone', toE164)
          .maybeSingle();
        contactId = raced?.id ?? null;
      } else {
        contactId = created?.id ?? null;
      }
    }
    if (!contactId) return json(502, { error: 'could not resolve contact' });

    // STOP list: the do-not-text tag blocks every channel, exactly as elsewhere.
    const { data: dnt } = await supa
      .from('wk_contact_tags')
      .select('id')
      .eq('contact_id', contactId)
      .eq('tag', 'do-not-text')
      .maybeSingle();
    if (dnt) return json(200, { ok: false, blocked: 'do_not_text', wk_contact_id: contactId });

    const templateVars: Record<string, string> = { '1': firstName || 'there' };
    let renderedTemplate = '';

    if (isTemplate) {
      // Approved-template send: verify with Twilio BEFORE spending. An unapproved
      // template fails asynchronously (201 queued, killed later), which reads as
      // success. Same pre-check as wk-sms-send, same reasons.
      if (!/^HX[0-9a-f]{32}$/i.test(contentSid)) {
        return json(400, { error: 'content_sid must be a Twilio Content sid (HX...)' });
      }
      const approval = await twilioGet(
        `https://content.twilio.com/v1/Content/${contentSid}/ApprovalRequests`,
      );
      if (approval.status === 404) {
        return json(200, { ok: false, blocked: 'template_unapproved', error: 'template gone' });
      }
      if (!approval.data) {
        return json(502, { error: 'could not check template approval; nothing sent' });
      }
      const waStatus = String(
        ((approval.data.whatsapp ?? {}) as Record<string, unknown>).status ?? '',
      ).toLowerCase();
      if (waStatus !== 'approved') {
        return json(200, {
          ok: false,
          blocked: 'template_unapproved',
          error: `template status: ${waStatus || 'not submitted'}`,
        });
      }
      const content = await twilioGet(`https://content.twilio.com/v1/Content/${contentSid}`);
      const types = ((content.data?.types ?? {}) as Record<string, { body?: string }>);
      const templateBody = String(types['twilio/text']?.body ?? '');
      renderedTemplate = templateBody ? renderTemplate(templateBody, templateVars) : '(template)';
    } else {
      // Free-form: only legal inside the 24h window. Twilio ACCEPTS an out-of-window
      // send (201) and kills it later with async 63016, so refuse here, synchronously.
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
        return json(200, { ok: false, blocked: 'window_closed', wk_contact_id: contactId });
      }
    }

    // The wire call. DB rows keep BARE e164; only the wire gets whatsapp: prefixes.
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth64 = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const form = new URLSearchParams({
      To: `whatsapp:${toE164}`,
      From: `whatsapp:${WHATSAPP_SENDER_E164}`,
      StatusCallback: `${SUPABASE_URL}/functions/v1/wk-sms-status`,
    });
    if (isTemplate) {
      form.set('ContentSid', contentSid);
      form.set('ContentVariables', JSON.stringify(templateVars));
    } else {
      form.set('Body', freeBody);
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
      console.error('[wk-partner-api] twilio error', twResp.status, errText);
      if (errText.includes('63016')) {
        return json(200, { ok: false, blocked: 'window_closed', wk_contact_id: contactId });
      }
      return json(502, { error: `Twilio ${twResp.status}` });
    }
    const twJson = (await twResp.json()) as { sid?: string; status?: string };

    const { data: inserted } = await supa
      .from('wk_sms_messages')
      .insert({
        contact_id: contactId,
        direction: 'outbound',
        body: isTemplate ? renderedTemplate : freeBody,
        twilio_sid: twJson.sid ?? null,
        from_e164: WHATSAPP_SENDER_E164,
        to_e164: toE164,
        status: twJson.status ?? 'queued',
        channel: 'whatsapp',
        external_id: externalId,
      })
      .select('id')
      .maybeSingle();
    await supa
      .from('wk_contacts')
      .update({ last_contact_at: new Date().toISOString() })
      .eq('id', contactId);

    return json(200, {
      ok: true,
      queued: true,
      wk_contact_id: contactId,
      wk_message_id: inserted?.id ?? null,
      twilio_sid: twJson.sid ?? null,
    });
  }

  return json(400, { error: `unknown action: ${action}` });
});
