"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Play } from "lucide-react";
import { trackWatch } from "./track";

/**
 * The demo reel, Hugo's mobile behaviour: one big player on top, the rest stay
 * as thumbnails underneath. Tapping a thumbnail promotes that clip into the
 * big player and starts it; the strip never moves, so on a phone you can hop
 * through all four without ever losing your place.
 *
 * The clips are the variation-factory edits: they start like a normal reel and
 * then land inside the phone mock-up, which is exactly the content HeyPubli
 * posts. Files live in public/watch/demos, one poster each, so nothing heavy
 * downloads before a tap.
 */

const CLIPS = [
  { src: "/watch/demos/d1.mp4", poster: "/watch/demos/d1.jpg" },
  { src: "/watch/demos/d2.mp4", poster: "/watch/demos/d2.jpg" },
  { src: "/watch/demos/d3.mp4", poster: "/watch/demos/d3.jpg" },
  { src: "/watch/demos/d4.mp4", poster: "/watch/demos/d4.jpg" },
];

/** Hugo, 2026-08-06: "the version we want is the fourth version... the model is
 *  the fourth model." The fourth clip leads; the strip holds all four. */
const FEATURED = 3;

const tracked = new Set<string>();

export function WatchDemos() {
  const [selected, setSelected] = useState(FEATURED);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const clip = CLIPS[selected];

  function promote(i: number) {
    setSelected(i);
    setPlaying(true);
    const key = CLIPS[i].src.split("/").pop() ?? "unknown";
    if (!tracked.has(key)) {
      tracked.add(key);
      trackWatch("demo_play", { clip: key });
    }
    // The element keeps its identity across the src swap, so play after the
    // source updates rather than in render.
    requestAnimationFrame(() => {
      const v = videoRef.current;
      if (v) {
        v.load();
        void v.play().catch(() => {});
      }
    });
  }

  return (
    <div data-testid="watch-demos-player">
      <div className="mx-auto max-w-[340px] overflow-hidden rounded-3xl border border-[#E5E7EB] bg-black">
        {playing ? (
          <video
            ref={videoRef}
            controls
            playsInline
            preload="none"
            poster={clip.poster}
            data-testid="demo-main"
            className="aspect-[9/16] w-full object-contain"
          >
            <source src={clip.src} type="video/mp4" />
          </video>
        ) : (
          <button
            type="button"
            data-testid="demo-main-poster"
            onClick={() => promote(selected)}
            className="relative block w-full"
            aria-label="Play the first example video"
          >
            <Image
              src={clip.poster}
              alt="Example of a video HeyPubli posts"
              width={720}
              height={1280}
              className="aspect-[9/16] w-full object-cover"
            />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90">
                <Play className="ml-1 h-7 w-7 text-[#1A1A1A]" fill="currentColor" />
              </span>
            </span>
          </button>
        )}
      </div>

      {/* The strip stays put; the selected clip is ringed. */}
      <div className="mx-auto mt-3 grid max-w-[340px] grid-cols-4 gap-2">
        {CLIPS.map((c, i) => (
          <button
            key={c.src}
            type="button"
            data-testid={`demo-thumb-${i + 1}`}
            onClick={() => promote(i)}
            aria-label={`Play example video ${i + 1}`}
            className={`relative overflow-hidden rounded-xl border-2 ${
              i === selected ? "border-[#E1306C]" : "border-transparent"
            }`}
          >
            <Image
              src={c.poster}
              alt=""
              width={180}
              height={320}
              className="aspect-[9/16] w-full object-cover"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
