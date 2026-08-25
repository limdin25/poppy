// Find builders for a house, and talk to them. Pedro's desk, not an admin one.
//
// Hugo, 2026-08-24: "we select the property and then he finds builders in the
// area ... and then he can click and say send message and then it shows the
// opener message ... we see the log, we see everything, how many numbers for
// that property."
//
// WHY THIS EXISTS SEPARATELY FROM api/admin/builder-outreach.ts. That route is
// gated on the `admin_users` table, and Pedro is not in it, so the cockpit's
// builder panel has always been silently blank for the one person who needs
// it (BuilderOutreachPanel.tsx says so in as many words). This route carries
// the same gate every other press Pedro already makes uses, the
// `wk_is_agent_or_admin` RPC, and calls the SAME lib functions, so there is a
// second door and not a second implementation. Settings stay admin-only and
// live in api/admin/builder-settings.ts.
//
// WHAT THE LIVE DATA SAID WHEN THIS WAS WRITTEN, and why the house number is
// the first thing on the page rather than a detail: eight viewings booked,
// eleven builders replied, two confirmed. Seven of the eight houses had no
// `viewing_address`, so builders answered "What number Oxford gardens is it
// and I will book it in the diary" and the thread died with us promising to
// come back. The one house that HAD a number is the one that confirmed.
//
// NODE, NOT EDGE: the send path reaches Twilio through sendOutreachRow, which
// uses Buffer for basic auth. Same reason and same adapter shape as
// api/admin/builder-outreach.ts.

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import {
  loadOutreachSettings,
  blockedReasonFor,
  builderFacingAddress,
  viewingTimeLabel,
  sentToday,
  nextRadiusM,
  draftOutreachForProperty,
  sendOutreachRow,
  floorRefusalFor,
  VIEWING_BOOKED_COLUMN,
  type OutreachProperty,
  type OutreachSettings,
} from '../lib/builder-outreach.js';
import { matchBuildersForOutcode, type BuilderRow } from '../lib/builder-match.js';
import {
  isUkMobile,
  WIDENING_RADII_M,
  scrapeBuildersWidening,
  scrapeBuildersForOutcode,
  upsertScrapedBuilders,
  planRosterChanges,
  scrapeLogLines,
} from '../lib/builder-scrape.js';
import { outcodeOf } from '../lib/brrr-deal-facts.js';
import { addressIsExact, addressFromAnswer } from '../lib/builder-brain.js';
import { answerQuery } from '../lib/ops-query.js';

export const config = { maxDuration: 60 };

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** The same gate as api/crm/book-viewing.ts: a CRM agent or an admin. */
async function requireAgent(req: Request): Promise<{ id: string; email: string } | Response> {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: userResp } = await sb.auth.getUser(jwt);
  if (!userResp?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const caller = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return Response.json({ error: 'CRM access required' }, { status: 403 });
  return { id: userResp.user.id, email: userResp.user.email ?? '' };
}

interface PropertyRow {
  id: string;
  address: string | null;
  viewing_address: string | null;
  viewing_at: string | null;
  viewing_notes: string | null;
  wk_contact_id: string | null;
  source_property_id: string | null;
  assigned_builder_id: string | null;
  builder_scraped_at: string | null;
  builder_scrape_radius_m: number | null;
  asking_price: number | null;
  deal: Record<string, unknown> | null;
  qualification: Record<string, unknown> | null;
  pinned_note: string | null;
}

const PROPERTY_COLUMNS =
  'id, address, viewing_address, viewing_at, viewing_notes, wk_contact_id, source_property_id,'
  + ' assigned_builder_id, builder_scraped_at, builder_scrape_radius_m, asking_price,'
  + ' deal, qualification, pinned_note';

