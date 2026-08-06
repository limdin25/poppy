import { createAdminClient } from "@/lib/supabase/admin";
import { downloadAttachment } from "@/lib/integrations/unipile";
import type { InboxContentType } from "@/types/database";

const BUCKET = "media";

export function detectContentType(mimeType: string): InboxContentType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

export function fileExtFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "video/mp4": "mp4",
    "application/pdf": "pdf",
  };
  return map[mime] || mime.split("/")[1] || "bin";
}

export async function downloadAndStoreAttachment(
  messageId: string,
  attachmentId: string,
  conversationId: string,
): Promise<{ url: string; contentType: InboxContentType; mimeType: string } | null> {
  const result = await downloadAttachment(messageId, attachmentId);
  if (!result) return null;

  const ext = fileExtFromMime(result.contentType);
  const path = `${conversationId}/${messageId}_${attachmentId}.${ext}`;

  const admin = createAdminClient();
  const { error } = await admin.storage.from(BUCKET).upload(path, result.buffer, {
    contentType: result.contentType,
    upsert: true,
  });

  if (error) {
    console.error("[storage] upload error:", error.message);
    return null;
  }

  const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl(path);

  return {
    url: urlData.publicUrl,
    contentType: detectContentType(result.contentType),
    mimeType: result.contentType,
  };
}
