// unipile-webhook — Unipile event sink. Handles two distinct payload shapes:
//
//   1. Hosted-auth notify_url callback (account_connected) when the user
//      finishes scanning the QR. Body: { account_id, name, ... }. We upsert
//      a wk_numbers row for the new connected account and fetch its phone
//      number from Unipile's /accounts API.
//
//   2. Webhook-registered messaging events (message_received) — inbound
//      WhatsApp / LinkedIn / Email messages that contacts send to our
//      connected accounts. We find/create the wk_contacts row and INSERT
//      into wk_sms_messages with channel matching the source provider.
//
// PR 69 (multi-channel pivot to Unipile), Hugo 2026-04-27.
//
// Public endpoint (verify_jwt = false). Auth: a custom header
// `Unipile-Auth` whose value matches our shared secret stored in
// UNIPILE_WEBHOOK_SECRET env. Set the header at webhook registration time
// (Unipile docs: webhooks support custom headers, not HMAC-signed bodies).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const UNIPILE_TOKEN = Deno.env.get('UNIPILE_TOKEN') ?? '';
const UNIPILE_DSN = Deno.env.get('UNIPILE_DSN') ?? 'api38.unipile.com:16812';
const UNIPILE_WEBHOOK_SECRET = Deno.env.get('UNIPILE_WEBHOOK_SECRET') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, unipile-auth',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ok = (payload: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ ok: true, ...payload }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

interface AccountConnectedNotify {
  status?: 'CREATION_SUCCESS' | 'OK' | string;
  account_id?: string;
  name?: string;
}

interface MessagingEvent {
  account_id?: string;
  account_type?: string;
  event?: string;
  message?: { id?: string; text?: string; timestamp?: string };
  sender?: { name?: string; provider_id?: string };
  chat?: { id?: string };
  attendees?: unknown;
}

async function fetchAccount(accountId: string): Promise<{
  phone?: string;
  type?: string;
  status?: string;
  display_name?: string;
} | null> {
  if (!UNIPILE_TOKEN) return null;
  const r = await fetch(`https://${UNIPILE_DSN}/api/v1/accounts/${accountId}`, {
    headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: 'application/json' },
  });
  if (!r.ok) {
    console.error('[unipile-webhook] account fetch failed', r.status, await r.text());
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j: any = await r.json();
  // Unipile shape varies by provider — extract phone for WhatsApp.
  const phone =
    j?.connection_params?.im?.phone ??
    j?.params?.phone_number ??
    j?.phone_number ??
    j?.connection_params?.mail?.username ?? // for email accounts, "phone" is the email
    null;
  return {
    phone,
    type: j?.type ?? j?.provider,
    status: j?.sources?.[0]?.status ?? j?.status,
    display_name: j?.name ?? j?.display_name,
  };
}

function toE164(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.replace(/^whatsapp:/, '').trim();
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) return trimmed;
  return trimmed.startsWith('+') ? trimmed : `+${digits}`;
}

