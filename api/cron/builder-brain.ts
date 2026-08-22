// The sweep that finishes the booking: answer the builders, chase the silent
// ones, and raise a hand when only a human can help.
//
// Hugo, 2026-08-22: "when we have a viewing arranged, you have to book the
// builder end to end. If something's missing, just let me know what's missing."
//
// FIVE PASSES, in this order, and the order is the priority:
//
//   1. answers    a human replied to a query, so the builder gets their answer
//   2. replies    a builder spoke last, so the brain answers them
//   3. confirm    nobody has agreed and the viewing is close, so chase
//   4. escalate   the viewing is nearly here with no builder, so tell a human
//   5. report     nothing, deliberately: every hole is already a query or a bell
//
// WHY A CRON AND NOT A WEBHOOK HOOK. The invite sweep next door explains half
// of it (a board drag touches no endpoint). The other half is that a builder
// answering within ten seconds of an automated invite, at 14:33 on a Thursday,
// should not get a reply in the same second: it reads as a robot, and the whole
// value of this thread is that a builder believes he is texting Pedro. Two
// minutes is a person putting the phone down and picking it back up.
//
// A HUMAN ALWAYS WINS. If anybody has typed into the thread since the builder's
// last message, the brain stands down on that thread for good. That is the
// ai-reply rule and it exists because two voices answering one person is worse
// than none.

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildFacts, runBuilderBrain, addressFromAnswer, addressReply, passthroughReply,
  addressIsExact, MAX_BRAIN_REPLIES, type BuilderFacts,
} from '../lib/builder-brain.js';
import {
  loadOutreachSettings, assignBuilderToProperty, viewingTimeLabel,
  builderFacingAddress, renderPreview, FOLLOWUP_TEMPLATE_TEXT,
} from '../lib/builder-outreach.js';
import { sendWhatsApp, windowOpen, templateApproval } from '../lib/whatsapp-send.js';
import { raiseQuery, markApplied, type OpsQueryKind } from '../lib/ops-query.js';
import { loadOpsContacts, unreachable } from '../lib/ops-contacts.js';
import { notifyBuilderEvent, builderNotifyRecipients } from '../lib/builder-notify.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = SupabaseClient<any, any, any>;

export const config = { maxDuration: 60 };

/** How long a builder may sit unanswered before we chase him. Four hours is a
 *  working half-day: long enough that a nudge is not nagging, short enough that
 *  a viewing two days out is still saveable. */
const CHASE_AFTER_MS = 4 * 60 * 60 * 1000;
/** Only chase when the viewing is close enough for it to matter. */
const CHASE_WITHIN_MS = 72 * 60 * 60 * 1000;
/** With this long to go and nobody booked, a human needs to know. */
const ESCALATE_WITHIN_MS = 30 * 60 * 60 * 1000;
/** How far ahead the house-level checks look. WIDER than the chase window on
 *  purpose: chasing a builder about a viewing eight days out is nagging, but
 *  finding out the house number eight days out is exactly when there is still
 *  time to find it. */
const LOOKAHEAD_MS = 14 * 24 * 60 * 60 * 1000;

interface Row {
  id: string; property_id: string; builder_id: string; contact_id: string | null;
  status: string; sent_at: string | null; replied_at: string | null;
  brain_replied_at: string | null; brain_replies: number; chase_sent_at: string | null;
  content_variables: Record<string, string> | null;
}

async function threadOf(sb: Sb, contactId: string) {
  const { data } = await sb
    .from('wk_sms_messages')
    .select('direction, body, status, ai_generated, created_by, created_at')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(20);
  return ((data ?? []) as Array<{
    direction: string; body: string; status: string | null;
    ai_generated: boolean | null; created_by: string | null; created_at: string;
  }>).reverse();
}

async function propertyFor(sb: Sb, propertyId: string) {
  const { data, error } = await sb
    .from('brrr_properties')
    .select('id, address, viewing_address, viewing_at, viewing_notes, notes, wk_contact_id, assigned_builder_id, bedrooms, property_type, deal, qualification, pinned_note, asking_price')
    .eq('id', propertyId)
    .maybeSingle();
  // LOGGED, NEVER SWALLOWED. The first live run of this cron did nothing at all
  // and said nothing about why: it asked for `beds` and `condition_notes`,
  // neither of which is on the table (the bed count is `bedrooms`, and what a
  // house needs is in `notes`). PostgREST answers an unknown column with an
  // error and no row, this read that as "no property" and skipped, and two
  // builders stayed unanswered. A house we cannot read is a reason, not silence.
  if (error) console.error('[builder-brain] could not read property', propertyId, error.message);
  return data as any;
}