/** The houses worth finding a builder for: anything with a viewing booked, plus
 *  anything whose branch has reached the Viewing booked column but has no time
 *  on it yet. The second half matters because a house with no `viewing_at` is
 *  exactly the one nobody has noticed, and it is invisible if you only look at
 *  the diary. Same trigger the sweep uses (api/cron/builder-outreach.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadHouses(sb: any): Promise<PropertyRow[]> {
  const byViewing = await sb
    .from('brrr_properties')
    .select(PROPERTY_COLUMNS)
    .not('viewing_at', 'is', null)
    .order('viewing_at', { ascending: true })
    .limit(200);

  const seen = new Map<string, PropertyRow>();
  for (const r of (byViewing.data ?? []) as PropertyRow[]) seen.set(r.id, r);

  const { data: col } = await sb
    .from('wk_pipeline_columns')
    .select('id')
    .eq('name', VIEWING_BOOKED_COLUMN)
    .limit(5);
  const columnIds = ((col ?? []) as Array<{ id: string }>).map((c) => c.id);
  if (columnIds.length) {
    const { data: contacts } = await sb
      .from('wk_contacts')
      .select('id')
      .in('pipeline_column_id', columnIds)
      .limit(200);
    const contactIds = ((contacts ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (contactIds.length) {
      const { data: more } = await sb
        .from('brrr_properties')
        .select(PROPERTY_COLUMNS)
        .in('wk_contact_id', contactIds)
        .limit(300);
      for (const r of (more ?? []) as PropertyRow[]) if (!seen.has(r.id)) seen.set(r.id, r);
    }
  }

  return [...seen.values()].sort((a, b) => {
    // Soonest viewing first, then the ones with no time at all, because those
    // are the ones nobody has looked at.
    if (a.viewing_at && b.viewing_at) return a.viewing_at.localeCompare(b.viewing_at);
    if (a.viewing_at) return -1;
    if (b.viewing_at) return 1;
    return String(a.address ?? '').localeCompare(String(b.address ?? ''));
  });
}

/** The measured discount off the local sold median, keyed by property. READ,
 *  never derived. It is the only proof a discovery house carries, because call
 *  one deliberately fetches no ballpark, so `deal` is {} on exactly the houses
 *  that reach a builder first and the block rules would refuse every one of
 *  them without it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadDiscounts(sb: any, rows: PropertyRow[]): Promise<Map<string, number | null>> {
  const ids = rows.map((r) => String(r.source_property_id ?? '')).filter(Boolean);
  if (!ids.length) return new Map();
  const { data } = await sb.from('wk_raw_leads').select('property_id, discount').in('property_id', ids);
  return new Map(
    ((data ?? []) as Array<{ property_id: string; discount: number | null }>)
      .map((r) => [String(r.property_id), r.discount] as const),
  );
}

function toOutreachProperty(r: PropertyRow, discount: number | null | undefined): OutreachProperty {
  return {
    id: r.id,
    address: r.address,
    viewing_address: r.viewing_address,
    viewing_at: r.viewing_at,
    wk_contact_id: r.wk_contact_id,
    deal: r.deal,
    qualification: r.qualification,
    pinned_note: r.pinned_note,
    asking_price: r.asking_price,
    discount: discount ?? null,
  };
}

interface OutreachRow {
  id: string;
  property_id: string;
  builder_id: string;
  contact_id: string | null;
  status: string;
  blocked_reason: string | null;
  sent_at: string | null;
  replied_at: string | null;
  confirmed_at: string | null;
  error: string | null;
}

const LIVE_STATUSES = new Set(['sent', 'replied', 'confirmed']);

async function handleWeb(req: Request): Promise<Response> {
  const who = await requireAgent(req);
  if (who instanceof Response) return who;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  if (req.method === 'GET') {
    const propertyId = new URL(req.url).searchParams.get('property_id') ?? '';
    const settings = await loadOutreachSettings(sb);
    const houses = await loadHouses(sb);
    if (!houses.length) return Response.json({ properties: [], settings });

    const discounts = await loadDiscounts(sb, houses);
    const { data: rosterRows } = await sb
      .from('brrr_builders')
      .select('id, name, phone, email, coverage, notes, active')
      .eq('active', true)
      .order('name');
    const roster = (rosterRows ?? []) as Array<BuilderRow & { notes: string | null; email: string | null }>;

    const { data: outreachRows } = await sb
      .from('brrr_builder_outreach')
      .select('id, property_id, builder_id, contact_id, status, blocked_reason, sent_at, replied_at, confirmed_at, error')
      .in('property_id', houses.map((h) => h.id));
    const byProperty = new Map<string, OutreachRow[]>();
    for (const r of (outreachRows ?? []) as OutreachRow[]) {
      const list = byProperty.get(r.property_id) ?? [];
      list.push(r);
      byProperty.set(r.property_id, list);
    }
    const builderNames = new Map(roster.map((b) => [b.id, b.name] as const));

    const summarise = (h: PropertyRow) => {
      const oc = outcodeOf(h.address);
      const covering = oc ? matchBuildersForOutcode(roster, oc) : [];
      const rows = byProperty.get(h.id) ?? [];
      const facing = builderFacingAddress(toOutreachProperty(h, discounts.get(String(h.source_property_id ?? ''))));
      return {
        id: h.id,
        address: h.address,
        outcode: oc,
        viewingAt: h.viewing_at,
        viewingLabel: h.viewing_at ? viewingTimeLabel(h.viewing_at) : null,
        builderFacingAddress: facing,
        houseNumberKnown: addressIsExact(facing),
        coveringCount: covering.length,
        mobileCount: covering.filter((b) => isUkMobile(b.phone)).length,
        invited: rows.filter((r) => LIVE_STATUSES.has(r.status)).length,
        replied: rows.filter((r) => r.replied_at).length,
        confirmed: rows.filter((r) => r.status === 'confirmed').length,
        declined: rows.filter((r) => r.status === 'declined').length,
        assignedBuilderName: h.assigned_builder_id ? builderNames.get(h.assigned_builder_id) ?? 'a builder' : null,
        scrapedAt: h.builder_scraped_at,
        radiusM: h.builder_scrape_radius_m,
      };
    };

    if (!propertyId) {
      return Response.json({ properties: houses.map(summarise), settings: publicSettings(settings) });
    }

    const house = houses.find((h) => h.id === propertyId);
    if (!house) return Response.json({ error: 'That house is not on the builder list.' }, { status: 404 });

    const discount = discounts.get(String(house.source_property_id ?? ''));
    const prop = toOutreachProperty(house, discount);
    const oc = outcodeOf(house.address);
    const covering = oc ? matchBuildersForOutcode(roster, oc) : [];
    const rows = byProperty.get(house.id) ?? [];
    const rowByBuilder = new Map(rows.map((r) => [r.builder_id, r] as const));

    return Response.json({
      property: {
        ...summarise(house),
        viewingNotes: house.viewing_notes,
        viewingAddress: house.viewing_address,
        assignedBuilderId: house.assigned_builder_id,
      },
      blockedReason: blockedReasonFor(prop, settings),
      builders: covering.map((b) => {
        const row = rowByBuilder.get(b.id);
        return {
          id: b.id,
          name: b.name,
          phone: b.phone,
          isMobile: isUkMobile(b.phone),
          coverage: b.coverage,
          notes: (b as { notes?: string | null }).notes ?? null,
          outreachId: row?.id ?? null,
          status: row?.status ?? null,
          blockedReason: row?.blocked_reason ?? null,
          contactId: row?.contact_id ?? null,
          sentAt: row?.sent_at ?? null,
          repliedAt: row?.replied_at ?? null,
          confirmedAt: row?.confirmed_at ?? null,
          error: row?.error ?? null,
        };
      }),
      settings: publicSettings(settings),
      sentToday: await sentToday(sb),
      nextRadiusM: nextRadiusM(house.builder_scrape_radius_m ?? settings.radius_m, WIDENING_RADII_M),
      log: await loadLog(sb, house.id),
    });
  }

  if (req.method === 'POST') {
    let body: {
      action?: string; property_id?: string; number?: string;
      builder_ids?: string[]; content_sid?: string;
      content_variables?: Record<string, string>;
    };
    try { body = await req.json() as typeof body; }
    catch { return Response.json({ error: 'bad json' }, { status: 400 }); }

    const propertyId = (body.property_id ?? '').trim();
    if (!propertyId) return Response.json({ error: 'property_id required' }, { status: 400 });

    if (body.action === 'set_house_number') {
      return setHouseNumber(sb, propertyId, body.number ?? '', who);
    }
    if (body.action === 'scrape' || body.action === 'widen') {
      return runScrape(sb, propertyId, body.action, who);
    }
    if (body.action === 'send') {
      return sendInvites(sb, propertyId, body.builder_ids ?? [],
        String(body.content_sid ?? ''), body.content_variables ?? {}, who);
    }

    return Response.json({ error: 'unknown action' }, { status: 400 });
  }

  return new Response('Method not allowed', { status: 405 });
}

/** THE THING THAT WAS ACTUALLY LOSING BOOKINGS.
 *
 *  Rightmove publishes no house number on the overwhelming majority of adverts,
 *  so an invite says "Oxford Gardens, Stafford" and the builder answers "what
 *  number is it and I will book it in the diary". Until now nothing in the
 *  product could write that number: the only writer was the overnight brain,
 *  reached by a human answering a WhatsApp question.
 *
 *  Two rules are load-bearing here:
 *
 *  1. It composes with addressFromAnswer, the SAME function the brain uses, so
 *     a number typed here and a number sent by WhatsApp produce byte-identical
 *     addresses. A second spelling of the same address is a second answer to
 *     "where is the viewing", and that is how a builder ends up on the wrong
 *     street.
 *  2. It writes `viewing_address` and NEVER `address`. draft-guards.ts and
 *     branch-email-match.ts both read the street as address.split(',')[0], so
 *     a leading "10, " would turn the street name into a house number for both.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function setHouseNumber(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  propertyId: string,
  typed: string,
  who: { id: string; email: string },
): Promise<Response> {
  const { data: house } = await sb
    .from('brrr_properties')
    .select('id, address, viewing_address, viewing_at')
    .eq('id', propertyId)
    .maybeSingle();
  if (!house) return Response.json({ error: 'That house is not on file.' }, { status: 404 });

  const full = addressFromAnswer(typed, String(house.address ?? ''));
  if (!full) {
    // "I will find out tomorrow" is not an address, and refusing is the whole
    // point: a wrong address sends a builder to the wrong house.
    return Response.json(
      { error: 'That does not contain a house number. Type the number, for example 10.' },
      { status: 400 },
    );
  }

  const { error } = await sb
    .from('brrr_properties')
    .update({ viewing_address: full, updated_at: new Date().toISOString() })
    .eq('id', propertyId);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // TELL THE BUILDERS WHO ALREADY ASKED, without writing a second sender.
  // If the brain raised a question for this house, answering it makes PASS 1
  // fan the address out to EVERY live builder on the house within a couple of
  // minutes, not just the one who asked. That is exactly the Oxford Gardens
  // case, where two builders asked the same question independently.
  const { data: open } = await sb
    .from('wk_ops_queries')
    .select('id')
    .eq('property_id', propertyId)
    .eq('kind', 'builder_needs_address')
    .eq('status', 'open')
    .limit(1)
    .maybeSingle();

  let waiting = 0;
  if (open?.id) {
    await answerQuery(sb, open.id, typed.trim(), who.email || 'crm');
    const { count } = await sb
      .from('brrr_builder_outreach')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId)
      .in('status', ['sent', 'replied', 'confirmed']);
    waiting = count ?? 0;
  }

  await sb.from('admin_audit_log').insert({
    admin_email: who.email,
    action: 'builder_house_number',
    target_type: 'brrr_property',
    metadata: { property_id: propertyId, address: full, told_builders: waiting },
  });

  return Response.json({
    ok: true,
    viewingAddress: full,
    // Honest about which of the two things happened. Never claim the builders
    // were told when no question was open to answer.
    told: waiting,
    message: waiting
      ? `Saved. The ${waiting} builder${waiting === 1 ? '' : 's'} already invited will be told in the next couple of minutes.`
      : 'Saved. Every invite from now on carries it.',
  });
}

/** Invite the builders Pedro ticked, with the template he chose.
 *
 *  WHY THE CHOSEN TEMPLATE IS NOT STORED ON THE DRAFT ROW AHEAD OF TIME.
 *  draftOutreachForProperty rewrites content_sid, content_variables and body on
 *  EVERY draft row on EVERY five-minute sweep, so a hand-picked template
 *  persisted onto a draft silently reverts within five minutes. That refresh is
 *  correct (a draft written before the viewing time was known must not keep an
 *  empty slot in it), so the choice travels in this request instead and is
 *  written in the same breath as the send.
 *
 *  THE ORDER BELOW IS THE SAFETY. The floor gate first, so a refused house
 *  refuses as one batch with one message rather than builder by builder. Then
 *  drafting, because a builder scraped thirty seconds ago has no outreach row
 *  and "select and send" would otherwise find nothing to send. Then the block
 *  is RE-DERIVED with the chosen template substituted, because blockedReasonFor
 *  returns template_pending against the settings template and clearing the
 *  reason outright would punch through the floor and discount gates too.
 *
 *  THE DAILY CAP IS ENFORCED HERE, which the manual path never did before. Only
 *  the two auto_send cron branches checked it, so one press could fire twenty
 *  cold WhatsApps at a roster of three builders and burn the number. */
