// The builder outreach engine: drafts WhatsApp invites when a deal sits in
// "Ballpark agreed", sends an approved one, and books the confirmed builder.
//
// THE GATE IS THE POINT (Hugo, 2026-08-19): drafts wait for a human press.
// auto_send in platform_settings.builder_outreach exists so that after a few
// clean batches the same cron can send on its own, one code path, one flag.
//
// A cold builder has never messaged us, so the 24h WhatsApp window is shut and
// a free-form send dies asynchronously (63016). The ONLY opener is a
// Meta-approved template, sent as ContentSid + ContentVariables. Until the
// template is approved and its HX sid is in settings, every draft is blocked
// with a reason the panel shows verbatim.
//
// Sends go straight to Twilio (the ai-reply.ts precedent: the wk-sms-send edge
// fn needs a live user JWT, which a cron does not have) but keep the same
// gates in the same order: do-not-text tag, template approval verified with a
// synchronous GET before spending, row inserted before the wire call so a
// retry cannot double-send, delivery fate via wk-sms-status.

import type { SupabaseClient } from '@supabase/supabase-js';
import { matchBuildersForOutcode, type BuilderRow } from './builder-match.js';
import { outcodeOf } from './brrr-deal-facts.js';
import { isUkMobile } from './builder-scrape.js';
import { notifyBuilderEvent, builderNotifyRecipients } from './builder-notify.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = SupabaseClient<any, any, any>;

export interface OutreachSettings {
  auto_send: boolean;
  daily_cap: number;
  radius_m: number;
  max_new_builders: number;
  /** Twilio Content sid (HX...) of the approved viewing-invite template. */
  invite_sid: string;
  followup_sid: string;
}

export const OUTREACH_DEFAULTS: OutreachSettings = {
  auto_send: false,
  daily_cap: 20,
  radius_m: 10_000,
  max_new_builders: 8,
  invite_sid: '',
  followup_sid: '',
};

/** What Pedro (or whoever presses send) signs the invite as. */
export const OUTREACH_SENDER_NAME = 'Pedro';

/** The invite wording, kept VERBATIM in sync with the Meta template submitted
 *  through Templates > WhatsApp. The wire send uses the ContentSid (Meta's
 *  approved copy is the one that travels); this string only renders the
 *  preview a human reads before approving. {{1}} sender, {{2}} address,
 *  {{3}} viewing date and time. */
export const INVITE_TEMPLATE_TEXT =
  "Hi there, this is {{1}}. We buy and refurbish houses in your area, and I'm looking for a builder, are you able to visit and give us a quote at {{2}} on {{3}}? Thanks.";

export function loadOutreachSettingsFrom(raw: unknown): OutreachSettings {
  let parsed: Partial<OutreachSettings> = {};
  try { parsed = JSON.parse(String(raw ?? '{}')) as Partial<OutreachSettings>; } catch { /* defaults */ }
  return { ...OUTREACH_DEFAULTS, ...parsed };
}

export async function loadOutreachSettings(sb: Sb): Promise<OutreachSettings> {
  const { data } = await sb
    .from('platform_settings').select('value').eq('key', 'builder_outreach').maybeSingle();
  return loadOutreachSettingsFrom((data as { value?: unknown } | null)?.value);
}

/** "Thursday 21 August at 2:30pm", always UK wall time, never the server's. */
export function viewingTimeLabel(viewingAt: string): string {
  const d = new Date(viewingAt);
  if (Number.isNaN(d.getTime())) return '';
  const date = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Europe/London',
  }).format(d).replace(/\s/g, '').toLowerCase();
  return `${date} at ${time}`;
}

export interface OutreachProperty {
  id: string;
  address?: string | null;
  viewing_at?: string | null;
  wk_contact_id?: string | null;
}

/** Why this draft cannot send yet, or null when it can. The strings are shown
 *  verbatim in the panel, so they are words, not codes. */
export function blockedReasonFor(
  property: OutreachProperty,
  settings: OutreachSettings,
): string | null {
  if (!String(property.viewing_at ?? '').trim()) return 'no_viewing_time';
  if (!/^HX[0-9a-f]{32}$/i.test(settings.invite_sid)) return 'template_pending';
  return null;
}

export function inviteVars(property: OutreachProperty): Record<string, string> {
  return {
    '1': OUTREACH_SENDER_NAME,
    '2': String(property.address ?? '').trim(),
    '3': property.viewing_at ? viewingTimeLabel(property.viewing_at) : '',
  };
}

