// Background.tsx: the generated field the phone sits on.
//
// Renders STANDALONE, which is not decoration. The phase 2 ffmpeg fast path
// renders this component once as a still and lets ffmpeg composite the video
// into it, avoiding a full browser re-encode of every frame. That only works if
// this component never depends on anything above it in the tree.
//
// It computes nothing. Every value arrives pre-resolved on the plan, because the
// contrast gate has already measured this exact background in node and a
// component that recalculated anything could disagree with what was measured.

import { AbsoluteFill } from 'remotion';
import { GRAIN } from '../archetypes';
import type { VariantPlan } from '../plan';

export const Background: React.FC<{ plan: VariantPlan }> = ({ plan }) => {
  return (
    <AbsoluteFill style={{ background: plan.backgroundCss }}>
      {/*
        Grain is always on and never animated.

        Always on because a 1080x1920 gradient bands visibly under h264, and
        banding is the clearest tell of a cheap render. Never animated because
        per-frame noise destroys inter-frame compression and roughly triples the
        file size for no visible gain at this resolution.
      */}
      <AbsoluteFill
        style={{
          backgroundImage: GRAIN.dataUri,
          backgroundSize: `${GRAIN.tile}px ${GRAIN.tile}px`,
          opacity: plan.grainAlpha,
          mixBlendMode: 'overlay',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
