// The creator video pipeline's conductor, every 2 minutes.
//
// Hugo, 07 Aug 2026: "every time an account gets signed up on our app, they
// receive the video... everyone gets on the same pipeline of videos in
// sequence... it cannot be in the same time." And 09 Aug 2026: "we have to
// post three videos per day per account... as soon as the user connects, within
// five minutes we should post the first video, and then it gets on the queue
// for the day."
//
// The beat is 2 minutes rather than 15 for that last sentence alone: a new
// account has to be enrolled, rendered and scheduled while they are still
// looking at the screen, and four 15-minute waits stacked up made the first
// video anything up to an hour away.
//
// Three duties, in dependency order, all idempotent:
//   1. ENROLL: every connected Instagram account gets a permanent color (from
//      the factory's 14 families), a stagger offset and a look number the
//      moment it appears. Hugo chose ALL connected accounts, finished
//      onboarding or not.
//   2. QUEUE RENDERS: for each account, the next few APPROVED masters in the
//      sequence get a render row (master x profile unique, so re-runs are
//      no-ops). The render worker drains these.
//   3. SCHEDULE POSTS: while an account has fewer than the day's quota of
//      posts in its own local day and the NEXT master in its sequence is
//      approved and rendered, create the scheduled_posts row at the next local
//      slot (11:00/15:00/19:00 + the account's stagger, or RIGHT NOW if the
//      account has never posted) and advance the pointer. The existing
//      /api/instagram/publish cron does the actual posting.
//
// Nothing here posts anything for a master Hugo has not approved on
// /admin/videos. That page is the authorization; this cron only executes it.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  composeCaption,
  creatorTimeZone,
  postsPerDayFromEnv,
  staggerSecondsFor,
  masterIndexForCursor,
  advanceToPlayable,
  STAGGER_SLOTS,
  enrollmentOffsets,
  pickColorFamily,
  postsInLocalDay,
  rotationSlots,
} from "@/lib/data/video-pipeline";
import type {
  CreatorVideoRender,
  CreatorVideoState,
  MasterVideo,
} from "@/types/database";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** How many masters ahead of an account's pointer to keep built. Two days of
 *  buffer at whatever the dial is set to, capped so that turning the dial to
 *  fifty does not ask the worker for a hundred files per account in one tick. */
function renderAhead(postsPerDay: number): number {
  return Math.min(40, 2 * postsPerDay);
}

/**
 * WHAT ONE TICK IS ALLOWED TO DO.
 *
 * The conductor ran every 2 minutes against 18 accounts at 3 posts a day and
 * finished in a blink. At 108 accounts and a dial of 10 the same code tries
 * roughly two thousand inserts in one invocation, blows the 120 second function
 * limit, and dies having committed a random fraction of them: FUNCTION_
 * INVOCATION_TIMEOUT, no report, no idea how far it got.
 *
 * Budgets make a tick finish. Whatever is left is simply the next tick's work,
 * and there is another one in two minutes. Slower to fill, but it always
 * finishes and it always says what it did.
 */
