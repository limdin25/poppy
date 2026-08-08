// Where a HeyPubli creator lead is on their onboarding, for the CRM inbox.
//
// THE DATA LIVES IN A DIFFERENT SUPABASE PROJECT. Elsie is loggyxryrhqsbtqpteog;
// the creator funnel is oouwidqeipibalkjubvw, a separate project with its own
// service key. The browser cannot reach it (no session there, and handing a
// second service key to a browser would be worse), so this route is the one
// door, and it is read-only.
//
// The join key is the phone number. HeyPubli profiles.whatsapp holds E.164,
// Elsie wk_contacts.phone holds E.164, and phoneKey() reduces both to digits so
// "+91 8207 324841" and "whatsapp:+918207324841" are one lead and not three.
//
// Every rule about the five steps lives in src/core/heypubli/journey.ts, which
// this route and the inbox both import. Nothing is re-derived here.

import { createClient } from '@supabase/supabase-js';
import {
  HEYPUBLI_STEPS,
  phoneKey,
  resolveJourneySteps,
  openStepOf,
  type JourneyProfile,
  type ProgressRow,
  type JourneyStep,
  type HeypubliStepId,
} from '../../src/core/heypubli/journey.js';

export const config = { runtime: 'edge' };

/** No more than this many contacts per call. The inbox asks only about its
 *  HeyPubli creator leads (125 of 5,656 contacts), and chunks at 200 on top of
 *  that, so this cap is a backstop and not something normal use ever meets. */
const MAX_PHONES = 300;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export interface JourneyResponseRow {
  profileId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  whatsapp: string | null;
  igUsername: string | null;
  signedUpAt: string;
  onboardingComplete: boolean;
  suspendedAt: string | null;
  steps: JourneyStep[];
  doneCount: number;
  totalSteps: number;
  allDone: boolean;
  openStep: HeypubliStepId | null;
  /** The freshest sign of life, which is what the nudge ladder counts from. */
  lastActivityAt: string;
  nudgeCount: number;
  lastNudgedAt: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
}

/** When the funnel next chases a PRE-SIGNUP lead, straight from the drip's own
 *  stamp (signup_leads.nurture_next_at), never recomputed here. Hugo,
 *  07 Aug 2026: "everyone deserves a follow-up... put a time when you're gonna
 *  follow up next, with the countdown, and if it's no more follow-up, write
 *  it." Creators with accounts are the nudge ladder's job; the client computes
 *  those from the journey row (nextTouch), so this is leads only. */
export interface ChaseRow {
  kind: 'drip' | 'stopped' | 'none';
  /** ISO time of the next automatic follow-up, when kind is 'drip'. */
  at: string | null;
  /** Why nothing more will ever be sent, when kind is 'stopped'. */
  reason: string | null;
}

/** Staff gate. Agents work this inbox, so it is agent-or-admin and not
 *  admin-only, exactly like the rest of /api/crm.
 *
 *  The client comes back with it. Every read that decides WHAT this caller may
 *  see has to go through that client and not the service role, or row-level
 *  security never gets a look in. Same shape as api/crm/site-flow.ts. */
