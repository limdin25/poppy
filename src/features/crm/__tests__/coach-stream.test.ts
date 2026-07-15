// TDD harness for the streaming coach helpers (SSE parser + throttle).
// These pure functions live in
// supabase/functions/wk-voice-transcription/coach-stream.ts and are
// imported by both the Deno edge function AND this vitest suite. They
// must contain ZERO Deno-specific imports.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseSseChunk,
  createThrottledWriter,
  retrieveFacts,
  buildOpenerBanList,
  type CoachFact,
} from '../../../../supabase/functions/wk-voice-transcription/coach-stream';

describe('parseSseChunk — OpenAI streaming SSE parser', () => {
  it('returns no events for an empty buffer', () => {
    const out = parseSseChunk('');
    expect(out.events).toEqual([]);
    expect(out.remaining).toBe('');
  });

  it('parses a single delta event', () => {
    const buf = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n';
    const out = parseSseChunk(buf);
    expect(out.events).toEqual([{ delta: 'Hi', done: false }]);
    expect(out.remaining).toBe('');
  });

  it('parses multiple deltas in one chunk', () => {
    const buf =
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n' +
      'data: {"choices":[{"delta":{"content":" there"}}]}\n' +
      'data: {"choices":[{"delta":{"content":"!"}}]}\n';
    const out = parseSseChunk(buf);
    expect(out.events.map((e) => e.delta).join('')).toBe('Hi there!');
    expect(out.events.every((e) => !e.done)).toBe(true);
  });

  it('parses the [DONE] sentinel as a terminal event', () => {
    const buf =
      'data: {"choices":[{"delta":{"content":"end"}}]}\n' +
      'data: [DONE]\n';
    const out = parseSseChunk(buf);
    expect(out.events).toEqual([
      { delta: 'end', done: false },
      { delta: '', done: true },
    ]);
  });

  it('keeps an incomplete trailing line in remaining', () => {
    const buf =
      'data: {"choices":[{"delta":{"content":"complete"}}]}\n' +
      'data: {"choices":[{"delta":{"content":"par';
    const out = parseSseChunk(buf);
    expect(out.events).toEqual([{ delta: 'complete', done: false }]);
    expect(out.remaining).toMatch(/^data: \{"choices":\[\{"delta":\{"content":"par/);
  });

  it('skips lines that are not data: events (comments / heartbeats)', () => {
    const buf =
      ': heartbeat\n' +
      'event: ping\n' +
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n';
    const out = parseSseChunk(buf);
    expect(out.events).toEqual([{ delta: 'ok', done: false }]);
  });

  it('handles an event with no content delta (e.g. role-only first chunk)', () => {
    const buf = 'data: {"choices":[{"delta":{"role":"assistant"}}]}\n';
    const out = parseSseChunk(buf);
    expect(out.events).toEqual([{ delta: '', done: false }]);
  });

  it('survives malformed JSON gracefully', () => {
    const buf =
      'data: not-json\n' +
      'data: {"choices":[{"delta":{"content":"recovered"}}]}\n';
    const out = parseSseChunk(buf);
    expect(out.events).toEqual([{ delta: 'recovered', done: false }]);
  });
});

describe('createThrottledWriter — throttled async write', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the first write immediately', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const writer = createThrottledWriter(fn, 200);
    writer.schedule('a');
    // Allow the microtask queue to flush.
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('coalesces rapid schedules within the throttle window', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const writer = createThrottledWriter(fn, 200);
    writer.schedule('a');
    await vi.advanceTimersByTimeAsync(0);
    writer.schedule('a-b');
    writer.schedule('a-b-c');
    writer.schedule('a-b-c-d');
    // Inside the window — only the first immediate should have fired.
    expect(fn).toHaveBeenCalledTimes(1);
    // After the window expires, the latest pending value runs.
    await vi.advanceTimersByTimeAsync(200);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('a-b-c-d');
  });

  it('flush() forces an immediate write of the latest pending value', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const writer = createThrottledWriter(fn, 200);
    writer.schedule('first');
    await vi.advanceTimersByTimeAsync(0);
    writer.schedule('second');
    // second is queued but throttled — flush() should run it now.
    await writer.flush();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('second');
  });

  it('does not double-fire when flush() runs without pending', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const writer = createThrottledWriter(fn, 200);
    writer.schedule('only');
    await vi.advanceTimersByTimeAsync(0);
    await writer.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('subsequent schedule after the window fires immediately again', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const writer = createThrottledWriter(fn, 200);
    writer.schedule('a');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(250);
    writer.schedule('b');
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(2, 'b');
  });
});

describe('retrieveFacts — keyword-matched knowledge base lookup', () => {
  const facts: CoachFact[] = [
    {
      key: 'partner_count',
      label: 'Partners on the deal',
      value: 'About 14 partners already on this deal.',
      keywords: ['how many people', 'how many partners', 'partner count'],
    },
    {
      key: 'office_location',
      label: 'Office',
      value: 'Manchester, 9 Owen Street.',
      keywords: ['where are you based', 'office', 'address'],
    },
    {
      key: 'entry_minimum',
      label: 'Min entry',
      value: 'Entry from £500.',
      keywords: ['minimum', 'how much do i need', 'cheapest'],
    },
  ];

  it('returns no matches for an utterance that mentions none of the keywords', () => {
    expect(retrieveFacts('hello there', facts)).toEqual([]);
    expect(retrieveFacts('', facts)).toEqual([]);
  });

  it('matches a single fact by exact keyword phrase', () => {
    const m = retrieveFacts('How many people are on the deal?', facts);
    expect(m).toHaveLength(1);
    expect(m[0].key).toBe('partner_count');
  });

  it('matches multiple facts if the utterance hits multiple', () => {
    const m = retrieveFacts(
      "Where are you based and what's the minimum?",
      facts
    );
    const keys = m.map((f) => f.key).sort();
    expect(keys).toEqual(['entry_minimum', 'office_location']);
  });

  it('is case-insensitive', () => {
    const m = retrieveFacts('WHERE ARE YOU BASED', facts);
    expect(m).toHaveLength(1);
    expect(m[0].key).toBe('office_location');
  });

  it('does not double-match the same fact even if multiple keywords hit', () => {
    const m = retrieveFacts(
      'How many people, how many partners — partner count?',
      facts
    );
    expect(m).toHaveLength(1);
    expect(m[0].key).toBe('partner_count');
  });

  it('treats facts with no keywords as never-matching (skip)', () => {
    const withEmpty: CoachFact[] = [
      ...facts,
      { key: 'no_keywords', label: 'X', value: 'Y', keywords: [] },
    ];
    const m = retrieveFacts('partner count', withEmpty);
    expect(m.map((f) => f.key)).toEqual(['partner_count']);
  });

  it('handles undefined / null utterance defensively', () => {
    expect(retrieveFacts(undefined as unknown as string, facts)).toEqual([]);
  });
});

describe('buildOpenerBanList — first-3-words extracted from prior cards', () => {
  it('returns an empty list for no prior cards', () => {
    expect(buildOpenerBanList([])).toEqual([]);
  });

  it('extracts the first 3 words of each card, lowercased', () => {
    const out = buildOpenerBanList([
      'Yeah fair enough — the timing matters.',
      'Right, makes sense — what kind of returns?',
    ]);
    expect(out).toContain('yeah fair enough');
    expect(out).toContain('right, makes sense');
  });

  it('deduplicates identical openers (last 5 might overlap)', () => {
    const out = buildOpenerBanList([
      'No worries — we can keep it short.',
      'No worries — happy to keep it short.',
    ]);
    expect(out).toEqual(['no worries —']);
  });

  it('handles short cards (1-2 words) by joining what is available', () => {
    const out = buildOpenerBanList(['Sure thing.', 'Ok.', 'Right okay']);
    expect(out).toContain('sure thing.');
    expect(out).toContain('right okay');
    // 1-word cards are too short to form a meaningful 3-gram — skipped.
    expect(out).not.toContain('ok.');
  });

  it('skips empty / whitespace-only cards', () => {
    const out = buildOpenerBanList(['', '   ', 'Real card here mate.']);
    expect(out).toEqual(['real card here']);
  });

  it('strips punctuation that would defeat startsWith matching at the model side', () => {
    // Light normalisation: collapse repeated whitespace, lowercase.
    const out = buildOpenerBanList(['  Multiple   spaces here  .']);
    expect(out).toEqual(['multiple spaces here']);
  });

  it('handles non-string inputs defensively', () => {
    const out = buildOpenerBanList([
      null as unknown as string,
      undefined as unknown as string,
      'Real card here please.',
    ]);
    expect(out).toEqual(['real card here']);
  });
});