export function renderPreview(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => vars[n] ?? '');
}

/** The builder's row in wk_contacts, created on first contact. lead_type is
 *  what the inbox, the coach and wk-sms-incoming branch on. */
export async function ensureBuilderContact(
  sb: Sb,
  builder: { id: string; name: string; phone: string },
  ownerAgentId: string | null,
): Promise<string | null> {
  const national = builder.phone.replace(/^\+44/, '0');
  const { data: existing } = await sb
    .from('wk_contacts')
    .select('id, custom_fields')
    .or(`phone.eq.${builder.phone},phone.eq.${national}`)
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    const cf = ((existing as { custom_fields?: Record<string, unknown> }).custom_fields ?? {});
    if (cf.lead_type !== 'builder') {
      await (sb.from('wk_contacts') as any)
        .update({ custom_fields: { ...cf, lead_type: 'builder', builder_id: builder.id } })
        .eq('id', existing.id);
    }
    return existing.id as string;
  }
  const { data: created, error } = await (sb.from('wk_contacts') as any)
    .insert({
      name: builder.name,
      phone: builder.phone,
      owner_agent_id: ownerAgentId,
      custom_fields: { lead_type: 'builder', builder_id: builder.id },
    })
    .select('id')
    .single();
  if (error) { console.error('[builder-outreach] contact create failed', error.message); return null; }
  return (created as { id: string } | null)?.id ?? null;
}

/**
 * Draft (or refresh) the invites for one property. Idempotent top to bottom:
 * the unique (property_id, builder_id) key makes re-drafting a no-op, and a
 * blocked draft is re-rendered on every sweep so it unblocks the moment the
 * viewing time lands or the template is approved.
 */
export async function draftOutreachForProperty(
  sb: Sb,
  property: OutreachProperty,
  settings: OutreachSettings,
): Promise<{ drafted: number; matched: number }> {
  const oc = outcodeOf(String(property.address ?? ''));
  if (!oc) return { drafted: 0, matched: 0 };

  const { data: roster } = await sb
    .from('brrr_builders')
    .select('id, name, phone, email, coverage, active');
  const matches = matchBuildersForOutcode(((roster ?? []) as BuilderRow[]), oc)
    .filter((b) => isUkMobile(b.phone));
  if (!matches.length) return { drafted: 0, matched: 0 };

  const admins = await builderNotifyRecipients(sb);
  const blocked = blockedReasonFor(property, settings);
  const vars = inviteVars(property);
  const body = renderPreview(INVITE_TEMPLATE_TEXT, vars);

  let drafted = 0;
  for (const b of matches) {
    const contactId = await ensureBuilderContact(
      sb, { id: b.id, name: b.name, phone: String(b.phone) }, admins[0] ?? null,
    );
    const { error } = await (sb.from('brrr_builder_outreach') as any).upsert({
      property_id: property.id,
      builder_id: b.id,
      contact_id: contactId,
      status: 'draft',
      blocked_reason: blocked,
      body,
      content_sid: settings.invite_sid || null,
      content_variables: vars,
    }, { onConflict: 'property_id,builder_id', ignoreDuplicates: true });
    if (!error) drafted += 1;
  }

  // Refresh rows still sitting at draft: a draft written while the viewing
  // time was missing must not keep its stale empty {{3}} forever.
  await (sb.from('brrr_builder_outreach') as any)
    .update({
      blocked_reason: blocked,
      body,
      content_sid: settings.invite_sid || null,
      content_variables: vars,
      updated_at: new Date().toISOString(),
    })
    .eq('property_id', property.id)
    .eq('status', 'draft');

  return { drafted, matched: matches.length };
}

async function twilioGet(url: string): Promise<{ status: number; data: Record<string, unknown> | null }> {
  const sid = process.env.TWILIO_ACCOUNT_SID ?? '';
  const token = process.env.TWILIO_AUTH_TOKEN ?? '';
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
    });
    if (!res.ok) return { status: res.status, data: null };
    return { status: res.status, data: await res.json() as Record<string, unknown> };
  } catch {
    return { status: 0, data: null };
  }
}

const WHATSAPP_SENDER_E164 = () => process.env.WHATSAPP_SENDER_E164 || '+447460035763';

/**
 * Send one draft. Returns the new status. Refuses (never sends) on a blocked
 * reason, a non-draft/approved status, a do-not-text tag, or an unapproved
 * template. The wk_sms_messages row goes in BEFORE Twilio is called, so a
 * retry after a lost response cannot double-send (the ai-reply rule).
 */
