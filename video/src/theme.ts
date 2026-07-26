// ONE PALETTE (REBUILD_PROMPT rule 6): white bg, Google blue accents, red ONLY
// for the YOU ring + scarcity line, neutrals elsewhere. No cream, no brown.
export const BG = '#ffffff'
export const BLUE = '#1a73e8'
export const RED = '#d93025'
export const INK = '#202124'
export const GREY = '#5f6368'
export const BORDER = '#dadce0'
export const SOFT = '#f1f3f4'

// vertical canvas
export const W = 1080
export const H = 1920

// actor circle (rule 8): 330px. Subtitles live bottom-LEFT, so the circle
// always stays on the RIGHT — only its HEIGHT moves, because what it must not
// cover changes scene by scene (Hugo 2026-07-26: "each needs to be placed in
// different places depending where we are on the video").
export const CIRCLE = 330
export const CIRCLE_X = 877

// Two hard limits on where it can sit:
//   TOP    — nothing above y=795 is safe on the scenes that centre their
//            content (the support-page highlight, "Dead simple / three steps",
//            "Be the name they see first" all land at y≈950).
//   BOTTOM — the page's floating buy button covers roughly the last 130px of
//            the video, so the circle's bottom edge must stay above ~1720,
//            i.e. centre y <= 1555.
// LOW (1520) is the default: every scene from S3 on finishes its content by
// y≈1310 at the latest, so the circle sits under all of it and over nothing.
const LOW = 1520

// Keyed to the scene map in FlowVideo.tsx. `at` is the frame the glide to that
// height BEGINS; it takes GLIDE frames to arrive.
export const CIRCLE_PARKS: { at: number; y: number; why: string }[] = [
  // S2 SERP — the one scene that is bottom-heavy. The whole beat is "there you
  // are, near the bottom", so the lead's own card is LOW and the circle must
  // stay high or it covers the single most important frame in the video.
  { at: 235, y: 960, why: 'SERP: their own card is the low one' },
  // S3 Google's own help page — the highlighted "more reviews… local ranking"
  // sentence sits at y≈960, dead behind the old park. This is the proof shot.
  { at: 940, y: LOW, why: 'support page: highlight sits at y~960' },
  // S4 door photo + the review card (ends y≈1310)
  { at: 1268, y: LOW, why: 'why: review card ends y~1310' },
  // S5 three steps — headline+step dots y≈480-990, logo grid ends y≈1200,
  // phone mockups end y≈1290
  { at: 1684, y: LOW, why: 'steps: logos/phone occupy the middle' },
  // S6 offer — £1, the owner-reply card (ends y≈1310), then the #1 card and
  // "Be the name they see first" at y≈975
  { at: 3110, y: LOW, why: 'offer: headline + owner-reply card' },
]

// how long the circle takes to slide between two parks — long enough to read
// as a deliberate move, short enough to be done before the new scene settles
export const CIRCLE_GLIDE = 24

export const UI_FONT = '-apple-system, "Helvetica Neue", Arial, sans-serif'
export const GOOGLE_FONT = 'Arial, Roboto, sans-serif'
