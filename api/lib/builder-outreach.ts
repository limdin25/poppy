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
import { vendorFloorVerdict, readDealMoney } from './brrr-offer.js';
import { pinnedCeilingIn } from './deal-state.js';
import { effectiveCeiling } from './counter-position.js';
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
  /** The 8am morning-of-the-viewing confirmation. */
  morning_sid: string;
}

export const OUTREACH_DEFAULTS: OutreachSettings = {
  auto_send: false,
  daily_cap: 20,
  radius_m: 10_000,
  max_new_builders: 8,
  invite_sid: '',
  followup_sid: '',
  morning_sid: '',
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
  /** THE ADDRESS A BUILDER CAN ACTUALLY FIND, with the house number on it.
   *
   *  Added 2026-08-21 because the absence of it lost us a booking. Rightmove
   *  publishes no house number on 96.6% of adverts, so `address` is a street
   *  and a postcode: "Oundle Road, Kingstanding, Birmingham B44 8EP". The
   *  invite that went to Lunar Builders carried exactly that. Shakeel replied
   *  the same minute asking for the full address, nobody answered him for 41
   *  hours, and he cancelled on the morning of the viewing saying he "needed
   *  the full address in advance and didn't receive it in time".
   *
   *  The number is knowable: the BRANCH puts it in the viewing confirmation
   *  email. Ben Rose's said "Re: 10, Stevenson Avenue, Farington, Leyland,
   *  PR25 4GQ".
   *
   *  It is a SEPARATE field rather than a correction to `address`, because two
   *  modules read the street as `address.split(',')[0]`
   *  (api/lib/draft-guards.ts, api/lib/branch-email-match.ts) and a leading
   *  "10, " would turn the street name into a house number for both. */
  viewing_address?: string | null;
  viewing_at?: string | null;
  wk_contact_id?: string | null;
  /** The engine's figures, the call's answers, and Hugo's written ruling. All
   *  optional, because a caller that does not select them gets the old
   *  behaviour rather than a silent block: the floor gate only ever fires on
   *  two numbers it can see. */
  deal?: Record<string, unknown> | null;
  qualification?: Record<string, unknown> | null;
  pinned_note?: string | null;
  /** The asking price, which is how a floor is judged credible for THIS house
   *  rather than for whichever house on the branch the call was really about. */
  asking_price?: number | string | null;
  /** The measured discount off the like-for-like local sold median, as a
   *  fraction, from the discovery lane (wk_raw_leads.discount).
   *
   *  READ, NEVER DERIVED, and it is the ONLY proof a discovery house has.
   *  Call one deliberately produces no ballpark (Hugo, 20 Aug: "we will book
   *  the builder call one and we won't fetch prices or ballpark"), so
   *  brrr_properties.deal is {} for exactly the houses that now reach a
   *  builder first. */
  discount?: number | string | null;
}

/** The floor gate for one property row, with the ceiling resolved the way the
 *  brain and the stress test resolve it: Hugo's pinned figure, else the
 *  engine's. ONE resolution, used by both the draft gate and the press gate. */
function floorVerdictFor(property: {
  deal?: Record<string, unknown> | null;
  qualification?: Record<string, unknown> | null;
  pinned_note?: string | null;
  asking_price?: number | string | null;
}) {
  const pinned = pinnedCeilingIn(String(property.pinned_note ?? ''));
  const governing = effectiveCeiling(readDealMoney(property).ceiling, pinned);
  return vendorFloorVerdict(property, governing);
}

/** The discount a house must show before anyone drives to it. The same value
 *  discovery_pool.MIN_DISCOUNT screens on and both assign scripts re-check,
 *  applied at the last gate before a real person gives up an afternoon.
 *
 *  MOVED WITH THE REST on 2026-08-21 (Hugo: "make 15 to 45%"). It has to track
 *  the lead floor rather than sit above it: a house good enough to call is a
 *  house good enough to price, and leaving this at 0.20 would have qualified
 *  leads that could then never reach a viewing, which is a worse failure than
 *  either number on its own. */
export const MIN_DISCOUNT_FOR_BUILDER = 0.15;

/** Is this house too dear to send anybody to, on the numbers we hold today?
 *
 *  READ, NEVER DERIVED, like everything else in brrr-offer. TWO sources, and
 *  which one exists tells you which lane the house came down:
 *
 *    priced lane      deal.gdv / deal.cmv, and the asking price on the row
 *    discovery lane   the measured discount, because there IS no valuation
 *
 *  A house with neither is not judged here. "We have not priced it" is not the
 *  same as "it is a bad deal", and notProvenADeal below is the check that
 *  catches that case with a reason a human can act on. */
