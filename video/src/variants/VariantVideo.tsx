// VariantVideo.tsx: one short-form variant, end to end.
//
// THE SHAPE OF EVERY VIDEO, and it is the same three acts every time:
//
//   1. the clip fills the whole canvas, with a retention hook over it
//   2. around nine seconds in, on a beat in the clip, it shrinks into a phone
//   3. it plays on inside the phone, hooks rotating, then the ten second end card
//
// LAYER ORDER MATTERS AND IS NOT ARBITRARY:
//
//   1. Background      the generated field, revealed by the shrink
//   2. the source clip, clipped to whatever rectangle it currently occupies
//   3. PhoneFrame      a RING with a transparent centre, laid on top
//   4. HookBand        the rotating text
//   then the end card, appended rather than overlaid.
//
// The frame sits over the video rather than around it so its rounded corners
// mask the video through alpha. That is what lets the phase 2 fast path render
// layers 1, 3 and 4 as stills and have ffmpeg drop the untouched video in
// between them, skipping a whole generation of re-encoding.
//
// TWO SOURCE FILES, ONE CLIP, AND THE SWAP IS THE QUALITY ARGUMENT. Act 1 needs
// 1080x1920 pixels to fill the canvas, and the sources are 720x1280, so it plays
// the 1080 twin that ingest upscaled once with lanczos at crf 14. Act 3 plays
// the 720 original at exactly SCREEN size, untouched, one pixel to one pixel.
// The handover happens at the instant the shrink finishes, where both files are
// drawing the same content at the same size, so it is invisible except as a
// small gain in sharpness. Doing it the lazy way, one 1080 file scaled down for
// act 3, would put the phone segment through an upscale and a downscale for
// nothing, and the phone segment is most of the video.
//
// Audio is a SINGLE track across both, taken from the 720 file, because two
// AAC streams butt-joined mid-word can click.

import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { BEZEL, CANVAS, SCREEN } from './geometry';
import { planVariant } from './plan';
import {
  AUDIO_FADE_FRAMES,
  CTA_FRAMES,
  ambienceFile,
  bodyFrames,
  clipTransform,
  gradeFilter,
  motionAt,
  resolveSource,
  restMotion,
} from './recipe';
import type { VariantProps } from './schema';
import type { FamilyKey } from './palettes';
import { Background } from './parts/Background';
import { CtaCard } from './parts/CtaCard';
import { HookBand } from './parts/HookBand';
import { PhoneFrame } from './parts/PhoneFrame';
import { useVariantFont } from './parts/useVariantFont';