async function sendInvites(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  propertyId: string,
  builderIds: string[],
  contentSid: string,
  contentVariables: Record<string, string>,
  who: { id: string; email: string },
): Promise<Response> {
  if (!builderIds.length) return Response.json({ error: 'Pick at least one builder.' }, { status: 400 });
  if (!/^HX[0-9a-f]{32}$/i.test(contentSid)) {
    return Response.json({ error: 'That message is not an approved WhatsApp template.' }, { status: 400 });
  }

  const refusal = await floorRefusalFor(sb, propertyId);
  if (refusal) return Response.json({ error: refusal }, { status: 409 });

  const settings = await loadOutreachSettings(sb);
  const already = await sentToday(sb);
  const room = Math.max(0, settings.daily_cap - already);
  if (builderIds.length > room) {
    return Response.json({
      error: room
        ? `Only ${room} more can go out today and you picked ${builderIds.length}.`
        : `Today's limit of ${settings.daily_cap} is used up. The rest can go tomorrow.`,
    }, { status: 429 });
  }

  const { data: houseRow } = await sb
    .from('brrr_properties').select(PROPERTY_COLUMNS).eq('id', propertyId).maybeSingle();
  if (!houseRow) return Response.json({ error: 'That house is not on file.' }, { status: 404 });
  const house = houseRow as PropertyRow;
  const discounts = await loadDiscounts(sb, [house]);
  const prop = toOutreachProperty(house, discounts.get(String(house.source_property_id ?? '')));

  // Materialise any missing rows, and bring ensureBuilderContact and the house
  // tag with them. Idempotent: existing rows are left alone.
  await draftOutreachForProperty(sb, prop, settings);

  const blocked = blockedReasonFor(prop, { ...settings, invite_sid: contentSid });
  if (blocked) {
    return Response.json({ error: `Blocked: ${blocked}.` }, { status: 409 });
  }

  const { data: rows } = await sb
    .from('brrr_builder_outreach')
    .select('id, builder_id, status')
    .eq('property_id', propertyId)
    .in('builder_id', builderIds);
  const rowByBuilder = new Map(
    ((rows ?? []) as Array<{ id: string; builder_id: string; status: string }>)
      .map((r) => [r.builder_id, r] as const),
  );
  const { data: names } = await sb.from('brrr_builders').select('id, name').in('id', builderIds);
  const nameOf = new Map(((names ?? []) as Array<{ id: string; name: string }>).map((b) => [b.id, b.name] as const));

  const results: Array<{ builderId: string; name: string; ok: boolean; error?: string }> = [];
  for (const builderId of builderIds) {
    const name = nameOf.get(builderId) ?? 'that builder';
    const row = rowByBuilder.get(builderId);
    if (!row) { results.push({ builderId, name, ok: false, error: 'No invite could be prepared.' }); continue; }

    await sb.from('brrr_builder_outreach')
      .update({
        content_sid: contentSid,
        content_variables: contentVariables,
        blocked_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .in('status', ['draft', 'approved']);

    const sent = await sendOutreachRow(sb, row.id);
    results.push({ builderId, name, ok: sent.ok, error: sent.ok ? undefined : sent.error });
  }

  const good = results.filter((r) => r.ok).length;
  await sb.from('admin_audit_log').insert({
    admin_email: who.email,
    action: 'builder_outreach_send',
    target_type: 'brrr_property',
    metadata: { property_id: propertyId, content_sid: contentSid, sent: good, tried: results.length },
  });

  return Response.json({
    ok: good > 0,
    sent: good,
    results,
    message: good === results.length
      ? `Sent to ${good} builder${good === 1 ? '' : 's'}.`
      : `Sent to ${good} of ${results.length}. The rest are listed below.`,
  });
}

/** Find builders near a house, or go out a ring and find more.
 *
 *  TWO PRESSES, ONE LADDER. `scrape` is the first search for a house that has
 *  never had one. `widen` is Hugo's "push for more" and steps the SAME ladder
 *  the overnight brain walks (10km, 20km, 40km), so a human pressing the button
 *  and the machine widening on its own cannot fight each other or double-spend.
 *
 *  THE ONCE-EVER GUARD IS KEPT, NOT BYPASSED. `builder_scraped_at` exists so a
 *  Google outage cannot make the five-minute cron re-spend on the same house
 *  forever. The first press owns the first search when the cron has not got
 *  there yet; going wider is a separate, deliberate press.
 *
 *  THE RADIUS IS STAMPED BEFORE THE SEARCH RUNS, which is the same anti-loop
 *  rule the cron states: if Places dies mid-call the house is marked as tried
 *  rather than becoming a spend that repeats on every refresh. */
async function runScrape(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  propertyId: string,
  action: 'scrape' | 'widen',
  who: { id: string; email: string },
): Promise<Response> {
  const settings = await loadOutreachSettings(sb);
  const { data: house } = await sb
    .from('brrr_properties')
    .select('id, address, builder_scraped_at, builder_scrape_radius_m')
    .eq('id', propertyId)
    .maybeSingle();
  if (!house) return Response.json({ error: 'That house is not on file.' }, { status: 404 });

  const oc = outcodeOf(house.address);
  if (!oc) {
    return Response.json(
      { error: 'This address has no postcode we can read, so there is nowhere to search around.' },
      { status: 400 },
    );
  }

  if (action === 'scrape' && house.builder_scraped_at) {
    const at = house.builder_scrape_radius_m ? `${Math.round(house.builder_scrape_radius_m / 1000)}km` : 'this area';
    return Response.json(
      { error: `This house has already been searched at ${at}. Press Find more to go out a ring.` },
      { status: 409 },
    );
  }

  const current = house.builder_scrape_radius_m ?? settings.radius_m;
  const next = action === 'widen' ? nextRadiusM(current, WIDENING_RADII_M) : null;
  if (action === 'widen' && !next) {
    // A real answer, said in words rather than an empty result.
    return Response.json({
      ok: true, found: 0, inserted: 0, extended: 0,
      log: [{ text: `We have searched 40km around ${oc} and there is nobody else. Add a builder by hand.` }],
      message: `We have searched as far as we go around ${oc}. Nobody else to find.`,
    });
  }

  // A human is waiting at the screen and asked for more names, so this press
  // reaches further down the paid tail than the cron's default.
  const cap = Math.max(settings.max_new_builders, 12);
  const maxDetailCalls = Math.min(2 * cap, 26);

  const radiusToStamp = action === 'widen' ? next! : settings.radius_m;
  await sb.from('brrr_properties').update({
    builder_scraped_at: new Date().toISOString(),
    builder_scrape_radius_m: radiusToStamp,
    updated_at: new Date().toISOString(),
  }).eq('id', propertyId);

  const result = action === 'widen'
    ? { builders: await scrapeBuildersForOutcode(oc, { radiusM: next!, cap, maxDetailCalls }), radiusM: next!, tried: [next!] }
    : await scrapeBuildersWidening(oc, { startRadiusM: settings.radius_m, cap, maxDetailCalls });

  if (result.radiusM && result.radiusM !== radiusToStamp) {
    await sb.from('brrr_properties')
      .update({ builder_scrape_radius_m: result.radiusM })
      .eq('id', propertyId);
  }

  const { data: existing } = await sb.from('brrr_builders').select('id, phone, coverage');
  const plan = planRosterChanges(
    (existing ?? []) as Array<{ id: string; phone: string | null; coverage: string[] }>,
    result.builders, oc, cap,
  );
  const applied = await upsertScrapedBuilders(sb, oc, result.builders, cap);
  const log = scrapeLogLines({
    outcode: oc,
    tried: result.tried,
    radiusM: result.radiusM,
    scraped: result.builders,
    plan,
    mobiles: result.builders.filter((b) => isUkMobile(b.phoneE164)).length,
  });

  await sb.from('admin_audit_log').insert({
    admin_email: who.email,
    action: 'builder_scrape',
    target_type: 'brrr_property',
    metadata: {
      property_id: propertyId, outcode: oc, tried: result.tried, radius_m: result.radiusM,
      found: result.builders.length, inserted: applied.inserted, extended: applied.extended,
      lines: log.map((l) => l.text),
    },
  });

  return Response.json({
    ok: true,
    found: result.builders.length,
    inserted: applied.inserted,
    extended: applied.extended,
    radiusM: result.radiusM,
    log,
  });
}

/** The settings a non-admin may see. The four Twilio SIDs are not secrets, but
 *  they are also not Pedro's business, and `invite_sid` is the only one this
 *  page needs in order to know whether a template is wired up at all. */
function publicSettings(s: OutreachSettings) {
  return {
    radius_m: s.radius_m,
    max_new_builders: s.max_new_builders,
    daily_cap: s.daily_cap,
    auto_send: s.auto_send,
    invite_sid: s.invite_sid,
  };
}

/** The log lives in admin_audit_log, which already carries every other builder
 *  press, so there is no new table to keep in step. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadLog(sb: any, propertyId: string) {
  const { data } = await sb
    .from('admin_audit_log')
    .select('action, admin_email, metadata, created_at')
    .in('action', ['builder_scrape', 'builder_outreach_send', 'builder_outreach_confirm', 'builder_assign', 'builder_house_number'])
    .contains('metadata', { property_id: propertyId })
    .order('created_at', { ascending: false })
    .limit(60);
  return (data ?? []) as Array<{
    action: string; admin_email: string | null;
    metadata: Record<string, unknown> | null; created_at: string;
  }>;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(',') : String(v);
  }
  const out = await handleWeb(new Request(`http://internal${req.url ?? '/'}`, {
    method: req.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  }));
  res.statusCode = out.status;
  out.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await out.arrayBuffer()));
}
