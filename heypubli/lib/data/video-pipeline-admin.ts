// Server-side loader for /admin/videos: everything Hugo sees on the approval
// page in one shape. Read-only; the actions live in lib/actions/video-pipeline.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  composeCaption,
  creatorTimeZone,
  nextSlots,
  FAMILY_CHIP_HEX,
} from "@/lib/data/video-pipeline";
import type { CreatorVideoRender, CreatorVideoState, MasterVideo } from "@/types/database";

export interface PipelineCreatorView {
  profileId: string;
  igUsername: string;
  firstName: string;
  colorFamily: string;
  colorHex: string;
  timeZone: string;
  staggerMin: number;
  nextSeq: number;
  /** The account's next two release instants, ISO. */
  nextTimes: string[];
  enrolled: boolean;
}

/** One account's line under a master: who, their color, and exactly when
 *  their copy goes (or went) out. */
export interface MasterAccountRow {
  igUsername: string;
  colorFamily: string;
  colorHex: string;
  timeZone: string;
  /** The REAL scheduled instant once the post row exists, else null. */
  scheduledAt: string | null;
  state: "scheduled" | "published" | "failed" | "rendering" | "waiting";
  /** The exact words this account posts, hashtags and all. Read off the
   *  scheduled post once one exists (that text is frozen), otherwise composed
   *  the same way the cron will compose it, so the approval page never shows
   *  Hugo a caption different from the one that goes out. */
  caption: string;
}

export interface PipelineMasterView extends MasterVideo {
  rendersReady: number;
  rendersTotal: number;
  postsScheduled: number;
  postsPublished: number;
  /** Publishes that FAILED: without this Hugo has no aggregate view of a
   *  broken account and a master silently skipped for it. */
  postsFailed: number;
  /** Per-account release times, live from scheduled_posts. */
  accounts: MasterAccountRow[];
}

export interface PipelineOverview {
  masters: PipelineMasterView[];
  creators: PipelineCreatorView[];
  workerLastSeen: string | null;
  workerAlive: boolean;
}

export async function getVideoPipelineOverview(): Promise<PipelineOverview> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const now = new Date();

  const [mastersRes, statesRes, rendersRes, connsRes, profilesRes, stateRow, postsRes] =
    await Promise.all([
      admin.from("master_videos").select("*").order("seq"),
      admin.from("creator_video_state").select("*"),
      admin.from("creator_video_renders").select("master_id, profile_id, status"),
      admin
        .from("outstand_connections")
        .select("profile_id, ig_username, is_connected")
        .eq("is_connected", true),
      admin.from("profiles").select("id, first_name, whatsapp"),
      admin.from("video_pipeline_state").select("worker_last_seen").eq("id", "default").single(),
      admin
        .from("scheduled_posts")
        .select("master_video_id, profile_id, scheduled_at, status, caption")
        .not("master_video_id", "is", null) as Promise<{
        data: Array<{
          master_video_id: string;
          profile_id: string;
          scheduled_at: string;
          status: string;
          caption: string | null;
        }> | null;
      }>,
    ]);

  const states = (statesRes.data ?? []) as CreatorVideoState[];
  const stateBy = new Map(states.map((s) => [s.profile_id, s]));
  const profileRows = (profilesRes.data ?? []) as Array<{
    id: string;
    first_name: string | null;
    whatsapp: string | null;
  }>;
  const profileBy = new Map(profileRows.map((p) => [p.id, p]));
  const renders = (rendersRes.data ?? []) as Pick<
    CreatorVideoRender,
    "master_id" | "profile_id" | "status"
  >[];
  const posts = postsRes.data ?? [];

  const connRows = (connsRes.data ?? []) as Array<{
    profile_id: string;
    ig_username: string | null;
  }>;
  const usernameBy = new Map(connRows.map((c) => [c.profile_id, c.ig_username ?? "unknown"]));
  const enrolledOrdered = [...states].sort((a, b) => a.variant_idx - b.variant_idx);

  const masters: PipelineMasterView[] = ((mastersRes.data ?? []) as MasterVideo[]).map((m) => {
    const mine = posts.filter((p) => p.master_video_id === m.id);
    const postBy = new Map(mine.map((p) => [p.profile_id, p]));
    const myRenders = new Map(
      renders.filter((r) => r.master_id === m.id).map((r) => [r.profile_id, r.status]),
    );
    const accounts: MasterAccountRow[] = enrolledOrdered
      .filter((s) => usernameBy.has(s.profile_id))
      .map((s) => {
        const post = postBy.get(s.profile_id);
        const renderStatus = myRenders.get(s.profile_id);
        const profile = profileBy.get(s.profile_id);
        return {
          igUsername: usernameBy.get(s.profile_id) ?? "unknown",
          colorFamily: s.color_family,
          colorHex: FAMILY_CHIP_HEX[s.color_family] ?? "#888888",
          timeZone: creatorTimeZone(profile?.whatsapp),
          scheduledAt: post?.scheduled_at ?? null,
          caption: post?.caption?.trim() || composeCaption(m.seq, s.variant_idx, m.caption),
          state: post
            ? (post.status === "published"
                ? "published"
                : post.status === "failed"
                  ? "failed"
                  : "scheduled")
            : renderStatus === "ready"
              ? "waiting"
              : renderStatus
                ? "rendering"
                : "waiting",
        };
      });
    return {
      ...m,
      rendersReady: renders.filter((r) => r.master_id === m.id && r.status === "ready").length,
      rendersTotal: renders.filter((r) => r.master_id === m.id).length,
      postsScheduled: mine.filter((p) => p.status === "pending").length,
      postsPublished: mine.filter((p) => p.status === "published").length,
      postsFailed: mine.filter((p) => p.status === "failed").length,
      accounts,
    };
  });
  const creators: PipelineCreatorView[] = connRows.map((c) => {
    const s = stateBy.get(c.profile_id);
    const profile = profileBy.get(c.profile_id);
    const tz = creatorTimeZone(profile?.whatsapp);
    return {
      profileId: c.profile_id,
      igUsername: c.ig_username ?? "unknown",
      firstName: profile?.first_name ?? "",
      colorFamily: s?.color_family ?? "(assigned on the next cron beat)",
      colorHex: s ? (FAMILY_CHIP_HEX[s.color_family] ?? "#888888") : "#cccccc",
      timeZone: tz,
      staggerMin: s?.stagger_min ?? 0,
      nextSeq: s?.next_seq ?? 1,
      nextTimes: s ? nextSlots(now, tz, s.stagger_min, 2).map((x) => x.at.toISOString()) : [],
      enrolled: Boolean(s),
    };
  });

  const workerLastSeen = stateRow.data?.worker_last_seen ?? null;
  const workerAlive = Boolean(
    workerLastSeen && now.getTime() - Date.parse(workerLastSeen) < 120_000,
  );

  return { masters, creators, workerLastSeen, workerAlive };
}
