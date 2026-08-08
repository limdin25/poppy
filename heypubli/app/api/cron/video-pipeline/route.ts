// The creator video pipeline's conductor, every 15 minutes.
//
// Hugo, 07 Aug 2026: "every time an account gets signed up on our app, they
// receive the video... every account gets two videos per day... everyone gets
// on the same pipeline of videos in sequence... it cannot be in the same time."
//
// Three duties, in dependency order, all idempotent:
//   1. ENROLL: every connected Instagram account gets a permanent color (from
//      the factory's 14 families), a stagger offset and a look number the
//      moment it appears. Hugo chose ALL connected accounts, finished
//      onboarding or not.
//   2. QUEUE RENDERS: for each account, the next few APPROVED masters in the
//      sequence get a render row (master x profile unique, so re-runs are
//      no-ops). The Mac worker drains these.
//   3. SCHEDULE POSTS: while an account has fewer than two pipeline posts in
//      its own local day and the NEXT master in its sequence is approved and
//      rendered, create the scheduled_posts row at the next local slot
//      (11:00/19:00 + the account's stagger) and advance the pointer. The
//      existing /api/instagram/publish cron does the actual posting.
//
// Nothing here posts anything for a master Hugo has not approved on
// /admin/videos. That page is the authorization; this cron only executes it.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  composeCaption,
  creatorTimeZone,
  STAGGER_SLOTS,
  enrollmentOffsets,
  pickColorFamily,
  postsInLocalDay,
  todaySlots,
} from "@/lib/data/video-pipeline";
import type {
  CreatorVideoRender,
  CreatorVideoState,
  MasterVideo,
} from "@/types/database";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** How many masters ahead of an account's pointer to keep rendered. Two days
 *  of buffer at two posts a day. */
const RENDER_AHEAD = 4;

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
  const report = {
    enrolled: 0,
    rendersQueued: 0,
    postsScheduled: 0,
    waitingOnRenders: 0,
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
  const masterBySeq = new Map(approved.map((m) => [m.seq, m]));

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
  for (const s of stateBy.values()) {
    // A disconnected account renders nothing and schedules nothing; it picks
    // its sequence back up where it left off if the connection returns.
    if (!connectedIds.has(s.profile_id)) continue;
    for (let seq = s.next_seq; seq < s.next_seq + RENDER_AHEAD; seq++) {
      const m = masterBySeq.get(seq);
      if (!m) continue;
      if (renderByKey.has(`${m.id}:${s.profile_id}`)) continue;
      const { error } = await db.from("creator_video_renders").insert({
        master_id: m.id,
        profile_id: s.profile_id,
        color_family: s.color_family,
        // The worker recomputes and records the real seed; this is a
        // placeholder the row is born with.
        seed: "pending",
        status: "queued",
        attempts: 0,
        video_url: null,
        error: null,
        claimed_at: null,
        rendered_at: null,
      });
      if (error) {
        if (!error.message.includes("duplicate")) {
          report.errors.push(`queue m${seq} ${s.profile_id}: ${error.message}`);
        }
        continue;
      }
      renderByKey.set(`${m.id}:${s.profile_id}`, {
        master_id: m.id,
        profile_id: s.profile_id,
        status: "queued",
      } as CreatorVideoRender);
      report.rendersQueued++;
    }
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

  for (const s of stateBy.values()) {
    const profile = profileBy.get(s.profile_id);
    if (!profile || profile.suspended_at) continue;
    if (!connectedIds.has(s.profile_id)) continue;
    const tz = creatorTimeZone(profile.whatsapp);
    const mine = postsBy.get(s.profile_id) ?? [];
    const taken = takenInstants.get(s.profile_id) ?? new Set<number>();

    // Fill ONLY today's remaining local slots. Review proved the previous
    // "keep filling until two exist today" marched the sequence days ahead:
    // once today's slots were gone, every run scheduled two more on ever
    // later days while today's count never moved. Today-only is self-limiting
    // at two per day, and tomorrow's cron fills tomorrow.
    const open = todaySlots(now, tz, s.stagger_min).filter(
      (slot) => !taken.has(slot.at.getTime()),
    );
    for (const slot of open) {
      if (postsInLocalDay(now, tz, mine) >= 2) break;
      const m = masterBySeq.get(s.next_seq);
      if (!m) break; // sequence exhausted; Hugo uploads more
      const render = renderByKey.get(`${m.id}:${s.profile_id}`);
      if (!render || render.status !== "ready" || !render.video_url) {
        report.waitingOnRenders++;
        break;
      }
      const { error } = await db.from("scheduled_posts").insert({
        profile_id: s.profile_id,
        brand_id: brand.id,
        media_type: "reel",
        media_url: render.video_url,
        // Hugo's own caption on the master wins; otherwise every account gets
        // its own machine-written one, and either way its own 1 to 4 hashtags
        // (unique per account per video, Hugo, 08 Aug 2026: "every caption
        // should be unique"). This is the same function /admin/videos shows
        // him before he approves, so what he read is what goes out.
        caption: composeCaption(m.seq, s.variant_idx, m.caption),
        scheduled_at: slot.at.toISOString(),
        status: "pending",
        provider: "outstand",
        instagram_options: null,
        master_video_id: m.id,
      });
      if (error) {
        // The partial unique index (one post per master per account, ever)
        // turns the crashed-between-insert-and-advance case into this exact
        // error: the post EXISTS, only the pointer is stale. Treat it as
        // already-scheduled and advance, or the account stalls forever.
        if (!/duplicate|unique/i.test(error.message)) {
          report.errors.push(`schedule m${m.seq} ${s.profile_id}: ${error.message}`);
          break;
        }
      } else {
        mine.push(slot.at);
        postsBy.set(s.profile_id, mine);
        report.postsScheduled++;
      }
      const nextSeq = s.next_seq + 1;
      const { error: advErr } = await db
        .from("creator_video_state")
        .update({ next_seq: nextSeq })
        .eq("profile_id", s.profile_id);
      if (advErr) {
        report.errors.push(`advance ${s.profile_id}: ${advErr.message}`);
        break;
      }
      s.next_seq = nextSeq;
    }
  }

  return NextResponse.json({ ok: true, ...report });
}