export const VariantVideo: React.FC<VariantProps> = ({ sourceId, variantIndex, recipeVersion, colorFamily }) => {
  const plan = planVariant(sourceId, variantIndex, recipeVersion, colorFamily as FamilyKey | undefined);
  const src = resolveSource(sourceId);
  const body = bodyFrames(sourceId, plan.recipe);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Holds frame 0 until the face is on the page, and cancels the render outright
  // if it is missing. A silent fallback typeface is the one failure that would
  // ship without anybody noticing.
  useVariantFont(plan.font);

  const { dropFrame, dropFrames, trimHeadFrames } = plan.recipe;
  const dropEnd = dropFrame + dropFrames;

  // Critically damped on purpose: damping 200 gives an ease with NO overshoot.
  // A springier setting looks better in isolation and is wrong here, because
  // overshooting past the rest position means the video is briefly smaller than
  // the phone screen and background shows through inside the bezel.
  //
  // Mass is what varies, not damping, and it is what gives the three curves
  // genuinely different feels while keeping all of them monotonic and the same
  // length. Two clips that shrink over the same 18 frames but accelerate
  // differently do not read as the same template.
  const t = spring({
    frame: frame - dropFrame,
    fps,
    config: { damping: 200, mass: [1, 0.55, 1.7][plan.recipe.dropEase] },
    durationInFrames: dropFrames,
  });
  // THE OPENING DRIFT. The clip starts on its own continuous zoom and crop and
  // arrives at the resting one exactly when the shrink finishes, so:
  //   - frame one is geometrically unique per file, with no pixel-identical
  //     fifth for the variants that happen to rest at zoom 1.000;
  //   - the handover to the untouched 720 file is still invisible, because at
  //     u = 1 this IS the resting transform;
  //   - what a viewer sees is a slow push over nine seconds, which reads as
  //     camera movement rather than as anything having been done to the file.
  // It is free because the opening is a 1.5x upscale either way.
  const u = interpolate(frame, [0, dropEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const openClip = clipTransform(motionAt(plan.recipe, u));
  // The phone act takes the resting transform directly rather than motionAt(1),
  // so its pixels do not depend on a float landing exactly on 1.0.
  const restClip = clipTransform(restMotion(plan.recipe));

  // The grade holds through the opening and decays to neutral across the shrink,
  // where a 1.5 percent level change is masked by the motion. The phone act gets
  // 'none', so those pixels are never put through a colour transform at all.
  const grade = gradeFilter(
    plan.recipe,
    interpolate(frame, [dropFrame, dropEnd], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const at = (from: number, to: number) => interpolate(t, [0, 1], [from, to]);
  const rect = {
    x: at(0, SCREEN.x),
    y: at(0, SCREEN.y),
    w: at(CANVAS.w, SCREEN.w),
    h: at(CANVAS.h, SCREEN.h),
    radius: at(0, SCREEN.radius),
  };

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/*
        The ambient bed, OUTSIDE the body sequence so it runs under the end card
        too. Around 50dB below the voice, which is under the noise floor of the
        source recordings, so it is inaudible in the body and only just present
        in the end card. It also does a job nobody asked for: the cut from a
        talking clip to ten seconds of digital silence was abrupt, and a bed
        carrying through makes the end card feel like part of the same video.

        Every variant gets a different bed, a different start point within it,
        and a different gain. See AMBIENCE_GAIN_MIN for what this does and, more
        importantly, what it does not.
      */}
      <Audio
        src={staticFile(ambienceFile(plan.recipe))}
        trimBefore={plan.recipe.ambienceStartFrame}
        volume={plan.recipe.ambienceGain}
      />

      <Sequence durationInFrames={body} name="body">
        <Background plan={plan} />

        <Audio
          src={staticFile(src.file)}
          // The seeded head trim. This is the whole of the per-file pixel
          // variation and it costs nothing: it is a cut, not a filter, so
          // every frame differs from every other variant while the pixels
          // that do play are untouched.
          trimBefore={trimHeadFrames}
          // A short ramp so the cut into the silent end card does not click.
          volume={(f) =>
            interpolate(f, [body - AUDIO_FADE_FRAMES, body], [1, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })
          }
        />

        <Sequence durationInFrames={dropEnd} name="clip-full">
          <AbsoluteFill>
            <div
              style={{
                position: 'absolute',
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                borderRadius: rect.radius,
                overflow: 'hidden',
              }}
            >
              <OffthreadVideo
                src={staticFile(src.fullFile)}
                trimBefore={trimHeadFrames}
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'block',
                  transform: openClip,
                  filter: grade,
                }}
              />
            </div>
          </AbsoluteFill>
        </Sequence>

        <Sequence from={dropEnd} durationInFrames={Math.max(1, body - dropEnd)} name="clip-phone">
          <AbsoluteFill>
            <div
              style={{
                position: 'absolute',
                left: SCREEN.x,
                top: SCREEN.y,
                width: SCREEN.w,
                height: SCREEN.h,
                borderRadius: SCREEN.radius,
                overflow: 'hidden',
              }}
            >
              <OffthreadVideo
                src={staticFile(src.file)}
                // Picks up exactly where the full-bleed twin left off.
                trimBefore={trimHeadFrames + dropEnd}
                muted
                style={{
                  // 720x1280 into a 720x1280 screen. At zoom 1.000, which is a
                  // real and common outcome, this is still a one to one pixel
                  // map with no resampling at all. See the note on SCREEN in
                  // geometry.ts and on MAX_ZOOM in recipe.ts.
                  width: SCREEN.w,
                  height: SCREEN.h,
                  display: 'block',
                  transform: restClip,
                }}
              />
            </div>
          </AbsoluteFill>
        </Sequence>

        <PhoneFrame plan={plan} screen={rect} bezel={interpolate(t, [0, 1], [0, BEZEL])} opacity={t} />
        <HookBand plan={plan} />
      </Sequence>

      <Sequence from={body} durationInFrames={CTA_FRAMES} name="cta">
        <CtaCard plan={plan} />
      </Sequence>
    </AbsoluteFill>
  );
};