export function belowDiscountRule(property: OutreachProperty): boolean {
  const measured = Number(property.discount ?? NaN);
  if (Number.isFinite(measured) && measured > 0) {
    return measured < MIN_DISCOUNT_FOR_BUILDER;
  }
  const m = readDealMoney(property);
  const worth = m.gdv ?? m.cmv;
  if (!worth || !m.asking) return false;
  return 1 - m.asking / worth < MIN_DISCOUNT_FOR_BUILDER;
}

/** Have we any evidence at all that this house is worth a builder's afternoon?
 *
 *  WHY THIS REPLACED `no_offer_on_file` (2026-08-21, hours after I wrote it).
 *  That check demanded a priced OFFER, which was right under the old two-call
 *  process and is wrong under the one running now: call one books the builder
 *  and deliberately fetches no ballpark, so every discovery house arrives here
 *  with deal = {} and would have been blocked forever. Oxford Gardens (27
 *  percent) and Stevenson Avenue (20 percent) are both real deals and both sat
 *  blocked behind it.
 *
 *  So the question is not "is there an offer" but "can we prove anything": a
 *  valuation OR a measured discount. Neither is still a refusal. */
export function notProvenADeal(property: OutreachProperty): boolean {
  const measured = Number(property.discount ?? NaN);
  if (Number.isFinite(measured) && measured > 0) return false;
  const m = readDealMoney(property);
  return !(m.gdv ?? m.cmv) || !m.asking;
}

/** Why this draft cannot send, or null when it can. The strings are codes the
 *  panel turns into words.
 *
 *  THE TWO REFUSALS COME FIRST, and they are refusals rather than waits. A
 *  missing viewing time and an unapproved template both clear on their own; a
 *  vendor who has turned down more than our ceiling does not, and neither does
 *  a house that is not a deal.
 *
 *  WHY THE DISCOUNT IS CHECKED HERE AT ALL (2026-08-20). Hugo: "we are booking
 *  viewings and wasting people's time and this needs to stop now." Wootton
 *  Street, Bedworth is the case. Pedro spent twenty minutes on the phone and
 *  the branch agreed to arrange a builder, on a house that is 5.3 percent under
 *  its own road. Its card said 21.2 percent because it was written before the
 *  road evidence existed, and every gate between the card and the builder was
 *  about the vendor's floor, the viewing time and the Meta template. Not one of
 *  them asked whether the house was still a deal.
 *
 *  A builder giving up an afternoon is the most expensive thing this pipeline
 *  spends, and it is somebody else's time rather than ours, so this is the
 *  right place for the last check rather than the wrong one. */
export function blockedReasonFor(
  property: OutreachProperty,
  settings: OutreachSettings,
): string | null {
  if (floorVerdictFor(property).blocked) return 'floor_above_ceiling';
  if (belowDiscountRule(property)) return 'below_discount_rule';
  if (notProvenADeal(property)) return 'not_proven_a_deal';
  if (!String(property.viewing_at ?? '').trim()) return 'no_viewing_time';
  if (!/^HX[0-9a-f]{32}$/i.test(settings.invite_sid)) return 'template_pending';
  return null;
}

/** The address we put in front of a builder: the one with the house number on
 *  it when we have it, and the street when we do not. See viewing_address. */
export function builderFacingAddress(property: OutreachProperty): string {
  const full = String(property.viewing_address ?? '').trim();
  return full || String(property.address ?? '').trim();
}