const MAX_RENDER_INSERTS_PER_TICK = 60;
const MAX_POST_INSERTS_PER_TICK = 120;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  // The generated Database types have never matched this client (every table
  // resolves to `never`, which is why the whole repo casts its queries); one
  // cast here instead of ten below, with the result typed at each read.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;
  const now = new Date();
  // THE RAMP DIAL. Hugo moves 10 -> 20 -> 40 -> 50 by editing this one value in
  // Vercel, never by a deploy. An absent or nonsense value falls back to three.
  const postsPerDay = postsPerDayFromEnv(process.env.VIDEO_POSTS_PER_DAY);
  const report = {
    postsPerDay,
    enrolled: 0,
    rendersQueued: 0,
    postsScheduled: 0,
    waitingOnRenders: 0,
    // True when a budget stopped this tick early. Not an error: the next tick
    // picks it up. It IS worth seeing, because a tick that is always capped
    // means the fleet is growing faster than the cron can fill it.
    cappedRenders: false,
    cappedPosts: false,
    errors: [] as string[],
  };

  // The cast-through-any on filtered reads is the repo's convention for
  // supabase-js chains the generated types cannot follow.

  // ---- 1. ENROLL -----------------------------------------------------------
  const { data: connections } = (await db
    .from("outstand_connections")
    .select("profile_id, ig_username, is_connected")
    .eq("is_connected", true)) as {
    data: Array<{ profile_id: string; ig_username: string | null; is_connected: boolean }> | null;
  };
  const { data: states } = (await db.from("creator_video_state").select("*")) as {
    data: CreatorVideoState[] | null;
  };
  const stateBy = new Map((states ?? []).map((s) => [s.profile_id, s as CreatorVideoState]));

  const unenrolled = (connections ?? []).filter((c) => !stateBy.has(c.profile_id));
  for (const c of unenrolled) {
    const live = [...stateBy.values()];
    const taken = live.map((s) => s.color_family);
    const { staggerMin, variantIdx, exhausted } = enrollmentOffsets(
      live.map((s) => s.stagger_min),
      live.map((s) => s.variant_idx),
    );
    // Every posting minute is spoken for, so this account has to share one.
    // Enrolment still proceeds (refusing to onboard a creator is worse), but it
    // must never happen unnoticed: two accounts posting the same minute is the
    // clustering signal no visual variation can undo.
    if (exhausted) {
      report.errors.push(
        `enroll ${c.ig_username}: all ${STAGGER_SLOTS} posting minutes are taken, ` +
          `so this account shares minute ${staggerMin} with a live one. ` +
          `Widen the stagger window or move stagger_min to seconds.`,
      );
    }
    const row: CreatorVideoState = {
      profile_id: c.profile_id,
      color_family: pickColorFamily(taken),
      stagger_min: staggerMin,
      next_seq: 1,
      variant_idx: variantIdx,
      enrolled_at: now.toISOString(),
    };
    const { error } = await db.from("creator_video_state").insert(row);
    if (error) {
      report.errors.push(`enroll ${c.ig_username}: ${error.message}`);
      continue;
    }
    stateBy.set(c.profile_id, row);
    report.enrolled++;
  }

  // ---- 2. QUEUE RENDERS ----------------------------------------------------
  const { data: masters } = (await db
    .from("master_videos")
    .select("*")
    .eq("status", "approved")
    .order("seq")) as { data: MasterVideo[] | null };
  const approved = (masters ?? []) as MasterVideo[];

  // PAGED on purpose: PostgREST caps a response at 1000 rows and this table
  // grows by creators x masters forever; an unpaged read here silently
  // dropped ready renders in review's projection and stalled scheduling.
  const renders: CreatorVideoRender[] = [];
  for (let fromRow = 0; ; fromRow += 1000) {
    const { data: page } = (await db
      .from("creator_video_renders")
      .select("id, master_id, profile_id, status, video_url")
      .order("created_at")
      .range(fromRow, fromRow + 999)) as { data: CreatorVideoRender[] | null };
    renders.push(...(page ?? []));
    if (!page || page.length < 1000) break;
  }
  const renderByKey = new Map(renders.map((r) => [`${r.master_id}:${r.profile_id}`, r]));

  const connectedIds = new Set((connections ?? []).map((c) => c.profile_id));
  const renderRows: Record<string, unknown>[] = [];
  for (const s of stateBy.values()) {
    // A disconnected account renders nothing and schedules nothing; it picks
    // its sequence back up where it left off if the connection returns.
    if (!connectedIds.has(s.profile_id)) continue;
    if (renderRows.length >= MAX_RENDER_INSERTS_PER_TICK) {
      report.cappedRenders = true;
      break;
    }
    for (let seq = s.next_seq; seq < s.next_seq + renderAhead(postsPerDay); seq++) {
      if (renderRows.length >= MAX_RENDER_INSERTS_PER_TICK) {
        report.cappedRenders = true;
        break;
      }
      const idx = masterIndexForCursor(seq, approved.length);
      const m = idx === null ? undefined : approved[idx];
      if (!m) continue;
      const key = `${m.id}:${s.profile_id}`;
      if (renderByKey.has(key)) continue;
      renderRows.push({
        master_id: m.id,
        profile_id: s.profile_id,
        color_family: s.color_family,
        seed: "pending",
        status: "queued",
        attempts: 0,
        video_url: null,
        error: null,
        claimed_at: null,
        rendered_at: null,
      });
      renderByKey.set(key, { master_id: m.id, profile_id: s.profile_id, status: "queued" } as CreatorVideoRender);
    }
  }

  // ONE insert, not sixty. Every round trip to Supabase from a Vercel function
  // measured 1.4 to 3 seconds, so sixty sequential inserts alone blew the 120
  // second limit before a single post was scheduled.
  if (renderRows.length) {
    const { error } = await db
      .from("creator_video_renders")
      .upsert(renderRows, { onConflict: "master_id,profile_id", ignoreDuplicates: true });
    if (error) report.errors.push(`queue renders: ${error.message}`);
    else report.rendersQueued = renderRows.length;
  }

  // ---- 3. SCHEDULE POSTS ---------------------------------------------------
  const { data: brand } = (await db
    .from("brands")
    .select("id")
    .eq("name", "HeyPubli")
    .single()) as { data: { id: string } | null };
  if (!brand) {
    report.errors.push("HeyPubli brand missing");
    return NextResponse.json({ ok: false, ...report }, { status: 500 });
  }

  const { data: profiles } = (await db
    .from("profiles")
    .select("id, whatsapp, suspended_at")) as {
    data: Array<{ id: string; whatsapp: string | null; suspended_at: string | null }> | null;
  };
  const profileBy = new Map((profiles ?? []).map((p) => [p.id, p]));

  // Every pipeline post around today's window, per creator. Failed posts are
  // kept OUT of the day count (a failed publish must not eat one of the two
  // real posts) but their slot instants still block re-use of the same time.
  const since = new Date(now.getTime() - 36 * 3600_000).toISOString();
  const { data: pipelinePosts } = await db.from("scheduled_posts")
    .select("profile_id, scheduled_at, master_video_id, status")
    .not("master_video_id", "is", null)
    .gte("scheduled_at", since);
  const postsBy = new Map<string, Date[]>();
  const takenInstants = new Map<string, Set<number>>();
  for (const p of (pipelinePosts ?? []) as Array<{
    profile_id: string;
    scheduled_at: string;
    status: string;
  }>) {
    const at = new Date(p.scheduled_at);
    if (p.status !== "failed") {
      const list = postsBy.get(p.profile_id) ?? [];
      list.push(at);
      postsBy.set(p.profile_id, list);
    }
    const taken = takenInstants.get(p.profile_id) ?? new Set<number>();
    taken.add(at.getTime());
    takenInstants.set(p.profile_id, taken);
  }

  const postRows: Record<string, unknown>[] = [];
  const cursorMoved = new Map<string, number>();
  for (const s of stateBy.values()) {
    const profile = profileBy.get(s.profile_id);
    if (!profile || profile.suspended_at) continue;
    if (!connectedIds.has(s.profile_id)) continue;
    const tz = creatorTimeZone(profile.whatsapp);
    const mine = postsBy.get(s.profile_id) ?? [];
    const taken = takenInstants.get(s.profile_id) ?? new Set<number>();

    // next_seq only ever leaves 1 when a post has been scheduled, so this is
    // the account's "nothing has ever gone out" flag, and it is the one that
    // earns an immediate first video.
    const neverPosted = s.next_seq === 1;

    // Fill ONLY today's remaining local slots. Review proved the previous
    // "keep filling until the day is full" marched the sequence days ahead:
    // once today's slots were gone, every run scheduled more on ever later
    // days while today's count never moved. Today-only is self-limiting at
    // the day's quota, and tomorrow's cron fills tomorrow.
    // ROTATION, not a fixed grid. Hugo, 26 Aug 2026: "it doesn't matter when we
    // post, it just keep posting." Whatever is left of today's quota is spread
    // over the runway that actually remains, so an account never loses the part
    // of the day that had already gone by the time the dial was turned up.
    const doneToday = postsInLocalDay(now, tz, mine);
    const wanted = Math.max(0, postsPerDay - doneToday);
    const rotation = rotationSlots(now, tz, wanted, staggerSecondsFor(s.variant_idx));
    const open = (
      neverPosted ? [{ at: now, slot: "now" }, ...rotation.slice(1)] : rotation
    ).filter((slot) => !taken.has(slot.at.getTime()));
    if (postRows.length >= MAX_POST_INSERTS_PER_TICK) {
      report.cappedPosts = true;
      break;
    }
    for (const slot of open) {
      if (postRows.length >= MAX_POST_INSERTS_PER_TICK) {
        report.cappedPosts = true;
        break;
      }
      if (postsInLocalDay(now, tz, mine) >= postsPerDay) break;
      // Walk to the next position in the ring whose body is actually built.
      // Stopping at the cursor stranded the whole fleet behind one queued
      // render while 928 finished ones sat unused.
      const playable = advanceToPlayable(s.next_seq, approved.length, (i) => {
        const cand = approved[i];
        const r = cand ? renderByKey.get(`${cand.id}:${s.profile_id}`) : undefined;
        return !!r && r.status === "ready" && !!r.video_url;
      });
      if (!playable) {
        report.waitingOnRenders++;
        break;
      }
      const m = approved[playable.index];
      const render = renderByKey.get(`${m.id}:${s.profile_id}`)!;
      postRows.push({
        profile_id: s.profile_id,
        brand_id: brand.id,
        media_type: "reel",
        // The plain body render. The assembler worker overwrites this with the
        // finished file; if it never gets there, this still posts.
        media_url: render.video_url,
        // Hugo's own caption on the master wins; otherwise every account gets
        // its own machine-written one, and either way its own place tags plus
        // 1 to 4 general ones.
        caption: composeCaption(m.seq, s.variant_idx, m.caption),
        scheduled_at: slot.at.toISOString(),
        status: "pending",
        provider: "outstand",
        instagram_options: null,
        master_video_id: m.id,
      });
      mine.push(slot.at);
      postsBy.set(s.profile_id, mine);
      // The cursor moves past what was just used. A master skipped because it
      // was still rendering comes back round on the next lap.
      s.next_seq = playable.cursor + 1;
      cursorMoved.set(s.profile_id, s.next_seq);
    }
  }

  // Two bulk writes instead of two per post. At 1.4 to 3 seconds a round trip,
  // the per-post version could not finish a tick before the function died.
  if (postRows.length) {
    const { error } = await db.from("scheduled_posts").insert(postRows);
    if (error) report.errors.push(`schedule: ${error.message}`);
    else report.postsScheduled = postRows.length;
  }
  if (cursorMoved.size && !report.errors.length) {
    // Upsert rather than one UPDATE per account, same reason.
    const rows = [...cursorMoved.entries()].map(([profile_id, next_seq]) => {
      const st = stateBy.get(profile_id)!;
      return {
        profile_id,
        next_seq,
        color_family: st.color_family,
        stagger_min: st.stagger_min,
        variant_idx: st.variant_idx,
      };
    });
    const { error } = await db
      .from("creator_video_state")
      .upsert(rows, { onConflict: "profile_id" });
    if (error) report.errors.push(`advance cursors: ${error.message}`);
  }

  return NextResponse.json({ ok: true, ...report });
}
