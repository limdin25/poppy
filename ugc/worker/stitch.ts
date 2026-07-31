// ffmpeg command builders for the chunked (OmniHuman) path: split the
// approved voice track on planned chunk boundaries, then concat the rendered
// chunk videos with a re-encode (concat demuxer copies break on mismatched
// timebases across provider renders). Pure builders + a silencedetect parser
// so all of it unit-tests without ffmpeg.

import type { Chunk } from '../src/core/chunks';

export function buildSilenceDetectArgs(audioPath: string): string[] {
  return ['-i', audioPath, '-af', 'silencedetect=noise=-35dB:d=0.3', '-f', 'null', '-'];
}

// ffmpeg prints silencedetect results to stderr as
// "silence_start: 12.34" / "silence_end: 12.9 | silence_duration: 0.56".
// The cut candidates are silence MIDPOINTS (the safest place to cut speech).
export function parseSilences(stderr: string): number[] {
  const midpoints: number[] = [];
  let currentStart: number | null = null;
  for (const line of stderr.split('\n')) {
    const start = line.match(/silence_start:\s*([\d.]+)/);
    if (start) currentStart = Number(start[1]);
    const end = line.match(/silence_end:\s*([\d.]+)/);
    if (end && currentStart !== null) {
      midpoints.push((currentStart + Number(end[1])) / 2);
      currentStart = null;
    }
  }
  return midpoints;
}

export function buildAudioSplitArgs(audioPath: string, chunk: Chunk, outPath: string): string[] {
  return [
    '-i', audioPath,
    '-ss', chunk.startSec.toFixed(3),
    '-to', chunk.endSec.toFixed(3),
    '-c', 'copy',
    '-y', outPath,
  ];
}

// Concat with re-encode: normalises codec, timebase and pixel format across
// independently-rendered chunks. listPath is an ffmpeg concat list file.
export function buildConcatArgs(listPath: string, outPath: string): string[] {
  return [
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-y', outPath,
  ];
}

export function buildConcatList(chunkPaths: string[]): string {
  return chunkPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
}