export async function sendOutreachRow(
  sb: Sb,
  rowId: string,
): Promise<{ ok: boolean; status: string; error?: string }> {
  const { data: row } = await sb
    .from('brrr_builder_outreach')
    .select('id, property_id, builder_id, contact_id, status, blocked_reason, body, content_sid, content_variables')
    .eq('id', rowId)
    .maybeSingle();
  if (!row) return { ok: false, status: 'missing', error: 'No such outreach row.' };
  const r = row as {
    id: string; property_id: string; builder_id: string; contact_id: string | null;
    status: string; blocked_reason: string | null; body: string;
    content_sid: string | null; content_variables: Record<string, string>;
  };
  if (r.status !== 'draft' && r.status !== 'approved') {
    return { ok: false, status: r.status, error: `Already ${r.status}.` };
  }
  if (r.blocked_reason) return { ok: false, status: r.status, error: `Blocked: ${r.blocked_reason}.` };
  if (!r.contact_id) return { ok: false, status: r.status, error: 'No contact on this row.' };
  if (!r.content_sid) return { ok: false, status: r.status, error: 'Blocked: template_pending.' };

  const { data: contact } = await sb
    .from('wk_contacts').select('id, phone').eq('id', r.contact_id).maybeSingle();
  const phone = String((contact as { phone?: string } | null)?.phone ?? '');
  if (!isUkMobile(phone)) return { ok: false, status: r.status, error: 'Builder has no UK mobile.' };

  const { data: dnt } = await sb
    .from('wk_contact_tags').select('tag')
    .eq('contact_id', r.contact_id).eq('tag', 'do-not-text').maybeSingle();
  if (dnt) return { ok: false, status: r.status, error: 'This builder opted out. Sending is blocked.' };

  // Approval verified before spending: an unapproved template dies
  // asynchronously exactly like 63016, which reads as success in the UI.
  const approval = await twilioGet(
    `https://content.twilio.com/v1/Content/${r.content_sid}/ApprovalRequests`,
  );
  const waStatus = String(
    ((approval.data?.whatsapp ?? {}) as Record<string, unknown>).status ?? '',
  ).toLowerCase();
  if (waStatus !== 'approved') {
    await (sb.from('brrr_builder_outreach') as any)
      .update({ blocked_reason: 'template_pending', updated_at: new Date().toISOString() })
      .eq('id', r.id);
    return {
      ok: false, status: r.status,
      error: waStatus ? `Template is "${waStatus}" with Meta, not approved yet.` : 'Template not submitted to Meta yet.',
    };
  }

  const { data: pending } = await (sb.from('wk_sms_messages') as any).insert({
    contact_id: r.contact_id, direction: 'outbound', channel: 'whatsapp',
    body: r.body, from_e164: WHATSAPP_SENDER_E164(), to_e164: phone, status: 'sending',
  }).select('id').single();

  const acc = process.env.TWILIO_ACCOUNT_SID ?? '';
  const tok = process.env.TWILIO_AUTH_TOKEN ?? '';
  const form = new URLSearchParams({
    To: `whatsapp:${phone}`,
    From: `whatsapp:${WHATSAPP_SENDER_E164()}`,
    ContentSid: r.content_sid,
    ContentVariables: JSON.stringify(r.content_variables ?? {}),
    StatusCallback: `${process.env.SUPABASE_URL}/functions/v1/wk-sms-status`,
  });
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${acc}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${acc}:${tok}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  if (!resp.ok) {
    const errText = (await resp.text()).slice(0, 300);
    if (pending?.id) {
      await (sb.from('wk_sms_messages') as any).update({ status: 'failed' }).eq('id', pending.id);
    }
    await (sb.from('brrr_builder_outreach') as any)
      .update({ status: 'failed', error: errText, updated_at: new Date().toISOString() })
      .eq('id', r.id);
    return { ok: false, status: 'failed', error: `Twilio ${resp.status}: ${errText}` };
  }
  const sent = await resp.json() as { sid?: string };
  if (pending?.id) {
    await (sb.from('wk_sms_messages') as any).update({
      twilio_sid: sent.sid ?? null, external_id: sent.sid ?? null, status: sent.sid ? 'sent' : 'queued',
    }).eq('id', pending.id);
  }
  await (sb.from('brrr_builder_outreach') as any).update({
    status: 'sent', twilio_sid: sent.sid ?? null, sent_at: new Date().toISOString(),
    error: null, updated_at: new Date().toISOString(),
  }).eq('id', r.id);
  return { ok: true, status: 'sent' };
}

