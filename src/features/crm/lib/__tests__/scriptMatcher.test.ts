// Unit tests for the teleprompter fuzzy matcher (PR 5).
//
// Goals:
//   - tokenize() drops stopwords + punctuation but keeps content words.
//   - jaccard() symmetric, bounded [0..1].
//   - matchChunkToBlock() respects threshold + sequential pointer.

import { describe, it, expect } from 'vitest';
import {
  tokenize,
  jaccard,
  matchChunkToBlock,
  blockText,
} from '../scriptMatcher';
import { parseBlocks } from '../scriptParser';

describe('tokenize', () => {
  it('drops stopwords, punctuation, casing', () => {
    const toks = tokenize(
      "Hi, this is Hugo from Elsie — saw you in the property WhatsApp group."
    );
    // "i" is a stopword; "from", "is", "this", "you", "in", "the" filtered.
    expect(toks).toContain('hugo');
    expect(toks).toContain('elsie');
    expect(toks).toContain('saw');
    expect(toks).toContain('property');
    expect(toks).toContain('whatsapp');
    expect(toks).toContain('group');
    expect(toks).not.toContain('the');
    expect(toks).not.toContain('this');
    expect(toks).not.toContain('you');
    expect(toks).not.toContain('i');
  });

  it('strips Markdown markers and {{placeholders}}', () => {
    const toks = tokenize('**Hi {{first_name}}**, *welcome*.');
    expect(toks).toEqual(['hi', 'welcome']);
  });

  it('returns empty for empty / whitespace', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('jaccard', () => {
  it('1 for identical token sets', () => {
    expect(jaccard(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1);
  });
  it('0 for disjoint sets', () => {
    expect(jaccard(['a', 'b'], ['c', 'd'])).toBe(0);
  });
  it('handles partial overlap', () => {
    // {a,b,c} vs {b,c,d}: intersection 2, union 4 → 0.5
    expect(jaccard(['a', 'b', 'c'], ['b', 'c', 'd'])).toBe(0.5);
  });
  it('returns 0 for empty input', () => {
    expect(jaccard([], ['a'])).toBe(0);
    expect(jaccard(['a'], [])).toBe(0);
  });
  it('is symmetric', () => {
    const a = ['hugo', 'elsie', 'whatsapp'];
    const b = ['elsie', 'whatsapp', 'group'];
    expect(jaccard(a, b)).toEqual(jaccard(b, a));
  });
});

describe('blockText', () => {
  it('returns the text content of each block kind', () => {
    const blocks = parseBlocks(
      [
        '# Heading',
        'Paragraph text.',
        '- one',
        "- If busy: come back later",
        '> quote',
        '---',
      ].join('\n')
    );
    expect(blockText(blocks[0])).toBe('Heading');
    expect(blockText(blocks[1])).toBe('Paragraph text.');
    // ul block aggregates its items
    expect(blockText(blocks[2])).toContain('one');
    expect(blockText(blocks[2])).toContain('busy');
    expect(blockText(blocks[2])).toContain('come back later');
    expect(blockText(blocks[3])).toBe('quote');
    expect(blockText(blocks[4])).toBe('');
  });
});

describe('matchChunkToBlock', () => {
  const seed = [
    "Hi {{first_name}}, this is {{agent_first_name}} from Elsie — saw you in the property WhatsApp group.",
    'Are you actively looking at Airbnb deals right now, or just keeping an eye on the market?',
    "Would it be okay if I quickly explain how our deals work? Two minutes max.",
    "We run Airbnb properties as Joint Venture Partnerships. Partners pool money into a deal.",
  ].join('\n\n');
  const blocks = parseBlocks(seed);

  it('matches an agent transcript chunk to the corresponding block', () => {
    const chunk =
      "Hi Sarah this is Tom from Elsie saw you in our property WhatsApp group";
    const res = matchChunkToBlock(chunk, blocks, 0);
    expect(res.matchedIdx).toBe(0);
    expect(res.score).toBeGreaterThanOrEqual(0.45);
  });

  it('respects the sequential pointer — chunks matching an earlier block return null', () => {
    const earlierChunk =
      'Hi Sarah this is Tom from Elsie saw you in our property WhatsApp group';
    // fromIdx = 2 → blocks 0 and 1 are off-limits
    const res = matchChunkToBlock(earlierChunk, blocks, 2);
    expect(res.matchedIdx).toBeNull();
  });

  it('drops short utterances (< 6 useful tokens) — yeah, right, ok', () => {
    expect(matchChunkToBlock('yeah', blocks, 0).matchedIdx).toBeNull();
    expect(matchChunkToBlock('right ok', blocks, 0).matchedIdx).toBeNull();
    expect(
      matchChunkToBlock("yeah I'm with you on that one", blocks, 0).matchedIdx
    ).toBeNull();
  });

  it('honours the threshold — weak overlap returns null', () => {
    const weakChunk = 'I had pasta for lunch yesterday it was nice';
    const res = matchChunkToBlock(weakChunk, blocks, 0);
    expect(res.matchedIdx).toBeNull();
  });

  it('matches the QUALIFY block when read aloud', () => {
    const chunk =
      'are you actively looking at Airbnb deals right now or just keeping an eye on the market';
    const res = matchChunkToBlock(chunk, blocks, 0);
    expect(res.matchedIdx).toBe(1);
  });

  it('matches the JV pitch block when read aloud, advancing past Qualify', () => {
    const chunk =
      'we run Airbnb properties as joint venture partnerships partners pool money into a deal';
    const res = matchChunkToBlock(chunk, blocks, 2);
    expect(res.matchedIdx).toBe(3);
  });
});
