// unipile-poll-messages — pulls recent (last 24h) messages from Unipile
// and inserts any not yet in wk_sms_messages. Polling fallback because
// Unipile's webhook delivery isn't firing for our endpoint.
//
// PR 82 refactor (Hugo 2026-04-27 — "audit how the inbox works"):
//   - 24h cap on age. Old messages aren't synced; we only care about
//     today's conversations.
//   - Atomic contact upsert via INSERT ... ON CONFLICT (phone) so we
//     never create duplicate contact rows (the prior version raced on
//     concurrent polls and made 21 dupes for Hugo's number).
//   - Counterparty extraction from chat_provider_id (WhatsApp jid format).
//   - Idempotent message insert via composite UNIQUE (channel, external_id).
//
// verify_jwt = false, gated by UNIPILE_POLL_CRON_SECRET header.
// Triggered every minute by pg_cron (PR 81).
// Also exposed for manual run via the inbox refresh button.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const UNIPILE_TOKEN = Deno.env.get('UNIPILE_TOKEN') ?? '';
const UNIPILE_DSN = Deno.env.get('UNIPILE_DSN') ?? 'api38.unipile.com:16812';
const CRON_SECRET = Deno.env.get('UNIPILE_POLL_CRON_SECRET') ?? '';

// Hard cap on how far back we sync. Hugo's spec: today's chats only.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface UnipileAccount {
  id: string;
  type: string;
  sources?: Array<{ status?: string }>;
  connection_params?: { im?: { phone_number?: string } };
}
interface UnipileMessage {
  id: string;
  text?: string;
  timestamp?: string;
  is_sender?: number | boolean;
  chat_id?: string;
  chat_provider_id?: string;
  sender_id?: string;
  attachments?: unknown[];
}

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

function digitsToE164(raw: string | undefined | null): string {
  if (!raw) return '';
  const digits = String(raw).replace(/[^0-9]/g, '');
  return digits ? `+${digits}` : '';
}

/** Counterparty's E.164 from a Unipile WhatsApp message.
 *  chat_provider_id holds "4470000000000@s.whatsapp.net" regardless of
 *  inbound/outbound. Newer @lid jid format doesn't carry a phone. */
function counterpartyFromMessage(m: UnipileMessage): string {
  if (m.chat_provider_id?.includes('@s.whatsapp.net')) {
    return digitsToE164(m.chat_provider_id);
  }
  if (m.sender_id?.includes('@s.whatsapp.net')) {
    return digitsToE164(m.sender_id);
  }
  return '';
}

/** Atomic find-or-create contact. Uses the wk_contacts_phone_uniq
 *  partial index from PR 82's dedup migration to make insert race-safe. */
