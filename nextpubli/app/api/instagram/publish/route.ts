import { NextResponse } from "next/server";
import { markPostPublished, markPostFailed } from "@/lib/data/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createMediaContainer,
  checkContainerStatus,
  publishMedia,
} from "@/lib/integrations/instagram";
import {
  getUploadUrl,
  confirmUpload,
  createPost,
  getPostStatus,
} from "@/lib/integrations/outstand";
import {
  getOutstandConnection,
  getPostingSettingsAdmin,
  saveOutstandPostId,
} from "@/lib/data/outstand";
import type { PostMediaType, ScheduledPost } from "@/types/database";

// Publishing many accounts in one run can exceed the default function duration
// (Outstand processing is polled per post). Unfinished posts stay pending and are
// picked up by the next 15-min run without duplicating (see publishViaOutstand).
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const { data: posts } = await supabase
    .from("scheduled_posts")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .returns<ScheduledPost[]>();

  if (!posts || posts.length === 0) {
    return NextResponse.json({ published: 0, results: [] });
  }

  const postingSettings = await getPostingSettingsAdmin();
  const results: { id: string; status: string }[] = [];

  // Posts belonging to suspended influencers never publish.
  const { data: suspendedProfiles } = await supabase
    .from("profiles")
    .select("id")
    .in("id", [...new Set(posts.map((p) => p.profile_id))])
    .not("suspended_at", "is", null);
  const suspendedIds = new Set(
    ((suspendedProfiles as { id: string }[] | null) ?? []).map((p) => p.id),
  );

  for (const post of posts) {
    const provider =
      (post as ScheduledPost & { provider?: string }).provider ?? "heypubli";

    if (suspendedIds.has(post.profile_id)) {
      await markPostFailed(post.id, "Conta suspensa");
      results.push({ id: post.id, status: "failed: conta suspensa" });
      continue;
    }

    try {
      if (provider === "outstand") {
        await publishViaOutstand(post, postingSettings?.outstand_api_key ?? null);
      } else {
        await publishViaMeta(post, supabase);
      }
      results.push({ id: post.id, status: "published" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      await markPostFailed(post.id, message);
      results.push({ id: post.id, status: `failed: ${message}` });
    }
  }

  return NextResponse.json({
    published: results.filter((r) => r.status === "published").length,
    results,
  });
}

// --- Meta Graph API path (existing logic, unchanged) ---

async function publishViaMeta(
  post: ScheduledPost,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
) {
  const { data: connection } = await supabase
    .from("instagram_connections")
    .select("*")
    .eq("profile_id", post.profile_id)
    .eq("is_connected", true)
    .single();

  if (!connection) {
    throw new Error("Instagram não conectado");
  }

  const containerParams = buildContainerParams(
    post.media_type,
    post.media_url,
    post.caption,
    connection.ig_user_id,
    connection.access_token,
  );

  const { id: containerId } = await createMediaContainer(containerParams);
  await waitForContainer(containerId, connection.access_token);
  const { id: igMediaId } = await publishMedia(
    connection.ig_user_id,
    containerId,
    connection.access_token,
  );

  await markPostPublished(post.id, igMediaId);
}

// --- Outstand.so path ---

async function publishViaOutstand(post: ScheduledPost, apiKey: string | null) {
  if (!apiKey) {
    throw new Error("Outstand API key não configurada");
  }

  // A previous run may have created the Outstand post but died before recording the
  // result (timeout/crash). Never create a duplicate — resolve the existing one.
  if (post.outstand_post_id) {
    const status = await waitForOutstandPost(apiKey, post.outstand_post_id);
    const accountStatus = status.socialAccounts[0];
    if (accountStatus?.status === "failed") {
      throw new Error(accountStatus.error || "Outstand publish failed");
    }
    await markPostPublished(
      post.id,
      accountStatus?.platformPostId || post.outstand_post_id,
    );
    return;
  }

  const connection = await getOutstandConnection(post.profile_id);
  if (!connection) {
    throw new Error("Outstand não conectado");
  }

  const mediaIds = await uploadMediaToOutstand(apiKey, post.media_url, post.media_type);

  const isStory = post.media_type === "story_image" || post.media_type === "story_video";
  const options = isStory ? null : post.instagram_options; // stories take media only

  const instagram: NonNullable<Parameters<typeof createPost>[1]["instagram"]> = {};
  if (isStory) instagram.publishAsStory = true;
  if (options?.collaborators?.length) instagram.collaborators = options.collaborators;
  if (post.media_type === "reel" && options?.reel_cover_seconds != null) {
    instagram.reelThumbOffset = Math.round(options.reel_cover_seconds * 1000);
  }

  const outstandPost = await createPost(apiKey, {
    content: post.caption,
    mediaIds,
    socialAccountIds: [connection.outstand_social_account_id],
    instagram: Object.keys(instagram).length > 0 ? instagram : undefined,
    firstComment: options?.first_comment,
  });

  await saveOutstandPostId(post.id, outstandPost.id);

  const status = await waitForOutstandPost(apiKey, outstandPost.id);
  const accountStatus = status.socialAccounts[0];

  if (accountStatus?.status === "failed") {
    throw new Error(accountStatus.error || "Outstand publish failed");
  }

  await markPostPublished(post.id, accountStatus?.platformPostId || outstandPost.id);
}

async function uploadMediaToOutstand(
  apiKey: string,
  mediaUrl: string,
  mediaType: PostMediaType,
): Promise<string[]> {
  const ext = guessExtension(mediaUrl, mediaType);
  const contentType = guessContentType(mediaType);
  const filename = `post_${Date.now()}.${ext}`;

  const { id: mediaId, upload_url } = await getUploadUrl(apiKey, filename, contentType);

  const mediaResponse = await fetch(mediaUrl);
  if (!mediaResponse.ok) throw new Error("Falha ao baixar mídia");
  const buffer = await mediaResponse.arrayBuffer();

  const uploadRes = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: buffer,
  });
  if (!uploadRes.ok) throw new Error("Falha no upload da mídia");

  await confirmUpload(apiKey, mediaId);

  return [mediaId];
}