export function inviteVars(property: OutreachProperty): Record<string, string> {
  return {
    '1': OUTREACH_SENDER_NAME,
    '2': builderFacingAddress(property),
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

/**
 * The floor refusal for one house, as the sentence a human reads, or null.
 *
 * One small read, shared by every path that can put a builder on a property:
 * the invite send, the panel's assign, and the cockpit's book_builder press.
 * The draft's stored blocked_reason is refreshed by a five-minute sweep, so on
 * its own it lets a press inside that window through; this re-reads the two
 * numbers at the moment somebody spends the builder.
 *
 * A property that cannot be loaded is a PASS. Unknown is not a refusal here,
 * and a database hiccup is the most unknown thing there is.
 */
export async function floorRefusalFor(sb: Sb, propertyId: string): Promise<string | null> {
  const { data } = await sb
    .from('brrr_properties')
    .select('source_property_id, deal, qualification, pinned_note, asking_price')
    .eq('id', propertyId)
    .maybeSingle();
  if (!data) return null;
  // The measured discount, same reason as the sweep: a discovery house has no
  // valuation to compare an asking price against, only this.
  const spid = String((data as unknown as { source_property_id?: string }).source_property_id ?? '');
  let discount: number | null = null;
  if (spid) {
    const { data: lead } = await sb
      .from('wk_raw_leads').select('discount').eq('property_id', spid)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    discount = (lead as { discount?: number | null } | null)?.discount ?? null;
  }
  const row = { ...(data as unknown as OutreachProperty), discount };
  const verdict = floorVerdictFor(row);
  if (verdict.blocked) return verdict.reason;
  // THE DISCOUNT, RE-READ AT THE MOMENT SOMEBODY SPENDS THE BUILDER.
  //
  // Same reasoning as the floor above it: the draft's stored blocked_reason is
  // only refreshed every five minutes, and this is the last thing that happens
  // before a real person is asked to drive somewhere. Wootton Street, Bedworth
  // (2026-08-20) is why it is here as well as in blockedReasonFor.
  if (belowDiscountRule(row)) {
    const m = readDealMoney(row);
    const worth = m.gdv ?? m.cmv ?? 0;
    const pct = m.asking && worth ? Math.round((1 - m.asking / worth) * 100) : 0;
    return `this house is only ${pct}% below what its road sells for, and the `
      + `rule is ${Math.round(MIN_DISCOUNT_FOR_BUILDER * 100)}%. `
      + 'Sending a builder would spend somebody\'s afternoon on a house we '
      + 'cannot buy at this price.';
  }
  return null;
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

  // Re-read rather than trusting the row: the stored reason is only as fresh
  // as the last sweep, and this is the moment the builder actually gets spent.
  const floorRefusal = await floorRefusalFor(sb, r.property_id);
  if (floorRefusal) {
    await (sb.from('brrr_builder_outreach') as any)
      .update({ blocked_reason: 'floor_above_ceiling', updated_at: new Date().toISOString() })
      .eq('id', r.id);
    return { ok: false, status: r.status, error: floorRefusal };
  }

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

/** The morning-of nudge, sent at 8am UK on the day of the viewing (Hugo,
 *  2026-08-20: "the morning of the visit you say hi good morning just wanna
 *  confirm we are still good for the viewing today").
 *
 *  NO NAME IN IT, on purpose. The roster holds the COMPANY ("MH Building &
 *  Roofing Services Ltd"), never the person who answers the phone, so a
 *  greeting built from it reads like a mail merge to the one human we want
 *  to sound human to. {{1}} is the address and nothing else. */
export const MORNING_TEMPLATE_TEXT =
  'Good morning, just want to confirm we are still good for the viewing today at {{1}}. Thanks.';

/** The board column a confirmed builder moves the branch card into. Renamed
 *  from 'Needs viewing' on 19 Aug; a card here means a builder is booked. */
export const VIEWING_BOOKED_COLUMN = 'Viewing booked';

/** Today's date in UK wall time, as YYYY-MM-DD. */
export function ukDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(at);
}

/**
 * The 8am reminder to every builder confirmed onto a viewing happening today.
 *
 * Only CONFIRMED builders, only the day itself, and only once: the send is
 * stamped on the outreach row (`morning_sent_at`), so a re-run or a second
 * cron beat cannot text a builder twice before breakfast.
 */
export async function sendMorningReminders(
  sb: Sb,
  now: Date = new Date(),
): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const out = { sent: 0, skipped: 0, errors: [] as string[] };
  const settings = await loadOutreachSettings(sb);
  const sid = settings.morning_sid;
  if (!/^HX[0-9a-f]{32}$/i.test(sid)) {
    out.errors.push('morning template not approved yet');
    return out;
  }
  const today = ukDay(now);

  const { data: rows } = await sb
    .from('brrr_builder_outreach')
    .select('id, property_id, contact_id, morning_sent_at, brrr_properties(address, viewing_address, viewing_at, assigned_builder_id)')
    .eq('status', 'confirmed')
    .is('morning_sent_at', null)
    .limit(100);

  for (const raw of ((rows ?? []) as Array<Record<string, unknown>>)) {
    const prop = raw.brrr_properties as { address?: string; viewing_address?: string; viewing_at?: string } | null;
    const contactId = raw.contact_id as string | null;
    if (!prop?.viewing_at || !contactId) { out.skipped += 1; continue; }
    if (ukDay(new Date(prop.viewing_at)) !== today) { out.skipped += 1; continue; }

    const { data: contact } = await sb
      .from('wk_contacts').select('phone').eq('id', contactId).maybeSingle();
    const phone = String((contact as { phone?: string } | null)?.phone ?? '');
    if (!isUkMobile(phone)) { out.skipped += 1; continue; }

    const { data: dnt } = await sb
      .from('wk_contact_tags').select('tag')
      .eq('contact_id', contactId).eq('tag', 'do-not-text').maybeSingle();
    if (dnt) { out.skipped += 1; continue; }

    const vars = { '1': String(prop.address ?? '').trim() };
    const body = renderPreview(MORNING_TEMPLATE_TEXT, vars);

    // Stamp BEFORE the wire call: a lost response must not re-send at 8:05.
    await (sb.from('brrr_builder_outreach') as any)
      .update({ morning_sent_at: new Date().toISOString() })
      .eq('id', raw.id as string);

    const { data: pending } = await (sb.from('wk_sms_messages') as any).insert({
      contact_id: contactId, direction: 'outbound', channel: 'whatsapp',
      body, from_e164: WHATSAPP_SENDER_E164(), to_e164: phone, status: 'sending',
    }).select('id').single();

    const acc = process.env.TWILIO_ACCOUNT_SID ?? '';
    const tok = process.env.TWILIO_AUTH_TOKEN ?? '';
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${acc}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${acc}:${tok}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: `whatsapp:${phone}`,
        From: `whatsapp:${WHATSAPP_SENDER_E164()}`,
        ContentSid: sid,
        ContentVariables: JSON.stringify(vars),
        StatusCallback: `${process.env.SUPABASE_URL}/functions/v1/wk-sms-status`,
      }).toString(),
    });
    if (!resp.ok) {
      const errText = (await resp.text()).slice(0, 200);
      out.errors.push(errText);
      if (pending?.id) {
        await (sb.from('wk_sms_messages') as any).update({ status: 'failed' }).eq('id', pending.id);
      }
      continue;
    }
    const sent = await resp.json() as { sid?: string };
    if (pending?.id) {
      await (sb.from('wk_sms_messages') as any).update({
        twilio_sid: sent.sid ?? null, external_id: sent.sid ?? null, status: sent.sid ? 'sent' : 'queued',
      }).eq('id', pending.id);
    }
    out.sent += 1;
  }
  return out;
}

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

  // Checked BEFORE the status flips, so a refused confirm leaves the row
  // exactly as it was rather than half-confirmed on a house we cannot buy.
  const floorRefusal = await floorRefusalFor(sb, r.property_id);
  if (floorRefusal) return { ok: false, error: floorRefusal };

  await (sb.from('brrr_builder_outreach') as any)
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', r.id);
  return assignBuilderToProperty(sb, r.property_id, r.builder_id, actorId);
}

