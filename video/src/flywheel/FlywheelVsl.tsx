import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, staticFile } from 'remotion';
import { z } from 'zod';
import { Broll } from './parts/Broll';
import { Emphasis } from './parts/Emphasis';
import { useFlywheelFont } from './useFlywheelFont';

/**
 * The Flywheel sales video.
 *
 * THE TAKE PLAYS WHOLE. No cuts, no zoom, no push. An earlier version cut the
 * pauses out and moved the framing on every shot; Hugo watched it and asked for
 * all of it gone. What is left is the recording as shot, the emphasis type over
 * it, and a quiet bed underneath.
 *
 * parts/Speaker.tsx is what did the cutting. It is no longer imported. The same
 * goes for data/plan.json and scripts/flywheel-plan.mjs, which built the cut
 * list. They are kept only because beats.ts timings were derived through them.
 */

/** Source take: 74.197s at 30fps. */
export const FLYWHEEL_FRAMES = 2226;

export const flywheelSchema = z.object({
  /** Filename inside public/flywheel/. Empty means silence under the voice. */
  musicSrc: z.string(),
  /**
   * Bed level, set by arithmetic rather than by ear, because the bed cannot be
   * measured inside the finished file: subtracting the source from the render
   * leaves mostly AAC re-encode residue, not music.
   *
   * bed.mp3 is -32.4 dB mean, the voice is -18.2 dB. Gain g puts the bed at
   * -32.4 + 20*log10(g). At 0.9 that is -33.3 dB, so 15 dB under the voice,
   * which is the normal place for a bed: plainly there in the pauses, never
   * competing with a word. 0.5 was the first guess and sat 20 dB down, which is
   * quiet enough to vanish on laptop speakers.
   */
  musicGain: z.number().min(0).max(1),
  /** The twelve generated inserts. Off: the brief came back as type and music only. */
  showBroll: z.boolean(),
});

export type FlywheelProps = z.infer<typeof flywheelSchema>;

export const DEFAULT_FLYWHEEL_PROPS: FlywheelProps = {
  musicSrc: 'bed.mp3',
  musicGain: 0.9,
  showBroll: false,
};

export const FlywheelVsl: React.FC<FlywheelProps> = ({ musicSrc, musicGain, showBroll }) => {
  // Hold frame 0 until the display face is on the page, or the first line can
  // render in a fallback and nobody notices until it is posted.
  useFlywheelFont();

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <OffthreadVideo
        src={staticFile('flywheel/source.mp4')}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
      {showBroll ? <Broll /> : null}
      <Emphasis />
      {musicSrc ? <Audio src={staticFile(`flywheel/${musicSrc}`)} volume={musicGain} /> : null}
    </AbsoluteFill>
  );
};