async function waitForOutstandPost(apiKey: string, postId: string, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const status = await getPostStatus(apiKey, postId);
    const accountStatus = status.socialAccounts[0]?.status;

    if (accountStatus === "published") return status;
    if (accountStatus === "failed") return status;

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Outstand post processing timeout");
}

function guessExtension(url: string, mediaType: PostMediaType): string {
  const urlExt = url.split(".").pop()?.split("?")[0]?.toLowerCase();
  if (urlExt && ["jpg", "jpeg", "png", "webp", "gif", "mp4", "mov"].includes(urlExt)) {
    return urlExt;
  }
  if (mediaType === "story_video" || mediaType === "reel") return "mp4";
  return "jpg";
}

function guessContentType(mediaType: PostMediaType): string {
  if (mediaType === "story_video" || mediaType === "reel") return "video/mp4";
  return "image/jpeg";
}

// --- Shared Meta helpers (unchanged) ---

function buildContainerParams(
  mediaType: PostMediaType,
  mediaUrl: string,
  caption: string,
  igUserId: string,
  token: string,
) {
  const base = { igUserId, token, caption };

  switch (mediaType) {
    case "feed":
      return { ...base, imageUrl: mediaUrl };
    case "story_image":
      return { ...base, imageUrl: mediaUrl, mediaType: "STORIES" as const };
    case "story_video":
      return { ...base, videoUrl: mediaUrl, mediaType: "STORIES" as const };
    case "reel":
      return { ...base, videoUrl: mediaUrl, mediaType: "REELS" as const };
    case "carousel":
      return { ...base, imageUrl: mediaUrl };
  }
}

async function waitForContainer(containerId: string, token: string, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const { status_code } = await checkContainerStatus(containerId, token);
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") {
      throw new Error(`Container ${status_code}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Container processing timeout");
}
