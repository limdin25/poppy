// buildOutgoingTwiml — pure TwiML builder for the manual-dial outbound flow.
//
// Lives under src/ so vitest can exercise it directly. The Deno edge
// function `supabase/functions/wk-voice-twiml-outgoing/index.ts` keeps an
// inline copy of this exact function (Deno deploy can't import from src/).
// If you change one, change the other — the tests pin the contract.
//
// Audit reference: live coach refactor — switched from <Start><Stream>
// (WebSocket-based, unreliable behind Supabase Edge Functions, returned
// Twilio error 31920 every time) to <Start><Transcription> which delivers
// transcripts over plain HTTP webhooks. wk-voice-transcription handles the
// inserts and triggers OpenAI Chat for coaching events.

export interface BuildOutgoingTwimlArgs {
  /** E.164 destination number to dial through Twilio. */
  to: string;
  /** Caller-ID number (E.164) to present to the callee. May be null. */
  callerIdE164: string | null;
  /** Public URL Twilio will POST when the bridge ends (status webhook). */
  statusUrl: string;
  /** Public URL Twilio will POST when the recording is ready. */
  recordingUrl: string;
  /**
   * Public URL of wk-voice-transcription. When provided, we emit
   * `<Start><Transcription …/></Start>` before `<Dial>` so Twilio's
   * Real-Time Transcription forwards transcript chunks to that endpoint
   * over HTTP POST. Pass null to skip (kill switch / coach disabled /
   * openai key empty) — call still bridges normally.
   */
  transcriptionCallbackUrl: string | null;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildOutgoingTwiml(args: BuildOutgoingTwimlArgs): string {
  const callerIdAttr = args.callerIdE164
    ? `callerId="${escapeXml(args.callerIdE164)}"`
    : '';

  // PR 29 (Hugo 2026-04-27): bumped `timeout` to 60s. Twilio's default
  // is 30s — if the destination phone hasn't picked up by then the
  // dial leg drops, which Hugo hit while testing with the callee's
  // phone on silent. 60s is the common "give them a minute" pattern;
  // anything beyond that and most carriers route to voicemail anyway.
  const dialBlock = [
    `<Dial ${callerIdAttr} answerOnBridge="true" timeout="60" record="record-from-answer-dual"`,
    `      recordingStatusCallback="${escapeXml(args.recordingUrl)}"`,
    `      recordingStatusCallbackEvent="completed"`,
    `      action="${escapeXml(args.statusUrl)}"`,
    `      method="POST">`,
    `  <Number>${escapeXml(args.to)}</Number>`,
    `</Dial>`,
  ].join('\n');

  // <Start><Transcription> must come BEFORE <Dial> so transcription begins
  // the moment the bridge connects. Per Twilio docs, for OUTBOUND calls the
  // tracks are:
  //   inbound_track  → the agent (originator who triggered the dial)
  //   outbound_track → the dialed recipient (Hugo's "caller")
  // wk-voice-transcription reads `Track` directly to map back to the
  // speaker enum. Label attributes below are cosmetic (Twilio dashboard).
  const transcriptionBlock = args.transcriptionCallbackUrl
    ? [
        `<Start>`,
        `  <Transcription`,
        `    statusCallbackUrl="${escapeXml(args.transcriptionCallbackUrl)}"`,
        `    statusCallbackMethod="POST"`,
        `    track="both_tracks"`,
        `    languageCode="en-GB"`,
        `    enableAutomaticPunctuation="true"`,
        `    profanityFilter="false"`,
        `    speechModel="telephony"`,
        `    inboundTrackLabel="agent"`,
        `    outboundTrackLabel="caller"`,
        `    partialResults="false"`,
        `  />`,
        `</Start>`,
      ].join('\n')
    : '';

  const body = [transcriptionBlock, dialBlock].filter((s) => s.length > 0).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${body}\n</Response>`;
}
