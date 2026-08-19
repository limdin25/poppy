// The builder-outreach sweep. Every five minutes through the working day:
// find every branch card sitting in 'Ballpark agreed', scrape local builders
// for that house's outcode (once per property, ever), and draft the WhatsApp
// invites. Drafts wait for a human press unless auto_send is on in
// platform_settings.builder_outreach, in which case unblocked drafts go out
// here too, capped per UK day.
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
import { scrapeBuildersForOutcode, upsertScrapedBuilders } from '../lib/builder-scrape.js';
import {
  loadOutreachSettings, draftOutreachForProperty, sendOutreachRow, sentToday,
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
    scrapeEmpty: 0, errors: [] as string[],
  };

  try {
    const settings = await loadOutreachSettings(sb);

    // The property pipeline is found the way every reader finds it: the
    // column named 'Ballpark agreed'.
    const { data: col } = await sb
      .from('wk_pipeline_columns').select('id').eq('name', 'Ballpark agreed')
      .limit(1).maybeSingle();
    const colId = (col as { id?: string } | null)?.id;
    if (!colId) {
      res.statusCode = 200;
      res.end(JSON.stringify({ ...out, note: 'no Ballpark agreed column' }));
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
        .select('id, address, viewing_at, wk_contact_id, builder_scraped_at')
        .eq('wk_contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(10);
      const rows = (props ?? []) as Array<{
        id: string; address: string | null; viewing_at: string | null;
        wk_contact_id: string | null; builder_scraped_at: string | null;
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
          const scraped = await scrapeBuildersForOutcode(oc, {
            radiusM: settings.radius_m, cap: settings.max_new_builders,
          });
          const applied = await upsertScrapedBuilders(sb, oc, scraped, settings.max_new_builders);
          out.scraped += applied.inserted + applied.extended;
        } catch (e) {
          out.errors.push(`scrape ${oc}: ${String(e).slice(0, 120)}`);
        }
      }

      const drafted = await draftOutreachForProperty(sb, property, settings);
      out.drafted += drafted.drafted;
      if (firstPass && !drafted.matched) {
        // Even after the scrape nobody on the roster covers this outcode.
        // Told once, on the pass that scraped, not every five minutes.
        out.scrapeEmpty += 1;
        await notifyBuilderEvent(sb, {
          kind: 'builder_scrape_empty', agentIds: admins, contactId,
          title: `No builders found for ${oc}`,
          body: `${String(property.address ?? 'A property')} is in Ballpark agreed but no builder covers ${oc} and the Google search found none with a UK mobile. Add one on /admin/builders by hand.`,
          link: '/admin/builders',
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
