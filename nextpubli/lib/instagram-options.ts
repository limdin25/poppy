import type { InstagramPostOptions } from "@/types/database";

/**
 * Reads the optional Instagram fields from a post-composer form into the
 * jsonb shape stored on scheduled_posts / campaign_items. Returns null when
 * nothing was filled (the common case) so the column stays null.
 */
export function readInstagramOptions(formData: FormData): InstagramPostOptions | null {
  const options: InstagramPostOptions = {};

  const collaboratorsRaw = ((formData.get("collaborators") as string) || "").trim();
  if (collaboratorsRaw) {
    const collaborators = [
      ...new Set(
        collaboratorsRaw
          .split(",")
          .map((c) => c.trim().replace(/^@+/, ""))
          .filter(Boolean),
      ),
    ].slice(0, 3);
    if (collaborators.length > 0) options.collaborators = collaborators;
  }

  const firstComment = ((formData.get("first_comment") as string) || "").trim();
  if (firstComment) options.first_comment = firstComment;

  const coverRaw = ((formData.get("reel_cover_seconds") as string) || "").trim();
  if (coverRaw) {
    const seconds = Number(coverRaw);
    if (Number.isFinite(seconds) && seconds >= 0) options.reel_cover_seconds = seconds;
  }

  return Object.keys(options).length > 0 ? options : null;
}
