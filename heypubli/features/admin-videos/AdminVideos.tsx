"use client";

// Hugo's authorization page. His words, 07 Aug 2026: "show me a place where on
// my app it shows the video and which accounts gonna go for and for me to
// authorize... give me a place where I can upload them... it should show us
// when I approve what time is gonna be released."
//
// Three blocks: the render worker's pulse, the master sequence (watch, caption,
// APPROVE), and the accounts (their color, their clock, their next two release
// times). Everything downstream is automatic; this page is the only gate.

import { useRef, useState, useTransition } from "react";
import { CheckCircle, Clock, Loader2, ShieldCheck, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  approveMaster,
  createMasterFromUpload,
  createVideoUploadUrl,
  updateMasterCaption,
} from "@/lib/actions/video-pipeline";
import type { PipelineOverview } from "@/lib/data/video-pipeline-admin";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function fmtWhen(iso: string, timeZone: string): string {
  const d = new Date(iso);
  const local = d.toLocaleString("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${local} their time`;
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  preview_rendering: { text: "RENDERING PREVIEW", cls: "bg-amber-100 text-amber-800" },
  pending_approval: { text: "WAITING FOR YOUR APPROVAL", cls: "bg-blue-100 text-blue-800" },
  approved: { text: "APPROVED, IN THE SEQUENCE", cls: "bg-green-100 text-green-800" },
  failed: { text: "UPLOAD FAILED, TRY ANOTHER FILE", cls: "bg-red-100 text-red-800" },
};

export function AdminVideos({ overview }: { overview: PipelineOverview }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [captions, setCaptions] = useState<Record<string, string>>({});

  const onUpload = async (file: File) => {
    setError(null);
    if (file.size > MAX_VIDEO_BYTES) {
      setError("Videos up to 100MB (Instagram's own limit).");
      return;
    }
    setUploading(true);
    try {
      const r = await createVideoUploadUrl(file.name, file.type);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from("creator-videos")
        .uploadToSignedUrl(r.path, r.token, file);
      if (upErr) {
        setError(`Upload failed: ${upErr.message}`);
        return;
      }
      const created = await createMasterFromUpload(r.publicUrl, title);
      if ("error" in created) setError(created.error);
      else window.location.reload();
    } finally {
      setUploading(false);
    }
  };

  const act = (fn: () => Promise<{ error: string } | { success: true }>) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if ("error" in r) setError(r.error);
      else window.location.reload();
    });
  };

  return (
    <div className="p-6 max-w-5xl space-y-8" data-testid="admin-videos">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Video pipeline</h1>
          <p className="text-sm text-foreground-secondary mt-1">
            Every account walks the same sequence, two posts a day, in its own color. Nothing goes
            out until you approve it here.
          </p>
        </div>
        <div
          className={`flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full ${
            overview.workerAlive ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
          }`}
          data-testid="worker-pulse"
        >
          <span
            className={`w-2 h-2 rounded-full ${overview.workerAlive ? "bg-green-600" : "bg-red-600"}`}
          />
          {overview.workerAlive
            ? "Render worker alive"
            : overview.workerLastSeen
              ? `Render worker QUIET since ${new Date(overview.workerLastSeen).toLocaleTimeString("en-GB")}`
              : "Render worker has never checked in"}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm" data-testid="videos-error">
          {error}
        </div>
      )}

      {/* Upload the next master */}
      <section className="border border-border rounded-xl p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Upload className="w-4 h-4" /> Add the next video in the sequence
        </h2>
        <p className="text-xs text-foreground-secondary">
          Drop the raw clip. The factory gives every account its own colored copy; you approve the
          preview before anything is scheduled.
        </p>
        <div className="flex gap-2 flex-wrap items-center">
          <input
            type="text"
            placeholder="Title (for you, not posted)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="border border-border rounded-lg px-3 py-2 text-sm w-64"
            data-testid="upload-title"
          />
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/quicktime"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Reset so picking the SAME file after a failure fires again.
              e.target.value = "";
              if (f) void onUpload(f);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold disabled:opacity-50"
            data-testid="upload-button"
          >
            {uploading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Uploading
              </span>
            ) : (
              "Upload video"
            )}
          </button>
        </div>
      </section>

      {/* The sequence */}
      <section className="space-y-4">
        <h2 className="font-semibold">The sequence ({overview.masters.length} videos)</h2>
        {overview.masters.length === 0 && (
          <p className="text-sm text-foreground-secondary">
            No masters yet. The first four are being seeded.
          </p>
        )}
        {overview.masters.map((m) => {
          const st = STATUS_LABEL[m.status] ?? STATUS_LABEL.preview_rendering;
          return (
            <div
              key={m.id}
              className="border border-border rounded-xl p-4 flex gap-4 flex-wrap"
              data-testid={`master-${m.seq}`}
            >
              <div className="w-40 flex-shrink-0">
                {m.preview_url ? (
                  <video
                    src={m.preview_url}
                    controls
                    preload="metadata"
                    className="w-40 rounded-lg bg-black aspect-[9/16] object-contain"
                  />
                ) : (
                  <div className="w-40 aspect-[9/16] rounded-lg bg-neutral-100 flex items-center justify-center text-xs text-foreground-secondary">
                    rendering...
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-[260px] space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-lg font-bold">#{m.seq}</span>
                  <span className="font-medium">{m.title || `Video ${m.seq}`}</span>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${st.cls}`}>
                    {st.text}
                  </span>
                </div>
                <div className="text-xs text-foreground-secondary flex items-center gap-4 flex-wrap">
                  <span>
                    Colored copies: {m.rendersReady}/{overview.creators.length} rendered
                  </span>
                  <span>Scheduled: {m.postsScheduled}</span>
                  <span>Published: {m.postsPublished}</span>
                  {m.postsFailed > 0 && (
                    <span className="text-red-700 font-semibold">FAILED: {m.postsFailed}</span>
                  )}
                </div>
                <textarea
                  placeholder="Leave empty and every account gets its own UNIQUE caption plus its own 1 to 4 hashtags (read them below). Type here to give every account the same words instead; they still get their own hashtags unless you write a # yourself."
                  defaultValue={m.caption}
                  onChange={(e) => setCaptions((c) => ({ ...c, [m.id]: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm h-16"
                  data-testid={`caption-${m.seq}`}
                />
                <div className="flex gap-2">
                  {captions[m.id] !== undefined && captions[m.id] !== m.caption && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => act(() => updateMasterCaption(m.id, captions[m.id]))}
                      className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold"
                    >
                      Save caption
                    </button>
                  )}
                  {m.status === "pending_approval" && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => act(() => approveMaster(m.id))}
                      className="px-4 py-1.5 rounded-lg bg-green-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
                      data-testid={`approve-${m.seq}`}
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Approve for all accounts
                    </button>
                  )}
                  {m.status === "approved" && (
                    <span
                      className="text-xs text-green-700 flex items-center gap-1"
                      data-testid={`approved-tag-${m.seq}`}
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      Approved{" "}
                      {m.approved_at ? new Date(m.approved_at).toLocaleString("en-GB") : ""} for{" "}
                      {m.approval_snapshot?.accounts.length ?? m.accounts.length} accounts
                    </span>
                  )}
                </div>

                {/* Who gets this video and exactly when. Before approval it is
                    the promise; after, the times are the real schedule. */}
                {/* Open by default while it still needs approving: the captions
                    are the thing being approved, so they cannot be behind a click. */}
                <details
                  className="mt-1"
                  open={m.status === "pending_approval"}
                  data-testid={`master-accounts-${m.seq}`}
                >
                  <summary className="text-xs font-semibold text-foreground-secondary cursor-pointer select-none">
                    {m.status === "approved"
                      ? `Release times and captions (${m.accounts.length} accounts)`
                      : `Approving sends this to ${m.accounts.length} accounts, each with its own caption`}
                  </summary>
                  <div className="mt-2 max-h-72 overflow-y-auto space-y-2 pr-2">
                    {m.accounts.map((a) => (
                      <div
                        key={a.igUsername}
                        className="border-b border-border/60 pb-2 last:border-0"
                        data-testid={`account-row-${m.seq}-${a.igUsername}`}
                      >
                        <div className="flex items-center gap-2 text-[12px] leading-tight">
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-black/10 flex-shrink-0"
                            style={{
                              background: `linear-gradient(135deg, ${a.colorHex} 50%, ${a.colorAccentHex} 50%)`,
                            }}
                            title={a.colorFamily}
                          />
                          <span className="font-medium truncate min-w-0 w-36">@{a.igUsername}</span>
                          {a.state === "failed" ? (
                            <span className="text-red-700 font-semibold">FAILED</span>
                          ) : a.scheduledAt ? (
                            <span
                              className={
                                a.state === "published"
                                  ? "text-green-700"
                                  : "text-foreground-secondary"
                              }
                            >
                              {a.state === "published" ? "posted " : "goes out "}
                              {fmtWhen(a.scheduledAt, a.timeZone)}
                            </span>
                          ) : (
                            <span className="text-foreground-secondary">
                              {m.status !== "approved"
                                ? "after you approve"
                                : a.state === "rendering"
                                  ? "rendering their copy"
                                  : "waiting for its turn"}
                            </span>
                          )}
                        </div>
                        {/* The exact words this account posts. Hugo, 08 Aug 2026:
                            "missing the caption so I can approve." */}
                        <p
                          className="mt-1 ml-5 text-[11px] leading-snug text-foreground-secondary whitespace-pre-line bg-background-secondary rounded-md px-2 py-1.5"
                          data-testid={`account-caption-${m.seq}-${a.igUsername}`}
                        >
                          {a.caption}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          );
        })}
      </section>

      {/* The accounts */}
      <section className="space-y-3">
        <h2 className="font-semibold">The accounts ({overview.creators.length})</h2>
        <p className="text-xs text-foreground-secondary">
          Each account owns its color for every video, and posts at its own two daily times so no
          two accounts ever post together.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {overview.creators.map((c) => (
            <div
              key={c.profileId}
              className="border border-border rounded-xl p-3 flex items-center gap-3"
              data-testid={`creator-${c.igUsername}`}
            >
              <span
                className="w-6 h-6 rounded-full border border-black/10 flex-shrink-0"
                style={{
                  background: `linear-gradient(135deg, ${c.colorHex} 50%, ${c.colorAccentHex} 50%)`,
                }}
                title={c.colorFamily}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">@{c.igUsername}</div>
                <div className="text-[11px] text-foreground-secondary truncate">
                  {c.colorFamily} - next video #{c.nextSeq}
                </div>
                {c.enrolled ? (
                  <div className="text-[11px] text-foreground-secondary flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">
                      {c.nextTimes.map((t) => fmtWhen(t, c.timeZone)).join(", ")}
                    </span>
                  </div>
                ) : (
                  <div className="text-[11px] text-amber-700 mt-0.5">
                    joining on the next cron beat
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