function providerToChannel(t: string): 'whatsapp' | 'email' | null {
  const up = (t ?? '').toUpperCase();
  if (up === 'WHATSAPP') return 'whatsapp';
  if (up === 'GMAIL' || up === 'OUTLOOK' || up === 'MAIL') return 'email';
  return null; // LinkedIn / Telegram not yet mapped — log + ignore
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  // Read body first — we need it both for auth-shape detection AND
  // verification of account-connected callbacks via the Unipile API.
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return ok({ note: 'invalid json' });
  }

  console.log('[unipile-webhook] payload keys:', Object.keys(payload));

  // Auth handling — TWO classes of inbound:
  //
  //   (a) hosted-auth notify_url callback (account_connected) — fired ONCE
  //       by Unipile after a user finishes the QR scan. Does NOT carry our
  //       pre-shared Unipile-Auth header (that's a per-webhook config that
  //       only applies to registered /webhooks events). We verify by
  //       fetching the account from Unipile's API in the handler — invalid
  //       ids return 404 from upstream, which gates the upsert.
  //
  //   (b) registered messaging webhook (message_received) — DOES carry the
  //       Unipile-Auth header per our /webhooks registration. We enforce
  //       header equality there.
  //
  // Detect class (a) by payload shape: `status` ∈ {CREATION_SUCCESS, OK}
  // (strict — any other string is NOT treated as a notify, so messaging
  // events can't masquerade past the header check) OR (account_id + name
  // without an `event` field). Class (b) carries an `event` field like
  // 'message_received'.
  const looksLikeHostedNotify =
    (typeof payload.status === 'string' &&
      (payload.status === 'CREATION_SUCCESS' || payload.status === 'OK')) ||
    (payload.account_id && payload.name && !payload.event);

  if (!looksLikeHostedNotify) {
    if (!UNIPILE_WEBHOOK_SECRET) {
      // Fail closed — without the shared secret we cannot verify messaging
      // events, and accepting would let anyone inject contacts/messages.
      console.error('[unipile-webhook] UNIPILE_WEBHOOK_SECRET not set — rejecting messaging event');
      return new Response(JSON.stringify({ error: 'webhook secret not configured' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const got = req.headers.get('unipile-auth') ?? req.headers.get('Unipile-Auth') ?? '';
    if (got !== UNIPILE_WEBHOOK_SECRET) {
      console.error('[unipile-webhook] bad Unipile-Auth header on messaging event — dropping');
      return ok({ note: 'bad auth — dropped' });
    }
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Branch 1: account_connected notify — body has status + account_id.
  const notify = payload as AccountConnectedNotify;
  if (notify.status === 'CREATION_SUCCESS' || notify.status === 'OK' || (notify.account_id && notify.name)) {
    const accountId = notify.account_id;
    const labelFromUser = notify.name ?? null;
    if (!accountId) return ok({ note: 'missing account_id' });

    const acct = await fetchAccount(accountId);
    const channel = providerToChannel(acct?.type ?? '');
    const phone = toE164(acct?.phone ?? '');
    const e164 = phone || `unipile:${accountId}`;

    if (channel) {
      const { error: upErr } = await supa
        .from('wk_numbers')
        .upsert(
          {
            e164,
            channel,
            provider: 'unipile',
            external_id: accountId,
            is_active: acct?.status === 'OK' || acct?.status === 'connected',
            voice_enabled: false,
            sms_enabled: false,
            recording_enabled: false,
          },
          { onConflict: 'channel,external_id' }
        );
      if (upErr) {
        console.error('[unipile-webhook] wk_numbers upsert failed', upErr);
      }
    }

    // Update the wk_channel_credentials Unipile row to "connected".
    await supa
      .from('wk_channel_credentials')
      .update({ is_connected: true, last_seen_at: new Date().toISOString() })
      .eq('provider', 'unipile');

    console.log(`[unipile-webhook] account_connected: ${accountId} (${acct?.type}) label=${labelFromUser}`);
    return ok({ note: 'account_connected', account_id: accountId, channel });
  }

  // Branch 2: messaging event — message_received etc.
  const ev = payload as MessagingEvent;
  if (ev.event === 'message_received' && ev.account_id && ev.message?.id) {
    const channel = providerToChannel(ev.account_type ?? '');
    if (!channel) {
      console.log(`[unipile-webhook] ignoring event for account_type=${ev.account_type}`);
      return ok({ note: 'ignored account_type' });
    }

    // Validate account_id is registered — reject messages from unknown accounts
    const { data: accountRow } = await supa
      .from('wk_numbers')
      .select('id, e164')
      .eq('provider', 'unipile')
      .eq('external_id', ev.account_id)
      .eq('channel', channel)
      .maybeSingle();

    if (!accountRow) {
      console.error(`[unipile-webhook] REJECTED: unregistered account_id=${ev.account_id} channel=${channel}`);
      return ok({ note: 'account not registered' });
    }

    const senderProviderId = ev.sender?.provider_id ?? '';
    const fromE164 = toE164(senderProviderId);
    if (!fromE164) return ok({ note: 'no sender' });

    // find or create contact
    let contactId: string | null = null;
    {
      const { data: existing } = await supa
        .from('wk_contacts')
        .select('id')
        .eq(channel === 'email' ? 'email' : 'phone', channel === 'email' ? senderProviderId : fromE164)
        .limit(1)
        .maybeSingle();
      if ((existing as { id?: string } | null)?.id) {
        contactId = (existing as { id: string }).id;
      } else {
        const { data: inserted } = await supa
          .from('wk_contacts')
          .insert({
            name: ev.sender?.name ?? fromE164,
            phone: channel === 'email' ? `email:${senderProviderId}` : fromE164,
            email: channel === 'email' ? senderProviderId : null,
            custom_fields: {
              source: `inbound_${channel}_unipile`,
              first_message_id: ev.message.id,
            },
          })
          .select('id')
          .single();
        contactId = (inserted as { id?: string } | null)?.id ?? null;
      }
    }
    if (!contactId) return ok({ note: 'contact resolve failed' });

    const { error: msgErr } = await supa
      .from('wk_sms_messages')
      .insert({
        contact_id: contactId,
        direction: 'inbound',
        channel,
        body: ev.message.text ?? '',
        external_id: ev.message.id,
        from_e164: fromE164,
        to_e164: accountRow.e164,
        media_urls: [],
        status: 'received',
      });
    if (msgErr) {
      const code = (msgErr as { code?: string }).code;
      if (code === '23505') {
        console.log(`[unipile-webhook] duplicate ${ev.message.id} — idempotent skip`);
      } else {
        console.error('[unipile-webhook] insert failed', msgErr);
      }
    } else {
      await supa
        .from('wk_contacts')
        .update({ last_contact_at: new Date().toISOString() })
        .eq('id', contactId);
    }

    return ok({ note: 'message_received', channel, message_id: ev.message.id });
  }

  console.log('[unipile-webhook] unhandled payload — keys:', Object.keys(payload));
  return ok({ note: 'unhandled' });
});
