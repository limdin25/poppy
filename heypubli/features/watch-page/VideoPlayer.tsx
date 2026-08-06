"use client";

import { useEffect, useRef } from "react";
import { trackWatch, captureWatchToken } from "./track";
import { watchCopy } from "./copy";

/**
 * The explainer, with the funnel's eyes on it.
 *
 * Watch percentage is COVERAGE of the played ranges, never the playhead. The
 * VSL funnel in the sister product learned this the hard way: with a seek bar,
 * playhead-based percent lets a lead drag to the end and register a full
 * watch. Summing video.played counts only seconds that actually rendered.
 */
function coverage(video: HTMLVideoElement): number {
  let seconds = 0;
  for (let i = 0; i < video.played.length; i++) {
    seconds += video.played.end(i) - video.played.start(i);
  }
  return video.duration > 0 ? seconds / video.duration : 0;
}

export function VideoPlayer() {
  const ref = useRef<HTMLVideoElement>(null);
  const fired = useRef<Set<string>>(new Set());

  useEffect(() => {
    const once = (event: string, meta?: Record<string, unknown>) => {
      if (fired.current.has(event)) return;
      fired.current.add(event);
      trackWatch(event, meta);
    };

    // Before the first beacon, so even the view event knows who arrived.
    captureWatchToken();
    once("view");
    const video = ref.current;
    if (!video) return;

    const onPlay = () => once("play");
    const onTime = () => {
      const c = coverage(video);
      if (c >= 0.5) once("watch_50");
      if (c >= 0.9) once("watch_90");
    };
    const onEnded = () => once("ended", { coverage: Math.round(coverage(video) * 100) });

    video.addEventListener("play", onPlay);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("ended", onEnded);
    };
  }, []);

  return (
    <video
      ref={ref}
      controls
      playsInline
      preload="metadata"
      poster={watchCopy.video.poster}
      aria-label={watchCopy.video.aria}
      data-testid="watch-video"
      className="aspect-video w-full rounded-2xl bg-black object-contain"
    >
      <source src={watchCopy.video.src} type="video/mp4" />
    </video>
  );
}