/** Sends made today (UK day), for the auto-mode daily cap. */
export async function sentToday(sb: Sb): Promise<number> {
  const now = new Date();
  const ukMidnight = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now)}T00:00:00`);
  const { count } = await sb
    .from('brrr_builder_outreach')
    .select('id', { count: 'exact', head: true })
    .gte('sent_at', ukMidnight.toISOString());
  return count ?? 0;
}

/** The board column a confirmed builder moves the branch card into. Renamed
 *  from 'Needs viewing' on 19 Aug; a card here means a builder is booked. */
export const VIEWING_BOOKED_COLUMN = 'Viewing booked';

/**
 * A human pressed "Builder confirmed": book the builder onto the property,
 * move the branch card to Viewing booked (on the branch's OWN board, warn
 * rather than fail if the column is missing), and ring the bell.
 */
export async function confirmBuilder(
  sb: Sb,
  rowId: string,
  actorId: string,
): Promise<{ ok: boolean; warning?: string; error?: string }> {
  const { data: row } = await sb
    .from('brrr_builder_outreach')
    .select('id, property_id, builder_id, contact_id, status')
    .eq('id', rowId)
    .maybeSingle();
  if (!row) return { ok: false, error: 'No such outreach row.' };
  const r = row as { id: string; property_id: string; builder_id: string; contact_id: string | null; status: string };
  if (r.status === 'confirmed') return { ok: true };

  const nowIso = new Date().toISOString();
  await (sb.from('brrr_properties') as any)
    .update({ assigned_builder_id: r.builder_id })
    .eq('id', r.property_id);
  await (sb.from('brrr_builder_outreach') as any)
    .update({ status: 'confirmed', confirmed_at: nowIso, updated_at: nowIso })
    .eq('id', r.id);

  const { data: prop } = await sb
    .from('brrr_properties')
    .select('id, address, wk_contact_id, viewing_at')
    .eq('id', r.property_id)
    .maybeSingle();
  const p = prop as { address?: string | null; wk_contact_id?: string | null; viewing_at?: string | null } | null;
  const { data: builder } = await sb
    .from('brrr_builders').select('name').eq('id', r.builder_id).maybeSingle();
  const builderName = String((builder as { name?: string } | null)?.name ?? 'The builder');

  // Move the branch card, on its own board only (the property-outcome rule).
  let warning: string | undefined;
  if (p?.wk_contact_id) {
    const { data: contact } = await sb
      .from('wk_contacts')
      .select('id, pipeline_column_id')
      .eq('id', p.wk_contact_id)
      .maybeSingle();
    const c = contact as { id: string; pipeline_column_id: string | null } | null;
    if (c) {
      let pipelineId: string | null = null;
      if (c.pipeline_column_id) {
        const { data: current } = await sb
          .from('wk_pipeline_columns').select('pipeline_id')
          .eq('id', c.pipeline_column_id).maybeSingle();
        pipelineId = (current as { pipeline_id?: string } | null)?.pipeline_id ?? null;
      }
      const q = sb.from('wk_pipeline_columns').select('id').eq('name', VIEWING_BOOKED_COLUMN);
      const { data: col } = await (pipelineId ? q.eq('pipeline_id', pipelineId) : q)
        .limit(1).maybeSingle();
      const colId = (col as { id?: string } | null)?.id;
      if (colId && colId !== c.pipeline_column_id) {
        await (sb.from('wk_contacts') as any).update({
          pipeline_column_id: colId,
          stage_moved_at: nowIso,
          stage_moved_from: c.pipeline_column_id,
          stage_moved_by: actorId,
          // 'agent': this move is the direct result of a human press.
          stage_move_source: 'agent',
        }).eq('id', c.id);
      } else if (!colId) {
        warning = `no ${VIEWING_BOOKED_COLUMN} column on this board, so the card was left where it was`;
      }
    }
  }

  const admins = await builderNotifyRecipients(sb);
  await notifyBuilderEvent(sb, {
    kind: 'builder_confirmed',
    agentIds: admins,
    contactId: p?.wk_contact_id ?? null,
    title: `Builder confirmed: ${builderName}`,
    body: `${builderName} is booked onto the viewing at ${String(p?.address ?? 'the property')}${p?.viewing_at ? ` (${viewingTimeLabel(p.viewing_at)})` : ''}.`,
    link: p?.wk_contact_id ? `/admin/crm/contacts/${p.wk_contact_id}` : '/admin/crm/cockpit',
  });

  return { ok: true, warning };
}
