// PhoneFrame.tsx: the bezel, its shadow and its rim light.
//
// THE SCREEN HOLE IS GENUINELY TRANSPARENT. This renders as a ring, not as a
// panel with a video in it, so it can be rendered standalone to an alpha PNG and
// laid OVER the video by ffmpeg in the phase 2 fast path. The rounded corners
// then mask the video for free, at no quality cost, because the alpha edge does
// the work instead of a second encode.
//
// THERE IS DELIBERATELY NO SCREEN GLARE. Real mockups usually have a diagonal
// sheen across the glass and it does look good, but it would sit on top of the
// video and change its pixels. The whole layout exists to map the source 1:1
// (see geometry.ts), so the glass stays clean.
//
// IT TAKES THE SCREEN RECTANGLE RATHER THAN READING THE CONSTANT, because the
// device is not there for the first nine seconds. The clip opens filling the
// canvas and the frame closes around it, so the bezel has to track the shrinking
// video exactly or the video's edge and the bezel's inner edge separate by a few
// pixels mid-animation and the whole thing looks like two layers instead of one
// object. At rest the caller passes SCREEN and BEZEL and nothing has moved.

import { AbsoluteFill } from 'remotion';
import { BEZEL, SCREEN } from '../geometry';
import { BEZEL_HEX } from '../palettes';
import { toHex } from '../oklch';
import type { VariantPlan } from '../plan';

export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly radius: number;
}

export const PhoneFrame: React.FC<{
  plan: VariantPlan;
  /** The hole the video is playing in, right now. Defaults to the rest position. */
  screen?: ScreenRect;
  bezel?: number;
  opacity?: number;
}> = ({ plan, screen = SCREEN, bezel = BEZEL, opacity = 1 }) => {
  const rim = plan.rimAlpha;
  const accent = toHex(plan.palette.accent);

  // A hairline overlap. Without it a fractional mid-animation position can leave
  // a one pixel seam of video showing between the bezel's inner edge and the
  // clipped video, which flickers as it moves.
  const overlap = 0.5;
  const inner = Math.max(bezel + overlap, 0);

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity }}>
      <div
        style={{
          position: 'absolute',
          left: screen.x - inner,
          top: screen.y - inner,
          width: screen.w + inner * 2,
          height: screen.h + inner * 2,
          borderRadius: screen.radius + inner,
          // The ring itself. A transparent centre with a thick border is what
          // makes the screen hole real rather than painted.
          border: `${inner}px solid ${BEZEL_HEX}`,
          boxSizing: 'border-box',
          background: 'transparent',
          boxShadow: [
            // Contact shadow, grounds the device.
            '0 48px 120px -24px rgba(0,0,0,0.62)',
            '0 12px 32px -12px rgba(0,0,0,0.45)',
            // Accent bloom. Separates the phone from the background by HUE as
            // well as by lightness, which is what saves the near-black families.
            `0 0 90px -10px ${accent}47`,
            // Rim light. Strength is measured, not chosen: deriveRimAlpha reads
            // how close the real background gets to the bezel in lightness.
            // Brightest along the top edge, where a light source would be.
            `inset 0 2px 0 rgba(255,255,255,${rim.toFixed(3)})`,
            `inset 0 0 0 1px rgba(255,255,255,${(rim * 0.4).toFixed(3)})`,
            `inset 0 -2px 0 rgba(255,255,255,${(rim * 0.18).toFixed(3)})`,
          ].join(', '),
        }}
      />
    </AbsoluteFill>
  );
};
