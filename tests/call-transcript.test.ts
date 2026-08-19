// The after-call transcript: the two things that fail SILENTLY if wrong.
//
// A backwards speaker map does not throw. It produces a readable transcript in
// which the agent appears to have said everything the branch said, which then
// travels into the cockpit brain, the ballpark and the 5:30 grade. Verified
// against real audio on 2026-08-18 (call 5d996797, outbound): AssemblyAI
// channel 1 carried Pedro, channel 2 carried the Rightmove IVR.

import { describe, it, expect } from 'vitest';
import { speakerFor } from '../api/cron/transcribe-calls.js';
import { formatTranscript, type TranscriptLine } from '../api/lib/call-transcript.js';

describe('speakerFor', () => {
  it('puts channel 1 on the agent for an outbound call', () => {
    expect(speakerFor('1', 'outbound')).toBe('agent');
    expect(speakerFor('2', 'outbound')).toBe('caller');
  });

  it('REVERSES on inbound, because there the caller dialled us', () => {
    expect(speakerFor('1', 'inbound')).toBe('caller');
    expect(speakerFor('2', 'inbound')).toBe('agent');
  });

  it('treats a missing direction as outbound, the overwhelmingly common case', () => {
    expect(speakerFor('1', null)).toBe('agent');
  });

  it('refuses to guess on any channel it does not know', () => {
    // AssemblyAI returns channel as a STRING. A number, an empty value or a
    // third channel must land on 'unknown' rather than defaulting to a real
    // speaker and inventing attribution.
    expect(speakerFor('', 'outbound')).toBe('unknown');
    expect(speakerFor('3', 'outbound')).toBe('unknown');
    expect(speakerFor('undefined', 'outbound')).toBe('unknown');
  });
});

describe('formatTranscript', () => {
  const lines: TranscriptLine[] = [
    { speaker: 'agent', body: 'Is the property on Royal Avenue still available?', ts: '2026-08-18T10:00:00Z' },
    { speaker: 'caller', body: 'Yes.', ts: '2026-08-18T10:00:05Z' },
    { speaker: 'agent', body: 'The budget would be £150,000 and maybe lower.', ts: '2026-08-18T10:00:09Z' },
  ];

  it('emits the SPEAKER: line shape every existing prompt already expects', () => {
    const out = formatTranscript(lines);
    expect(out).toContain('AGENT: Is the property on Royal Avenue still available?');
    expect(out).toContain('AGENT: The budget would be £150,000 and maybe lower.');
  });

  it('keeps the magnitude on a money figure', () => {
    // The whole point of the accurate transcript: Twilio wrote "£150" for this
    // line on 2026-08-18, dropping three zeros.
    expect(formatTranscript(lines)).toContain('£150,000');
  });

  it('drops empty lines, measuring the FORMATTED line as the existing readers do', () => {
    // The >8 floor is applied to "SPEAKER: body", not to the body, which is
    // how draft-offer-email and ballpark have always done it. So a short real
    // answer like "Yes." survives (12 chars formatted) and only a blank body
    // is dropped. Keeping "Yes." matters: it is half the answers on a call.
    const withBlank = [...lines, { speaker: 'caller', body: '   ', ts: '2026-08-18T10:00:12Z' }];
    const out = formatTranscript(withBlank);
    expect(out).toContain('CALLER: Yes.');
    expect(out.split('\n')).toHaveLength(3);
  });

  it('caps on characters, which is what protects the model context', () => {
    expect(formatTranscript(lines, 20).length).toBe(20);
  });
});
