"use client";

import { useState } from "react";
// No Instagram icon in this lucide version: brand icons were dropped, and
// importing one gives you `undefined`, which React reports as "Element type is
// invalid" rather than anything about icons. Camera is the stand-in used
// everywhere else in this app.
import { Camera, Check, ChevronDown, Users, UserRoundCheck } from "lucide-react";
import { gettingStartedCopy as copy } from "./copy";

export type StepKey = "instagram" | "community" | "profile";

/**
 * One short video per step, dropped into public/videos and named here. Left
 * empty until Hugo records them; a step with no video renders no player rather
 * than an empty black box.
 */
export type StepVideos = Partial<Record<StepKey, string>>;

export interface GettingStartedProps {
  instagramConnected: boolean;
  /** True once Skool has confirmed them, by invite or as a paid member. */
  communityJoined: boolean;
  connectUrl: string;
  communityUrl?: string;
  skoolAffiliateUrl: string | null;
  /** They pressed "My profile is ready". We cannot read their bio to check. */
  profileReady: boolean;
  videos?: StepVideos;
  onSaveStep3: (formData: FormData) => void | Promise<void>;
}

const ICONS: Record<StepKey, typeof Camera> = {
  instagram: Camera,
  community: Users,
  profile: UserRoundCheck,
};

function StepVideo({ step, src }: { step: StepKey; src: string }) {
  return (
    <video
      data-testid={`step-video-${step}`}
      src={src}
      controls
      preload="none"
      playsInline
      className="mt-3 w-full rounded-xl border border-border bg-black"
    />
  );
}

export function GettingStarted({
  instagramConnected,
  communityJoined,
  connectUrl,
  communityUrl = "https://www.skool.com/ai-influencer-flywheel-5612",
  skoolAffiliateUrl,
  profileReady,
  videos = {},
  onSaveStep3,
}: GettingStartedProps) {
  const finished: Record<StepKey, boolean> = {
    instagram: instagramConnected,
    community: communityJoined,
    profile: profileReady,
  };
  const order: StepKey[] = ["instagram", "community", "profile"];
  const doneCount = order.filter((k) => finished[k]).length;

  // Open the first thing they still have to do. Once everything is done the
  // last step stays open, because that is the one they come back to edit.
  const firstOpen = order.find((k) => !finished[k]) ?? "profile";
  const [open, setOpen] = useState<StepKey | null>(firstOpen);

  return (
    <div className="rounded-2xl border border-border p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-secondary">
          {copy.title}
        </h2>
        <span className="rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-3 py-1 text-xs font-bold text-white">
          {copy.progress(doneCount, order.length)}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {order.map((key, index) => {
          const step = copy.steps[key];
          const isDone = finished[key];
          const isOpen = open === key;
          const Icon = ICONS[key];
          const video = videos[key];

          return (
            <div
              key={key}
              className={`overflow-hidden rounded-xl border ${
                isOpen ? "border-accent/40" : "border-border"
              }`}
            >
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : key)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 p-4 text-left"
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    isDone ? "bg-success text-white" : "bg-background-secondary"
                  }`}
                >
                  {isDone ? (
                    <Check className="h-4 w-4" strokeWidth={3} />
                  ) : (
                    <Icon className="h-4 w-4 text-foreground-secondary" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground">
                    {`Step ${index + 1}. ${step.label}`}
                  </span>
                  <span className="block text-xs text-foreground-secondary">
                    {step.summary}
                  </span>
                </span>
                {isDone && (
                  <span className="shrink-0 text-xs font-semibold text-success">
                    {copy.done}
                  </span>
                )}
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-foreground-secondary transition-transform ${
                    isOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {isOpen && (
                <div
                  data-testid={`step-${key}`}
                  className="border-t border-border px-4 pb-4 pt-3"
                >
                  <p className="text-sm text-foreground-secondary">
                    {isDone && "doneBody" in step ? step.doneBody : step.body}
                  </p>

                  {key === "community" && !isDone && (
                    <p className="mt-2 rounded-lg bg-background-secondary p-3 text-xs text-foreground-secondary">
                      {copy.steps.community.note}
                    </p>
                  )}

                  {video && <StepVideo step={key} src={video} />}

                  {key === "instagram" && !isDone && (
                    <a
                      href={connectUrl}
                      className="mt-3 inline-block rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-5 py-2 text-sm font-medium text-white"
                    >
                      {copy.steps.instagram.cta}
                    </a>
                  )}

                  {key === "community" && (
                    <a
                      href={communityUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-block rounded-full border border-border px-5 py-2 text-sm font-medium text-foreground"
                    >
                      {copy.steps.community.cta}
                    </a>
                  )}

                  {key === "profile" && (
                    <form action={onSaveStep3} className="mt-3 space-y-2">
                      <label
                        htmlFor="skool_affiliate_url"
                        className="block text-sm font-medium text-foreground"
                      >
                        {copy.steps.profile.linkLabel}
                      </label>
                      <input
                        id="skool_affiliate_url"
                        name="skool_affiliate_url"
                        type="url"
                        inputMode="url"
                        defaultValue={skoolAffiliateUrl ?? ""}
                        placeholder={copy.steps.profile.linkPlaceholder}
                        className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground"
                      />
                      <p className="text-xs text-foreground-secondary">
                        {copy.steps.profile.linkHelp}
                      </p>
                      <button
                        type="submit"
                        className="rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-5 py-2 text-sm font-medium text-white"
                      >
                        {copy.steps.profile.cta}
                      </button>
                      {isDone && (
                        <p className="text-xs text-success">
                          {copy.steps.profile.savedNote}
                        </p>
                      )}
                    </form>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
