// The builder-outreach sweep. Every five minutes through the working day:
// find every branch card sitting in 'Viewing booked', scrape local builders
// for that house's outcode (once per property, ever), and draft the WhatsApp
// invites. Drafts wait for a human press unless auto_send is on in
// platform_settings.builder_outreach, in which case unblocked drafts go out
// here too, capped per UK day.
//
// THE TRIGGER MOVED FROM 'Ballpark agreed' TO 'Viewing booked' (2026-08-21).
//
// It had stopped firing entirely, and not because anything here was broken:
// it was watching a door nobody uses any more. On 20 August the process
// changed so that CALL ONE books the builder and names no figure (Hugo: "we
// will book the builder call one and we won't fetch prices or ballpark"). The
// script, the live coach, the after-call review and the 5:30 report all moved
// with it. This cron did not, so it kept waiting for a ballpark to be agreed,
// which is the step that had just been removed.
//
// Measured the morning it was noticed: 'Ballpark agreed' held ZERO branches
// and had all day, while 'Viewing booked' held four that Pedro had put there
// himself. One viewing had ever reached a builder, on 19 August, by hand.
//
// SAFE AGAINST THE CONFIRM PRESS, which is the obvious worry now the trigger
// and the destination are the same column: confirming a builder moves the card
// to 'Viewing booked' where it already is, and drafting is idempotent by the
// unique (property_id, builder_id) key, so a card sitting in the column is
// swept every five minutes and nothing happens twice.
//
// A cron rather than hooks in property-outcome/cockpit-action, because a
// plain board DRAG never touches a server endpoint, and Places latency does
// not belong inside Pedro's outcome press. Idempotency is structural:
// builder_scraped_at blocks a re-scrape, the unique (property_id, builder_id)
// key blocks a re-draft, so a card leaving and re-entering the column does
// nothing twice.
//
// Node (req,res) runtime on purpose, like deal-sweep.ts: the edge Request
// shape throws at runtime here.

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import { outcodeOf } from '../lib/brrr-deal-facts.js';
import { scrapeBuildersWidening, upsertScrapedBuilders } from '../lib/builder-scrape.js';
import { raiseQuery } from '../lib/ops-query.js';
import {
  loadOutreachSettings, draftOutreachForProperty, sendOutreachRow, sentToday,
  VIEWING_BOOKED_COLUMN,
} from '../lib/builder-outreach.js';
import { notifyBuilderEvent, builderNotifyRecipients } from '../lib/builder-notify.js';

