// The machine asking a human a question, on WhatsApp, and getting an answer
// back into the deal.
//
// Hugo, 2026-08-22: "the brand should contact us, both of us, so maybe you
// should have a template approved by Meta that says we have a query or
// something like this, so then you send it, we reply, and then you give it the
// query, because of the twenty four hours thing."
//
// That is exactly the shape below, with one addition he did not have to ask
// for: IF THE WINDOW IS ALREADY OPEN, THE QUESTION GOES STRAIGHT OUT. Making
// somebody reply "?" to a template they could have answered directly is a round
// trip for nothing, and the whole reason this exists is that round trips cost
// us a builder.
//
//   raiseQuery()    write the row, once per (house, kind), and deliver it
//   deliverQuery()  per recipient: question if the window is open, approved
//                   template if it is shut
//   openWindowFor() their reply arrived, so push any question that was waiting
//   answerQuery()   their words are the answer; hand them back to the caller
//
// WHAT THIS DELIBERATELY DOES NOT DO: decide anything. It carries a question to
// a person and an answer back. Every judgement about what the answer MEANS
// belongs to the module that asked (today that is the builder brain), because a
// generic answer-interpreter is a machine for getting the important cases
// subtly wrong.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadOpsContacts, reachable, unreachable, templateVar,
  type OpsContact, type OpsContacts,
} from './ops-contacts.js';
import { sendWhatsApp, windowOpen, templateApproval } from './whatsapp-send.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = SupabaseClient<any, any, any>;

/** The kinds of hole the automation can hit. A closed set on purpose: the brain
 *  branches on it when the answer comes back, and a free-text kind is a branch
 *  nobody wrote. */
export type OpsQueryKind =
  /** A builder asked for the house number and Rightmove never published one. */
  | 'builder_needs_address'
  /** A builder asked something about the works we hold no answer to. */
  | 'builder_needs_scope'
  /** A builder wants a different day or time from the one Pedro booked. */
  | 'builder_time_change'
  /** The viewing is close and not one builder has agreed to attend. */
  | 'no_builder_for_viewing'
  /** The card is in Viewing booked but nobody wrote down the date. */
  | 'viewing_time_missing'
  /** Anything else worth a human's eyes, worded by the caller. */
  | 'other';

/** The opener sent when the 24 hour window is shut. Kept VERBATIM in step with
 *  the Meta template of the same name, because the ContentSid carries Meta's
 *  approved copy on the wire and this string only renders the preview stored in
 *  the thread.
 *
 *  {{1}} who we are asking about, {{2}} the one-line question.
 *
 *  IT DOES NOT END ON A VARIABLE. Meta rejects a template whose body ends on a
 *  placeholder even with punctuation after it (subCode 2388299, learned live on
 *  2026-08-20), so the closing sentence is fixed copy. */
export const OPS_QUERY_TEMPLATE_TEXT =
  'Unico deals: we need you on {{1}}. {{2}} Reply here and I will send you the full details.';

export const OPS_QUERY_TEMPLATE_NAME = 'ops_query_v1';

export interface OpsQuerySettings {
  /** Twilio Content sid (HX...) of the approved opener above. */
  query_sid: string;
}

export interface RaiseArgs {
  sb: Sb;
  kind: OpsQueryKind;
  propertyId: string | null;
  /** Short, no newlines: it travels as a template variable. */
  subject: string;
  /** The whole question, in plain words, sent free-form. */
  question: string;
  builderContactId?: string | null;
  outreachId?: string | null;
  /** What the asker intends to tell the builder once it has the answer. Stored
   *  now so the answer path is not re-deriving intent hours later. */
  pendingReply?: string | null;
  /** Injected in tests; production reads platform_settings. */
  ops?: OpsContacts;
  querySid?: string;
  now?: Date;
}

export interface RaiseResult {
  ok: boolean;
  /** null when an identical query was already open: the anti-nag path, and a
   *  success, not an error. */
  queryId: string | null;
  alreadyOpen: boolean;
  asked: string[];
  /** Named on the ops list with no usable number. Reported, never guessed. */
  missingNumbers: string[];
  errors: string[];
}

