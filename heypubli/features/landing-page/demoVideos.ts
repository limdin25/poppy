// The demo reel: Hugo's own AI videos, served from /public/demos so the wall keeps
// working if a third-party embed dies. Sources came in at mixed sizes and bitrates and
// were normalised to 720x1280 h264 with a poster frame each.
//
// Adding one: drop vN.mp4 + vN.jpg in public/demos and add an entry here. Keep the list
// short. The wall is proof of quality, not a catalogue.

export interface DemoVideo {
  /** Path under /public. */
  src: string;
  /** Poster frame, shown until the clip is in view. Stops 15MB downloading on load. */
  poster: string;
  /** One short line on what this clip proves. Read by screen readers as the label. */
  note: string;
}

export const demoVideos: DemoVideo[] = [
  {
    src: "/demos/v1.mp4",
    poster: "/demos/v1.jpg",
    note: "Product review. Every frame generated, nothing filmed.",
  },
  {
    src: "/demos/v2.mp4",
    poster: "/demos/v2.jpg",
    note: "Lifestyle to camera. No studio, no crew, no shoot day.",
  },
  {
    src: "/demos/v3.mp4",
    poster: "/demos/v3.jpg",
    note: "Explainer with captions, built for silent scrolling.",
  },
  {
    src: "/demos/v4.mp4",
    poster: "/demos/v4.jpg",
    note: "Personal recommendation, the format that sells.",
  },
];