async function upsertContact(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supa: any,
  phone: string,
  firstMessageId: string,
): Promise<string | null> {
  // First try lookup — service role bypasses RLS so this is the fast path.
  const { data: existing } = await supa
    .from('wk_contacts')
    .select('id')
    .eq('phone', phone)
    .limit(1)
    .maybeSingle();
  if ((existing as { id?: string } | null)?.id) {
    return (existing as { id: string }).id;
  }

  // Atomic insert; on partial-index collision (race with a concurrent
  // poll), the upsert no-ops and we re-read to get the existing id.
  const { data: inserted, error: insErr } = await supa
    .from('wk_contacts')
    .upsert(
      {
        name: phone,
        phone,
        custom_fields: { source: 'unipile_poll', first_message_id: firstMessageId },
        is_hot: false,
      },
      { onConflict: 'phone', ignoreDuplicates: true }
    )
    .select('id')
    .maybeSingle();

  if (inserted?.id) return inserted.id as string;
  if (insErr) console.error('[unipile-poll] upsert err', insErr);

  // Fallback re-read in case the conflict path returned no row.
  const { data: again } = await supa
    .from('wk_contacts')
    .select('id')
    .eq('phone', phone)
    .limit(1)
    .maybeSingle();
  return (again as { id?: string } | null)?.id ?? null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  if (CRON_SECRET) {
    const got = req.headers.get('x-cron-secret') ?? '';
    if (got !== CRON_SECRET) return json(401, { error: 'bad cron secret' });
  }
  if (!UNIPILE_TOKEN) return json(503, { error: 'UNIPILE_TOKEN not configured' });

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const cutoffMs = Date.now() - MAX_AGE_MS;

  const accountsRes = await fetch(`https://${UNIPILE_DSN}/api/v1/accounts`, {
    headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: 'application/json' },
  });
  if (!accountsRes.ok) {
    return json(502, { error: `accounts ${accountsRes.status}: ${(await accountsRes.text()).slice(0, 300)}` });
  }
  const accountsJson = (await accountsRes.json()) as { items?: UnipileAccount[] };

  const summary: Array<{
    account_id: string;
    type: string;
    pulled: number;
    inserted: number;
    skipped_old: number;
    skipped_dup: number;
    skipped_nophone: number;
    error?: string;
  }> = [];

  for (const acct of accountsJson.items ?? []) {
    if (acct.type !== 'WHATSAPP') continue;
    const accountId = acct.id;
    if (acct.sources?.[0]?.status !== 'OK') {
      summary.push({
        account_id: accountId, type: acct.type, pulled: 0, inserted: 0,
        skipped_old: 0, skipped_dup: 0, skipped_nophone: 0, error: 'account not OK',
      });
      continue;
    }

    // Only poll accounts already registered in wk_numbers.
    // Unregistered accounts are skipped to prevent data leaks.
    const { data: registeredRow } = await supa
      .from('wk_numbers')
      .select('id, e164')
      .eq('provider', 'unipile')
      .eq('external_id', accountId)
      .eq('channel', 'whatsapp')
      .maybeSingle();

    if (!registeredRow) {
      summary.push({
        account_id: accountId, type: acct.type, pulled: 0, inserted: 0,
        skipped_old: 0, skipped_dup: 0, skipped_nophone: 0, error: 'account not registered in wk_numbers',
      });
      continue;
    }

    const mr = await fetch(
      `https://${UNIPILE_DSN}/api/v1/messages?account_id=${accountId}&limit=100`,
      { headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: 'application/json' } }
    );
    if (!mr.ok) {
      summary.push({
        account_id: accountId, type: acct.type, pulled: 0, inserted: 0,
        skipped_old: 0, skipped_dup: 0, skipped_nophone: 0, error: `messages ${mr.status}`,
      });
      continue;
    }
    const mj = (await mr.json()) as { items?: UnipileMessage[] };
    const msgs = mj.items ?? [];

    const ourNumberE164 = (registeredRow as { e164?: string }).e164 ?? '';

    let inserted = 0;
    let skipped_old = 0;
    let skipped_dup = 0;
    let skipped_nophone = 0;

    for (const m of msgs) {
      if (!m.id) {
        skipped_nophone++;
        continue;
      }
      // 24h age filter — Hugo's spec: don't sync ancient history.
      const msgMs = m.timestamp ? Date.parse(m.timestamp) : Date.now();
      if (Number.isFinite(msgMs) && msgMs < cutoffMs) {
        skipped_old++;
        continue;
      }

      const direction: 'inbound' | 'outbound' =
        m.is_sender === true || m.is_sender === 1 ? 'outbound' : 'inbound';

      const counterpartyE164 = counterpartyFromMessage(m);
      if (!counterpartyE164) {
        skipped_nophone++;
        continue;
      }

      const contactId = await upsertContact(supa, counterpartyE164, m.id);
      if (!contactId) {
        skipped_nophone++;
        continue;
      }

      const { error: msgErr } = await supa
        .from('wk_sms_messages')
        .insert({
          contact_id: contactId,
          direction,
          channel: 'whatsapp',
          body: m.text ?? '',
          external_id: m.id,
          from_e164: direction === 'inbound' ? counterpartyE164 : ourNumberE164,
          to_e164: direction === 'inbound' ? ourNumberE164 : counterpartyE164,
          media_urls: [],
          status: direction === 'inbound' ? 'received' : 'queued',
        });
      if (msgErr) {
        const code = (msgErr as { code?: string }).code;
        if (code === '23505') { skipped_dup++; continue; }
        console.error('[unipile-poll] insert failed', msgErr);
        skipped_nophone++;
        continue;
      }

      inserted++;
      await supa
        .from('wk_contacts')
        .update({ last_contact_at: m.timestamp ?? new Date().toISOString() })
        .eq('id', contactId);
    }

    summary.push({
      account_id: accountId, type: acct.type, pulled: msgs.length,
      inserted, skipped_old, skipped_dup, skipped_nophone,
    });
  }

  return json(200, {
    polled_at: new Date().toISOString(),
    cutoff: new Date(cutoffMs).toISOString(),
    accounts: summary,
  });
});