/**
 * Put a builder on a house, with or without an invite behind it.
 *
 * Hugo, 2026-08-20: "I don't see the option that can tag which builder will go
 * to which property. Should be an option there." So the pairing is a plain
 * human choice from the roster, not only the tail of a WhatsApp conversation:
 * a builder rung on the phone, or one Hugo already knows, is assigned the same
 * way and gets the same chip, the same bell and the same board move.
 *
 * REFUSED on a house whose known floor is at or above our ceiling, whichever
 * way the builder was picked. A hand-picked builder costs exactly as much as
 * one who answered an invite.
 */
export async function assignBuilderToProperty(
  sb: Sb,
  propertyId: string,
  builderId: string,
  actorId: string,
): Promise<{ ok: boolean; warning?: string; error?: string }> {
  const floorRefusal = await floorRefusalFor(sb, propertyId);
  if (floorRefusal) return { ok: false, error: floorRefusal };

  const r = { property_id: propertyId, builder_id: builderId };

  const nowIso = new Date().toISOString();
  await (sb.from('brrr_properties') as any)
    .update({ assigned_builder_id: r.builder_id })
    .eq('id', r.property_id);
  // An invite already sent to this builder follows the assignment, so the
  // panel and the chip cannot disagree about who is going.
  await (sb.from('brrr_builder_outreach') as any)
    .update({ status: 'confirmed', confirmed_at: nowIso, updated_at: nowIso })
    .eq('property_id', r.property_id)
    .eq('builder_id', r.builder_id)
    .in('status', ['draft', 'approved', 'sent', 'replied']);

  const { data: prop } = await sb
    .from('brrr_properties')
    .select('id, address, viewing_address, wk_contact_id, viewing_at')
    .eq('id', r.property_id)
    .maybeSingle();
  const p = prop as { address?: string | null; viewing_address?: string | null; wk_contact_id?: string | null; viewing_at?: string | null } | null;
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
