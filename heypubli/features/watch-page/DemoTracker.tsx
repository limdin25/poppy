"use client";

import { useCallback } from "react";
import { trackWatch } from "./track";

/**
 * Counts plays on the demo videos WITHOUT touching the DemoWall feature that
 * renders them (features never import features; the page composes both and
 * this wrapper sits between). Media "play" events do not bubble, but they do
 * fire ancestor listeners in the CAPTURE phase, which is what onPlayCapture
 * uses. One beacon per session per video is enough signal.
 */
const seen = new Set<string>();

export function DemoTracker({ children }: { children: React.ReactNode }) {
  const onPlayCapture = useCallback((e: React.SyntheticEvent) => {
    const target = e.target as HTMLVideoElement | null;
    const src = target?.currentSrc || target?.querySelector?.("source")?.src || "unknown";
    const key = src.split("/").pop() ?? "unknown";
    if (seen.has(key)) return;
    seen.add(key);
    trackWatch("demo_play", { clip: key });
  }, []);

  return <div onPlayCapture={onPlayCapture}>{children}</div>;
}
