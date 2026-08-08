import React from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import plan from '../data/plan.json';

/**
 * The talking head, rebuilt from 29 shots of one continuous take.
 *
 * Two kinds of shot, both declared in data/plan.json:
 *   pause  the take is CUT, dead air removed, so the audio genuinely jumps
 *   punch  nothing is removed, only the framing changes at a word boundary
 *
 * A punch is what stops the pacing being hostage to where the speaker happened
 * to breathe: on its own the pause list gave one 14 second shot next to a 0.7
 * second one. Because the subject is locked off, a scale change alone reads as
 * a cut, and the audio runs straight through it.
 *
 * Audio rides on the video. Each OffthreadVideo carries its own slice of the
 * original take, so cutting the picture cuts the voiceover to match and there is
 * no separate track to drift out of sync.
 */

/** Drift across a shot, on top of its base scale. Small: the cut is the energy. */
const DRIFT = 0.022;

export const Speaker: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {plan.cuts.map((cut, i) => (
        <Sequence
          key={i}
          from={cut.fromFrame}
          durationInFrames={cut.durationInFrames}
          layout="none"
        >
          <Shot cut={cut} local={frame - cut.fromFrame} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const Shot: React.FC<{
  cut: (typeof plan.cuts)[number];
  local: number;
}> = ({ cut, local }) => {
  // Alternate drift direction by shot so the movement never accumulates into
  // one long creep across the video.
  const inward = cut.srcStartFrame % 2 === 0;
  const drift = interpolate(
    local,
    [0, cut.durationInFrames],
    inward ? [0, DRIFT] : [DRIFT, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const scale = cut.framing.scale + drift;

  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        transform: `scale(${scale}) translate(${cut.framing.x * 100}%, ${cut.framing.y * 100}%)`,
      }}
    >
      <OffthreadVideo
        src={staticFile('flywheel/source.mp4')}
        trimBefore={cut.srcStartFrame}
        trimAfter={cut.srcEndFrame}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </AbsoluteFill>
  );
};
