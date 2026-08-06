"use client";

import { useState, useTransition } from "react";
import { Send, CheckCircle, Info } from "lucide-react";
import { schedulePost } from "@/lib/actions/admin";
import { MediaUpload } from "@/components/media-upload";
import { SCHEDULING_TIMEZONES, DEFAULT_TIMEZONE } from "@/lib/timezone";
import type { PostingProvider } from "@/types/database";

interface BrandOption {
  id: string;
  name: string;
}

// Only influencers with a connected Instagram can be scheduled.
export interface SchedulerInfluencer {
  id: string;
  first_name: string;
  last_name: string;
  ig_username: string | null;
}

interface AdminSchedulerProps {
  influencers: SchedulerInfluencer[];
  brands: BrandOption[];
  activeProvider?: PostingProvider;
  defaultTimezone?: string;
}

const POST_TYPES = [
  { value: "feed", label: "Feed" },
  { value: "story_image", label: "Story (Image)" },
  { value: "story_video", label: "Story (Video)" },
  { value: "reel", label: "Reel" },
  { value: "carousel", label: "Carousel" },
] as const;

const STORY_TYPES = ["story_image", "story_video"];
const COLLAB_TYPES = ["feed", "reel", "carousel"];

export function AdminScheduler({
  influencers,
  brands,
  activeProvider,
  defaultTimezone = DEFAULT_TIMEZONE,
}: AdminSchedulerProps) {
  const [selectedInfluencers, setSelectedInfluencers] = useState<string[]>([]);
  const [postType, setPostType] = useState("feed");
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [caption, setCaption] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [mediaUrl, setMediaUrl] = useState("");
  const [collaborators, setCollaborators] = useState("");
  const [firstComment, setFirstComment] = useState("");
  const [reelCoverSeconds, setReelCoverSeconds] = useState("");
  const [isPending, startTransition] = useTransition();
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isStory = STORY_TYPES.includes(postType);
  const allowsCollabs = COLLAB_TYPES.includes(postType);

  const toggleInfluencer = (id: string) => {
    setSelectedInfluencers((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  };

  const selectAll = () => {
    setSelectedInfluencers(
      selectedInfluencers.length === influencers.length
        ? []
        : influencers.map((i) => i.id),
    );
  };

  const handleSchedule = () => {
    if (selectedInfluencers.length === 0) {
      setError("Select at least one creator");
      return;
    }
    if (!brandId) {
      setError("Select a brand");
      return;
    }
    if (!isStory && !caption.trim()) {
      setError("Write a caption");
      return;
    }
    if (!scheduledAt) {
      setError("Select a date and time");
      return;
    }
    if (!mediaUrl.trim()) {
      setError(
        "Upload the media or enter a URL, the post cannot be published without media",
      );
      return;
    }

    setError(null);
    const formData = new FormData();
    formData.set("influencer_ids", selectedInfluencers.join(","));
    formData.set("brand_id", brandId);
    formData.set("media_type", postType);
    formData.set("media_url", mediaUrl);
    formData.set("caption", caption);
    formData.set("scheduled_at", scheduledAt);
    formData.set("timezone", timezone);
    if (allowsCollabs && collaborators.trim()) {
      formData.set("collaborators", collaborators);
    }
    if (!isStory && firstComment.trim()) {
      formData.set("first_comment", firstComment);
    }
    if (postType === "reel" && reelCoverSeconds.trim()) {
      formData.set("reel_cover_seconds", reelCoverSeconds);
    }

    startTransition(async () => {
      try {
        await schedulePost(formData);
        setSuccess(true);
        setSelectedInfluencers([]);
        setCaption("");
        setScheduledAt("");
        setMediaUrl("");
        setCollaborators("");
        setFirstComment("");
        setReelCoverSeconds("");
        setTimeout(() => setSuccess(false), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not schedule");
      }
    });
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Scheduler</h1>
        {activeProvider && (
          <span className="rounded-full bg-background-secondary px-2 py-0.5 text-[10px] text-foreground-secondary">
            {activeProvider === "outstand" ? "Outstand" : "HeyPubli"}
          </span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Select creators</h2>
            <button onClick={selectAll} className="text-xs text-accent hover:underline">
              {selectedInfluencers.length === influencers.length
                ? "Deselect all"
                : "Select all"}
            </button>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {influencers.map((inf) => (
              <label
                key={inf.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-background-secondary"
              >
                <input
                  type="checkbox"
                  checked={selectedInfluencers.includes(inf.id)}
                  onChange={() => toggleInfluencer(inf.id)}
                  className="rounded border-border"
                />
                <span className="text-sm">
                  {`${inf.first_name} ${inf.last_name}`.trim() || inf.ig_username}
                </span>
                {inf.ig_username && (
                  <span className="text-xs text-foreground-secondary">
                    @{inf.ig_username}
                  </span>
                )}
              </label>
            ))}
            {influencers.length === 0 && (
              <p className="text-sm text-foreground-secondary">
                No creators with Instagram connected. Only connected accounts
                show up here.
              </p>
            )}
          </div>
          <p className="mt-2 text-xs text-foreground-secondary">
            {selectedInfluencers.length} selected · only accounts with Instagram
            connected appear in this list
          </p>
        </section>

        <section className="rounded-xl border border-border p-6">
          <h2 className="mb-4 text-lg font-semibold">Post details</h2>
          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-foreground-secondary">
                Brand
              </label>
              <select
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
                className="rounded-lg border border-border px-4 py-2.5 focus:border-accent focus:outline-none"
              >
                {brands.length === 0 && <option value="">No brands</option>}
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-foreground-secondary">
                Post type
              </label>
              <select
                value={postType}
                onChange={(e) => setPostType(e.target.value)}
                className="rounded-lg border border-border px-4 py-2.5 focus:border-accent focus:outline-none"
              >
                {POST_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-foreground-secondary">
                Media
              </label>
              <MediaUpload onUploaded={setMediaUrl} />
              <input
                type="url"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder="or paste the media URL: https://..."
                className="mt-1 rounded-lg border border-border px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
              />
            </div>

            {isStory ? (
              <div className="flex items-start gap-2 rounded-lg bg-background-secondary px-4 py-3 text-xs text-foreground-secondary">
                <Info size={14} className="mt-0.5 shrink-0" />
                <span>
                  Stories via the official Instagram API accept only the media (9:16
                  image or video). Captions, links, stickers, polls and music are not
                  allowed by Meta for any tool.
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-foreground-secondary">
                  Caption
                </label>
                <textarea
                  rows={3}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Write the post caption..."
                  className="rounded-lg border border-border px-4 py-2.5 focus:border-accent focus:outline-none resize-none"
                />
              </div>
            )}

            {allowsCollabs && (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-foreground-secondary">
                  Collaborators (up to 3, comma separated)
                </label>
                <input
                  type="text"
                  value={collaborators}
                  onChange={(e) => setCollaborators(e.target.value)}
                  placeholder="@brand, @profile2"
                  className="rounded-lg border border-border px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
                />
              </div>
            )}

            {!isStory && (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-foreground-secondary">
                  First comment (optional)
                </label>
                <textarea
                  rows={2}
                  value={firstComment}
                  onChange={(e) => setFirstComment(e.target.value)}
                  placeholder="Comment published automatically after the post"
                  className="rounded-lg border border-border px-4 py-2.5 text-sm focus:border-accent focus:outline-none resize-none"
                />
              </div>
            )}

            {postType === "reel" && (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-foreground-secondary">
                  Reel cover (second of the video, optional)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={reelCoverSeconds}
                  onChange={(e) => setReelCoverSeconds(e.target.value)}
                  placeholder="e.g. 2.5"
                  className="rounded-lg border border-border px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
                />
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-foreground-secondary">
                  Date and time
                </label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="rounded-lg border border-border px-4 py-2.5 focus:border-accent focus:outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-foreground-secondary">
                  Timezone
                </label>
                <select
                  aria-label="Timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="rounded-lg border border-border px-4 py-2.5 focus:border-accent focus:outline-none"
                >
                  {SCHEDULING_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>
      </div>

      {error && (
        <div className="rounded-lg bg-error/10 px-4 py-3 text-sm text-error">{error}</div>
      )}

      {success && (
        <div className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3 text-sm text-success">
          <CheckCircle size={16} />
          Post(s) scheduled successfully!
        </div>
      )}

      <div className="flex items-center gap-4">
        <button
          onClick={handleSchedule}
          disabled={isPending}
          className="flex items-center gap-2 rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          <Send size={16} />
          {isPending ? "Scheduling..." : "Schedule post"}
        </button>
      </div>
    </div>
  );
}
