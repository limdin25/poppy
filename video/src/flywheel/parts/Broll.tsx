import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { BROLL } from '../beats';

/**
 * B-roll inserts over the speaker.
 *
 * Hard in, hard out. A crossfade here would undo the point: the brief asks for
 * snappy, and a fade reads as slow no matter how short it is. The only movement
 * is a slow push, alternating direction per insert so twelve of them do not feel
 * like one long zoom.
 *
 * They cover the full frame rather than sitting in a corner. A talking head that
 * disappears for a beat and comes back at a different size is the thing that
 * resets attention; a picture-in-picture just adds clutter.
 */

/** How far each insert travels over its life. Enough to feel alive, not enough to notice. */
const PUSH = 0.06;

export const Broll: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <>
      {BROLL.map((b) => (
        <Sequence
          key={b.slug}
          from={Math.round(b.at * fps)}
          durationInFrames={Math.round(b.seconds * fps)}
          layout="none"
        >
          <Insert slug={b.slug} push={b.push} durationInFrames={Math.round(b.seconds * fps)} />
        </Sequence>
      ))}
    </>
  );
};

const Insert: React.FC<{
  slug: string;
  push: 'in' | 'out';
  durationInFrames: number;
}> = ({ slug, push, durationInFrames }) => {
  const frame = useCurrentFrame();

  const scale = interpolate(
    frame,
    [0, durationInFrames],
    push === 'in' ? [1, 1 + PUSH] : [1 + PUSH, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: '#000' }}>
      <Img
        src={staticFile(`flywheel/broll/${slug}.png`)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale})`,
        }}
      />
    </AbsoluteFill>
  );
};
