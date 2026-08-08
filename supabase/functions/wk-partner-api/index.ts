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
//   send            { to, first_name, content_sid?, body?, external_id, product }
//   message_status  { external_id }
//   sender_load     {}
//   contact_state   { phone }    has this person ever written to us / been written to?
//   ensure_contact  { phone, first_name } find-or-create + heypubli stamp, NO send
//   inbox_summary   {}           heypubli threads whose LAST message is inbound + drafts
//   thread_messages { phone, limit? } the conversation, oldest first, for the reply brain
//   template_status { sids: [] } live Meta approval status per Content sid
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
    // Count what META counts: business-INITIATED conversations. A reply to
    // somebody who wrote to us inside the last 24 hours is free and unlimited
    // on WhatsApp; only a message that OPENS a conversation spends the tier.
    //
    // The first version counted every outbound row. On 07 Aug 2026 that read
    // 251 while the true initiated count was ~110, so the drip believed the
    // 150 cap was blown and deferred every fresh lead's welcome by 24 hours,
    // all evening, while most of the "spend" was replies Meta never charges.
    //
    // No schema records template-ness, so the discriminator is Meta's own
    // definition, computed from rows we already have: an outbound with no
    // inbound from that same number in the 24 hours before it.
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const { data: outs } = await supa
      .from('wk_sms_messages')
      .select('to_e164, created_at')
      .eq('direction', 'outbound')
      .eq('channel', 'whatsapp')
      .gte('created_at', dayAgo);
    const { data: ins } = await supa
      .from('wk_sms_messages')
      .select('from_e164, created_at')
      .eq('direction', 'inbound')
      .eq('channel', 'whatsapp')
      .gte('created_at', twoDaysAgo);
    const inboundByPeer = new Map<string, string[]>();
    for (const m of ins ?? []) {
      const arr = inboundByPeer.get(m.from_e164) ?? [];
      arr.push(m.created_at);
      inboundByPeer.set(m.from_e164, arr);
    }
    let initiated = 0;
    for (const o of outs ?? []) {
      const t = Date.parse(o.created_at);
      const windowOpen = (inboundByPeer.get(o.to_e164) ?? []).some((inAt) => {
        const ti = Date.parse(inAt);
        return ti < t && t - ti < 24 * 3600 * 1000;
      });
      if (!windowOpen) initiated++;
    }
    return json(200, { ok: true, sent24h: initiated, totalOutbound24h: outs?.length ?? 0 });
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
  // Has this phone number ever talked to us? Exists so the sheet-sync can tell a
  // form lead who ALREADY opened a WhatsApp conversation apart from one who went
  // quiet: the first must never get a cold template on top of a live thread.
  if (action === 'contact_state') {
    const phone = normalizeE164(String(payload.phone ?? ''));
    if (!phone || phone.length < 8) return json(200, { ok: false, error: 'bad phone' });
    const { data: contact } = await supa
      .from('wk_contacts')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();
    if (!contact) {
      return json(200, { ok: true, exists: false, do_not_text: false, last_inbound_at: null, last_outbound_at: null });
    }
    const { data: dntTag } = await supa
      .from('wk_contact_tags')
      .select('id')
      .eq('contact_id', contact.id)
      .eq('tag', 'do-not-text')
      .maybeSingle();
    const lastOf = async (direction: string) => {
      let q = supa
        .from('wk_sms_messages')
        .select('created_at, status')
        .eq('contact_id', contact.id)
        .eq('channel', 'whatsapp')
        .eq('direction', direction)
        .order('created_at', { ascending: false })
        .limit(1);
      if (direction === 'outbound') q = q.neq('status', 'draft');
      const { data } = await q.maybeSingle();
      return data?.created_at ?? null;
    };
    return json(200, {
      ok: true,
      exists: true,
      wk_contact_id: contact.id,
      do_not_text: Boolean(dntTag),
      last_inbound_at: await lastOf('inbound'),
      last_outbound_at: await lastOf('outbound'),
    });
  }

  // ------------------------------------------------------------
  // Find-or-create the contact and stamp it product=heypubli WITHOUT sending anything.
  // The stamp is load-bearing: wk-sms-incoming only relays an inbound to heypubli's
  // funnel when the contact carries it, and until 07 Aug 2026 the stamp was only ever
  // written on the first OUTBOUND send. So a fresh form lead who replied during their
  // 10 minute grace was invisible to the relay, the drip never heard about the reply,
  // and the cold template landed on top of a live conversation. Stamping at import
  // time closes that hole.
  if (action === 'ensure_contact') {
    const phone = normalizeE164(String(payload.phone ?? ''));
    const firstName = String(payload.first_name ?? '').trim();
    if (!phone || phone.length < 8) return json(200, { ok: false, error: 'bad phone' });
    const { data: existing } = await supa
      .from('wk_contacts')
      .select('id, custom_fields')
      .eq('phone', phone)
      .maybeSingle();
    if (existing) {
      const cf = (existing.custom_fields ?? {}) as Record<string, unknown>;
      if (cf.product !== 'heypubli') {
        await supa
          .from('wk_contacts')
          .update({ custom_fields: { ...cf, product: 'heypubli' } })
          .eq('id', existing.id);
      }
      return json(200, { ok: true, wk_contact_id: existing.id, created: false });
    }
    const { data: created, error: createErr } = await supa
      .from('wk_contacts')
      .insert({
        name: firstName || phone,
        phone,
        custom_fields: { product: 'heypubli', owner_name: firstName, source: 'heypubli_funnel' },
      })
      .select('id')
      .maybeSingle();
    if (createErr) {
      const { data: raced } = await supa
        .from('wk_contacts')
        .select('id')
        .eq('phone', phone)
        .maybeSingle();
      if (!raced) return json(502, { error: 'could not create contact' });
      return json(200, { ok: true, wk_contact_id: raced.id, created: false });
    }
    return json(200, { ok: true, wk_contact_id: created?.id ?? null, created: true });
  }

  // ------------------------------------------------------------
  // Threads that are waiting on US: heypubli contacts whose last real message is
  // inbound, plus AI drafts nobody has approved. Feeds the 5 minute funnel email.
  if (action === 'inbox_summary') {
    const since = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
    // NEWEST first at the database, then re-sorted ascending in memory: with an
    // ascending LIMIT, a busy 72h window silently dropped the newest inbound, which
    // is exactly the message that most needs answering.
    const { data: msgsDesc, error: msgsErr } = await supa
      .from('wk_sms_messages')
      .select('contact_id, direction, status, created_at')
      .eq('channel', 'whatsapp')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5000);
    if (msgsErr) return json(502, { error: 'could not read messages' });
    const msgs = (msgsDesc ?? []).reverse();
    type Acc = { lastIn: string | null; lastOut: string | null; drafts: number };
    const byContact = new Map<string, Acc>();
    for (const m of msgs ?? []) {
      const acc = byContact.get(m.contact_id) ?? { lastIn: null, lastOut: null, drafts: 0 };
      if (m.direction === 'inbound') acc.lastIn = m.created_at;
      else if (m.status === 'draft') acc.drafts++;
      else acc.lastOut = m.created_at;
      byContact.set(m.contact_id, acc);
    }
    const waitingIds = [...byContact.entries()]
      .filter(([, a]) => a.lastIn && (!a.lastOut || a.lastIn > a.lastOut))
      .map(([id]) => id);
    if (!waitingIds.length) return json(200, { ok: true, waiting: [] });
    const { data: contacts } = await supa
      .from('wk_contacts')
      .select('id, name, phone, custom_fields')
      .in('id', waitingIds);
    const waiting = (contacts ?? [])
      .filter((c) => ((c.custom_fields ?? {}) as Record<string, unknown>).product === 'heypubli')
      .map((c) => {
        const a = byContact.get(c.id)!;
        return {
          name: c.name,
          phone: c.phone,
          last_inbound_at: a.lastIn,
          drafts_pending: a.drafts,
          waiting_minutes: a.lastIn ? Math.round((Date.now() - Date.parse(a.lastIn)) / 60000) : null,
        };
      })
      .sort((x, y) => (y.waiting_minutes ?? 0) - (x.waiting_minutes ?? 0));
    return json(200, { ok: true, waiting });
  }

  // ------------------------------------------------------------
  // The conversation itself, oldest first, so heypubli's reply brain can read what
  // was said after our last message. Drafts are the OTHER brain's unsent suggestions
  // (wk_ai_reply mode=draft); they are returned with their status so the caller can
  // ignore them, they were never sent to the lead.
  if (action === 'thread_messages') {
    const phone = normalizeE164(String(payload.phone ?? ''));
    if (!phone || phone.length < 8) return json(200, { ok: false, error: 'bad phone' });
    const limit = Math.min(Math.max(Number(payload.limit ?? 30), 1), 50);
    const { data: contact } = await supa
      .from('wk_contacts')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();
    if (!contact) return json(200, { ok: true, exists: false, messages: [] });
    const { data: dntTag } = await supa
      .from('wk_contact_tags')
      .select('id')
      .eq('contact_id', contact.id)
      .eq('tag', 'do-not-text')
      .maybeSingle();
    // Drafts are excluded in the QUERY, not after: they are the other brain's unsent
    // suggestions, and on a drafty thread they were eating most of the 30 slots, which
    // silently truncated the caller's never-send-a-link-twice memory.
    const { data: msgs, error: msgsErr } = await supa
      .from('wk_sms_messages')
      .select('id, direction, body, status, created_at, media_urls')
      .eq('contact_id', contact.id)
      .eq('channel', 'whatsapp')
      .neq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (msgsErr) return json(502, { error: 'could not read messages' });
    return json(200, {
      ok: true,
      exists: true,
      wk_contact_id: contact.id,
      do_not_text: Boolean(dntTag),
      messages: (msgs ?? []).reverse().map((m) => ({
        id: m.id,
        direction: m.direction,
        body: m.body,
        status: m.status,
        created_at: m.created_at,
        // A picture with no caption must never read as "said nothing".
        media_count: Array.isArray(m.media_urls) ? m.media_urls.length : 0,
      })),
    });
  }

  // ------------------------------------------------------------
  // GIVING THE BRAIN EYES. A creator who cannot describe the screen sends a
  // photo of it, and until now that was always a handover: heypubli could see
  // media_count but never the picture, because inbound media lives behind
  // Twilio's own basic auth and only this function holds those credentials.
  //
  // So it fetches the image HERE and hands back base64. Deliberately not a
  // signed URL: Twilio media URLs are permanent and unauthenticated once
  // guessed, and a creator's screenshot can carry their email, their phone,
  // and whatever else was on their screen.
  if (action === 'message_media') {
    const messageId = String(payload.message_id ?? '');
    if (!messageId) return json(200, { ok: false, error: 'message_id required' });
    const { data: msg } = await supa
      .from('wk_sms_messages')
      .select('id, direction, media_urls')
      .eq('id', messageId)
      .maybeSingle();
    if (!msg) return json(200, { ok: false, error: 'not found' });
    // INBOUND ONLY. Our own outbound media is on a public CDN and asking for
    // it here would just be a way to make this function fetch arbitrary URLs.
    if (msg.direction !== 'inbound') return json(200, { ok: false, error: 'not inbound' });
    const urls: string[] = Array.isArray(msg.media_urls) ? msg.media_urls.map(String) : [];
    const first = urls.find((u) => u.startsWith('https://api.twilio.com/'));
    if (!first) return json(200, { ok: false, error: 'no twilio media' });
    try {
      const res = await fetch(first, {
        headers: { Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}` },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) return json(200, { ok: false, error: `twilio ${res.status}` });
      const type = res.headers.get('content-type') ?? 'image/jpeg';
      // Only still images. A video or a voice note is not something the vision
      // model can read, and a 20MB clip would blow the response either way.
      if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) {
        return json(200, { ok: false, error: `unsupported ${type}` });
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > 4_500_000) return json(200, { ok: false, error: 'too large' });
      let binary = '';
      for (let i = 0; i < buf.length; i += 8192) {
        binary += String.fromCharCode(...buf.subarray(i, i + 8192));
      }
      return json(200, { ok: true, media_type: type, base64: btoa(binary) });
    } catch (e) {
      return json(200, { ok: false, error: e instanceof Error ? e.message : 'fetch failed' });
    }
  }

  // ------------------------------------------------------------
  // Live Meta approval per template. The funnel email watches the pending ones so
  // nobody has to keep asking Twilio by hand whether Meta moved.
  if (action === 'template_status') {
    const sids = (Array.isArray(payload.sids) ? payload.sids.map(String) : [])
      .filter((s) => /^HX[0-9a-f]{32}$/i.test(s))
      .slice(0, 30);
    if (!sids.length) return json(400, { error: 'sids required' });
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return json(503, { error: 'Twilio creds not set' });
    const templates = [];
    for (const sid of sids) {
      const approval = await twilioGet(`https://content.twilio.com/v1/Content/${sid}/ApprovalRequests`);
      const wa = (approval.data?.whatsapp ?? {}) as Record<string, unknown>;
      templates.push({
        sid,
        name: String(wa.name ?? ''),
        status: approval.status === 404 ? 'gone' : String(wa.status ?? 'unknown'),
        rejection_reason: String(wa.rejection_reason ?? ''),
      });
    }
    return json(200, { ok: true, templates });
  }

  // ------------------------------------------------------------
  if (action === 'send') {
    const toE164 = normalizeE164(String(payload.to ?? ''));
    const firstName = String(payload.first_name ?? '').trim();
    const contentSid = String(payload.content_sid ?? '');
    const freeBody = String(payload.body ?? '');
    const externalId = String(payload.external_id ?? '');
    const isTemplate = contentSid.length > 0;
    // A picture of the menu beats a sentence about the menu. Hugo, 07 Aug 2026:
    // "we should have the screenshot for how to get to the URL."
    //
    // WhatsApp media is NOT the same restriction as SMS media. MMS MediaUrl only
    // works to US and Canada, which is why wk-sms-send appends a link instead;
    // on the whatsapp: channel Twilio delivers the image itself, worldwide. The
    // URL has to be publicly reachable by Twilio, so a signed Supabase URL is no
    // good, it must live in a public bucket.
    // One picture or several clips. Twilio takes MediaUrl repeated, up to 10 on
    // WhatsApp; three is the practical limit for a lead on mobile data.
    const mediaList: string[] = (
      Array.isArray(payload.media_urls)
        ? payload.media_urls.map(String)
        : [String(payload.media_url ?? '')]
    )
      .map((u) => u.trim())
      .filter(Boolean);
    if (mediaList.some((u) => !/^https:\/\//.test(u))) {
      return json(400, { error: 'media must be https' });
    }
    if (mediaList.length > 3) return json(400, { error: 'at most 3 media items' });
    const mediaUrl = mediaList[0] ?? '';

    if (!toE164 || toE164.length < 8) return json(200, { ok: false, blocked: 'bad_number' });
    if (!externalId) return json(400, { error: 'external_id required' });
    if (!isTemplate && !freeBody.trim()) return json(400, { error: 'body or content_sid required' });
    // A template's wording lives at Meta and its media is part of the approved
    // template, so an extra MediaUrl here would be silently ignored at best.
    if (mediaUrl && isTemplate) return json(400, { error: 'media_url cannot be used with a template' });
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
      // append, not set: repeated MediaUrl is how Twilio takes more than one.
      for (const u of mediaList) form.append('MediaUrl', u);
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

    // The message is ALREADY GONE by this point. If the row fails to write we
    // have texted somebody and have no record of it: the CRM shows them as
    // unanswered, and anything that reads "what have we already sent" is wrong.
    //
    // 07 Aug 2026: this happened once and said nothing. Ankur was sent an
    // answer at 09:56, read it, and the inbox still listed him as waiting,
    // because the insert returned null and the error was thrown away. Never
    // again silently: it is logged and handed back in the response.
    const { data: inserted, error: insertErr } = await supa
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
        // Same column the inbound webhook writes, so a picture we sent renders
        // in the CRM thread exactly like one a lead sent us.
        //
        // EMPTY ARRAY, NOT NULL. The column is NOT NULL, and writing null here
        // broke every text-only send for eleven minutes on 07 Aug 2026: the
        // messages reached the leads and none of them was recorded. It was
        // invisible until the insert error started being logged, which is the
        // whole reason that logging exists.
        media_urls: mediaList,
      })
      .select('id')
      .maybeSingle();
    if (insertErr || !inserted?.id) {
      console.error(
        '[wk-partner-api] SENT BUT NOT RECORDED',
        JSON.stringify({
          to: toE164,
          twilio_sid: twJson.sid,
          external_id: externalId,
          error: insertErr,
        }),
      );
    }
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
      // Present ONLY when the text went out but the row did not. The caller
      // must not retry on this: retrying texts the person a second time.
      unrecorded: insertErr ? (insertErr.message ?? 'insert failed') : undefined,
    });
  }

  return json(400, { error: `unknown action: ${action}` });
});
