// HookBand.tsx: the rotating hook, anchored just above the phone.
//
// Renders standalone against transparency, for the same fast-path reason as the
// other parts.
//
// Timing comes entirely from the plan's recipe, in WHOLE FRAMES. A hook that
// entered 20ms later than another would be pixel-identical at 30fps, so every
// offset here is a frame count and the smallest real step is 33ms.
//
// NOTHING RENDERS BEFORE THE SHRINK. The opening plays completely clean: no
// text, no plate, nothing. The first hook arrives once the phone has settled,
// and from there they rotate to the end card.
//
// That is a deliberate reversal of how this worked at first, and the reason is
// the reveal. The video never says what it is until the end card, so the only
// job the text has is holding somebody through the back half to get there. Text
// over the opening spent that attention early and gave the viewer something to
// judge before the clip had earned it.
//
// It also means the plate is gone. The plate existed because no gate can prove
// text is readable over playing video, and the hook was over playing video. Now
// it only ever sits on the generated background, which the contrast gate covers.

import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { HOOK_MAX_LINES, HOOK_PLATE, HOOK_SAFE_AREA, HOOK_TEXT_W } from '../geometry';
import { hook } from '../hooks';
import type { VariantPlan } from '../plan';
import { TextBlock } from './TextBlock';

/** Frames the outgoing line takes to clear before the incoming one arrives. */
const CROSSFADE = 8;

export const HookBand: React.FC<{ plan: VariantPlan }> = ({ plan }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { hookLeadFrames, hookStagger, hookSwapFrame, dropFrame, dropFrames } = plan.recipe;
  const startFrame = dropFrame + dropFrames + hookLeadFrames;

  if (frame < startFrame) return null;

  // At most ONE swap, and usually none. See the note on hookCount in recipe.ts:
  // a line that changes every few seconds competes with the clip for the
  // attention it is meant to be holding, and one message said eight ways is
  // weaker than the same message left alone.
  const swapped = hookSwapFrame > 0 && frame >= hookSwapFrame - CROSSFADE;
  const slot = swapped && plan.hookIds.length > 1 ? 1 : 0;
  const localFrame = frame - (slot === 1 ? hookSwapFrame : startFrame);

  const opacity =
    slot === 0 && hookSwapFrame > 0
      ? // The outgoing line fades out just before the incoming one fades in.
        interpolate(
          frame,
          [startFrame, startFrame + 6, hookSwapFrame - CROSSFADE, hookSwapFrame],
          [0, 1, 1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        )
      : // Everything else fades in once and then simply stays.
        interpolate(localFrame, [0, 6], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });

  const current = hook(plan.hookIds[slot]);

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: HOOK_SAFE_AREA.x,
          top: HOOK_SAFE_AREA.y,
          width: HOOK_SAFE_AREA.w,
          height: HOOK_SAFE_AREA.h,
          display: 'flex',
          flexDirection: 'column',
          // Bottom anchored and centred. See the note on HOOK_SAFE_AREA.
          justifyContent: 'flex-end',
          alignItems: 'center',
          opacity,
        }}
      >
        {/*
          The padding stays even though the plate is gone, so the text sits in
          the same place it did when there was one and HOOK_TEXT_W remains the
          width the fit checks measure against.
        */}
        <div style={{ padding: `${HOOK_PLATE.padY}px ${HOOK_PLATE.padX}px` }}>
          <TextBlock
            key={current.id}
            text={current.text}
            fontKey={plan.font}
            capPx={plan.recipe.hookCapPx}
            widthPx={HOOK_TEXT_W}
            maxLines={HOOK_MAX_LINES}
            color={plan.ink}
            align="center"
            fitContent
            lineStyle={(i) => {
              // Per-line entrance stagger. The seeded stagger is what stops two
              // variants of the same source animating in lockstep.
              const s = spring({
                frame: localFrame - i * hookStagger,
                fps,
                config: { damping: 18, stiffness: 110 },
              });
              return {
                transform: `translateY(${(1 - s) * 26}px)`,
                opacity: s,
              };
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
