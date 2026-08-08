import React from 'react';
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { TYPE } from '../beats';
import { DISPLAY_FAMILY } from '../useFlywheelFont';

/**
 * Kinetic typography: short emphasis lines, not subtitles.
 *
 * Full word-by-word captions are the other way to do this, and they are right
 * for a feed where the sound is off. This is a sales page, the viewer pressed
 * play, the sound is on, and a caption running under every word competes with
 * the twelve B-roll inserts for the same attention. So the type only fires on
 * the twenty lines that carry the argument.
 *
 * Lower third by default so it never sits over the speaker's face. The one hero
 * beat is the price, and it is the only line allowed to take the whole frame.
 */

const GOLD = '#f0c667';
const WHITE = '#ffffff';

export const Emphasis: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <>
      {TYPE.map((t, i) => (
        <Sequence
          key={`${t.at}-${i}`}
          from={Math.round(t.at * fps)}
          durationInFrames={Math.round(t.seconds * fps)}
          layout="none"
        >
          <Line beat={t} durationInFrames={Math.round(t.seconds * fps)} />
        </Sequence>
      ))}
    </>
  );
};

const Line: React.FC<{
  beat: (typeof TYPE)[number];
  durationInFrames: number;
}> = ({ beat, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hero = beat.style === 'hero';

  // Snap in on a stiff spring, hold, then leave quickly. The exit is a straight
  // ramp rather than a spring: a bouncy exit reads as indecisive.
  const enter = spring({ frame, fps, config: { damping: 200, stiffness: 340, mass: 0.5 } });
  const exit = interpolate(frame, [durationInFrames - 4, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const opacity = enter * exit;
  const scale = hero
    ? interpolate(enter, [0, 1], [0.86, 1])
    : interpolate(enter, [0, 1], [0.94, 1]);
  const lift = interpolate(enter, [0, 1], [26, 0]);

  const gold = new Set((beat.gold ?? []).map((w) => w.toUpperCase()));

  return (
    <AbsoluteFill
      style={{
        justifyContent: hero ? 'center' : 'flex-end',
        alignItems: 'center',
        paddingBottom: hero ? 0 : 96,
      }}
    >
      {/* The hero beat lands on the speaker's face, so it gets a scrim to sit on.
          The lower-third lines do not need one: they sit over his chest, where
          the shadow alone carries them. */}
      {hero ? (
        <AbsoluteFill
          style={{
            opacity: opacity * 0.82,
            background:
              'radial-gradient(ellipse 62% 52% at 50% 50%, rgba(0,0,0,0.86) 0%, rgba(0,0,0,0.66) 45%, rgba(0,0,0,0) 78%)',
          }}
        />
      ) : null}
      <div
        style={{
          fontFamily: `${DISPLAY_FAMILY}, sans-serif`,
          fontWeight: 800,
          fontSize: hero ? 320 : 96,
          letterSpacing: hero ? '-0.04em' : '-0.02em',
          lineHeight: 1,
          textAlign: 'center',
          opacity,
          // Dead centre would sit straight over the speaker's mouth while he is
          // still talking. Dropping the hero onto his chest keeps the price
          // dominant and leaves the face readable.
          transform: `translateY(${lift + (hero ? 150 : 0)}px) scale(${scale})`,
          // A hard shadow rather than a plate: the type has to stay legible over
          // both a dark living room and a bright B-roll insert, and a box behind
          // it would read as a caption bar.
          textShadow: '0 6px 34px rgba(0,0,0,0.86), 0 2px 8px rgba(0,0,0,0.7)',
          padding: '0 80px',
        }}
      >
        {beat.text.split(' ').map((word, i) => (
          <span key={i} style={{ color: gold.has(word.toUpperCase()) ? GOLD : WHITE }}>
            {word}
            {i < beat.text.split(' ').length - 1 ? ' ' : ''}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};
