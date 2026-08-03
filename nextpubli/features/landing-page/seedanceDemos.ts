// The Seedance 2.5 demo reel: real public posts on X, embedded with X's own widget so
// each creator keeps their name on their work. Harvested 2026-08-03 from live X search;
// every entry was checked to actually carry a playable video that day.
//
// These double as the proof on the landing page ("this is the quality") and, where a
// prompt is public, as classroom material. Keep the list short and current: swap stale
// entries rather than letting the reel grow.

export interface SeedanceDemo {
  /** Full status URL on x.com. The embed widget resolves everything else from it. */
  url: string;
  /** Who made it, shown while the embed loads. */
  handle: string;
  /** One line on why this one is on the wall. */
  note: string;
}

export const seedanceDemos: SeedanceDemo[] = [
  {
    url: "https://x.com/BubbleBrain/status/2083659648108990925",
    handle: "@BubbleBrain",
    note: "The viral vlog test. One prompt, a full handheld day-in-the-life, 105k views.",
  },
  {
    url: "https://x.com/aitrendz_xyz/status/2084202663944634398",
    handle: "@aitrendz_xyz",
    note: "AI UGC in 15 seconds for about a dollar, next to a week of back and forth for the old way.",
  },
  {
    url: "https://x.com/AIwithLoveth/status/2084202200385953959",
    handle: "@AIwithLoveth",
    note: "Straight out of Dreamina, no edit, prompt shared by the creator.",
  },
  {
    url: "https://x.com/zumercreator/status/2084173492937982078",
    handle: "@zumercreator",
    note: "Everyday realism, the kind of clip that reads as a phone camera.",
  },
  {
    url: "https://x.com/egeberkina/status/2084228424919392301",
    handle: "@egeberkina",
    note: "A 30 second cinematic sequence from a single text prompt, flaws and all.",
  },
];
