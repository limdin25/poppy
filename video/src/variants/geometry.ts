// geometry.ts: the layout constants, read by BOTH renderers.
//
// The Remotion composition and (later) the ffmpeg fast-path filtergraph both
// read SCREEN from here. If they ever hold separate copies, the phone frame
// lands a few pixels off the video and every fast-path output is subtly broken
// in a way that is very hard to see and very easy to ship. One constant, two
// readers, never duplicated.

export const CANVAS = { w: 1080, h: 1920 } as const;

/**
 * The phone SCREEN, and the layout number everything else is measured from.
 *
 * IT IS NO LONGER A 1:1 PIXEL MAP, and that was a deliberate trade made for a
 * concrete reason. It used to be 720x1280, exactly the size of the encoded
 * sources, so the video mapped one pixel to one pixel with no resampling at all.
 * That is a real quality guarantee and it was worth defending for a long time.
 *
 * What killed it was the feed. At 1308px tall the phone left only 612px of the
 * 1920 canvas for everything else, and once the hook had a box tall enough for
 * three lines the text started 48px from the top of the frame. Every platform
 * covers far more than that with its own interface, so the first line was being
 * hidden in the one place it had to be read. Hugo caught it in QuickTime.
 *
 * So the screen is 676x1202: 9:16 to within a fifth of a pixel, and a 6 percent
 * DOWNSCALE of the source. Downscaling discards detail cleanly and never invents
 * any, so it is strictly less damaging than the 4.5 percent upscale the zoom was
 * already allowed to apply, and it buys 205px of clear space above the text and
 * 250px below the phone.
 *
 * It has a quiet upside too. At 676 wide the source has 720 pixels to give, so
 * even at MAX_ZOOM the phone act is still downsampling (720 / (676 x 1.045) =
 * 1.02 source pixels per output pixel). There is no longer any upscaling
 * anywhere in the phone segment at all, at any zoom.
 *
 * If you make this bigger again, check the top of the frame in a real feed
 * before you ship it.
 */
export const SCREEN = { x: 202, y: 454, w: 676, h: 1202, radius: 38 } as const;

/** Bezel thickness around the screen. */
export const BEZEL = 14;

/** The phone body: the screen plus its bezel. */
export const PHONE = {
  x: SCREEN.x - BEZEL,
  y: SCREEN.y - BEZEL,
  w: SCREEN.w + BEZEL * 2,
  h: SCREEN.h + BEZEL * 2,
  radius: SCREEN.radius + BEZEL,
} as const;

/**
 * Where the rotating hook lives. The gate samples a grid across this box, so it
 * must be the real text bounds and not an approximation.
 */
// THE VERTICAL LAYOUT, and every number in it is spent rather than chosen. The
// canvas is 1920 and the phone takes 1230 of it, so there are 690 pixels to
// divide between the top margin, the text, the gap and the bottom margin:
//
//   205  clear at the top     nothing is drawn above this line
//   190  the hook             two lines at HOOK_CAP_PX, worst case 182
//    45  gap
//  1230  the phone            y 440 to 1670
//   250  clear at the bottom
//
// The 205 is the point of the whole arrangement. It used to be 48, because the
// box was 300 tall to hold three lines of 96px type and it was pinned near the
// top of the frame. Every platform draws its own interface over the top of a
// vertical video, so the first line of the hook was being covered in the one
// place it has to be read. Dropping the type to two lines at a smaller cap is
// what freed the space; the phone shrank by 6 percent to pay for the rest.
//
// THE TEXT IS ANCHORED TO THE BOTTOM OF THIS BOX, NOT THE TOP. Most hooks are
// one line, and anchored to the top a one line hook would float with nothing
// between it and the phone. Anchored to the bottom, every hook sits the same
// 45px off the device whatever its length. It is centred horizontally for the
// same reason: a left-aligned single line under a centred phone has no axis to
// belong to.
export const HOOK_SAFE_AREA = { x: 72, y: 205, w: CANVAS.w - 144, h: 190 } as const;

/** Hooks are held to two lines. See the budget above; three does not fit. */
export const HOOK_MAX_LINES = 2;

/**
 * The plate drawn behind the hook while the clip is still full bleed.
 *
 * Nothing can prove text is readable over playing video, so before the shrink
 * the hook gets an opaque backing in a colour the contrast gate has already
 * measured (see PLATE_POINT in plan.ts). It fades out as the shrink reveals the
 * generated background underneath, which is a surface the gate does cover.
 */
export const HOOK_PLATE = { padX: 34, padY: 22, radius: 26 } as const;

/** Usable text width inside the plate. What the fit checks must measure against. */
export const HOOK_TEXT_W = HOOK_SAFE_AREA.w - HOOK_PLATE.padX * 2;

/** Where the end card's text sits. Same canvas, no phone. */
export const CTA_TEXT_AREA = { x: 96, y: 560, w: CANVAS.w - 192, h: 800 } as const;

/**
 * How far outside the phone silhouette the rim-light sampler looks.
 * Far enough to be past the drop shadow, close enough to still be "behind" it.
 */
export const ANNULUS_OFFSET = 40;

// A NOTE ON A RULE THAT WAS TRIED AND DROPPED, so nobody re-adds it.
//
// An earlier version forbade any archetype from putting its brightest region
// behind the phone, on the theory that a bright backdrop dissolves the
// silhouette. That does not survive contact with this layout: the phone is
// 1308px tall on a 1920px canvas, so "behind the phone" is most of the frame,
// and the rule banned every glow-based archetype outright.
//
// The real failure mode is not brightness, it is SIMILARITY. A near-black phone
// against a bright background separates beautifully. It dissolves only when the
// backdrop sits near the bezel's own lightness, and that case is measured on the
// annulus and answered by the rim light in deriveRimAlpha.

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Evenly spaced sample points across a box, inclusive of the edges. */
export function sampleGrid(box: Box, cols: number, rows: number): Point[] {
  const pts: Point[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pts.push({
        x: box.x + (cols === 1 ? box.w / 2 : (box.w * c) / (cols - 1)),
        y: box.y + (rows === 1 ? box.h / 2 : (box.h * r) / (rows - 1)),
      });
    }
  }
  return pts;
}

/** Points on a rounded-rectangle ring `offset` px outside the phone silhouette. */
export function annulusPoints(offset = ANNULUS_OFFSET, count = 24): Point[] {
  const cx = PHONE.x + PHONE.w / 2;
  const cy = PHONE.y + PHONE.h / 2;
  const halfW = PHONE.w / 2 + offset;
  const halfH = PHONE.h / 2 + offset;
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    // Project the angle onto the rectangle rather than onto an ellipse, so the
    // samples actually hug the phone's edge instead of bulging past its corners.
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const scale = 1 / Math.max(Math.abs(cos) / halfW, Math.abs(sin) / halfH);
    pts.push({ x: cx + cos * scale, y: cy + sin * scale });
  }
  return pts;
}
