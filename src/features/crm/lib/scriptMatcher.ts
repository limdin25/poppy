// Fuzzy matcher: link agent transcript chunks to parsed script blocks
// for the live-call teleprompter (PR 5).
//
// Design:
//   - Pure functions, no React or Supabase imports — testable in
//     isolation; the hook (useScriptReadTracking) layers realtime
//     state on top.
//   - Token-set Jaccard rather than Levenshtein. Twilio transcription
//     drops words and changes punctuation; word-set overlap is more
//     tolerant of that than character-edit distance.
//   - Sequential matching: once block N has been marked read, only
//     blocks at index ≥ N + 1 can match next. Stops the matcher
//     "snapping back" to an earlier block when the agent re-uses
//     common words ("yeah / right / let me check…").
//   - Floor on chunk length: agent utterances under 6 useful tokens
//     are ignored to keep "yeah" / "okay" from drifting the cursor.

import type { Block } from './scriptParser';

// Common English filler / function words. Removed before scoring so
// matches reflect content overlap, not "the / and / I" overlap.
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'to',
  'of',
  'in',
  'on',
  'for',
  'at',
  'by',
  'with',
  'from',
  'into',
  'about',
  'as',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'i',
  'you',
  'he',
  'she',
  'we',
  'they',
  'me',
  'him',
  'her',
  'us',
  'them',
  'my',
  'your',
  'his',
  'their',
  'our',
  'do',
  'does',
  'did',
  'doing',
  'have',
  'has',
  'had',
  'having',
  'will',
  'would',
  'shall',
  'should',
  'can',
  'could',
  'may',
  'might',
  'must',
  'so',
  'if',
  'then',
  'than',
  'just',
  'um',
  'uh',
  'er',
  'ah',
  'oh',
  'yeah',
  'yep',
  'no',
  'ok',
  'okay',
  'right',
]);

/** Tokenise a string for matching: lowercase, strip Markdown / template
 *  placeholders, drop punctuation and stopwords, return remaining word
 *  stems. Public so the hook + tests can reuse it. */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const cleaned = text
    .toLowerCase()
    // Remove {{first_name}} / {{agent_first_name}} placeholders so a
    // pre-substitution block doesn't accidentally token-match the
    // literal placeholder string.
    .replace(/\{\{[^}]*\}\}/g, ' ')
    // Strip light Markdown markup so the matcher works on rendered text.
    .replace(/[*_`>#-]/g, ' ')
    // Punctuation → spaces. Keep apostrophes inside words ("don't")
    // by transforming them to nothing (so it tokenises to "dont").
    .replace(/'/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ');
  return cleaned
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

/** Extract the matchable text of a parsed script block. Returns empty
 *  string for HRule (no text). For IF list items, includes both the
 *  condition and the body. */
export function blockText(block: Block): string {
  switch (block.type) {
    case 'h':
      return block.text;
    case 'p':
      return block.text;
    case 'q':
      return block.text;
    case 'hr':
      return '';
    case 'ul':
      return block.items
        .map((it) =>
          it.kind === 'if'
            ? `${it.condition ?? ''} ${it.text}`
            : it.text
        )
        .join(' ');
  }
}

/** Jaccard ratio of two token arrays. 0 = no overlap, 1 = identical
 *  sets. Punishes short chunks naturally because the union grows with
 *  the longer side. */
export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const unionSize = setA.size + setB.size - intersection;
  if (unionSize === 0) return 0;
  return intersection / unionSize;
}

interface MatchOpts {
  /** Minimum Jaccard ratio to count as a match. Default 0.45. */
  threshold?: number;
  /** Minimum tokens after stopword filtering before a chunk is scored.
   *  Below this, the chunk is ignored. Default 6. */
  minTokens?: number;
}

interface MatchResult {
  /** Index of the matched block, or null if nothing crossed threshold. */
  matchedIdx: number | null;
  /** Score of the best block (>= threshold when matchedIdx is non-null). */
  score: number;
}

/** Find the best block at or after `fromIdx` whose tokens overlap the
 *  chunk tokens above the threshold. Sequential-only — earlier blocks
 *  are deliberately skipped to prevent the cursor from backsliding. */
export function matchChunkToBlock(
  chunkText: string,
  blocks: Block[],
  fromIdx: number,
  opts: MatchOpts = {}
): MatchResult {
  const threshold = opts.threshold ?? 0.45;
  const minTokens = opts.minTokens ?? 6;
  const chunkTokens = tokenize(chunkText);
  if (chunkTokens.length < minTokens) {
    return { matchedIdx: null, score: 0 };
  }
  let bestIdx: number | null = null;
  let bestScore = 0;
  for (let i = Math.max(0, fromIdx); i < blocks.length; i++) {
    const blockTokens = tokenize(blockText(blocks[i]));
    if (blockTokens.length === 0) continue;
    const score = jaccard(chunkTokens, blockTokens);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestScore >= threshold) {
    return { matchedIdx: bestIdx, score: bestScore };
  }
  return { matchedIdx: null, score: bestScore };
}
