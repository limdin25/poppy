// Stitch builders: silencedetect parsing to midpoints, split windows, and a
// concat command that re-encodes (a copy concat breaks on mismatched
// provider timebases).

import { describe, it, expect } from 'vitest';
import {
  parseSilences,
  buildSilenceDetectArgs,
  buildAudioSplitArgs,
  buildConcatArgs,
  buildConcatList,
} from '../../worker/stitch';

describe('parseSilences', () => {
  it('pairs starts with ends and returns midpoints', () => {
    const stderr = [
      '[silencedetect @ 0x1] silence_start: 10.0',
      '[silencedetect @ 0x1] silence_end: 11.0 | silence_duration: 1.0',
      'frame= 100',
      '[silencedetect @ 0x1] silence_start: 24.5',
      '[silencedetect @ 0x1] silence_end: 25.5 | silence_duration: 1.0',
    ].join('\n');
    expect(parseSilences(stderr)).toEqual([10.5, 25]);
  });

  it('ignores an unpaired trailing start', () => {
    expect(parseSilences('silence_start: 5.0')).toEqual([]);
  });
});

describe('command builders', () => {
  it('silencedetect runs to the null muxer (no output file)', () => {
    const args = buildSilenceDetectArgs('/tmp/a.wav');
    expect(args).toContain('silencedetect=noise=-35dB:d=0.3');
    expect(args.slice(-2)).toEqual(['null', '-']);
  });

  it('audio split cuts the exact chunk window with stream copy', () => {
    const args = buildAudioSplitArgs('/tmp/a.wav', { seq: 1, startSec: 28, endSec: 31 }, '/tmp/c1.wav');
    expect(args.join(' ')).toContain('-ss 28.000 -to 31.000 -c copy');
  });

  it('concat re-encodes instead of copying', () => {
    const args = buildConcatArgs('/tmp/list.txt', '/tmp/out.mp4');
    expect(args).toContain('libx264');
    expect(args).toContain('yuv420p');
    expect(args.join(' ')).not.toContain('-c copy');
  });

  it('concat lists escape single quotes in paths', () => {
    const list = buildConcatList(["/tmp/it's.mp4"]);
    expect(list).toBe("file '/tmp/it'\\''s.mp4'\n");
  });
});
