// Chunk planning for providers with a per-generation duration cap (OmniHuman
// at 30s). Greedy segmentation: each chunk runs as long as the cap allows,
// cutting at the latest detected silence inside the window so the stitch
// lands between sentences and reads as a natural UGC jump cut. The default
// Kling path (5-minute single takes) never needs this; it exists for the
// premium contender and as safety for any capped provider.

export interface Chunk {
  seq: number;
  startSec: number;
  endSec: number;
}

export interface ChunkOptions {
  maxChunkSec?: number;
  // A tail shorter than this reads as a glitch; the final cut moves back to
  // guarantee it. Also the minimum length of any silence-snapped chunk.
  minChunkSec?: number;
  // Candidate cut points (centre of detected silences), seconds from start.
  silences?: number[];
}

export function planChunks(totalSec: number, opts: ChunkOptions = {}): Chunk[] {
  const max = opts.maxChunkSec ?? 30;
  const min = opts.minChunkSec ?? 3;
  const silences = [...(opts.silences ?? [])].sort((a, b) => a - b);

  if (!(totalSec > 0)) throw new Error(`Cannot chunk a ${totalSec}s clip`);
  if (max <= min) throw new Error('maxChunkSec must exceed minChunkSec');

  const chunks: Chunk[] = [];
  let pos = 0;
  let seq = 0;

  while (totalSec - pos > max) {
    // Prefer the latest silence inside (pos + min, pos + max]; fall back to a
    // hard cut at the cap.
    const candidates = silences.filter((s) => s > pos + min && s <= pos + max);
    let cut = candidates.length ? candidates[candidates.length - 1]! : pos + max;

    // Never leave a sliver of a tail: pull the cut back so the remainder
    // stays at least min seconds long.
    if (totalSec - cut < min) {
      const safeCandidates = silences.filter((s) => s > pos + min && s <= totalSec - min);
      cut = safeCandidates.length ? safeCandidates[safeCandidates.length - 1]! : totalSec - min;
    }

    chunks.push({ seq, startSec: pos, endSec: cut });
    seq += 1;
    pos = cut;
  }

  chunks.push({ seq, startSec: pos, endSec: totalSec });
  return chunks;
}