async function builderNameFor(sb: Sb, builderId: string): Promise<string> {
  const { data } = await sb.from('brrr_builders').select('name').eq('id', builderId).maybeSingle();
  return String((data as { name?: string } | null)?.name ?? 'the builder');
}

/** Raise a query and say plainly in the log who could not be reached. */
async function ask(
  sb: Sb,
  kind: OpsQueryKind,
  args: {
    propertyId: string | null; subject: string; question: string;
    builderContactId?: string | null; outreachId?: string | null; pendingReply?: string | null;
  },
  out: { errors: string[]; asked: number },
) {
  const res = await raiseQuery({ sb, kind, ...args });
  if (res.ok && !res.alreadyOpen) out.asked += 1;
  for (const e of res.errors) out.errors.push(`ask ${kind}: ${e}`);
  if (res.missingNumbers.length) {
    out.errors.push(`no WhatsApp number on file for ${res.missingNumbers.join(', ')}`);
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const auth = req.headers.authorization || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ) as Sb;

  const now = new Date();
  const out = {
    answered: 0, replied: 0, confirmed: 0, chased: 0, asked: 0, skipped: 0,
    errors: [] as string[],
  };

  try {
    const settings = await loadOutreachSettings(sb);
    const ops = await loadOpsContacts(sb);
    const missing = unreachable(ops).map((c) => c.name);
    const admins = await builderNotifyRecipients(sb);

    // -----------------------------------------------------------------------
    // PASS 1: a human answered a question, so the builder gets their answer.
    // -----------------------------------------------------------------------
    const { data: answered } = await sb
      .from('wk_ops_queries')
      .select('id, kind, property_id, builder_contact_id, outreach_id, answer, pending_reply')
      .eq('status', 'answered')
      .limit(20);

    for (const raw of ((answered ?? []) as Array<Record<string, unknown>>)) {
      const q = raw as {
        id: string; kind: string; property_id: string | null; builder_contact_id: string | null;
        outreach_id: string | null; answer: string | null; pending_reply: string | null;
      };
      const answer = String(q.answer ?? '').trim();
      if (!answer) { await markApplied(sb, q.id, now); continue; }

      // The house number: written onto the house FIRST, because it is worth
      // more than this one conversation. Every future invite, the morning
      // reminder and the drawer all read viewing_address.
      let toSend = '';
      if (q.kind === 'builder_needs_address' && q.property_id) {
        const prop = await propertyFor(sb, q.property_id);
        const full = addressFromAnswer(answer, String(prop?.address ?? ''));
        if (!full) {
          // They said something that is not an address. Left OPEN on purpose so
          // the next thing they type is still treated as the answer.
          await (sb.from('wk_ops_queries') as any)
            .update({ status: 'open', answer: null, answered_at: null, updated_at: now.toISOString() })
            .eq('id', q.id);
          out.errors.push(`address answer had no number in it: "${answer.slice(0, 60)}"`);
          continue;
        }
        await (sb.from('brrr_properties') as any)
          .update({ viewing_address: full }).eq('id', q.property_id);
        toSend = addressReply(full, prop?.viewing_at ? viewingTimeLabel(prop.viewing_at) : '');
      } else {
        toSend = passthroughReply(answer);
      }

      // Every builder still live on this house hears it, not only the one who
      // asked: on Oundle Road four builders had the same street with no number.
      const targets = new Set<string>();
      if (q.builder_contact_id) targets.add(q.builder_contact_id);
      if (q.kind === 'builder_needs_address' && q.property_id) {
        const { data: live } = await sb
          .from('brrr_builder_outreach')
          .select('contact_id')
          .eq('property_id', q.property_id)
          .in('status', ['sent', 'replied', 'confirmed']);
        for (const r of ((live ?? []) as Array<{ contact_id: string | null }>)) {
          if (r.contact_id) targets.add(r.contact_id);
        }
      }

      let delivered = 0;
      for (const contactId of targets) {
        if (!(await windowOpen(sb, contactId, now))) {
          out.errors.push('a builder is outside the 24 hour window, so the answer could not be sent to them');
          continue;
        }
        const { data: c } = await sb.from('wk_contacts').select('phone').eq('id', contactId).maybeSingle();
        const phone = String((c as { phone?: string } | null)?.phone ?? '');
        if (!phone) continue;
        const sent = await sendWhatsApp(sb, { contactId, toE164: phone, body: toSend });
        if (sent.ok) delivered += 1;
        else out.errors.push(`answer to builder: ${sent.error}`);
      }
      if (delivered) out.answered += delivered;
      await markApplied(sb, q.id, now);
    }

    // -----------------------------------------------------------------------
    // PASS 2: a builder spoke last, so answer them.
    // -----------------------------------------------------------------------
    const { data: liveRows } = await sb
      .from('brrr_builder_outreach')
      .select('id, property_id, builder_id, contact_id, status, sent_at, replied_at, brain_replied_at, brain_replies, chase_sent_at, content_variables')
      .in('status', ['sent', 'replied', 'confirmed'])
      .not('contact_id', 'is', null)
      .order('replied_at', { ascending: true, nullsFirst: false })
      .limit(60);

    for (const row of ((liveRows ?? []) as Row[])) {
      if (!row.contact_id) continue;
      const thread = await threadOf(sb, row.contact_id);
      const sendable = thread.filter((m) => String(m.status ?? '') !== 'draft');
      const lastInbound = [...sendable].reverse().find((m) => m.direction === 'inbound');
      if (!lastInbound) continue;
      const lastOutbound = [...sendable].reverse().find((m) => m.direction === 'outbound');
      const inMs = new Date(lastInbound.created_at).getTime();
      // Answered already, by anybody.
      if (lastOutbound && new Date(lastOutbound.created_at).getTime() > inMs) continue;

      // A HUMAN TOOK OVER. Once somebody types into this thread by hand, the
      // brain is done with it: two voices answering one builder is worse than
      // one slow one.
      //
      // created_by IS THE TEST, not ai_generated, and the difference is not
      // academic. Every invite this pipeline has ever sent is stored with
      // ai_generated = false (the template sends in builder-outreach.ts do not
      // set it and the column defaults false), so an ai_generated test would
      // read our own opener as a human takeover and the brain would answer
      // nobody, ever. created_by is the agent id wk-sms-send stamps on a human
      // press and a cron has none, so it is exactly the fact we want. Checked
      // live on the Oxford Gardens threads before this was written.
      const humanSpoke = sendable.some(
        (m) => m.direction === 'outbound' && m.created_by != null,
      );
      if (humanSpoke) { out.skipped += 1; continue; }

      if ((row.brain_replies ?? 0) >= MAX_BRAIN_REPLIES) {
        out.skipped += 1;
        await ask(sb, 'builder_needs_scope', {
          propertyId: row.property_id,
          subject: String(row.content_variables?.['2'] ?? 'a builder'),
          question: `A builder has been going back and forth with me ${row.brain_replies} times and still needs something. Take a look at the thread in the inbox.`,
          builderContactId: row.contact_id, outreachId: row.id,
        }, out);
        continue;
      }

      const property = await propertyFor(sb, row.property_id);
      if (!property) continue;
      const facts: BuilderFacts = buildFacts(
        property, await builderNameFor(sb, row.builder_id), row.builder_id,
      );

      // Nothing to answer with. Ask for the date rather than improvise one: a
      // guessed day sends a real builder to a real house on the wrong afternoon.
      if (!facts.viewingLabel) {
        await ask(sb, 'viewing_time_missing', {
          propertyId: row.property_id,
          subject: facts.address,
          question: `${facts.builderName} has replied about ${facts.address} but nobody has written down the viewing date. What day and time is it? Reply with the day and time in UK time.`,
          builderContactId: row.contact_id, outreachId: row.id,
        }, out);
        continue;
      }

      const { decision } = await runBuilderBrain(
        facts,
        sendable.map((m) => ({
          direction: m.direction === 'inbound' ? 'inbound' as const : 'outbound' as const,
          body: String(m.body ?? ''),
        })),
      );

      // The window: a builder who last spoke inside 24 hours can be answered
      // free-form, which is every builder the moment they reply. Outside it,
      // there is no approved template for a conversational answer, so a human
      // is asked rather than a message quietly never arriving.
      const canSpeak = await windowOpen(sb, row.contact_id, now);

      if (decision.reply && canSpeak) {
        const { data: c } = await sb.from('wk_contacts').select('phone').eq('id', row.contact_id).maybeSingle();
        const phone = String((c as { phone?: string } | null)?.phone ?? '');
        const { data: dnt } = await sb
          .from('wk_contact_tags').select('tag')
          .eq('contact_id', row.contact_id).eq('tag', 'do-not-text').maybeSingle();
        if (phone && !dnt) {
          const sent = await sendWhatsApp(sb, { contactId: row.contact_id, toE164: phone, body: decision.reply });
          if (sent.ok) {
            out.replied += 1;
            await (sb.from('brrr_builder_outreach') as any).update({
              brain_replied_at: now.toISOString(),
              brain_replies: (row.brain_replies ?? 0) + 1,
              status: row.status === 'confirmed' ? 'confirmed' : 'replied',
              replied_at: row.replied_at ?? lastInbound.created_at,
              updated_at: now.toISOString(),
            }).eq('id', row.id);
          } else out.errors.push(`reply to ${facts.builderName}: ${sent.error}`);
        }
      } else if (decision.reply && !canSpeak) {
        out.errors.push(`${facts.builderName} is outside the 24 hour window, so nothing could be sent`);
      }

      // THE BOOKING. In code, never by the model: assignBuilderToProperty
      // re-reads the floor gate and can still refuse a house whose vendor has
      // turned down more than our ceiling.
      if (decision.action === 'reply_and_confirm' && !property.assigned_builder_id) {
        const booked = await assignBuilderToProperty(
          sb, row.property_id, row.builder_id, admins[0] ?? null as unknown as string,
        );
        if (booked.ok) {
          out.confirmed += 1;
          await ask(sb, 'other', {
            propertyId: row.property_id,
            subject: facts.address,
            question: `${facts.builderName} has confirmed the viewing at ${facts.address} on ${facts.viewingLabel}. Nothing needed from you, just so you know.`,
            builderContactId: row.contact_id, outreachId: row.id,
          }, out);
        } else if (booked.error) {
          out.errors.push(`confirm ${facts.builderName}: ${booked.error}`);
        }
      }

      if (decision.action === 'reply_and_close') {
        await (sb.from('brrr_builder_outreach') as any)
          .update({ status: 'declined', declined_at: now.toISOString(), updated_at: now.toISOString() })
          .eq('id', row.id);
      }

      if (decision.opsKind && decision.opsQuestion) {
        await ask(sb, decision.opsKind, {
          propertyId: row.property_id,
          subject: facts.address,
          question: decision.opsQuestion,
          builderContactId: row.contact_id,
          outreachId: row.id,
          pendingReply: decision.pendingReply,
        }, out);
      }
    }

    // -----------------------------------------------------------------------
    // PASS 3 and 4: the houses with a viewing coming and nobody on them.
    // -----------------------------------------------------------------------
    const { data: upcoming } = await sb
      .from('brrr_properties')
      .select('id, address, viewing_address, viewing_at, wk_contact_id, assigned_builder_id')
      .gte('viewing_at', now.toISOString())
      .lte('viewing_at', new Date(now.getTime() + LOOKAHEAD_MS).toISOString())
      .limit(30);

    for (const raw of ((upcoming ?? []) as Array<Record<string, unknown>>)) {
      const p = raw as {
        id: string; address: string | null; viewing_address: string | null;
        viewing_at: string; wk_contact_id: string | null; assigned_builder_id: string | null;
      };
      const label = viewingTimeLabel(p.viewing_at);
      const address = builderFacingAddress(p as any);
      const untilViewing = new Date(p.viewing_at).getTime() - now.getTime();

      const { data: rows } = await sb
        .from('brrr_builder_outreach')
        .select('id, builder_id, contact_id, status, sent_at, replied_at, chase_sent_at')
        .eq('property_id', p.id);
      const all = (rows ?? []) as Array<Row>;
      const sent = all.filter((r) => r.status === 'sent' || r.status === 'replied');

      // THE HOUSE NUMBER IS ASKED FOR BEFORE A BUILDER ASKS FOR IT.
      //
      // Waiting for the question is what cost us Lunar Builders. He asked two
      // minutes after the invite, and the answer did not exist anywhere in the
      // system: somebody had to go and find it, and by the time anyone tried it
      // was the morning of the viewing. Rightmove publishes no number on 96.6%
      // of adverts, so a builder standing on a street with eleven houses on it
      // is the DEFAULT outcome of every invite we send, not an edge case.
      //
      // Raised the moment invites are out and the address is only a street, and
      // raised exactly once by the partial unique index. The answer writes
      // viewing_address, which every builder-facing path already prefers, so
      // one reply from Hugo fixes the invite, the reminder and the drawer at
      // the same time.
      if (sent.length && !addressIsExact(address)) {
        await ask(sb, 'builder_needs_address', {
          propertyId: p.id,
          subject: address,
          question:
            `The advert for ${address} gives no house number, so nobody knows which house to go to. `
            + `${sent.length} ${sent.length === 1 ? 'builder is' : 'builders are'} invited for ${label}. `
            + 'What is the number? Reply with just the number and I will send it to all of them.',
        }, out);
      }

      if (p.assigned_builder_id) continue;

      // PASS 3: nudge the ones who never answered the invite at all. Once.
      // BOUNDED BY ITS OWN WINDOW, and it has to be stated here rather than
      // left to the query above. It used to be implied by the fetch, and when
      // the fetch widened to 14 days so the house number could be chased early,
      // six builders were nudged about viewings four and six days out on the
      // first run. A nudge is only a nudge when the answer is still useful.
      if (untilViewing <= CHASE_WITHIN_MS && /^HX[0-9a-f]{32}$/i.test(settings.followup_sid)) {
        const approved = await templateApproval(settings.followup_sid);
        for (const r of sent) {
          if (r.chase_sent_at || r.replied_at || !r.contact_id || !r.sent_at) continue;
          if (now.getTime() - new Date(r.sent_at).getTime() < CHASE_AFTER_MS) continue;
          if (approved !== 'approved') { out.errors.push('the builder follow-up template is not approved, so nobody could be chased'); break; }
          const { data: c } = await sb.from('wk_contacts').select('phone').eq('id', r.contact_id).maybeSingle();
          const phone = String((c as { phone?: string } | null)?.phone ?? '');
          if (!phone) continue;
          const vars = { '1': address, '2': label };
          // Stamped first: a lost response must not chase the same builder on
          // the next beat, two minutes later.
          await (sb.from('brrr_builder_outreach') as any)
            .update({ chase_sent_at: now.toISOString() }).eq('id', r.id);
          const sentMsg = await sendWhatsApp(sb, {
            contactId: r.contact_id, toE164: phone,
            body: renderPreview(FOLLOWUP_TEMPLATE_TEXT, vars),
            contentSid: settings.followup_sid, contentVariables: vars,
          });
          if (sentMsg.ok) out.chased += 1;
          else {
            out.errors.push(`chase: ${sentMsg.error}`);
            await (sb.from('brrr_builder_outreach') as any).update({ chase_sent_at: null }).eq('id', r.id);
          }
        }
      }

      // PASS 4: close enough to matter, and still nobody coming.
      if (untilViewing <= ESCALATE_WITHIN_MS) {
        const declined = all.filter((r) => r.status === 'declined').length;
        await ask(sb, 'no_builder_for_viewing', {
          propertyId: p.id,
          subject: address,
          question:
            `The viewing at ${address} is ${label} and no builder has confirmed yet. `
            + `${all.length} ${all.length === 1 ? 'was' : 'were'} invited, ${declined} said no. `
            + 'Do you want me to widen the search and invite more builders, or do you have someone? Reply here.',
        }, out);
        if (p.wk_contact_id) {
          await notifyBuilderEvent(sb, {
            kind: 'builder_scrape_empty', agentIds: admins, contactId: p.wk_contact_id,
            title: `No builder for ${label}`,
            body: `${address} has a viewing ${label} and nobody has confirmed. ${all.length} invited, ${declined} declined.`,
            link: `/admin/crm/contacts/${p.wk_contact_id}`,
          });
        }
      }
    }

    if (missing.length) {
      out.errors.push(`no WhatsApp number on file for ${missing.join(', ')}, so they were not asked anything`);
    }

    res.statusCode = 200;
    res.end(JSON.stringify(out));
  } catch (e) {
    out.errors.push(String(e).slice(0, 300));
    res.statusCode = 500;
    res.end(JSON.stringify(out));
  }
}