async function loadQuerySid(sb: Sb): Promise<string> {
  const { data } = await sb
    .from('platform_settings').select('value').eq('key', 'builder_outreach').maybeSingle();
  try {
    const parsed = JSON.parse(String((data as { value?: unknown } | null)?.value ?? '{}')) as
      Partial<OpsQuerySettings>;
    return String(parsed.query_sid ?? '');
  } catch {
    return '';
  }
}

/**
 * Find or create the ops contact's own CRM row.
 *
 * A staff member gets a wk_contacts row like anybody else, because the thread
 * is how the conversation is stored and read. What keeps them out of the sales
 * machinery is `custom_fields.lead_type = 'ops'`, which wk-sms-incoming checks
 * before any lead handling runs: no campaign, no AI sales reply, no product
 * stamp.
 */
export async function ensureOpsContact(
  sb: Sb,
  contact: OpsContact & { e164: string },
): Promise<string | null> {
  const national = contact.e164.replace(/^\+44/, '0');
  const { data: existing } = await sb
    .from('wk_contacts')
    .select('id, custom_fields')
    .or(`phone.eq.${contact.e164},phone.eq.${national}`)
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    const cf = ((existing as { custom_fields?: Record<string, unknown> }).custom_fields ?? {});
    if (cf.lead_type !== 'ops') {
      await (sb.from('wk_contacts') as any)
        .update({ custom_fields: { ...cf, lead_type: 'ops', ops_name: contact.name } })
        .eq('id', existing.id);
    }
    return existing.id as string;
  }
  const { data: created, error } = await (sb.from('wk_contacts') as any)
    .insert({
      name: contact.name,
      phone: contact.e164,
      custom_fields: { lead_type: 'ops', ops_name: contact.name, ops_role: contact.role },
    })
    .select('id')
    .single();
  if (error) {
    console.error('[ops-query] contact create failed', error.message);
    return null;
  }
  return (created as { id: string } | null)?.id ?? null;
}

/**
 * Deliver one query to one person.
 *
 * The whole decision is the window. Open: send the question, done in one
 * message. Shut: send the approved opener naming the subject and a one-line
 * summary, and leave question_sent_at null so openWindowFor() finishes the job
 * the moment they reply.
 *
 * A template that is not approved yet is a REFUSAL, not a fallback to
 * free-form: free-form outside the window is accepted by Twilio, returns a sid,
 * and is never delivered. Failing loudly here beats a question nobody ever saw.
 */
export async function deliverQuery(
  sb: Sb,
  query: {
    id: string; subject: string; question: string;
  },
  contact: OpsContact & { e164: string },
  querySid: string,
  now: Date = new Date(),
): Promise<{ ok: boolean; via: 'question' | 'template' | 'none'; error?: string }> {
  const contactId = await ensureOpsContact(sb, contact);
  if (!contactId) return { ok: false, via: 'none', error: 'no contact row' };

  const { data: existingPing } = await sb
    .from('wk_ops_query_pings')
    .select('id, template_sent_at, question_sent_at')
    .eq('query_id', query.id)
    .eq('phone', contact.e164)
    .maybeSingle();
  const ping = existingPing as
    { id: string; template_sent_at: string | null; question_sent_at: string | null } | null;
  if (ping?.question_sent_at) return { ok: true, via: 'none' };

  const open = await windowOpen(sb, contactId, now);

  // The row goes in FIRST, and it is stamped as though the send succeeded,
  // because the alternative is a two-minute cron that re-asks on every beat if
  // the response is ever lost. A ping that failed is corrected below with the
  // error on it; a ping that double-sent cannot be corrected at all.
  const stamp = open
    ? { question_sent_at: now.toISOString() }
    : { template_sent_at: now.toISOString() };
  const pingId = ping?.id;
  if (pingId) {
    await (sb.from('wk_ops_query_pings') as any).update(stamp).eq('id', pingId);
  } else {
    await (sb.from('wk_ops_query_pings') as any).insert({
      query_id: query.id, phone: contact.e164, name: contact.name, contact_id: contactId, ...stamp,
    });
  }

  const markFailed = async (error: string) => {
    await (sb.from('wk_ops_query_pings') as any)
      .update({ error: error.slice(0, 300), ...(open ? { question_sent_at: null } : { template_sent_at: null }) })
      .eq('query_id', query.id).eq('phone', contact.e164);
  };

  if (open) {
    const sent = await sendWhatsApp(sb, {
      contactId, toE164: contact.e164, body: query.question,
    });
    if (!sent.ok) { await markFailed(sent.error ?? 'send failed'); return { ok: false, via: 'question', error: sent.error }; }
    return { ok: true, via: 'question' };
  }

  if (!/^HX[0-9a-f]{32}$/i.test(querySid)) {
    await markFailed('ops query template not configured');
    return { ok: false, via: 'template', error: 'The ops query template is not set up yet, so nothing could be sent outside the 24 hour window.' };
  }
  const approval = await templateApproval(querySid);
  if (approval !== 'approved') {
    await markFailed(`template ${approval || 'unsubmitted'}`);
    return {
      ok: false, via: 'template',
      error: approval ? `The ops query template is "${approval}" with Meta, not approved.` : 'The ops query template has not been approved by Meta yet.',
    };
  }
  const vars = {
    '1': templateVar(query.subject, 90),
    // One line of the question, so the opener is not opaque. The full text
    // follows the moment they reply.
    '2': templateVar(query.question.split(/(?<=[.?!])\s/)[0] ?? query.question, 140),
  };
  const preview = OPS_QUERY_TEMPLATE_TEXT
    .replace('{{1}}', vars['1']).replace('{{2}}', vars['2']);
  const sent = await sendWhatsApp(sb, {
    contactId, toE164: contact.e164, body: preview,
    contentSid: querySid, contentVariables: vars,
  });
  if (!sent.ok) { await markFailed(sent.error ?? 'send failed'); return { ok: false, via: 'template', error: sent.error }; }
  return { ok: true, via: 'template' };
}

