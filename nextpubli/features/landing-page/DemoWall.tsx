"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { landingCopy } from "./copy";
import { demoVideos } from "./demoVideos";

/* The demo wall. Four vertical clips that play themselves when they scroll into view and
   stop when they leave, so a phone never holds four decoders open at once. Nothing is
   downloaded until a clip is actually near the viewport: preload="none" plus a poster.
   Sound is opt-in and exclusive, because four talking heads at once is the fastest way
   to make someone close the tab. */
export function DemoWall() {
  const copy = landingCopy.demos;
  const [soundOn, setSoundOn] = useState<number | null>(null);
  const refs = useRef<Array<HTMLVideoElement | null>>([]);

  useEffect(() => {
    const nodes = refs.current.filter(Boolean) as HTMLVideoElement[];
    if (!nodes.length || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const video = entry.target as HTMLVideoElement;
          if (entry.isIntersecting) {
            // play() rejects when the browser refuses autoplay. The poster stays up and
            // the tap-to-play control still works, so there is nothing to recover from.
            void video.play().catch(() => {});
          } else {
            video.pause();
          }
        });
      },
      { threshold: 0.4 },
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  const toggleSound = useCallback((index: number) => {
    setSoundOn((current) => {
      const next = current === index ? null : index;
      refs.current.forEach((video, i) => {
        if (!video) return;
        video.muted = i !== next;
        if (i === next) void video.play().catch(() => {});
      });
      return next;
    });
  }, []);

  return (
    <section id="demos" className="bg-background-secondary py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground-secondary shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {copy.badge}
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            {copy.title}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-foreground-secondary">
            {copy.subtitle}
          </p>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          {demoVideos.map((demo, i) => {
            const isOn = soundOn === i;
            return (
              <figure
                key={demo.src}
                className="group relative overflow-hidden rounded-2xl border border-border bg-black shadow-sm"
              >
                <video
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  src={demo.src}
                  poster={demo.poster}
                  preload="none"
                  muted
                  loop
                  playsInline
                  aria-label={demo.note}
                  className="aspect-[9/16] w-full object-cover"
                />

                <button
                  type="button"
                  onClick={() => toggleSound(i)}
                  aria-pressed={isOn}
                  aria-label={isOn ? copy.muteLabel : copy.unmuteLabel}
                  className="absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
                >
                  {isOn ? (
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 9H5v6h4l5 4V5L9 9zm7.5-.5a5 5 0 010 7M19 5a9 9 0 010 14"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 9H5v6h4l5 4V5L9 9zm8 1l4 4m0-4l-4 4"
                      />
                    </svg>
                  )}
                </button>

                <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pt-8 pb-3 text-[11px] leading-snug font-medium text-white sm:text-xs">
                  {demo.note}
                </figcaption>
              </figure>
            );
          })}
        </div>

        <p className="mt-6 text-center text-xs text-foreground-secondary">
          {copy.footnote}
        </p>
      </div>
    </section>
  );
}