export const config = { maxDuration: 60 };

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
  );

  const out = {
    contacts: 0, scraped: 0, drafted: 0, autoSent: 0,
    scrapeEmpty: 0, needsTime: 0, errors: [] as string[],
  };

  try {
    const settings = await loadOutreachSettings(sb);

    // The property pipeline is found the way every reader finds it: by column
    // name. VIEWING_BOOKED_COLUMN rather than a second copy of the string,
    // because confirmBuilder already owns that name and the two must never
    // drift apart: this sweep reads the column the confirm press writes to.
    const { data: col } = await sb
      .from('wk_pipeline_columns').select('id').eq('name', VIEWING_BOOKED_COLUMN)
      .limit(1).maybeSingle();
    const colId = (col as { id?: string } | null)?.id;
    if (!colId) {
      res.statusCode = 200;
      res.end(JSON.stringify({ ...out, note: `no ${VIEWING_BOOKED_COLUMN} column` }));
      return;
    }

    const { data: contacts } = await sb
      .from('wk_contacts').select('id').eq('pipeline_column_id', colId).limit(100);
    const contactIds = ((contacts ?? []) as Array<{ id: string }>).map((c) => c.id);
    out.contacts = contactIds.length;

    const admins = await builderNotifyRecipients(sb);

    for (const contactId of contactIds) {
      const { data: props } = await sb
        .from('brrr_properties')
        // deal + qualification are here for the floor gate: a draft must not be
        // written for a house whose vendor has already turned down more than
        // our ceiling.
        .select('id, source_property_id, address, viewing_address, viewing_at, wk_contact_id, builder_scraped_at, deal, qualification, pinned_note, asking_price')
        .eq('wk_contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(10);
      // THE MEASURED DISCOUNT, fetched alongside, because a discovery house
      // has no valuation at all: call one books the builder and fetches no
      // ballpark, so brrr_properties.deal is {} on exactly the houses that
      // now reach this sweep first. wk_raw_leads.discount is the only proof
      // they carry, and without it the gate below refuses every one of them.
      const { data: rawLeads } = await sb
        .from('wk_raw_leads')
        .select('property_id, discount')
        .in('property_id', ((props ?? []) as Array<{ source_property_id?: string }>)
          .map((p) => String((p as { source_property_id?: string }).source_property_id ?? ''))
          .filter(Boolean));
      const discountOf = new Map(
        ((rawLeads ?? []) as Array<{ property_id: string; discount: number | null }>)
          .map((r) => [String(r.property_id), r.discount]),
      );
      const rows = (props ?? []) as Array<{
        id: string; address: string | null; viewing_address: string | null; viewing_at: string | null;
        source_property_id?: string | null;
        wk_contact_id: string | null; builder_scraped_at: string | null;
        deal: Record<string, unknown> | null;
        qualification: Record<string, unknown> | null;
        pinned_note: string | null;
        asking_price: number | null;
      }>;
      if (!rows.length) continue;
      // The deal being viewed is the one with the viewing; otherwise the
      // newest filing for this branch.
      const property = rows.find((p) => p.viewing_at) ?? rows[0];

      const oc = outcodeOf(String(property.address ?? ''));
      if (!oc) {
        if (!property.builder_scraped_at) {
          await (sb.from('brrr_properties') as never as {
            update(v: Record<string, unknown>): { eq(k: string, v: string): PromiseLike<unknown> };
          }).update({ builder_scraped_at: new Date().toISOString() }).eq('id', property.id);
          out.scrapeEmpty += 1;
          await notifyBuilderEvent(sb, {
            kind: 'builder_scrape_empty', agentIds: admins, contactId,
            title: 'No postcode on this house, no builders found',
            body: `${String(property.address ?? 'A property')} has no readable outcode, so no builders could be searched. Add one on /admin/builders by hand.`,
            link: `/admin/crm/contacts/${contactId}`,
          });
        }
        continue;
      }

      const firstPass = !property.builder_scraped_at;
      if (firstPass) {
        // Stamp FIRST: a Places outage must not turn into a re-scrape loop
        // that spends the budget every five minutes.
        await (sb.from('brrr_properties') as never as {
          update(v: Record<string, unknown>): { eq(k: string, v: string): PromiseLike<unknown> };
        }).update({ builder_scraped_at: new Date().toISOString() }).eq('id', property.id);
        try {
          // WIDENS WHEN THE DOORSTEP IS EMPTY (Hugo, 2026-08-22: "if you don't
          // find in this exact location, expand a bit further"). 10km, then
          // 20, then 40, stopping at the first radius that finds anybody. The
          // radius that worked is recorded on the house, because an outcode
          // that needed 40km is worth knowing next time.
          const scraped = await scrapeBuildersWidening(oc, {
            startRadiusM: settings.radius_m, cap: settings.max_new_builders,
          });
          const applied = await upsertScrapedBuilders(sb, oc, scraped.builders, settings.max_new_builders);
          out.scraped += applied.inserted + applied.extended;
          if (scraped.radiusM) {
            await (sb.from('brrr_properties') as never as {
              update(v: Record<string, unknown>): { eq(k: string, v: string): PromiseLike<unknown> };
            }).update({ builder_scrape_radius_m: scraped.radiusM }).eq('id', property.id);
          }
        } catch (e) {
          out.errors.push(`scrape ${oc}: ${String(e).slice(0, 120)}`);
        }
      }

      const drafted = await draftOutreachForProperty(
        sb,
        { ...property, discount: discountOf.get(String(property.source_property_id ?? '')) ?? null },
        settings,
      );
      out.drafted += drafted.drafted;

      // NOBODY CAN BE INVITED TO A VIEWING WITH NO TIME ON IT, AND THAT USED
      // TO HAPPEN IN SILENCE.   (2026-08-21)
      //
      // Pedro booked two viewings that morning and pressed Viewing booked on
      // both. He did not fill in the date box, which is a second step in the
      // call room and easy to miss on a call that has just ended. So the sweep
      // ran, scraped the builders, wrote eight drafts, and blocked every one of
      // them on no_viewing_time. Nothing said a word: Hugo found it by looking
      // at the board and asking where his leads had gone.
      //
      // The date is the ONE thing here a machine should not invent. A guessed
      // day sends a real builder to a real house on the wrong afternoon, which
      // is worse than not sending him. So the fix is not to extract it, it is
      // to stop the silence: ask the person who took the call.
      //
      // Once per property, keyed on builder_scraped_at like the empty-roster
      // notice, so a card parked in the column does not nag every five minutes.
      if (drafted.matched && !String(property.viewing_at ?? '').trim() && firstPass) {
        out.needsTime += 1;
        await notifyBuilderEvent(sb, {
          kind: 'builder_needs_viewing_time', agentIds: admins, contactId,
          title: 'A viewing with no time on it, so no builder can be invited',
          body: `${String(property.address ?? 'A property')} is in Viewing booked and ${drafted.matched} builder(s) are ready, but nothing can be sent until the date and time are on the house. Add them on the call card.`,
          link: `/admin/crm/contacts/${contactId}`,
        });
        // AND ON WHATSAPP, because the bell was already ringing on 21 August
        // and Hugo still found this by looking at the board himself. A bell is
        // a thing you have to be looking at; this is the missing fact going to
        // the two people who can supply it.
        await raiseQuery({
          sb, kind: 'viewing_time_missing', propertyId: property.id,
          subject: String(property.address ?? 'a property'),
          question:
            `${String(property.address ?? 'A property')} is in Viewing booked and ${drafted.matched} ${drafted.matched === 1 ? 'builder is' : 'builders are'} ready to be invited, `
            + 'but nobody wrote down the date. What day and time is the viewing, UK time? Reply here and I will send the invites.',
        });
      }
      if (firstPass && !drafted.matched) {
        // Even after the scrape nobody on the roster covers this outcode.
        // Told once, on the pass that scraped, not every five minutes.
        out.scrapeEmpty += 1;
        await notifyBuilderEvent(sb, {
          kind: 'builder_scrape_empty', agentIds: admins, contactId,
          title: `No builders found for ${oc}`,
          body: `${String(property.address ?? 'A property')} is in ${VIEWING_BOOKED_COLUMN} but no builder covers ${oc} and the Google search found none with a UK mobile. Add one on /admin/builders by hand.`,
          link: '/admin/builders',
        });
        // The search widened to 40km and still found nobody, so there is
        // nothing left for the machine to try. That is a fact for a person,
        // not a quieter retry.
        await raiseQuery({
          sb, kind: 'no_builder_for_viewing', propertyId: property.id,
          subject: String(property.address ?? oc),
          question:
            `${String(property.address ?? 'A property')} has a viewing but I cannot find a single builder near ${oc}, `
            + 'even searching 40km out. Do you know anyone who covers that area? Reply with a name and number and I will invite them.',
        });
      }

      if (settings.auto_send) {
        const already = await sentToday(sb);
        if (already >= settings.daily_cap) continue;
        const { data: sendable } = await sb
          .from('brrr_builder_outreach')
          .select('id')
          .eq('property_id', property.id)
          .eq('status', 'draft')
          .is('blocked_reason', null)
          .limit(settings.daily_cap - already);
        for (const rowRef of ((sendable ?? []) as Array<{ id: string }>)) {
          const sent = await sendOutreachRow(sb, rowRef.id);
          if (sent.ok) out.autoSent += 1;
          else if (sent.error) out.errors.push(`send ${rowRef.id}: ${sent.error.slice(0, 120)}`);
        }
      }
    }

    res.statusCode = 200;
    res.end(JSON.stringify(out));
  } catch (e) {
    out.errors.push(String(e).slice(0, 200));
    res.statusCode = 500;
    res.end(JSON.stringify(out));
  }
}