/**
 * Ask the humans something.
 *
 * Idempotent by the partial unique index on (property_id, kind) where status is
 * open: the brain re-raises the same query on every two-minute sweep, and the
 * second one loses to the database rather than to anybody remembering. That
 * refusal is reported as alreadyOpen, not as an error.
 */
export async function raiseQuery(args: RaiseArgs): Promise<RaiseResult> {
  const { sb } = args;
  const now = args.now ?? new Date();
  const out: RaiseResult = {
    ok: false, queryId: null, alreadyOpen: false, asked: [], missingNumbers: [], errors: [],
  };

  const ops = args.ops ?? await loadOpsContacts(sb);
  if (!ops.enabled) { out.errors.push('ops contacts are switched off'); return out; }
  out.missingNumbers = unreachable(ops).map((c) => c.name);
  const people = reachable(ops);
  if (!people.length) {
    out.errors.push('nobody on the ops list has a usable WhatsApp number');
    return out;
  }

  if (args.propertyId) {
    const { data: open } = await sb
      .from('wk_ops_queries')
      .select('id')
      .eq('property_id', args.propertyId)
      .eq('kind', args.kind)
      .eq('status', 'open')
      .maybeSingle();
    if (open?.id) {
      out.ok = true;
      out.alreadyOpen = true;
      out.queryId = (open as { id: string }).id;
      return out;
    }
  }

  const { data: created, error } = await (sb.from('wk_ops_queries') as any).insert({
    kind: args.kind,
    property_id: args.propertyId,
    builder_contact_id: args.builderContactId ?? null,
    outreach_id: args.outreachId ?? null,
    subject: args.subject.slice(0, 200),
    question: args.question,
    pending_reply: args.pendingReply ?? null,
  }).select('id').single();
  if (error || !created?.id) {
    // A unique violation is the anti-nag index doing its job under a race.
    if (String(error?.code) === '23505') { out.ok = true; out.alreadyOpen = true; return out; }
    out.errors.push(String(error?.message ?? 'could not write the query'));
    return out;
  }
  const queryId = (created as { id: string }).id;
  out.queryId = queryId;

  const querySid = args.querySid ?? await loadQuerySid(sb);
  for (const person of people) {
    const res = await deliverQuery(
      sb, { id: queryId, subject: args.subject, question: args.question }, person, querySid, now,
    );
    if (res.ok) out.asked.push(person.name);
    else if (res.error) out.errors.push(`${person.name}: ${res.error}`);
  }
  out.ok = out.asked.length > 0;
  return out;
}

