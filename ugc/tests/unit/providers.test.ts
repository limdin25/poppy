// Provider request builders: exact URLs, headers and bodies, keys never in a
// URL, and the Fish prosody speed pinned at 1.2 on EVERY payload.

import { describe, it, expect } from 'vitest';
import {
  buildTtsRequest,
  buildCloneRequest,
  wavDurationSeconds,
  FISH_SPEED,
  MAX_TAKE_CHARS,
} from '../../src/core/providers/fish';

describe('fish TTS builder', () => {
  const base = { apiKey: 'k-secret', text: 'Hello there', referenceId: 'ref-1' };

  it('produces the proven call shape with speed 1.2 always', () => {
    const r = buildTtsRequest(base);
    expect(r.url).toBe('https://api.fish.audio/v1/tts');
    expect(r.headers['model']).toBe('s2.1-pro');
    expect(r.body.prosody.speed).toBe(1.2);
    expect(FISH_SPEED).toBe(1.2);
    expect(r.body.reference_id).toBe('ref-1');
    expect(r.body.format).toBe('wav');
    expect(r.body.normalize).toBe(true);
  });

  it('never leaks the key into the URL', () => {
    const r = buildTtsRequest(base);
    expect(r.url).not.toContain('k-secret');
    expect(r.headers['Authorization']).toBe('Bearer k-secret');
  });

  it('refuses empty text, over-long scripts and a missing voice', () => {
    expect(() => buildTtsRequest({ ...base, text: '  ' })).toThrow();
    expect(() => buildTtsRequest({ ...base, text: 'x'.repeat(MAX_TAKE_CHARS + 1) })).toThrow();
    expect(() => buildTtsRequest({ ...base, referenceId: '' })).toThrow();
  });
});

describe('fish clone builder', () => {
  it('clones private with fast training', () => {
    const r = buildCloneRequest({ apiKey: 'k', title: 'My voice' });
    expect(r.fields).toEqual({ title: 'My voice', train_mode: 'fast', visibility: 'private' });
  });

  it('refuses an unnamed voice', () => {
    expect(() => buildCloneRequest({ apiKey: 'k', title: ' ' })).toThrow();
  });
});

describe('wav duration', () => {
  it('reads 16-bit mono PCM length', () => {
    // 10 seconds at 44.1kHz mono 16-bit = 882000 PCM bytes + 44 header.
    expect(wavDurationSeconds(882044, 44100)).toBeCloseTo(10, 3);
    expect(wavDurationSeconds(44, 44100)).toBe(0);
  });
});
