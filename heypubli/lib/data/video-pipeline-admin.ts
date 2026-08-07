// Server-side loader for /admin/videos: everything Hugo sees on the approval
// page in one shape. Read-only; the actions live in lib/actions/video-pipeline.

import { createAdminClient } from "@/lib/supabase/admin";
import {
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

export interface PipelineMasterView extends MasterVideo {
  rendersReady: number;
  rendersTotal: number;
  postsScheduled: number;
  postsPublished: number;
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
        .select("master_video_id, status")
        .not("master_video_id", "is", null) as Promise<{
        data: Array<{ master_video_id: string; status: string }> | null;
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

  const masters: PipelineMasterView[] = ((mastersRes.data ?? []) as MasterVideo[]).map((m) => ({
    ...m,
    rendersReady: renders.filter((r) => r.master_id === m.id && r.status === "ready").length,
    rendersTotal: renders.filter((r) => r.master_id === m.id).length,
    postsScheduled: posts.filter((p) => p.master_video_id === m.id && p.status === "pending").length,
    postsPublished: posts.filter((p) => p.master_video_id === m.id && p.status === "published")
      .length,
  }));

  const connRows = (connsRes.data ?? []) as Array<{
    profile_id: string;
    ig_username: string | null;
  }>;
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
