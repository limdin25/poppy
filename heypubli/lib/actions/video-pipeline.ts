"use server";

// Admin actions for the creator video pipeline. The approval action is the
// single gate Hugo asked for: "show me the video and which accounts gonna go
// for and for me to authorize." Nothing renders for creators and nothing is
// scheduled until approveMaster runs.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "creator-videos";

const ALLOWED: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single<{ is_admin: boolean }>();
  if (!profile?.is_admin) throw new Error("Access denied");
}

type ActionResult = { error: string } | { success: true };

/** Signed URL so the raw clip uploads browser-to-storage (100MB videos never
 *  touch a server body limit). Same shape as lib/actions/media.ts. */
export async function createVideoUploadUrl(
  filename: string,
  contentType: string,
): Promise<{ path: string; token: string; publicUrl: string } | { error: string }> {
  await requireAdmin();
  const ext = ALLOWED[contentType];
  if (!ext) return { error: "Videos only: MP4 or MOV." };
  const slug = filename
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${slug ? `-${slug}` : ""}.${ext}`;
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? "Failed to create upload" };
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  return { path, token: data.token, publicUrl: pub.publicUrl };
}

/** An uploaded clip becomes the NEXT master in the sequence. The Mac worker
 *  ingests it, renders the preview Hugo watches, and flips it to
 *  pending_approval; until Hugo approves it, no account ever sees it. */
export async function createMasterFromUpload(
  publicUrl: string,
  title: string,
): Promise<ActionResult> {
  await requireAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: maxRow } = (await admin
    .from("master_videos")
    .select("seq")
    .order("seq", { ascending: false })
    .limit(1)) as { data: Array<{ seq: number }> | null };
  const seq = (maxRow?.[0]?.seq ?? 0) + 1;
  // Source ids share a namespace with the factory's originals (v1..v4); the
  // m-prefix keeps uploads from ever colliding with those.
  const sourceId = `m${Date.now().toString(36)}`;
  const { error } = await admin.from("master_videos").insert({
    seq,
    source_id: sourceId,
    title: title.trim() || `Video ${seq}`,
    caption: "",
    source_url: publicUrl,
    preview_url: null,
    status: "preview_rendering",
    approved_at: null,
    recipe_version: 8,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/videos");
  return { success: true };
}

/** THE authorization. After this, the cron queues one colored render per
 *  account and schedules the posts; the page shows the exact release times. */
export async function approveMaster(masterId: string): Promise<ActionResult> {
  await requireAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: m } = (await admin
    .from("master_videos")
    .select("status, preview_url")
    .eq("id", masterId)
    .single()) as { data: { status: string; preview_url: string | null } | null };
  if (!m) return { error: "Master not found" };
  if (m.status === "approved") return { success: true };
  if (!m.preview_url) return { error: "Preview is still rendering; approve once you can watch it." };
  const { error } = await admin
    .from("master_videos")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", masterId);
  if (error) return { error: error.message };
  revalidatePath("/admin/videos");
  return { success: true };
}

export async function updateMasterCaption(
  masterId: string,
  caption: string,
): Promise<ActionResult> {
  await requireAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { error } = await admin
    .from("master_videos")
    .update({ caption: caption.slice(0, 2200) })
    .eq("id", masterId);
  if (error) return { error: error.message };
  revalidatePath("/admin/videos");
  return { success: true };
}