async function caller(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data } = await client.auth.getUser();
  if (!data?.user) return null;
  const { data: staff } = await client.rpc('wk_is_agent_or_admin');
  if (!staff) return null;
  return { client, userId: data.user.id };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const who = await caller(req);
  if (!who) return json({ error: 'Unauthorized' }, 401);

  const url = process.env.HEYPUBLI_SUPABASE_URL;
  const key = process.env.HEYPUBLI_SERVICE_ROLE_KEY;
  // DEGRADE, DO NOT 500. Without the keys the inbox simply shows no journey
  // badges. A 500 here would break the whole conversation list over a missing
  // env var on a feature that is decoration for every non-creator lead.
  //
  // `ok: false` is the whole point of this answer. An empty `journeys` with no
  // flag reads exactly like "we checked and nobody has an account", and the
  // inbox rendered it as "they have not finished signing up" for every single
  // creator, because these vars are not set in production.
  if (!url || !key) {
    console.warn('[heypubli-journey] HEYPUBLI_SUPABASE_URL / _SERVICE_ROLE_KEY not set');
    return json({ ok: false, configured: false, journeys: {} });
  }

  let phones: string[] = [];
  try {
    const body = (await req.json()) as { phones?: unknown };
    phones = Array.isArray(body.phones) ? body.phones.map(String) : [];
  } catch {
    return json({ error: 'Bad request' }, 400);
  }

  const wanted = new Set(phones.map(phoneKey).filter(Boolean));
  if (wanted.size === 0) return json({ ok: true, configured: true, journeys: {} });
  if (wanted.size > MAX_PHONES) {
    return json({ error: `Too many phones (max ${MAX_PHONES})` }, 400);
  }

  // Both stored shapes. profiles.whatsapp and wk_contacts.phone are both E.164
  // with the plus, but a row saved without one must still be found.
  const shapes = (digits: string) => [`+${digits}`, digits];

  // WHOSE NUMBERS ARE THESE? Asked FIRST, and asked with the caller's own
  // token, so wk_contacts row-level security answers it: an admin sees every
  // lead, an agent sees the ones they own, are assigned, or have texted or
  // called. Anything else is dropped here and is never mentioned to HeyPubli.
  //
  // Without this the staff gate was the only lock, and the HeyPubli read runs
  // on a service-role key that ignores RLS entirely. A contractor agent could
  // post any list of numbers and get back creator names, emails, WhatsApp
  // numbers and Instagram handles for people they have no relationship with.
  const { data: mineRows, error: mineErr } = await who.client
    .from('wk_contacts')
    .select('phone')
    .in('phone', [...wanted].flatMap(shapes));
  if (mineErr) {
    console.error('[heypubli-journey] wk_contacts scope query failed', mineErr.message);
    return json({ ok: false, configured: true, journeys: {}, error: 'lookup failed' });
  }
  const allowed = new Set<string>();
  for (const r of (mineRows ?? []) as Array<{ phone: string | null }>) {
    const k = phoneKey(r.phone);
    if (k && wanted.has(k)) allowed.add(k);
  }
  if (allowed.size === 0) return json({ ok: true, configured: true, journeys: {} });

  const hp = createClient(url, key, { auth: { persistSession: false } });

  const variants = [...allowed].flatMap(shapes);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profileRows, error: profErr } = await (hp.from('profiles') as any)
    .select(
      'id, first_name, last_name, email, whatsapp, ig_username, created_at, onboarding_complete, suspended_at, community_joined_declared_at, photo_declared_at, bio_link_declared_at, skool_affiliate_url',
    )
    .in('whatsapp', variants);
  if (profErr) {
    console.error('[heypubli-journey] profiles query failed', profErr.message);
    return json({ ok: false, configured: true, journeys: {}, error: 'lookup failed' });
  }

  // The next-chase answer for pre-signup leads. Read alongside profiles so a
  // phone with only a lead row still gets an answer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: chaseLeads } = await (hp.from('signup_leads') as any)
    .select('whatsapp, whatsapp_e164, profile_id, nurture_state, nurture_next_at, nurture_stop_reason, whatsapp_opted_out_at, chase_next_at, chase_count')
    .or(
      [...allowed]
        .flatMap((d) => [
          `whatsapp.eq.+${d}`,
          `whatsapp.eq.${d}`,
          `whatsapp_e164.eq.+${d}`,
          `whatsapp_e164.eq.${d}`,
        ])
        .join(','),
    )
    .limit(600);
  const chase: Record<string, ChaseRow> = {};
  for (const l of (chaseLeads ?? []) as Array<{
    whatsapp: string | null;
    whatsapp_e164: string | null;
    profile_id: string | null;
    nurture_state: string | null;
    nurture_next_at: string | null;
    nurture_stop_reason: string | null;
    whatsapp_opted_out_at: string | null;
    chase_next_at: string | null;
    chase_count: number | null;
  }>) {
    let row: ChaseRow;
    if (l.whatsapp_opted_out_at) row = { kind: 'stopped', at: null, reason: 'they opted out' };
    else if (l.nurture_state === 'blocked')
      row = { kind: 'stopped', at: null, reason: l.nurture_stop_reason ?? 'refused' };
    else if (l.nurture_state === 'active' && l.nurture_next_at)
      row = { kind: 'drip', at: l.nurture_next_at, reason: null };
    // The reply brain's own chase for answered no-account leads (08 Aug
    // 2026). Stamped by heypubli's reply-runner; read BEFORE the exhausted
    // verdict because a lead who replied after exhausting the drip is back
    // in a conversation and IS being chased again.
    else if (l.chase_next_at) row = { kind: 'drip', at: l.chase_next_at, reason: null };
    else if (l.nurture_state === 'exhausted')
      row = { kind: 'stopped', at: null, reason: 'every automatic follow-up went out, no reply' };
    else if ((l.chase_count ?? 0) > 0 && l.nurture_state === 'stopped' && !l.nurture_next_at)
      row = { kind: 'none', at: null, reason: 'chased, waiting on them' };
    else row = { kind: 'none', at: null, reason: l.nurture_stop_reason };
    for (const p of [l.whatsapp_e164, l.whatsapp]) {
      const k = phoneKey(p);
      if (k && allowed.has(k) && !chase[k]) chase[k] = row;
    }
  }

  type ProfileRow = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    whatsapp: string | null;
    ig_username: string | null;
    created_at: string;
    onboarding_complete: boolean | null;
    suspended_at: string | null;
    community_joined_declared_at: string | null;
    photo_declared_at: string | null;
    bio_link_declared_at: string | null;
    skool_affiliate_url: string | null;
  };
  const profiles = (profileRows ?? []) as ProfileRow[];
  // Lead-only phones (no account yet) still carry their chase answer.
  if (profiles.length === 0) return json({ ok: true, configured: true, journeys: {}, chase });

  const ids = profiles.map((p) => p.id);

  // Instagram comes from outstand_connections. NEVER instagram_connections,
  // which is empty and always has been, and which once had us telling Hugo a
  // connected creator was not connected.
  const [connRes, progRes, nudgeRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (hp.from('outstand_connections') as any)
      .select('profile_id, ig_username, is_connected')
      .in('profile_id', ids),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (hp.from('onboarding_progress') as any)
      .select('profile_id, step, first_seen_at, completed_at')
      .in('profile_id', ids),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (hp.from('onboarding_nudge_state') as any)
      .select('profile_id, nudge_count, last_nudged_at, stopped_at, stop_reason')
      .in('profile_id', ids),
  ]);

  const connBy = new Map<string, { ig_username: string | null; is_connected: boolean }>();
  for (const c of (connRes.data ?? []) as Array<{
    profile_id: string;
    ig_username: string | null;
    is_connected: boolean;
  }>) {
    connBy.set(c.profile_id, { ig_username: c.ig_username, is_connected: Boolean(c.is_connected) });
  }

  const progBy = new Map<string, ProgressRow[]>();
  for (const r of (progRes.data ?? []) as Array<ProgressRow & { profile_id: string }>) {
    const list = progBy.get(r.profile_id) ?? [];
    list.push({ step: r.step, first_seen_at: r.first_seen_at, completed_at: r.completed_at });
    progBy.set(r.profile_id, list);
  }

  const nudgeBy = new Map<
    string,
    { nudge_count: number; last_nudged_at: string | null; stopped_at: string | null; stop_reason: string | null }
  >();
  for (const n of (nudgeRes.data ?? []) as Array<{
    profile_id: string;
    nudge_count: number | null;
    last_nudged_at: string | null;
    stopped_at: string | null;
    stop_reason: string | null;
  }>) {
    nudgeBy.set(n.profile_id, {
      nudge_count: n.nudge_count ?? 0,
      last_nudged_at: n.last_nudged_at,
      stopped_at: n.stopped_at,
      stop_reason: n.stop_reason,
    });
  }

  const journeys: Record<string, JourneyResponseRow> = {};
  for (const p of profiles) {
    const key = phoneKey(p.whatsapp);
    if (!key || !allowed.has(key)) continue;
    const conn = connBy.get(p.id) ?? null;
    const progress = progBy.get(p.id) ?? [];

    const profile: JourneyProfile = {
      id: p.id,
      firstName: p.first_name,
      lastName: p.last_name,
      email: p.email,
      whatsapp: p.whatsapp,
      igUsername: conn?.ig_username ?? p.ig_username ?? null,
      igConnected: Boolean(conn?.is_connected),
      createdAt: p.created_at,
      onboardingComplete: Boolean(p.onboarding_complete),
      suspendedAt: p.suspended_at,
      communityJoinedDeclaredAt: p.community_joined_declared_at,
      photoDeclaredAt: p.photo_declared_at,
      bioLinkDeclaredAt: p.bio_link_declared_at,
      skoolAffiliateUrl: p.skool_affiliate_url,
    };

    const steps = resolveJourneySteps(profile, progress);
    const doneCount = steps.filter((s) => s.done).length;
    const nudge = nudgeBy.get(p.id) ?? {
      nudge_count: 0,
      last_nudged_at: null,
      stopped_at: null,
      stop_reason: null,
    };

    // The same "freshest sign of life" the nudge brain counts from: the
    // account's birth, plus every step stamp we have.
    const lastActivityAt =
      [p.created_at, ...progress.flatMap((r) => [r.first_seen_at, r.completed_at])]
        .filter((x): x is string => Boolean(x))
        .sort()
        .at(-1) ?? p.created_at;

    journeys[key] = {
      profileId: p.id,
      firstName: p.first_name,
      lastName: p.last_name,
      email: p.email,
      whatsapp: p.whatsapp,
      igUsername: profile.igUsername,
      signedUpAt: p.created_at,
      onboardingComplete: Boolean(p.onboarding_complete),
      suspendedAt: p.suspended_at,
      steps,
      doneCount,
      totalSteps: HEYPUBLI_STEPS.length,
      allDone: doneCount === HEYPUBLI_STEPS.length,
      openStep: openStepOf(steps),
      lastActivityAt,
      nudgeCount: nudge.nudge_count,
      lastNudgedAt: nudge.last_nudged_at,
      stoppedAt: nudge.stopped_at,
      stopReason: nudge.stop_reason,
    };
  }

  return json({ ok: true, configured: true, journeys, chase });
}