/**
 * A staff member just messaged us, so the window is open: send anything that
 * was waiting on it.
 *
 * This is the second half of Hugo's design. The template said "we have a
 * query"; their reply, whatever it says, is the key that unlocks free-form, and
 * the question follows within seconds rather than at the next cron beat.
 */
export async function openWindowFor(
  sb: Sb,
  phone: string,
  now: Date = new Date(),
): Promise<{ sent: number; errors: string[] }> {
  const out = { sent: 0, errors: [] as string[] };
  const { data: pings } = await sb
    .from('wk_ops_query_pings')
    .select('id, query_id, phone, name, contact_id, wk_ops_queries(id, question, status)')
    .eq('phone', phone)
    .is('question_sent_at', null)
    .not('template_sent_at', 'is', null)
    .limit(10);

  for (const raw of ((pings ?? []) as Array<Record<string, unknown>>)) {
    const q = raw.wk_ops_queries as { id: string; question: string; status: string } | null;
    if (!q || q.status !== 'open') continue;
    const contactId = String(raw.contact_id ?? '');
    if (!contactId) continue;
    // Stamped before the wire call, same rule as everywhere else here.
    await (sb.from('wk_ops_query_pings') as any)
      .update({ question_sent_at: now.toISOString() }).eq('id', raw.id as string);
    const sent = await sendWhatsApp(sb, {
      contactId, toE164: String(raw.phone), body: q.question,
    });
    if (sent.ok) out.sent += 1;
    else {
      out.errors.push(sent.error ?? 'send failed');
      await (sb.from('wk_ops_query_pings') as any)
        .update({ question_sent_at: null, error: (sent.error ?? '').slice(0, 300) })
        .eq('id', raw.id as string);
    }
  }
  return out;
}

/**
 * The oldest query this person still owes us an answer to, or null.
 *
 * OLDEST FIRST, and only ones they have actually been given: a query still
 * sitting behind a template they have not replied to is not one their message
 * can be an answer to. That distinction is what stops "yes ok" from being filed
 * against a question they never read.
 */
export async function pendingQueryFor(
  sb: Sb,
  phone: string,
): Promise<{ id: string; kind: string; question: string; property_id: string | null;
  builder_contact_id: string | null; outreach_id: string | null; pending_reply: string | null } | null> {
  const { data: pings } = await sb
    .from('wk_ops_query_pings')
    .select('query_id, question_sent_at')
    .eq('phone', phone)
    .not('question_sent_at', 'is', null)
    .order('question_sent_at', { ascending: true })
    .limit(20);
  const ids = ((pings ?? []) as Array<{ query_id: string }>).map((p) => p.query_id);
  if (!ids.length) return null;
  const { data: q } = await sb
    .from('wk_ops_queries')
    .select('id, kind, question, property_id, builder_contact_id, outreach_id, pending_reply')
    .in('id', ids)
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (q as any) ?? null;
}

/** File their words against the query. The caller decides what the words MEAN. */
export async function answerQuery(
  sb: Sb,
  queryId: string,
  answer: string,
  fromPhone: string,
  now: Date = new Date(),
): Promise<void> {
  await (sb.from('wk_ops_queries') as any).update({
    status: 'answered',
    answer: answer.slice(0, 2000),
    answered_at: now.toISOString(),
    answered_by_phone: fromPhone,
    updated_at: now.toISOString(),
  }).eq('id', queryId).eq('status', 'open');
}

/** The answer has been used: passed to the builder, written onto the house. */
export async function markApplied(sb: Sb, queryId: string, now: Date = new Date()): Promise<void> {
  await (sb.from('wk_ops_queries') as any)
    .update({ status: 'applied', applied_at: now.toISOString(), updated_at: now.toISOString() })
    .eq('id', queryId);
}

/** The question stopped mattering (the builder cancelled, the house was lost). */
export async function cancelQueries(
  sb: Sb,
  propertyId: string,
  kinds: OpsQueryKind[],
  now: Date = new Date(),
): Promise<void> {
  if (!kinds.length) return;
  await (sb.from('wk_ops_queries') as any)
    .update({ status: 'cancelled', updated_at: now.toISOString() })
    .eq('property_id', propertyId).eq('status', 'open').in('kind', kinds);
}
