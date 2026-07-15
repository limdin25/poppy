// Pins the TwiML returned by wk-voice-twiml-outgoing.
//
// Critical contract: when transcriptionCallbackUrl is set, the response MUST
// include <Start><Transcription> BEFORE <Dial>, with track="both_tracks"
// so Twilio Real-Time Transcription forwards both legs to our webhook.
// (Replaces the earlier <Start><Stream> + Supabase WebSocket bridge that
// returned Twilio error 31920 every call — switched 2026-04-26.)
//
// When transcriptionCallbackUrl is null, the response MUST be
// backwards-compatible (just <Dial>) — kill switch / coach disabled /
// openai key empty all collapse to the same null on the caller's side.

import { describe, it, expect } from 'vitest';
import { buildOutgoingTwiml } from '../buildOutgoingTwiml';

const BASE = {
  to: '+447863992555',
  callerIdE164: '+447380308316',
  statusUrl: 'https://loggyxryrhqsbtqpteog.supabase.co/functions/v1/wk-voice-status',
  recordingUrl: 'https://loggyxryrhqsbtqpteog.supabase.co/functions/v1/wk-voice-recording',
};

const TRANSCRIPTION_URL =
  'https://loggyxryrhqsbtqpteog.supabase.co/functions/v1/wk-voice-transcription';

describe('buildOutgoingTwiml — without transcription URL', () => {
  it('emits <Dial> with caller-ID and no <Start><Transcription>', () => {
    const out = buildOutgoingTwiml({ ...BASE, transcriptionCallbackUrl: null });
    expect(out).toContain('<Response>');
    expect(out).toContain('<Dial');
    expect(out).toContain('callerId="+447380308316"');
    expect(out).toContain('<Number>+447863992555</Number>');
    expect(out).not.toContain('<Start>');
    expect(out).not.toContain('<Transcription');
    expect(out).not.toContain('<Stream'); // legacy stream verb is gone
  });

  it('omits caller-ID attribute when null', () => {
    const out = buildOutgoingTwiml({
      ...BASE,
      callerIdE164: null,
      transcriptionCallbackUrl: null,
    });
    expect(out).not.toContain('callerId=');
    expect(out).toContain('<Dial');
  });
});

describe('buildOutgoingTwiml — with transcription URL', () => {
  it('includes <Start><Transcription> before <Dial>', () => {
    const out = buildOutgoingTwiml({
      ...BASE,
      transcriptionCallbackUrl: TRANSCRIPTION_URL,
    });
    const startIdx = out.indexOf('<Start>');
    const transcriptIdx = out.indexOf('<Transcription');
    const dialIdx = out.indexOf('<Dial');
    expect(startIdx).toBeGreaterThan(-1);
    expect(transcriptIdx).toBeGreaterThan(-1);
    expect(dialIdx).toBeGreaterThan(-1);
    expect(startIdx).toBeLessThan(dialIdx);
    expect(transcriptIdx).toBeLessThan(dialIdx);
  });

  it('uses track="both_tracks" so caller AND agent audio reach the webhook', () => {
    const out = buildOutgoingTwiml({
      ...BASE,
      transcriptionCallbackUrl: TRANSCRIPTION_URL,
    });
    expect(out).toContain('track="both_tracks"');
  });

  it('points statusCallbackUrl at the transcription webhook (XML-escaped)', () => {
    const out = buildOutgoingTwiml({
      ...BASE,
      transcriptionCallbackUrl: 'https://example.test/cb?x=1&y=2',
    });
    // Ampersand must be escaped to &amp; for valid XML.
    expect(out).toContain('statusCallbackUrl="https://example.test/cb?x=1&amp;y=2"');
  });

  it('labels tracks per Twilio outbound-call semantics (inbound=agent, outbound=caller)', () => {
    // Twilio docs: for an outbound dial, inbound_track is the originator
    // (agent) and outbound_track is the recipient (caller). Labels here
    // are cosmetic for the Twilio dashboard; wk-voice-transcription does
    // its own mapping via the Track field.
    const out = buildOutgoingTwiml({
      ...BASE,
      transcriptionCallbackUrl: TRANSCRIPTION_URL,
    });
    expect(out).toContain('inboundTrackLabel="agent"');
    expect(out).toContain('outboundTrackLabel="caller"');
  });

  it('uses partialResults="false" — only final chunks, no draft noise', () => {
    const out = buildOutgoingTwiml({
      ...BASE,
      transcriptionCallbackUrl: TRANSCRIPTION_URL,
    });
    expect(out).toContain('partialResults="false"');
  });

  it('still emits the <Dial> block with caller-ID + recording webhook', () => {
    const out = buildOutgoingTwiml({
      ...BASE,
      transcriptionCallbackUrl: TRANSCRIPTION_URL,
    });
    expect(out).toContain('<Dial');
    expect(out).toContain('callerId="+447380308316"');
    expect(out).toContain('record="record-from-answer-dual"');
    expect(out).toContain('<Number>+447863992555</Number>');
  });
});
