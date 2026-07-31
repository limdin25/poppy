"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "media";

// Instagram only accepts these (JPEG/PNG images; MP4/MOV video).
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single<{ is_admin: boolean }>();

  if (!profile?.is_admin) throw new Error("Acesso negado");
}

/**
 * Hands the browser a one-time signed URL so post media uploads straight to
 * Supabase Storage — no server body-size limits, works for 100MB videos.
 * Returns the public URL the post pipeline will download from at publish time.
 */
export async function createMediaUploadUrl(
  filename: string,
  contentType: string,
): Promise<{ path: string; token: string; publicUrl: string } | { error: string }> {
  await requireAdmin();

  const ext = ALLOWED[contentType];
  if (!ext) {
    return {
      error:
        "Formato não suportado. Use imagem JPG/PNG ou vídeo MP4/MOV (exigência do Instagram).",
    };
  }

  const slug = filename
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const path = `post-media/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${slug ? `-${slug}` : ""}.${ext}`;

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? "Falha ao criar upload" };

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  return { path, token: data.token, publicUrl: pub.publicUrl };
}
