// Chunk planning for capped providers: greedy segmentation, silence-snapped
// cuts, no chunk over the cap, no sliver tails.

import { describe, it, expect } from 'vitest';
import { planChunks } from '../../src/core/chunks';

function lengths(chunks: ReturnType<typeof planChunks>): number[] {
  return chunks.map((c) => +(c.endSec - c.startSec).toFixed(3));
}

describe('planChunks', () => {
  it('8s -> 1 chunk, 30s -> 1 chunk (at the cap is fine)', () => {
    expect(planChunks(8)).toHaveLength(1);
    expect(planChunks(30)).toHaveLength(1);
  });

  it('31s -> 2 chunks with no sliver tail (the cut pulls back to protect a 3s minimum)', () => {
    const chunks = planChunks(31);
    expect(chunks).toHaveLength(2);
    expect(lengths(chunks)).toEqual([28, 3]);
  });

  it('60s -> 2 chunks, 61s -> 3 chunks, every chunk within the cap', () => {
    expect(planChunks(60)).toHaveLength(2);
    const chunks = planChunks(61);
    expect(chunks).toHaveLength(3);
    for (const len of lengths(chunks)) {
      expect(len).toBeLessThanOrEqual(30);
      expect(len).toBeGreaterThanOrEqual(3);
    }
  });

  it('chunks are contiguous, ordered and 0-indexed', () => {
    const chunks = planChunks(75);
    expect(chunks[0]!.startSec).toBe(0);
    expect(chunks[chunks.length - 1]!.endSec).toBe(75);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]!.startSec).toBe(chunks[i - 1]!.endSec);
      expect(chunks[i]!.seq).toBe(i);
    }
  });

  it('cuts snap to the LATEST silence inside the window (sentence boundaries win)', () => {
    const chunks = planChunks(45, { silences: [12, 26] });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.endSec).toBe(26);
  });

  it('a silence too close to the start is ignored (minimum chunk length)', () => {
    const chunks = planChunks(45, { silences: [1.5] });
    expect(chunks[0]!.endSec).toBe(30);
  });

  it('a silence that would leave a sliver tail is rejected in favour of a safe cut', () => {
    const chunks = planChunks(32, { silences: [30.5] });
    expect(chunks).toHaveLength(2);
    const tail = chunks[1]!;
    expect(tail.endSec - tail.startSec).toBeGreaterThanOrEqual(3);
  });

  it('zero or negative durations throw', () => {
    expect(() => planChunks(0)).toThrow();
    expect(() => planChunks(-5)).toThrow();
  });
});
