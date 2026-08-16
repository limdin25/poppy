// wk-voice-transcription — Twilio Real-Time Transcription webhook receiver.
//
// Why this exists:
//   The earlier <Start><Stream> + Supabase WebSocket bridge approach
//   failed reliably (Twilio error 31920) because Supabase Edge Functions'
//   WebSocket layer is unreliable for inbound Twilio Media Streams
//   connections. We've switched to Twilio's native Real-Time Transcription
//   verb which delivers transcripts over HTTP POST — no WebSocket needed.
//
// Flow:
//   1. wk-voice-twiml-outgoing emits <Start><Transcription
//      statusCallbackUrl="…/wk-voice-transcription" track="both_tracks"/>
//   2. Twilio transcribes both legs of the call in real time and POSTs
//      transcript chunks here as they're produced.
//   3. We INSERT each chunk into wk_live_transcripts (LiveTranscriptPane
//      subscribes via Supabase realtime → live UI).
//   4. For caller utterances, we async-POST the rolling transcript to
//      OpenAI Chat to generate coaching suggestions and INSERT them into
//      wk_live_coach_events (AI coach pane subscribes via realtime).
//
// AUTH: Twilio HMAC-SHA1 signature. URL is public (verify_jwt = false).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import {
  parseSseChunk,
  createThrottledWriter,
  retrieveFacts,
  buildOpenerBanList,
  type CoachFact,
} from './coach-stream.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-twilio-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ----------------------------------------------------------------------------
// HEARING AN EMAIL ADDRESS. Hugo, 2026-08-14: "the brain recognizes he's asking
// for the email ... it types the agent address" so Pedro does not have to spell
// it back while the branch is still talking.
//
// The block between the markers is COPIED VERBATIM from api/lib/spoken-email.ts
// (a Deno edge function cannot import from api/lib). tests/spoken-email.test.ts
// compares the two character for character and fails the build if they drift.
// Edit the api/lib copy, then paste it here. Nothing else may live inside the
// markers.
// ----------------------------------------------------------------------------

// --- spoken-email:start
/** Words that mean punctuation when somebody reads an address out loud. */
const SPOKEN_SYMBOLS: Record<string, string> = {
  dot: '.', point: '.', period: '.', stop: '.',
  at: '@',
  underscore: '_', under: '_',
  dash: '-', hyphen: '-', minus: '-',
};

/** Noise that turns up around a spoken address and is never part of one. */
const SPOKEN_NOISE = new Set([
  'my', 'the', 'best', 'email', 'e-mail', 'address', 'is', 'its', "it's", 'it', 'so',
  'you', 'can', 'send', 'to', 'me', 'on', 'that', 'would', 'be', 'just', 'and',
  'um', 'uh', 'er', 'yeah', 'okay', 'ok', 'right', 'sure', 'please', 'thanks',
  'lowercase', 'lower', 'case', 'uppercase', 'all', 'one', 'word', 'letter',
  'full',
]);

/** A literal address, the easy case: the transcriber already joined it up. */
const LITERAL_RE = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/i;

/** What an address has to look like before we hand it to anybody. */
const VALID_RE = /^[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.[a-z]{2,10}$/;

/**
 * The address somebody just said, or null.
 *
 * Handles the literal form and the spoken form, including a domain read as
 * separate words ("ddm residential dot co dot uk"), which is joined up because
 * that is what the domain actually is.
 */
export function extractEmail(text: string | null | undefined): string | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  // 1. Already an address. Strip the punctuation a sentence leaves on the end.
  const literal = raw.match(LITERAL_RE);
  if (literal) {
    const hit = literal[0].toLowerCase().replace(/[.,;:!?)"']+$/, '');
    if (VALID_RE.test(hit)) return hit;
  }

  // 2. Spoken. Only worth trying when the word "at" is in there somewhere:
  //    without it there is no address, only a domain at best.
  const words = raw
    .toLowerCase()
    .replace(/[,;:!?"()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const atIndex = words.findIndex((w) => w === 'at' || w === '@');
  if (atIndex < 1) return null;

  // A window either side. Wide enough for "doug dot allen at ddm residential
  // dot co dot uk", tight enough that half a sentence cannot wander in.
  const before = words.slice(Math.max(0, atIndex - 8), atIndex);
  const after = words.slice(atIndex + 1, atIndex + 10);

  const render = (list: string[]): string => list
    .map((w) => w.replace(/[.]+$/, (m) => m))
    .filter((w) => !SPOKEN_NOISE.has(w))
    .map((w) => (SPOKEN_SYMBOLS[w] !== undefined && w !== 'at' ? SPOKEN_SYMBOLS[w] : w))
    .join('')
    .replace(/[^a-z0-9._%+-]/g, '');

  const local = render(before);
  const domain = render(after);
  if (!local || !domain) return null;

  const candidate = `${local}@${domain}`.replace(/\.+/g, '.').replace(/^\.|\.$/g, '');
  if (!VALID_RE.test(candidate)) return null;
  // A domain with no dot in it was never an address, and "at" is a common word.
  if (!candidate.split('@')[1].includes('.')) return null;
  return candidate;
}
// --- spoken-email:end

/** Cheap gate: only look for an address on a line that mentions one. */
function mentionsEmail(text: string | null | undefined): boolean {
  return /\be-?mail\b|@/i.test(String(text ?? ''));
}

// ----------------------------------------------------------------------------
// HEARING WHO YOU ARE SPEAKING TO. Hugo, 2026-08-14: "we need to ask for the
// agent name, and if the AI captured the agent name then it has to add
// automatically", after a board card rendered "Name not available" over a
// branch Pedro had spoken to twice.
//
// The block between the markers is COPIED VERBATIM from api/lib/spoken-name.ts
// (a Deno edge function cannot import from api/lib). tests/spoken-name.test.ts
// compares the two character for character and fails the build if they drift.
// Edit the api/lib copy, then paste it here. Nothing else may live inside the
// markers.
// ----------------------------------------------------------------------------

// --- spoken-name:start
/** The phrases somebody actually uses to say who they are, or to read it back.
 *
 *  Deliberately short. Every pattern here is an EXPLICIT introduction; there is
 *  no "a capitalised word near the start" rule, because a transcriber
 *  capitalises street names, agency names and the odd random noun, and each of
 *  those would become somebody's name. */
const NAME_PATTERNS: RegExp[] = [
  // "you're through to Doug", "you are speaking to Doug Allen"
  /\byou(?:'re|s? are|r)?\s+(?:through|speaking|talking)\s+(?:to|with)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)/i,
  // "my name is Lucy", "my name's Lucy Barnes"
  /\bmy name(?:'s| is)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)/i,
  // "Zest, Lucy speaking"
  /\b([a-z][a-z'-]*)\s+speaking\b/i,
  // "this is Doug", "it's Doug"
  /\b(?:this is|it'?s)\s+([a-z][a-z'-]*)\b/i,
  // Pedro reading it back: "am I speaking to Doug", "is that Doug"
  /\b(?:am i speaking (?:to|with)|is (?:that|this))\s+([a-z][a-z'-]*)\b/i,
];

/** Words that follow those phrases every day and are never the person's name.
 *
 *  "this is fine", "you're speaking to the wrong branch", "it's about the
 *  property" all match a pattern above and all have to lose. */
const NOT_A_NAME = new Set([
  // pronouns. "you're speaking to..." matches the "X speaking" pattern with X
  // = "you're", which is how the very first run of this offered Pedro the name
  // "You're".
  'i', 'you', 'we', 'he', 'she', 'they', 'im', 'ive', 'youre', 'weve',
  // grammar that follows "this is" / "speaking to" far more often than a name
  'a', 'an', 'the', 'my', 'your', 'our', 'his', 'her', 'their', 'its', 'it',
  'that', 'this', 'these', 'those', 'there', 'here', 'me', 'him', 'them', 'us',
  'who', 'what', 'which', 'someone', 'somebody', 'anyone', 'nobody', 'everyone',
  // filler and reactions
  'yes', 'yeah', 'no', 'nope', 'ok', 'okay', 'right', 'sure', 'fine', 'good',
  'great', 'lovely', 'perfect', 'sorry', 'thanks', 'well', 'so', 'just', 'only',
  'actually', 'really', 'still', 'now', 'then', 'about', 'because', 'but', 'and',
  'not', 'never', 'always', 'maybe', 'probably', 'obviously', 'basically',
  // the shape of a property call
  'calling', 'ringing', 'going', 'looking', 'selling', 'buying', 'regarding',
  'property', 'house', 'flat', 'branch', 'office', 'vendor', 'buyer', 'seller',
  'agent', 'landlord', 'owner', 'director', 'manager', 'team', 'company',
  'wrong', 'right', 'main', 'sales', 'lettings', 'reception', 'number',
  'morning', 'afternoon', 'evening', 'today', 'tomorrow', 'yesterday',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  // our own side. Pedro introduces himself on every single call, and the coach
  // would otherwise file OUR name as the branch contact on all of them.
  'pedro', 'hugo', 'unico', 'elsie', 'heyelsie',
]);

/**
 * The name somebody just gave, capitalised, or null.
 *
 * Two words at most: "Doug" and "Doug Allen" are both real answers, a third
 * word means the pattern has run off the end of the introduction and into the
 * rest of the sentence.
 */
export function extractSpokenName(text: string | null | undefined): string | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  for (const re of NAME_PATTERNS) {
    const m = raw.match(re);
    if (!m || !m[1]) continue;

    const words = m[1]
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    if (words.length === 0) continue;

    // Every word has to look like a name AND not be on the list. Checking every
    // word rather than the first is what kills "speaking to the vendor".
    const clean = words.filter((w) => /^[a-z][a-z'-]{1,19}$/i.test(w));
    if (clean.length !== words.length) continue;
    if (clean.some((w) => NOT_A_NAME.has(w.toLowerCase()))) continue;
    // A CONTRACTION IS NEVER A NAME. "it's", "that's", "you're", "I'm" all pass
    // the shape test above because an apostrophe is legal in O'Brien. No real
    // name ends in one of these, so the ending is what tells them apart.
    if (clean.some((w) => /'(re|s|m|ll|ve|d|t)$/i.test(w))) continue;

    // A one-letter or two-letter "name" is a transcription artefact.
    if (clean[0].length < 3) continue;

    // "o'brien" -> "O'Brien", "anne-marie" -> "Anne-Marie": a name capitalises
    // after its own punctuation, not only at the front.
    return clean
      .map((w) => w.toLowerCase().replace(/(^|['-])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase()))
      .join(' ');
  }
  return null;
}
// --- spoken-name:end

/** Cheap gate: only look for a name on a line that reads like an introduction. */
function mentionsName(text: string | null | undefined): boolean {
  return /\b(speaking|talking|through to|my name|this is|it'?s|is that|is this)\b/i.test(
    String(text ?? ''),
  );
}

// ----------------------------------------------------------------------------
// Twilio signature validation — same pattern as wk-voice-twiml-outgoing.
// ----------------------------------------------------------------------------

async function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>
): Promise<boolean> {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) data += key + params[key];
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return signature === expected;
}

// ----------------------------------------------------------------------------
// PR 58 (Hugo 2026-04-27): stage cursor from agent voice.
//
// The stage cursor (wk_calls.current_stage) used to advance ONLY when
// the coach itself fired a SCRIPT card. If the agent read aloud a
// section's opening line themselves, the cursor stayed put — so the
// coach could later regress to an earlier stage. This block detects
// the agent's progression by matching their transcript against the
// script's anchor lines and bumping current_stage forward when a
// match lands at a later stage than the cursor's current position.
// ----------------------------------------------------------------------------

const STAGE_ORDER = [
  'Open',
  'Qualify',
  'Permission to pitch',
  'Pitch',
  'Pricing',
  'SMS close',
  'Follow-up lock',
];

function stageIndex(stage: string | null): number {
  if (!stage) return -1;
  const target = stage.trim().toLowerCase();
  return STAGE_ORDER.findIndex((s) => s.toLowerCase() === target);
}

interface ScriptSection {
  stage: string;
  anchors: string[];
}

/** Parse the script body into a `## N. <Stage>` section list, capturing
 *  the FIRST read-aloud bullet under each heading as that section's
 *  anchor. Anchors can be quoted (`- "Hi…"`) or unquoted (`- Hi…`). */
export function parseScriptAnchors(scriptBody: string): ScriptSection[] {
  const lines = scriptBody.split('\n');
  const out: ScriptSection[] = [];
  let current: ScriptSection | null = null;

  for (const raw of lines) {
    const headingMatch = raw.match(/^\s*##\s*\d+\.\s*(.+?)\s*$/);
    if (headingMatch) {
      if (current) out.push(current);
      current = { stage: headingMatch[1].trim(), anchors: [] };
      continue;
    }
    if (!current) continue;
    // Only capture the FIRST quoted bullet — that's the section's
    // primary read-aloud line. Variant lines inside `If yes:` /
    // `If no:` branches are noisy for matching.
    if (current.anchors.length > 0) continue;
    const quoted = raw.match(/^\s*-\s*"(.+?)"\s*$/);
    if (quoted) {
      current.anchors.push(quoted[1]);
    }
  }
  if (current) out.push(current);
  return out;
}

/** Returns true when a long-enough run of consecutive content words
 *  from `anchor` appears in `transcript`. Strict enough that filler
 *  ("yeah, ok, sure") never matches; loose enough to allow agent
 *  paraphrasing ("we come out, assess it and quote before any work"). */
export function anchorMatches(transcript: string, anchor: string): boolean {
  const STOP = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'for', 'from',
    'i', 'if', 'in', 'is', 'it', 'just', 'me', 'of', 'on', 'or', 'so', 'that',
    'the', 'this', 'to', 'we', 'with', 'you', 'your', "i'll", "i'm", 'now',
    'um', 'uh', 'er', 'erm', 'really', 'right', 'yeah', 'ok', 'okay',
  ]);
  const tokenize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w));

  const aw = tokenize(anchor);
  const tw = tokenize(transcript);
  if (aw.length < 3) return false;

  // Slide through the transcript; for each starting position count
  // how many anchor content-words appear in order within a 12-token
  // window. 3+ matches OR ≥ 40% of anchor content tokens hit = match.
  for (let i = 0; i < tw.length; i++) {
    let aIdx = 0;
    let hits = 0;
    for (let tIdx = i; tIdx < tw.length && tIdx - i < 12 && aIdx < aw.length; tIdx++) {
      if (tw[tIdx] === aw[aIdx]) {
        hits++;
        aIdx++;
      }
    }
    if (hits >= 3 || hits / aw.length >= 0.4) return true;
  }
  return false;
}

/** Returns the stage NAME the agent has just advanced to (forward-only
 *  vs `currentStage`), or null when the transcript doesn't match any
 *  later section anchor. */
export function detectStageFromAgent(
  transcript: string,
  sections: ScriptSection[],
  currentStage: string | null,
): string | null {
  // Skip very short utterances — backchannel filler rarely conveys
  // a section transition.
  if (!transcript || transcript.trim().split(/\s+/).length < 5) return null;
  const currIdx = stageIndex(currentStage);

  // Walk sections RIGHT-to-LEFT and pick the highest-stage anchor
  // that matches — agents who skip a section out loud should land
  // at the right place rather than the next-numbered one.
  for (let i = sections.length - 1; i >= 0; i--) {
    const sec = sections[i];
    const secIdx = stageIndex(sec.stage);
    if (secIdx <= currIdx) continue;
    for (const anchor of sec.anchors) {
      if (anchorMatches(transcript, anchor)) return sec.stage;
    }
  }
  return null;
}

// ----------------------------------------------------------------------------
// Coaching — fire OpenAI Chat per caller utterance, in the background. We
// don't want to block returning 200 to Twilio (which may retry or get noisy).
// ----------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// THE CLOSE CALL (wk_calls.script_key = 'vsl_close')
//
// A lead who was sent a personalised video about their own Google reviews and
// WATCHED it, rung back off the video funnel's "Call to close" button. They
// have already had the pitch. Coaching them the cold-call guide contradicts the
// script on the agent's screen and insults the lead.
//
// These are module constants, not DB rows, ON PURPOSE: the words have to stay
// in lockstep with src/core/content/vsl-close-script.html, and a test
// (tests/coach-close-call.test.ts) fails the build when they drift. A DB row
// could not be drift-tested.
//
// EVERY reference to these is gated on isCloseCall, so a cold dial (script_key
// NULL, which is every existing row and every normal dial) runs the exact same
// code it ran before this existed.
// ---------------------------------------------------------------------------

const CLOSE_STAGE_ORDER = [
  'Who is that',
  'Why you are ringing',
  'Any questions',
  'Close',
];

/** The words on the agent's screen, as markdown, for the AGENT'S CALL SCRIPT
 *  layer. `## N. Stage` headings so parseScriptAnchors finds the sections. */
const CLOSE_AGENT_SCRIPT_MD = `# They watched the video

Warm call, and a short one. Four beats. Do not pitch it again.

## 1. Who is that
"Hi, is that {{first_name}}?"
Just that. No "you alright", no "quick one".
If someone else answers: "Oh sorry, is the owner about? It's about the video I sent over about their Google reviews, they've had a look at it."

## 2. Why you are ringing
"It's Elsie here. I'm just calling you back about that video I sent you over, the one about your Google reviews. I could see you'd watched it, so I thought I'd give you a ring."
Then STOP. Do not add a pitch onto the end of it.

## 3. Any questions
"So I was just wondering, have you got any questions about it?"
Say it and go quiet. Answer straight and short, then go to the close.
Anything you do not have an approved answer for: "Good question, let me check that properly and come straight back to you."

## 4. Close
"So is that something you'd like to get started with then, and get you some reviews coming in?"
Then say nothing until they answer.
On a yes: "Perfect. I'm texting you the link now. Tap Subscribe, pop your details in, and I'll get you sorted while we're on the phone."

## Objections, one line then back to the close
"I need to think about it" - "Course. What is it you want to think about, the money or whether it'll work?"
"How much is it again?" - "Same as it says on the video, and it's a pound to start today. You'll see it working before you're paying properly for it."
"I already ask for reviews myself" - "Everyone does on a good week and forgets on a busy one. This asks every customer, every time, without you touching it."
"I'll have a look and get back to you" - "You'll get busy and it'll be next month. It takes a minute while I'm here. Shall we just do it?"
"Not right now" - "No problem at all. I'll leave it with you, the link's on your phone whenever you want it." Then stop, take the outcome, do not push again.
"I didn't really watch it" - "No bother. You're sat behind the other firms in town, and the thing between you and them is reviews. That's what this fixes. Worth a go?"`;

/** Replaces wk_ai_settings.coach_script_prompt (the cold-call 7-stage guide)
 *  for this call only. */
const CLOSE_SCRIPT_PROMPT = [
  'This call is a FOLLOW UP, not a cold call. The person on the phone was sent a personalised video about their own Google reviews and has already watched it. They have heard the pitch. Your job is to help the agent get a yes in four short beats, not to sell it again.',
  '',
  'THE FOUR BEATS, forward-only order',
  '1. Who is that',
  '2. Why you are ringing',
  '3. Any questions',
  '4. Close',
  'That is the whole call. There is no qualify stage, no permission to pitch, no pitch and no pricing walkthrough, because all of that already happened in the video.',
  '',
  'NEVER SAY, these are cold-call lines and this is not a cold call:',
  '- "quick one"',
  '- "you alright"',
  '- "I was looking at you on Google, you have only got a handful of reviews"',
  '- "is now a good time"',
  '- anything that introduces the company as if they have never heard of it.',
  'They watched the video. Opening cold insults them and loses the call.',
  '',
  'DO NOT RE-PITCH. Never explain the service back to them, never narrate what was in the video, never re-quote the offer unprompted. If they ask a direct question, answer it in ONE line and go straight back to the close.',
  '',
  'SILENCE. After the agent asks "have you got any questions about it?" or the closing question, the caller thinking is NOT a cue for a card. The silence is the script. Emit STAY_ON_SCRIPT.',
  '',
  'OBJECTIONS. One line, then the close. Every extra sentence is a new thing for them to object to. Use the approved answer from the AGENT\'S CALL SCRIPT or the KNOWLEDGE BASE, never invent a new argument.',
  '',
  'KNOWLEDGE POLICY. Company specific facts (price, what is included, how it works) come from the KNOWLEDGE BASE only. If the answer is not there, say "I will check that and come back to you". Never invent figures. Never promise a ranking.',
].join('\n');

/** One extra block on the user message so the model cannot mistake the call
 *  type even if it skims the system layers. */
const CLOSE_CALL_CONTEXT = [
  '=== THIS CALL IS A FOLLOW UP, NOT A COLD CALL ===',
  'This lead was sent a personalised video about their own Google reviews and has already watched it. They have heard the pitch.',
  'Do not coach the cold opener. Do not coach a pitch. Four beats: who is that, why you are ringing, any questions, ask for the yes.',
].join('\n');

// ---------------------------------------------------------------------------
// THE PROPERTY CALL (wk_calls.script_key = 'property_call')
//
// The agent is ringing an ESTATE AGENCY about a house their client wants to
// buy. Nothing about the Elsie product is relevant: no reviews, no Google rank,
// no competitors, no subscription. Coaching the cold-call guide here would have
// the agent pitching a review service to someone selling a terrace.
//
// Same shape and the same reasoning as the close-call block above: module
// constants rather than DB rows, because the words must stay in lockstep with
// src/core/content/property-call-script.html and a test
// (tests/coach-property-call.test.ts) fails the build when they drift.
//
// EVERY reference to these is gated on isPropertyCall, so a cold dial and a
// close call both run exactly the code they ran before this existed.
// ---------------------------------------------------------------------------

const PROPERTY_STAGE_ORDER = [
  'Is it still available',
  'Ask for the two minutes',
  'The discovery questions',
  'Their figure, never ours',
  'Lock the next step',
  'Call two, the offer',
];

/** The words on the agent's screen, as markdown, for the AGENT'S CALL SCRIPT
 *  layer. `## N. Stage` headings so parseScriptAnchors finds the sections. */
const PROPERTY_AGENT_SCRIPT_MD = `# Ringing the agent about a house

A real person at a real company, working with the director, who is a cash buyer.
TWO CALLS. CALL ONE IS DISCOVERY: the facts, what sold done up on the street,
what has been rejected, THEIR figure if they will give one, the video and the
measurements, the email address, and a booked time to ring back. THE AGENT NEVER
SAYS A NUMBER OF OUR OWN ON CALL ONE. Call two is the offer call, made only
after the homework, with the director's confirmed figure. Do NOT make a formal
offer on either call. NEVER view a property and never book one: our builder
views it and prices the refurb at the same time. One question at a time.

## 1. Is it still available
"Hi, hello. I'm calling about the property on {{property_street}}, the {{bedrooms}} bed {{property_type}}. Is that one still available?"
Then stop. Nothing else.
If sold or under offer: "Ah, fair enough. Would the vendor consider backup offers at all?"

## 2. Ask for the two minutes
"Oh lovely. I'm Pedro by the way, who am I speaking to?" Take their name and use it for the rest of the call.
"Nice one. So, I work with our director Hugo at Unico, we buy in the area, cash. Mind if I ask you a couple of quick questions about it?"
Wait for the yes.
If asked who is calling: "It's Pedro. I work with Hugo, our director, at Unico. We buy residential property, we're looking in your patch at the minute."
If asked what company: "Unico. We're a small property company, the director Hugo buys with cash and I do the legwork for him." Only if they press for the legal detail: "Full name's Ulinc Unico Group Limited, company number 11197856. Registered office is 483 Green Lanes in London, N13 4BS."
If asked cash or mortgage: "Cash. No mortgage, no chain, nothing to sell."

## 3. The discovery questions
The whole job of call one. Conversational, not a form.
"Is it vacant, or is there a tenant in?" If tenanted: staying or leaving, and what rent.
"And what sort of condition is it in, ready to move into or does it need work?"
"It needs a bit of work" is NOT an answer and must never be accepted: that sentence covers a 5k tidy-up and a 40k strip-out, and the difference is the offer. Dig, one question at a time:
"When you say it needs work, what sort of thing are we talking? Is it more cosmetic, kitchen, bathroom, carpets, decorating, or is it a proper full refurb?" If they hedge: "Could someone live in it while the work's being done, or is it a shell?"
"And how are the big four, the roof, any damp, the electrics and the boiler? Have any of them been done?" One at a time, a rewire, boiler, roof or damp course are thousands each and none show in photos.
"And is it dry? Any leaks, anything coming in, any staining on the ceilings? What's the roof like, has it been done or is it the original?" ASK ON EVERY HOUSE, even an immaculate one. Water is what turns a 15k refurb into a 40k one and a photograph never shows it. Never accept "I think it's fine": push once with "has anyone been up on it?" and "has there ever been a leak in there, even one that's been sorted?". A leak is NOT a reason to walk away, it is the reason the price comes down, so never react to it and never say what it will cost us.
"How old are the kitchen and the bathroom? And are the windows double glazed?"
"Has anybody been round and priced the work up? What sort of number did they come back with?"
If they say it is down to personal preference: "No, course. I mean more the boring stuff, like the boiler, the electrics, the roof, any damp?"
"Do you know why they're selling?" Then: in a hurry, and is there an onward chain.
"Has anything on that street sold recently that was done up? What did it actually go for?" The most valuable question on the page: the done-up value from the person who sells that street.
"Has it had much interest? Any offers so far, and has anything been turned down?" A rejected offer is the floor. And has a sale ever fallen through.
"How long's it been on with you? And has the price come down at all?"
"Have you got the floor area on it, or the room measurements?" Ask whenever the listing has no floor plan.
"Is it freehold or leasehold?"
FLAT only: years left on the lease, service charge, ground rent, major works, cladding or EWS1.
HOUSE only: confirm freehold, structural issues, extensions signed off.
Never ask a house about service charges or a lease unless they say it is leasehold. Never ask a flat about subsidence unless they raise it.

## 4. Their figure, never ours
"Is there a figure the vendor has in mind that would actually get it done? What sort of figure do you think would actually get it done?" Said lightly. Then be quiet: whoever speaks first loses this bit.
A figure THEY say is worth more than any figure we could float. Write it down word for word.
If they push for OUR number: "Honestly, I don't want to give you a number I'd have to take back. Let me do the work properly, what's sold, what the work costs, and I'll come back to you tomorrow with something you can actually put to the vendor." That is the whole answer, on every first call.
If they cannot disclose: "No, and I wouldn't ask you to. Roughly though, are they wedded to the asking price, or is there room? You don't have to give me a number."

## 5. Lock the next step
"Is there any chance you could send me a video walkthrough of it? Or even just FaceTime me round it?" Ask this on EVERY call. The builder prices the refurb off the video before anyone travels.
"What's the best email for you anyway? My director will want to come back to you directly with a couple of questions on it, and I'd rather it came to you than the general inbox." Ask this on EVERY call. Never hang up without the email address: every offer goes out by email, so a call with no email cannot become an offer.
IF THEY REFUSE THE VIDEO, THAT CHANGES NOTHING ABOUT THE EMAIL. The video is a bonus, the address is the call. Say "no bother at all" and go straight to the email ask with the word "anyway" in it. Never argue for the video, never ask twice, and never let a no on the video cost you the address. If they will not give a personal address, take the branch inbox and say you will put their name in the subject.
THEN SEND IT WHILE THEY ARE STILL ON THE PHONE, whatever they said about the video. As soon as they say the address: "Brilliant, I'm sending you one now so you've got my address. Can you just tell me it's landed before I let you go?" If they said yes to the video the email asks for it; if they said no, he presses "No video, just my address" and it is two lines that ask for nothing. The address types itself into the Email tab the moment they say it, the email is already written, so this is one press of Send. An email they watched arrive is an email that gets answered, and it gives them our address to send the video back to.
"Before I let you go, have you got anything else stuck? Anything in a chain that's dragging, or a sale that's fallen through where cash would sort it?"
THE STANDING BRIEF, on every call: "And you've got my email there now, so do me a favour and keep me in mind. Anything that comes in needing plenty of work, or where the vendor has to move quick and the price has to come down, send it straight to me and I'll come back to you the same day." Two things only, needs plenty of work and the price has to come down, said lightly and once. It is a brief sent DIRECTLY to him, not their mailing list, and the reason they should bother is that we are cash, no chain, and answer the same day.
"And when it comes to it, we'd get our builder round to have a look and price the work up." Ask, do not book.
"Right, that's everything I need. I'll do the homework on it properly tonight. What's a realistic time for me to ring you back, tomorrow or is it better later in the week?" Never end the call without an agreed callback time. The booked callback IS call two.
"That's great, thanks for your time. Speak to you then."
Then wait. Do not hang up on your own closing line.

## 6. Call two, the offer
ONLY after the homework, with the director's confirmed figures on screen. Open: "Hi, it's Pedro from Unico, we spoke about {{property_street}}. I said I'd do the homework and come back to you, so here I am."
The offer without offering, said as one breath: "I've had a proper look at this one. I've been through what's sold on the same streets and worked out roughly what it'd cost us to put it right. I can't get near what you're asking, and I don't want to waste your time or embarrass anyone with a silly offer. But if we were to offer around {{offer_open}}, am I in the ballpark, or am I a million miles off?"
"If we were to offer", never "I'd like to offer". Then be quiet. Let the silence do the work.
Climb the ladder ONE rung at a time, and only in exchange for something they have given you.
Push back once, with a comp: "The one that sold on the same street went for less than that and it didn't need the work this one needs. What would they actually take?"
"Let me speak to Hugo and come back to you" is a lever used LATER, not an opener: when a real figure has been banked, when they ask for something formal, or when pushed for a commitment the agent cannot give.
If asked "is that your best?": "It's where we'd start. If there's a number that gets it done quickly, tell me what it is and I'll put it to Hugo today."
Close: ask them to put the figure to the vendor, and book the ring-back. Hugo follows up in writing, subject to our builder going round.
Then the standing brief, last thing before the goodbye and however the money went: "same as I said last time, anything else that lands needing plenty of work, or where they've got to sell quick and the price has to come down, send it straight to me and I'll come back to you the same day."`;

/** WHAT THIS PARTICULAR CALL IS FOR.
 *
 *  Hugo 2026-08-12: "when Pedro is gonna follow up, the script and the AI coach
 *  should change according to that step of the process."
 *
 *  Until now there was one property prompt and it assumed every call was the
 *  first one: the goal is a ballpark figure. So when Pedro rang back to chase an
 *  offer that was already in, the coach pushed him to get a figure he already
 *  had.
 *
 *  The step comes off the branch card (wk_contacts.custom_fields.next_step),
 *  which is written by the queue script, by the outcome he presses, and by the
 *  offer email going out. The tags match
 *  src/features/crm/components/templates/dealProcessSteps.ts exactly.
 *
 *  Absent or unknown step -> nothing is appended and the coach behaves exactly
 *  as it did before this existed. */
const PROPERTY_STEP_PROMPT: Record<string, string> = {
  'Discovery call': [
    'WHICH CALL THIS IS: THE FIRST CALL to this branch. Discovery only.',
    'THE AGENT MUST NEVER SAY A NUMBER OF OUR OWN ON THIS CALL. Not a figure, not a range, not "around" anything. If they start to float one, fire a card immediately: "No number on a first call. If pushed: I don\'t want to give you a number I\'d have to take back, let me do the homework and come back to you tomorrow."',
    'What this call is for, in order: the facts (vacant, condition, why selling), what sold DONE UP on the street and for how much, offers and rejections, the floor area or room measurements, THEIR figure if they will give one, a video walkthrough or the floor plan, the estate agent\'s EMAIL ADDRESS, and a BOOKED time to ring back.',
    'If the branch names a figure of their own, that is the prize: bank it word for word, coach the callback booking, never a counter-number.',
    'And before the goodbye, the STANDING BRIEF: our email left with them for anything needing plenty of work or where the price has to come down, sent straight to him. Coach it if the call is winding down without it.',
  ].join('\n'),
  'Do the homework': [
    'WHICH CALL THIS IS: a FOLLOW UP. A ballpark figure has already come out of this branch and the director is pricing it up now.',
    'So do NOT coach the ballpark question again, and do NOT coach a new figure. Asking for a ballpark twice makes us look like we do not keep records.',
    'What this call is for, in order: anything still missing on the house (photos that never arrived, the floorplan, the full EPC, a video walkthrough), the estate agent\'s EMAIL ADDRESS if we still do not have it, whether anything has changed (other offers, a price drop, is it still available), and an agreed time to ring back.',
    'If the estate agent volunteers a new or lower figure, that is the most important thing on the call: bank it, say it goes to the director, agree a callback.',
  ].join('\n'),
  'Builder ballpark': [
    'WHICH CALL THIS IS: a FOLLOW UP while the director prices the building work.',
    'Do NOT coach the ballpark question again and do NOT coach a figure of any kind.',
    'What this call is for: photos, floorplan, full EPC or a video walkthrough for the builder, the estate agent\'s email address, and whether anything has changed. Then an agreed callback.',
  ].join('\n'),
  'Email the offer': [
    'WHICH CALL THIS IS: the offer is going over by email from the director TODAY.',
    'What this call is for: tell them it is coming or that it has landed, and explain how we work in one breath. We buy across the country, we assess remotely first, and we send a local builder round to view it and price the work in the same visit. That is why the offer is subject to our builder rather than to a survey.',
    'Coach the agent to ask them to put it to the vendor and to agree a time to ring back. Never coach a NEW figure on this call: the number is the director\'s and it is already written down.',
    'If they ask for anything in writing, that is a yes: get the email address confirmed.',
  ].join('\n'),
  'Offer call': [
    'WHICH CALL THIS IS: THE OFFER CALL, call two. The homework is done and the director\'s confirmed figure is in THIS LEAD.',
    'Open by picking up where call one left off: "it\'s Pedro from Unico, we spoke about the house, I said I\'d do the homework and come back to you."',
    'Now the money conversation IS the job: the offer without offering with the "open at" figure in THIS LEAD, one number, never a range, then silence. Climb the ladder one rung at a time. Push back once with a comparable.',
    'Close: ask them to put the figure to the vendor and BOOK the ring-back. The director follows up in writing, subject to our builder going round.',
    'If the money boxes in THIS LEAD are empty, something is wrong: coach the agent to gather facts and book a callback instead, and never to invent a figure.',
    'Last thing before the goodbye, wherever the number landed, the STANDING BRIEF: anything else needing plenty of work or where they have to sell quick and the price has to come down, straight to him, answered the same day. It matters most on the calls that died on price.',
  ].join('\n'),
  'Chase the agent': [
    'WHICH CALL THIS IS: a CHASE. An offer or a figure is already with the vendor and we are waiting on an answer.',
    'What this call is for: has the vendor seen it, what did they say, and when is realistic to ring back. Nothing else.',
    'Do NOT coach the ballpark question again. Do NOT improve our own offer unprompted: nothing has been given, so there is nothing to pay for.',
    'If they knock it back WITHOUT naming a figure, coach "fair enough, what would they actually take?" immediately.',
    'If they name a figure, bank it, put it to the director, agree a callback. That is the whole call.',
  ].join('\n'),
  'Book the viewing': [
    'WHICH CALL THIS IS: the ballpark has come back accepted or close, so the builder\'s visit is being arranged. The visit IS the viewing: he views it and prices the works in one trip.',
    'What this call is for: agree access with the branch for our builder, confirm who meets him, and keep the figure exactly where it is. Never renegotiate on this call and never book the agent themselves to attend.',
  ].join('\n'),
  'Get it in writing': [
    'WHICH CALL THIS IS: they have ACCEPTED. The only thing missing is it in writing.',
    'What this call is for: thank them, and ask for an email confirming the address and the agreed price, for our records and for the solicitor. Coach exactly that.',
    'Do NOT coach any negotiation. The price is agreed and reopening it here loses the deal.',
    'Then: the buyer details and proof of funds follow shortly, and ask what they need from our side.',
  ].join('\n'),
  'Renegotiate': [
    'WHICH CALL THIS IS: our builder has been round and the work costs more than we budgeted.',
    'What this call is for: put the builder\'s quote to them as EVIDENCE, not as haggling, and ask them to take a revised figure to the vendor. Coach offering to send the quote over.',
    'The revised figure is the director\'s and is already decided. Never coach a number that is not on screen.',
    'Keep the rest of the deal in the sentence: still cash, still no chain, still the same timescale.',
  ].join('\n'),
};

const PROPERTY_SCRIPT_PROMPT = [
  'This call is an agent ringing an ESTATE AGENCY about a house. The person on the phone sells houses for a living. They are NOT a sales lead, they are the seller\'s representative, and we are the buyer.',
  '',
  '',
  'THIS IS A TWO CALL PROCESS AND YOU MUST COACH THE RIGHT CALL.',
  'CALL ONE is DISCOVERY: the facts, what sold done up on the street, offers and rejections, the measurements, THEIR figure if they will give one, the video, THE EMAIL ADDRESS, and a booked time to ring back. THE AGENT NEVER SAYS A NUMBER OF OUR OWN ON A FIRST CALL: no figure, no range, no "around". If they start to, fire a card that stops them, with the approved line: "I don\'t want to give you a number I\'d have to take back, let me do the homework and come back to you tomorrow." CALL TWO is the offer call, made after the homework with the director\'s confirmed figure: there, and only there, the ballpark question is the job. A WHICH CALL THIS IS block appears below when the deal step is known; without one, treat the call as a FIRST call.',
  'On every call: a figure out of the BRANCH\'S mouth is the prize, and a call that ends without a booked ring-back time has not worked, however pleasant it was.',
  '',
  'THE SIX BEATS, forward-only order',
  '1. Is it still available',
  '2. Ask for the two minutes',
  '3. The discovery questions (empty, needs work, why selling, what sold done up on the street, offers and rejections, time on market, measurements, tenure)',
  '4. Their figure, never ours (call one never floats OUR number)',
  '5. Lock the next step (video walkthrough, THE EMAIL ADDRESS, builder, callback time)',
  '6. Call two, the offer (ONLY after the homework, with the director\'s confirmed figure)',
  '',
  'NEVER MENTION, none of it exists on this call:',
  '- Google reviews, star ratings, local ranking, competitors',
  '- websites, video, subscriptions, pricing, free trials',
  '- anything at all about the Elsie product.',
  'If a card would have referenced any of that, it is the wrong call type. Emit STAY_ON_SCRIPT instead.',
  '',
  'THE MONEY, on the OFFER CALL ONLY, never on a first call:',
  '- The agent OPENS on the "open at" figure in THIS LEAD. One number, never a range.',
  '- Never coach the agent to say a range, and never coach "between X and Y".',
  '- NEVER SAY THE WALK-AWAY FIGURE, and never coach the agent to reveal it, hint at it, or confirm a guess at it. It is their ceiling and it is private. If the estate agent asks "is that your best?", the answer is "it\'s where he\'d start", never the ceiling.',
  '- Climb the ladder ONE rung at a time, and only after the estate agent gives ground or new information.',
  '- Justify with the sold evidence in THIS LEAD, one comparable at a time, said casually. Never read the list out.',
  '- Always push the question back: "what sort of figure do you think would actually get it done?" A figure THEY say is worth more than any figure we say.',
  '',
  'WHEN THE BRANCH NAMES A FIGURE, THIS IS THE MOST IMPORTANT CARD YOU WILL EVER FIRE.',
  'A number out of their mouth is the entire reason for the call, WHATEVER the number is and however far above our ceiling it sits. Coach: bank it, put it to the director, agree a time to ring back. NEVER let the agent thank them and end the call on a number. This has already happened once, on the best lead of the week, and it is the single behaviour this coach exists to prevent.',
  '',
  'THE SECOND GEAR. When the estate agent knocks the figure back WITHOUT naming one of their own ("no chance", "way off", "a million miles off"), that is not the end of the conversation, it is the start of the negotiation. Coach "Fair enough, no problem. What would the vendor actually take, do you think?" immediately. Do NOT stay silent here, and do NOT coach the agent to improve our own number: nothing has been given, so there is nothing to pay for.',
  '',
  'NEVER VIEW A PROPERTY. We buy remotely. If they insist on a viewing before an offer, the answer is that we put the figure forward SUBJECT TO OUR BUILDER GOING ROUND, who views it and prices the refurb in one trip, plus an ask for a video walkthrough. Say "subject to our builder", never "subject to survey". Never coach the agent to attend a viewing, book one, or promise to attend.',
  '',
  'THE EMAIL ADDRESS. Every offer we make goes out by email, so a call that ends without the estate agent\'s email address cannot become an offer however well it went. If the call is winding down and no email has been given, coach: "what\'s the best email for you? Hugo will want to put something over in writing." Fire this even on a call that went badly, because a branch email is worth having either way.',
  '',
  'THE STANDING BRIEF, ON EVERY CALL, FIRST OR SECOND. Before the goodbye the agent leaves our email with a brief: anything needing plenty of work, or where the vendor has to move quick and the price has to come down, sent STRAIGHT TO HIM and he answers the same day. If the call is winding down and he has not said it, coach it in his words: "you\'ve got my email now, so keep me in mind, anything that needs plenty of work or where the price has to come down, send it straight to me." Fire it hardest on a call that died on price, because the relationship is the only thing left to take from it. Two things only, needs work and the price comes down. Never coach a list of criteria, never coach the word investor or sourcer, and never coach asking to be added to their mailing list: that is their whole Rightmove feed and it is a brush-off. This ask is DIRECT to that person.',
  '',
  'NEVER PROMISE. The agent is not authorised to make a formal offer or book a viewing. Everything is "the director will confirm that himself". If pushed for a formal offer, coach exactly that line.',
  '',
  'PROPERTY TYPE. Coach lease, service charge, ground rent and cladding questions ONLY for a flat, maisonette or apartment. Coach freehold, subsidence and extension questions ONLY for a house or bungalow. Asking the wrong set makes the agent sound like they have never bought a house, and estate agents notice immediately.',
  '',
  'SILENCE. After the agent names a figure, the estate agent going QUIET is NOT a cue for a card. The silence is the tactic. Emit STAY_ON_SCRIPT. This applies to silence ONLY: if the estate agent actually SAYS something, including a rejection, that is a cue and you must fire.',
  '',
  'NEVER INVENT a fact about the property, the director, or the financing. Everything known is in THIS LEAD. If it is not there, coach the agent to ask rather than to assert.',
].join('\n');

/**
 * The KNOWLEDGE BASE for a property call: the estate-agent objections and the
 * approved answer to each, word for word, mirroring the amber panels in
 * src/core/content/property-call-script.html.
 *
 * Why a module constant and not wk_coach_facts rows: the workspace facts are
 * Elsie product facts (price, what is included, how the review system works)
 * and every one of them is WRONG on this call. Feeding them to the model here
 * is what would let a card say something about reviews to somebody selling a
 * terrace. So on a property call this REPLACES the workspace knowledge base
 * rather than adding to it. Per-campaign wk_campaign_facts still override by
 * key, so Hugo keeps a way to add a fact without a deploy.
 *
 * `keywords` feed retrieveFacts(), which highlights the matching fact from the
 * estate agent's last utterance, so the answer is in front of the model at the
 * moment the objection is actually said.
 */
const PROPERTY_OBJECTIONS: CoachFact[] = [
  {
    key: 'prop_who_is_calling',
    label: 'They ask who is calling',
    value: 'Say: "It\'s Pedro. I work with Hugo, our director, at Unico. We buy residential property, we\'re looking in your patch at the minute." Flat and unbothered. Hesitating here reads as a scam call.',
    keywords: ['who\'s calling', 'who is calling', 'who am i speaking', 'sorry who', 'what was your name', 'who is this'],
  },
  {
    key: 'prop_what_company',
    label: 'They ask what company',
    value: 'Say: "Unico. We\'re a small property company, the director Hugo buys with cash and I do the legwork for him." ONLY if they press for legal detail: "Full name\'s Ulinc Unico Group Limited, company number 11197856. Registered office is 483 Green Lanes in London, N13 4BS." Never improvise a number or an address.',
    keywords: ['what company', 'which company', 'who do you work for', 'what firm', 'company name', 'are you with'],
  },
  {
    key: 'prop_cash_or_mortgage',
    label: 'Cash buyer or mortgage',
    value: 'Say: "Cash. No mortgage, no chain, nothing to sell." Three words and stop. Never invent a fund, a bank, a figure or a timescale.',
    keywords: ['cash buyer', 'mortgage', 'finance', 'funding', 'how are you buying', 'chain'],
  },
  {
    key: 'prop_are_you_a_sourcer',
    label: 'Are you a sourcer or an investor',
    value: 'Say: "We buy for ourselves. Hugo\'s the buyer, I do the running around. If it\'s right we move quickly, if it\'s not we won\'t waste your afternoon." Never use the word sourcer, never claim a list of investors, and never mention a course or training.',
    keywords: ['sourcer', 'sourcing', 'investor', 'investment company', 'do you buy', 'trade buyer', 'developer'],
  },
  {
    key: 'prop_no_investors',
    label: 'We do not deal with investors',
    value: 'Do not argue. Say: "No, fair enough. We\'re a cash buyer with nothing to sell, so if you ever get one that\'s dragging or a sale falls over, we\'re the boring easy one. Can I leave you my number?" Then end it politely.',
    keywords: ['don\'t deal with investors', 'do not deal with investors', 'no investors', 'not interested in investors'],
  },
  {
    key: 'prop_mailing_list',
    label: 'I will add you to our mailing list',
    value: 'This is a brush-off, not a win: their list is every property that goes on Rightmove anyway. Accept it in one breath and get straight back to the property. Say: "Yeah, do, cheers. Though what\'s more useful to me is this one in front of me. Can I ask you two quick things about it?" The list is not the goal, the standing brief at the end of the call is: our email with them, and them sending anything needing plenty of work straight to him.',
    keywords: ['mailing list', 'our list', 'database', 'send you what comes', 'add you to', 'applicant list'],
  },
  {
    key: 'prop_branch_manager',
    label: 'Speak to the branch manager',
    value: 'Take a name and a time, never just "he\'s not in". Say: "No problem. Is he about now, or when\'s the best time to catch him? And what\'s his name, sorry?"',
    keywords: ['branch manager', 'manager', 'the boss', 'not in today', 'he\'s out', 'she\'s out'],
  },
  {
    key: 'prop_email_me',
    label: 'Can you email me instead',
    value: 'An email is where the call dies. Agree, ask one more question anyway, get a callback time. Say: "Course, I\'ll do that. While I\'ve got you though, is it vacant or is somebody in it?"',
    keywords: ['email me', 'send me an email', 'put it in an email', 'drop me an email'],
  },
  {
    key: 'prop_too_low',
    label: 'That is far too low',
    value: 'Do not defend the number and do not climb to make them feel better. Say: "Fair enough, no problem. What would the vendor actually take, do you think?" Make them counter first, THEN move one rung.',
    keywords: ['too low', 'way off', 'never accept', 'insulting', 'miles off', 'not going to happen'],
  },
  {
    key: 'prop_is_that_your_best',
    label: 'Is that your best',
    value: 'Never answer with the ceiling. Say: "It\'s where we\'d start. If there\'s a number that gets it done quickly, tell me what it is and I\'ll put it to Hugo today."',
    keywords: ['your best', 'best offer', 'best you can do', 'final offer', 'push it up', 'go any higher'],
  },
  {
    key: 'prop_vendor_wont_accept',
    label: 'The vendor will not accept that',
    value: 'Flatter their judgement and ask again without moving the number. Say: "You know them better than me. Where do you honestly think they\'d land if the right buyer turned up with cash and no chain?"',
    keywords: ['vendor won\'t', 'seller won\'t', 'they won\'t accept', 'won\'t take that', 'holding out for'],
  },
  {
    key: 'prop_higher_offers',
    label: 'We have had higher offers',
    value: 'Said lightly, never as a gotcha. Say: "Okay, no worries. Are those still on the table, or did they come and go? Because it\'s still on the market, so I\'m guessing something didn\'t stick." A cash buyer with no chain beats a bigger number that cannot complete.',
    keywords: ['higher offer', 'had offers', 'better offer', 'more than that', 'offers over', 'another buyer'],
  },
  {
    key: 'prop_must_view_first',
    label: 'You have to view it first',
    value: 'Not a no, and we do not refuse. Say: "Course, and someone will. We buy across the country, so the way we do it is we put the figure forward subject to our builder going round. He views it and prices the work at the same time. While I\'ve got you, is there any chance you could send me a video walkthrough?" Say SUBJECT TO OUR BUILDER, never "subject to survey". NEVER book a viewing and never offer to attend one yourself.',
    keywords: ['view it first', 'come and see', 'viewing first', 'need to view', 'see the property', 'book a viewing', 'have to view', 'before we can put', 'before taking an offer', 'go and see it'],
  },
  {
    key: 'prop_they_named_a_figure',
    label: 'THEY NAME A FIGURE. This is the call.',
    value: 'A number out of their mouth is the whole reason for the call, whatever the number is. Say: "Right, that\'s not miles off. Let me put that exact figure to Hugo and I\'ll come back to you. What\'s a realistic time for me to ring you back?" Then write it in the Houses tab word for word and press Figure obtained. NEVER thank them and hang up on a number.',
    keywords: ['looking around', 'looking for', 'would be looking', 'they\'d want', 'they want', 'hoping for', 'holding out for', 'in the region of', 'closer to', 'the mark'],
  },
  {
    key: 'prop_flat_no_no_number',
    label: 'A flat no with no number attached',
    value: 'You have a second gear. Say: "Fair enough, no problem. What would the vendor actually take, do you think?" If they still will not say: "Okay. And if a cash buyer with nothing to sell came along, where do you honestly think they\'d land?" Ask twice, warmly, then leave it. NEVER improve your own figure to fill a silence.',
    keywords: ['no chance', 'not going to happen', 'million miles', 'way off', 'nowhere near', 'wouldn\'t consider', 'don\'t think they', 'wouldn\'t be accepted'],
  },
  {
    key: 'prop_cannot_disclose',
    label: 'I cannot disclose what they would accept',
    value: 'Give them permission not to answer and they usually answer. Say: "No, and I wouldn\'t ask you to. I don\'t want to compromise you with your client. But if I were a smidgen above where I am, would I be in with a shout? You don\'t have to tell me where." Then be quiet.',
    keywords: ['can\'t disclose', 'cannot disclose', 'not at liberty', 'confidential', 'can\'t tell you what', 'can\'t say what'],
  },
  {
    key: 'prop_only_vendor_can_answer',
    label: 'Only the vendor or head office can answer that',
    value: 'Do not argue, deputise them. Say: "Of course. Could you put it to them for me? Just as an indication, not an offer, so nobody wastes a viewing finding out we are miles apart. When would you get the chance to ask?" An agent who agrees to ask the vendor has to ring you back. Get the day.',
    keywords: ['only the vendor', 'housing company', 'corporate', 'head office', 'act on behalf', 'masked client', 'would be able to answer', 'have to ask them'],
  },
  {
    key: 'prop_condition_preference',
    label: 'We cannot say what work it needs, it is personal preference',
    value: 'Ask about the four things that cost real money, which nobody can call a matter of taste. Say: "No, course. I mean more the boring stuff, like the boiler, the electrics, the roof, any damp?" This exact follow-up got a full answer out of a branch that had just stonewalled.',
    keywords: ['personal preference', 'different preference', 'everybody\'s got a different', 'up to you', 'just needs updating', 'difficult for me to say', 'depends what you want'],
  },
  {
    key: 'prop_shared_ownership',
    label: 'It is shared ownership or a part exchange',
    value: 'Do not pretend to know. Say: "Ah right, so what share is being sold, and what is the rent on the rest? And is it the housing association who would need to approve a buyer?" Shared ownership means they own a share and pay rent on the remainder. Part exchange means a housebuilder took it against a new build and wants it gone, which is usually a motivated seller. Both need somebody else to approve, so find out who and note it.',
    keywords: ['shared ownership', 'shared owner', 'part exchange', 'part-exchange', 'housing association', 'staircasing', '25%', 'own a percentage'],
  },
  {
    key: 'prop_what_price_range',
    label: 'What price range are you looking at',
    value: 'Never give a budget: it caps every property they will ever send you, and on the first day of calls it ended a conversation in five seconds. Say: "It really depends on the house and what it needs. This one is the one I am interested in today. Is it vacant, or is somebody in it?"',
    keywords: ['price range', 'what\'s your budget', 'how much are you looking', 'looking to spend', 'up to what', 'what sort of price are you'],
  },
  {
    key: 'prop_off_a_course',
    label: 'You are off one of them courses, are you',
    value: 'The fastest way to be written off. Deny it flatly, do not get defensive, and be back on the property within one sentence. Say: "No, we are just buying. Hugo has bought in the area before and I do the legwork for him. Anyway, is it vacant or is somebody in it?" NEVER mention training, a mentor or a programme.',
    keywords: ['crash course', 'one of them courses', 'done a course', 'training course', 'seminar', 'been on a course'],
  },
  {
    key: 'prop_not_local',
    label: 'Where are you calling from, you are not local',
    value: 'Turn it into the reason you are asking rather than a weakness. Say: "We are London based, we buy all over. That is exactly why I am asking about the price before anything else, I do not want to send someone up there if we are a million miles apart."',
    keywords: ['not local', 'where are you calling from', 'where are you based', 'you\'re not from', 'your accent', 'down south', 'whereabouts are you'],
  },
  {
    key: 'prop_register_me',
    label: 'I need to register you, what is your email',
    value: 'Know these without hunting. Say: "Course. It is Pedro, the company is Unico, and the email is pedro@hostunico.com. Registered office is 483 Green Lanes, London, N13 4BS." Company number if pressed: 11197856, Ulinc Unico Group Limited. Give it plainly and get back to the property.',
    keywords: ['register you', 'registered with us', 'your email', 'email address', 'take your details', 'get you on the system', 'applicant'],
  },
  {
    key: 'prop_price_or_terms',
    label: 'Your price my terms, or my price your terms',
    value: 'The strongest answer to any money objection, because it names the trade instead of defending the number. Say: "I get it, everyone wants the best price and the quickest sale, but you can\'t really have both. It\'s either your price on my terms, or my price on your terms. If they want it gone quickly and cleanly, that\'s what we do, and that\'s what the figure reflects." Then give them what the discount buys: one viewing, no chain, no mortgage, no time wasters every Saturday.',
    keywords: ['too low', 'best price', 'want more', 'not enough', 'worth more', 'hold out', 'get more for it'],
  },
  {
    key: 'prop_mortgage_advisor',
    label: 'Come in and see our mortgage advisor',
    value: 'Corporate branches gate every buyer through their in-house adviser because they earn on the mortgage. Cash takes you straight out of it. Say: "No need on this one, it would be a cash purchase. Happy to get proof of funds over once we are anywhere near agreeing a figure." Say it once and move on.',
    keywords: ['mortgage advisor', 'mortgage adviser', 'financial advisor', 'financial adviser', 'in house', 'come in and see', 'sit down with'],
  },
  {
    key: 'prop_talks_you_out',
    label: 'They try to talk you out of the property',
    value: 'Do not argue and do not sound stung. Say: "I appreciate that, and thanks for being straight with me. I would still like to look at the numbers properly. Can you send me the EPC and the floor plan?" If they keep blocking, ask for somebody else: "is there anyone else there who deals with the sales side?" There always is.',
    keywords: ['nothing in it', "wouldn't bother", 'would not bother', 'not worth', 'no money in it', "don't view", 'do not view', 'waste of time for you'],
  },
  {
    key: 'prop_priced_right',
    label: 'It is priced right, that is what it is worth',
    value: 'Find the gap without calling anybody wrong. Say: "Can I ask, what did you originally value it at compared to what it is on for now?" An agent often wins the instruction by promising a number nobody can get, then spends months walking the vendor down, and that gap is the opportunity. Then show, never tell: "the ones that actually sold on those streets went for less, and they did not need the work this one needs. Would you say the market has moved since it went on?" People like to feel clever, and an agent who gets there himself will carry it to the vendor for you.',
    keywords: ['priced right', 'worth what', 'it is worth', 'valued at', 'market value', 'fairly priced', 'no room'],
  },
  {
    key: 'prop_anything_stuck',
    label: 'Ask what else is stuck',
    value: 'Free money, and it works. Cash is the reason the branch is talking to you, so the moment they hear it they start thinking about the one that will not complete. Say: "Before I let you go, have you got anything else stuck? Anything in a chain that is dragging, or a sale that has fallen through where cash would sort it?" Ask it even on a call that went nowhere.',
    keywords: ['fallen through', 'fell through', 'chain', 'dragging', 'not completing', 'taken so long', 'stuck'],
  },
  {
    key: 'prop_ask_for_valuer',
    label: 'Ask who does the valuations',
    value: 'The best question for the long game. The valuer sees a house before it is ever listed and knows which vendors are desperate; the negotiator who answered the phone usually does not. Say: "And who does your valuations there, is it yourself?" Get the name and ask for them next time.',
    keywords: ['valuation', 'valuer', 'who values', 'appraisal', 'market appraisal'],
  },
  {
    key: 'prop_video_walkthrough',
    label: 'Asking for a video walkthrough',
    value: 'Ask on EVERY call, it is what lets the builder quote without anybody driving anywhere. Say: "One last thing, is there any chance you could send me a video walkthrough of it? Or even just FaceTime me round it whenever you are next there." Most branches already have one from a previous viewing.',
    keywords: ['video', 'walkthrough', 'walk through', 'facetime', 'photos', 'pictures', 'more images', 'floor plan'],
  },
  {
    key: 'prop_formal_offer',
    label: 'Put it in writing or make a formal offer',
    value: 'This is the moment for the director card. Say: "Of course. Nothing I\'ve said today is a formal offer, I\'m just trying to find out if we\'re in the right area. Let me put the figure to Hugo and he\'ll confirm everything properly with you."',
    keywords: ['in writing', 'formal offer', 'officially', 'put an offer in', 'submit an offer', 'in an email'],
  },
  {
    key: 'prop_how_quickly',
    label: 'How quickly could you complete',
    value: 'Never invent a number of weeks. Say: "Quickly, we\'re cash and there\'s no chain, so it\'s down to the solicitors more than us. Hugo will give you the exact timescale when he confirms, but we\'re not the ones who\'d be holding it up."',
    keywords: ['how quickly', 'how fast', 'complete', 'completion', 'timescale', 'how soon', 'exchange'],
  },
  {
    key: 'prop_proof_of_funds',
    label: 'Have you got proof of funds',
    value: 'A normal question, treat it as one. Say: "Yeah, that\'s no issue at all. Hugo handles that side, so as soon as we\'re agreed on a figure he\'ll send it over to you." Never quote a balance and never send anything yourself.',
    keywords: ['proof of funds', 'pof', 'evidence of funds', 'bank statement', 'prove the money', 'show funds'],
  },
  {
    key: 'prop_chain_free',
    label: 'Are you chain free',
    value: 'Short and confident. Say: "Completely. Nothing to sell, no mortgage to arrange, no chain behind us."',
    keywords: ['chain free', 'chain-free', 'anything to sell', 'own chain', 'position'],
  },
  {
    key: 'prop_what_will_you_do_with_it',
    label: 'What will you do with it',
    value: 'Say: "Do it up and hold it, most likely. It\'s why the condition matters to me more than the postcode." Never describe a yield, a strategy, or what it is worth after works.',
    keywords: ['what are you going to do', 'rent it out', 'flip it', 'live in it', 'do it up', 'refurb it'],
  },
  {
    key: 'prop_what_is_it_worth',
    label: 'They ask what you think it is worth',
    value: 'Say: "Honestly, on what I can see sold nearby, less than you\'re asking. That\'s why I gave you the figure I did." Never say the walk-away figure here either.',
    keywords: ['what do you think it\'s worth', 'what\'s it worth', 'what would you value', 'your valuation'],
  },
  {
    key: 'prop_sold_or_under_offer',
    label: 'It is sold or under offer',
    value: 'Worth 20 seconds. Say: "Ah, fair enough. Would the vendor consider backup offers at all? And how long has it been agreed, out of interest?" Get their name and agree to ring back in a few weeks.',
    keywords: ['sold', 'under offer', 'sale agreed', 'sold stc', 'gone', 'off the market'],
  },
  {
    key: 'prop_callback_time',
    label: 'Ending the call',
    value: 'Never end a call without an agreed callback time. Say: "What\'s a realistic time for me to ring you back, tomorrow or is it better later in the week?" That turns pestering into an appointment, and the money in this job is in the follow-up.',
    keywords: ['ring me', 'call me back', 'get back to you', 'speak to the vendor', 'i\'ll find out', 'leave it with me'],
  },
];

/** One extra block on the user message so the model cannot mistake the call
 *  type even if it skims the system layers. */
const PROPERTY_CALL_CONTEXT = [
  '=== THIS CALL IS ABOUT BUYING A HOUSE ===',
  'The person on the phone is an ESTATE AGENT. We are the buyer. There is no product being sold to them, no reviews, no website, no subscription.',
  'Five beats: is it still available, ask for two minutes, the checklist, the money, wrap up.',
  'The walk-away figure in THIS LEAD is private. Never coach the agent to say it.',
  'The KNOWLEDGE BASE on this call is the estate-agent objection list. Answer an objection with the approved line from it, never with a new argument.',
].join('\n');

// Hugo 2026-04-29: replaced the single mega-prompt with three independently
// editable layers (style / script / knowledge base). The model receives them
// as separate system messages so each can evolve in isolation. See
// docs/runbooks/COACH_PROMPT_LAYERS.md for the full architecture.

interface CoachLayers {
  stylePrompt: string;   // wk_ai_settings.coach_style_prompt
  scriptPrompt: string;  // wk_ai_settings.coach_script_prompt
  facts: CoachFact[];    // wk_coach_facts (active rows)
  // PR 8 (Hugo 2026-04-26): the agent's actual call script body
  // (wk_call_scripts WHERE owner_agent_id = call.agent_id, falling
  // back to is_default = true). Already substituted: `{{first_name}}`
  // → contact's first name, `{{agent_first_name}}` → agent's first
  // name. Empty string when no script is found at all.
  agentScriptBody: string;
  agentScriptSource: 'own' | 'column' | 'campaign' | 'default' | 'vsl_close' | 'property_call' | 'none';
}

interface CoachOptions {
  apiKey: string;
  model: string;
  layers: CoachLayers;
  recentTranscript: string;
  latestUtterance: string;
  speaker: 'caller' | 'agent';
  priorCards: string[];
  // PR 42 (Hugo 2026-04-27): wk_calls.current_stage — human label of
  // the last SCRIPT card's script_section. Injected into the user
  // message so the model refuses to regress (no firing OPEN mid-call
  // once we've already moved past it). Null on a fresh call.
  currentStage: string | null;
  // Real facts about the lead being called (owner name, review count, rating,
  // rank, competitors) so the coach fills the script with actual values
  // instead of emitting placeholders like [X] / [Name]. Empty when unknown.
  leadFacts: string;
  /** Close calls only. Replaces the hardcoded cold stage list in STAGE LOCK.
   *  Undefined on every normal dial, which renders the original literal. */
  stageOrder?: string[];
  /** 'vsl_close' adds one block to the user message. Undefined = cold call. */
  callKind?: 'vsl_close' | 'property_call';
  onChunk: (accumulated: string, isFirst: boolean) => void;
  isAborted: () => boolean;
}

async function generateCoachSuggestion(
  opts: CoachOptions
): Promise<CoachOutput | null> {
  const {
    apiKey,
    model: modelOverride,
    layers,
    recentTranscript,
    latestUtterance,
    speaker,
    priorCards,
    currentStage,
    leadFacts,
    stageOrder,
    callKind,
    onChunk,
    isAborted,
  } = opts;
  if (!apiKey || !latestUtterance || speaker !== 'caller') return null;

  // Model is admin-editable via /smsv2/settings → AI coach. Fallback used
  // only when the DB column is empty.
  const DEFAULT_LIVE_COACH_MODEL = 'gpt-5.4-mini';
  const trimmedModel = (modelOverride ?? '').trim();
  const liveCoachModel = trimmedModel.length > 0 ? trimmedModel : DEFAULT_LIVE_COACH_MODEL;

  // ----- LAYER FALLBACKS (used only if DB columns / facts are empty) -----
  //
  // These constants ARE the canonical defaults in this project — the
  // consolidated CRM-port migration deliberately seeds no coach prompts,
  // so a workspace with blank wk_ai_settings gets this generic
  // service-business content until the admin configures their own.

  const DEFAULT_STYLE_PROMPT = [
    'You are voicing the lines a sales rep will read aloud, mid-call. Output ONE primary line, ready to read.',
    '',
    'VOICE',
    '- UK English. Plain, commercial, natural — like a real human salesperson, not a coach, therapist, or copywriter.',
    '- Short lines: 1–3 short sentences. Up to ~50 words for explanations, fewer for everything else.',
    '- If the caller is short or blunt, match their energy. Don\'t over-warm.',
    '- Every line should move the conversation forward.',
    '',
    'FILLER CADENCE',
    '- Light fillers — right / yeah / fair enough / no worries / look / listen / alright / makes sense / ok — should appear in roughly 1 in 4 lines, no more.',
    '- Never two filler-led lines in a row.',
    '- Vary the vocabulary across the call. Don\'t lean on the same one twice in a row.',
    '- A filler must be doing work (acknowledgement, soft pivot). If it\'s just there for warmth, drop it.',
    '',
    'ABSOLUTE BANS',
    '- No style labels or acting notes ([warm], [firm], [low], [reasonable man], [you could say], etc.).',
    '- No coaching-language metaphors ("you\'re open, not desperate"). No therapist tone.',
    '- No multiple variants. ONE primary line.',
    '- No bullets. No quotation marks around your line. No labels.',
    '- No instructional verbs (Reintroduce, Ask, Describe, Tell them, Explain, Suggest, Confirm, Probe, Pivot, Mention, Address, Acknowledge). You are WRITING the line, not directing it.',
    '- No American/corporate slop ("reach out", "circle back", "for sure", "absolutely", "appreciate that", "that\'s a great question", "going forward").',
    '',
    'COMPLIANCE BANS — never put these words in the agent\'s mouth:',
    '- "Guaranteed" / "Guarantee" — we never promise outcomes.',
    '- "Risk-free" — no job or purchase is risk-free.',
    '- "Can\'t lose" — same reason.',
    '- "Definitely" when talking about results, savings or timescales ("definitely be done by", "definitely save you X") — soften to "typically" or "usually".',
    '- "Free trial" / "free to try" / "nothing today" / "no charge today" / "you don\'t pay a penny" — do NOT say any of these unless the offer is genuinely £0 today. If an entry charge is taken (the sign-up takes £1 today), say that plainly: it starts at a pound, then the monthly price after the trial. Never tell the caller a charge is free when a charge is taken.',
    'If a banned phrase shows up in your draft, REWRITE the line before emitting it. We describe what the business DOES and how it has PERFORMED for other customers — we never promise outcomes.',
    '',
    'REQUIRED SAFETY PHRASES — bake these into price / timescale / outcome talk:',
    '- "Typically" / "Usually" instead of unqualified claims.',
    '- "Subject to a proper look at the job" when discussing a price before a survey or site visit.',
    '- "Like any job of this kind…" before discussing caveats or things that could change the quote.',
    '- "Most customers find…" when quoting figures or timeframes from KB facts.',
    'Use at least one of these whenever the line contains a number, a price, a timescale, or any forward-looking statement.',
    '',
    'OUTPUT',
    'Return exactly one read-aloud line. Nothing else.',
  ].join('\n');

  const DEFAULT_SCRIPT_PROMPT = [
    'You follow the business\'s call script. Default to script INTENT, paraphrase fresh each time. Only deviate when the caller asks a direct factual question or raises an objection.',
    '',
    'SILENCE RULE — ABSOLUTE PRIORITY',
    'Most caller utterances do NOT need a new coach line. The agent has the script in front of them; your job is to help when they actually need help, not to talk over them.',
    'Output the literal marker `STAY_ON_SCRIPT` on a single line — and nothing else — when ANY of these are true:',
    '- Caller utterance is filler / acknowledgement / backchannel ("yeah", "right", "ok", "mhm", "sure", "go on", "I see", "uh huh", "got it").',
    '- Caller is asking a question already covered by the SCRIPT or KNOWLEDGE BASE — the agent can read the script line themselves.',
    '- Caller is mid-thought (incomplete sentence, trailing off) and there is nothing concrete to respond to yet.',
    '- The agent\'s last move was already the right move and the caller hasn\'t introduced anything new.',
    'If you output STAY_ON_SCRIPT, output ONLY that string. No explanation, no quotes, no leading words.',
    'Only produce a real coach line when the caller asks something NOT covered by the script AND NOT covered by the knowledge base — something the agent genuinely needs help responding to (a curveball question, an unexpected objection, an emotional reaction).',
    '',
    'USE FRESH WORDING',
    'You\'re on a live call with a real human. Repeating the exact same phrasing twice in a call sounds canned. Use the example phrasings below as anchors, then pick a fresh wording each time you hit the same stage / branch. Never copy a phrasing word-for-word from your last 5 cards (see ANTI-REPETITION).',
    '',
    'OPEN-ENDED DEFAULT',
    'Most lines end with a question or invitation that keeps the conversation moving:',
    '- "What\'s prompted you to look into this now?"',
    '- "Is this something you need sorted urgently, or more planning ahead?"',
    '- "Want me to give you the quick version?"',
    '- "Does that make sense?"',
    '- "Have you used a company for this before, or is it your first time sorting it?"',
    'If the caller is short or blunt, match their energy.',
    '',
    'CALL STAGES (always know which one you\'re in)',
    'Numbered order — strict forward-only progression:',
    '1. Open',
    '2. Qualify',
    '3. Permission to pitch',
    '4. Pitch',
    '5. Pricing',
    '6. SMS close',
    '7. Follow-up lock',
    '',
    'STAGE LOCK — STRICT FORWARD-ONLY (Hugo 2026-04-27, v12)',
    'The user message includes a "STAGE LOCK" block telling you the LAST SCRIPT card you fired on this call (read from wk_calls.current_stage).',
    'Rules:',
    '- DO NOT fire any SCRIPT card whose stage number is LESS THAN OR EQUAL TO the locked stage. You have already done that stage; don\'t repeat it.',
    '- The next [SCRIPT: <stage>] card MUST be at a HIGHER stage number than the locked stage. (e.g. lock=4 means next SCRIPT must be 5, 6, or 7.)',
    '- If the caller wants you to re-explain something already in an earlier stage (e.g. "run me through that again"), DO NOT re-fire SCRIPT — Pitch. Instead fire [SUGGESTION] or [EXPLAIN] with a brief recap of what they asked about.',
    '- If the caller diverges off-script entirely, fire [SUGGESTION] or [EXPLAIN], never roll back the script.',
    '- The only exception: if the caller has clearly hung up and restarted (a fresh "Hello?" after a long silence), you may reset to OPEN.',
    '',
    'EARNED-PITCH RULE',
    'Only ask permission-to-pitch ("would it be okay if I explain quickly how we work?") when EITHER:',
    '1. The caller has confirmed they need the service ("yeah I\'m looking to get this sorted", "tell me about it", etc.), OR',
    '2. The caller has given more than a one-word answer to QUALIFY (e.g. "we\'ve had this problem for a few months", not just "yeah").',
    'Otherwise: ask another open question that gets them talking. Don\'t burn the permission-to-pitch on a cold caller.',
    '',
    'EARNED-CLOSE RULE',
    'Fire the SMS-close + tomorrow lock ONLY when ALL of these are true:',
    '1. PITCH and PRICING already delivered.',
    '2. The caller has shown interest (asked a relevant question, agreed, or stayed engaged for more than two exchanges).',
    '3. The caller has NOT refused the SMS in this call.',
    'Otherwise default to a question that moves the conversation forward.',
    '',
    'KNOWLEDGE POLICY — three tiers',
    'Distinguish between three kinds of caller question and pick the right source for each:',
    '',
    '1. COMPANY-SPECIFIC FACTS — KB ONLY.',
    '   Anything that depends on the business\'s specific operations: prices, call-out fees, service packages, coverage areas, opening hours, availability, lead times, warranty/guarantee terms, accreditations, the company\'s Companies House number.',
    '   Source: KNOWLEDGE BASE only. If the answer isn\'t there, say "I\'ll check that and come back to you" — NEVER invent figures, coverage areas, or terms.',
    '',
    '2. GENERAL DOMAIN KNOWLEDGE — OK from your general training.',
    '   Industry-standard concepts that aren\'t company-specific: what a trade certification covers in general, common UK regulations for the trade, how a standard quote/survey process works, what a deposit or call-out fee usually is, consumer-rights basics — anything regulatory, industry, or domain-conceptual that isn\'t about THIS company.',
    '   You may answer these from your general knowledge in a brief, plain-English UK style. Prefer the [EXPLAIN] card kind for these (not [SCRIPT]) so the agent\'s UI marks them as a factual answer rather than a script line.',
    '   If you genuinely don\'t know (or it\'s a niche regulatory edge case), say so — DO NOT bluff.',
    '',
    '3. UNCERTAIN / NICHE — DEFER.',
    '   If the question doesn\'t fit (1) or (2) and you\'re not confident, say "I\'ll check that and come back to you" or pivot to "let me check with the team and come back in writing".',
    '',
    'NEVER blend tiers — don\'t answer a company-specific question with general knowledge ("I think most firms charge around X…") and don\'t answer a general question with a deflection if you actually know the concept.',
    '',
    'OBJECTIONS',
    'If the caller pushes back, use the matching approved answer from the KNOWLEDGE BASE. Then return to the next open-ended question — NOT immediately to a close (see EARNED-CLOSE RULE).',
    '',
    'ANTI-REPETITION',
    'The user message includes "YOUR LAST FEW COACH CARDS" and a "DO NOT START WITH" list of opener n-grams from your last 5 cards. Don\'t ship a card whose opening 3 words match any banned n-gram. Move forward through the script — don\'t loop the same line.',
    '',
    'DEFAULT SCRIPT — INTENT + 2-3 EXAMPLE PHRASINGS (paraphrase fresh each time)',
    '',
    'OPEN',
    'INTENT: Confirm the caller is the right person + introduce yourself + reference their enquiry + ask what they need sorted.',
    'EXAMPLES (anchors — paraphrase, do not read verbatim):',
    '- "Hey, is that [Name]? It\'s [Your Name] from [Company] — you got in touch about [service]. Is now a decent time for a quick chat about what you need?"',
    '- "[Name]? [Your Name] from [Company] here, following up on your enquiry. Quick one — is this something you\'re looking to get sorted soon, or more getting a feel for options?"',
    '',
    'QUALIFY',
    'INTENT: Find out what the job actually is, how urgent it is, and whether they\'ve tried anyone else. Don\'t make them feel quizzed.',
    'EXAMPLES:',
    '- "What\'s the situation at the moment — is it something that\'s just come up, or been on the list a while?"',
    '- "Roughly when were you hoping to get it done?"',
    '- "Have you had anyone look at it yet, or are we the first?"',
    '',
    'JUST EXPLORING (when caller says "just exploring" / "just looking" / "just getting quotes")',
    'Don\'t permission-pitch yet. Pick ONE of these angles, NEVER the same shape twice in a row across the call:',
    '- WARM CURIOSITY — ask what prompted them to enquire in the first place (e.g. "fair — what made you get in touch about it now?").',
    '- LIGHT CONTEXT — most of our customers started exactly there, share that briefly, no pitch (e.g. "makes sense, plenty of our customers started by just comparing options — anything in particular you\'re weighing up?").',
    '- SOCIAL PROOF (light, no numbers) — mention the typical customer profile (e.g. "fair enough — most people who come to us are just trying to get it done properly without the runaround, sound familiar?").',
    '- LOW-PRESSURE PERMISSION — happy to walk through how it works as a reference point (e.g. "no worries — happy to keep it quick, want me to run through how we\'d handle it so you\'ve got a reference, or save it for next time?").',
    '- EMPATHY BRIDGE — ask what would have to be true for them to go ahead (e.g. "fair enough. What would have to line up for you to actually book it in?").',
    '',
    'PERMISSION TO PITCH',
    'INTENT: Quick, low-pressure check before explaining how the service works. Only fire when the EARNED-PITCH RULE is met.',
    'EXAMPLES:',
    '- "Mind if I run through how we\'d handle it — two minutes max?"',
    '- "Quick one — alright if I explain how we usually approach this?"',
    '- "Fair if I walk you through it quickly so you\'ve got something concrete?"',
    '',
    'PITCH',
    'INTENT: Explain how the service works + what\'s included + what makes the company worth choosing. Quote specifics ONLY from the KNOWLEDGE BASE — do not invent or substitute. Use the KB facts for services, coverage and guarantees; never hardcode figures in your line.',
    'PARAPHRASE: a sentence about how the job gets done ("we come out, assess it properly, and give you a fixed quote before any work starts"), then a sentence pulling the relevant service details from KB facts, then a soft check-in.',
    '',
    'PRICING',
    'INTENT: Explain how pricing works (quote, call-out, fixed price, hourly — whatever the KB says) and what happens next. Reference KB facts — don\'t invent prices. If a price depends on seeing the job, say so plainly.',
    'EXAMPLES (anchors):',
    '- "Pricing\'s straightforward — we give you the full quote up front before anything starts, so there are no surprises. Does that work for you?"',
    '- "It depends a bit on the job itself, so we\'d confirm the exact figure after taking a proper look — but you\'ll have it in writing before anything goes ahead. Sound fair?"',
    '',
    'SMS CLOSE — IMPORTANT',
    'INTENT: Frame the follow-up text as a courtesy, not pressure. Only fire when the EARNED-CLOSE RULE is met.',
    'TWO BEATS — both need to happen before Follow-up lock:',
    '  Beat A — ask permission to send the details:',
    '    "To keep it simple rather than run through everything on this call, would it be okay if I text you the details so you can see everything properly?"',
    '  Beat B — IF YES, ask for their name (we don\'t have it in our records):',
    '    "Perfect — can you confirm your name so I can add you to my contacts here?"',
    '    After they give their name: "Great, you\'ll receive the text right after this call."',
    'The agent will not have the caller\'s name reliably — always include Beat B before sending the SMS. Do not skip this beat.',
    '',
    'FOLLOW-UP LOCK',
    'INTENT: Lock tomorrow without being pushy.',
    'EXAMPLES:',
    '- "After you\'ve had a look, I\'ll give you a quick call tomorrow to talk through it. Will tomorrow work?"',
    '- "Once it lands, mind if I ring you tomorrow to talk through it — morning or afternoon?"',
    '- "I\'ll call you tomorrow to walk through anything that\'s come up, what time suits?"',
    '',
    'OUTPUT FORMAT — v11 (Hugo 2026-04-26)',
    'A separate system message titled `=== AGENT\'S CALL SCRIPT ===` carries the EXACT lines the agent has on screen. Mirror those lines whenever you emit a SCRIPT card.',
    'Every line MUST start with one of these classifier prefixes so the UI can label the card correctly:',
    '- `[SCRIPT: <stage>] <line>` — caller is on-script, your line is the next thing the rep should read. The <stage> MUST match a "## N. <Stage>" heading from the AGENT\'S CALL SCRIPT body. The <line> SHOULD be a verbatim or near-verbatim quote of the next line under that heading; only paraphrase when adapting an example phrasing to the caller. Example: `[SCRIPT: Qualify] What\'s the situation at the moment — just come up, or been on the list a while?`',
    '- `[SUGGESTION] <line>` — caller went off-script and the rep needs a fresh line that isn\'t in the script. Example: `[SUGGESTION] Fair enough — what would have to line up for you to actually book it in?`',
    '- `[EXPLAIN] <line>` — caller raised an objection or asked a factual question; your line answers it from the KNOWLEDGE BASE. Example: `[EXPLAIN] Fair — the exact figure depends on the job itself, but you get the full quote in writing before anything goes ahead.`',
    'Default to SCRIPT whenever the caller\'s utterance plausibly falls inside one of the seven stages above. SUGGESTION is for genuine off-script moments; EXPLAIN is reserved for objections or KB-grounded factual answers.',
    'If you output the silence marker (see SILENCE RULE), do NOT add a prefix — just the bare `STAY_ON_SCRIPT`.',
    'Return exactly ONE classified line. No quotes around the line. No labels other than the prefix.',
  ].join('\n');

  // Resolve each layer: prefer DB content, fall back to canonical default.
  const stylePrompt =
    (layers.stylePrompt ?? '').trim().length > 0
      ? layers.stylePrompt.trim()
      : DEFAULT_STYLE_PROMPT;
  const scriptPrompt =
    (layers.scriptPrompt ?? '').trim().length > 0
      ? layers.scriptPrompt.trim()
      : DEFAULT_SCRIPT_PROMPT;

  // Render the knowledge base as a flat block. Empty list → tells the
  // model the KB is empty and it must defer rather than guess.
  const factsBlock =
    layers.facts.length === 0
      ? '(no facts loaded — if asked a factual question, say "I\'ll check that and come back to you" rather than guessing.)'
      : layers.facts
          .map((f) => `- ${f.label}: ${f.value}`)
          .join('\n');

  const knowledgeBaseSystemPrompt =
    `=== KNOWLEDGE BASE ===\nThese are the only facts you may quote. Do NOT invent figures or new facts. If the answer isn't here, say "I'll check that and come back to you".\n\n${factsBlock}`;

  // PR 8 (Hugo 2026-04-26): the agent's actual call script. The model
  // can see the EXACT lines the agent reads and should mirror them
  // verbatim when emitting `[SCRIPT: <stage>]` cards. Placeholders are
  // already substituted, so anything inside this block can be quoted
  // back to the agent without modification.
  const agentScriptBody = (layers.agentScriptBody ?? '').trim();
  const agentScriptSource = layers.agentScriptSource ?? 'none';
  const agentScriptSystemPrompt =
    agentScriptBody.length === 0
      ? `=== AGENT'S CALL SCRIPT ===\n(no per-agent or default script loaded — fall back to your built-in stage map.)`
      : `=== AGENT'S CALL SCRIPT (source: ${agentScriptSource}) ===\nThis is the EXACT script the agent has open in front of them right now. When you emit a [SCRIPT: <stage>] card, the body MUST be the literal next line from this script (or a very close paraphrase if a placeholder needed substituting). Do NOT invent script lines that aren't in this body. The <stage> in your prefix MUST match a "## N. <Stage>" heading from this script.\n\n${agentScriptBody}`;

  // Retrieval: highlight facts whose keywords match the caller's last
  // utterance so the model focuses on the most likely-relevant ones.
  const matched = retrieveFacts(latestUtterance, layers.facts);
  const relevantFactsHint =
    matched.length === 0
      ? '(no specific fact keyword matched — answer from the script unless the caller is asking for a fact in the KB above.)'
      : matched
          .map((f) => `- ${f.label}: ${f.value}`)
          .join('\n');

  // Last few coach cards passed back to the model so it doesn't echo
  // openers / structures it just produced. v8 (PR #575): expanded from
  // 3 to 5 cards for better coverage of repeated openers.
  const priorCardsBlock =
    priorCards.length === 0
      ? '(none yet — this is your first card on this call)'
      : priorCards.map((c, i) => `${i + 1}. "${c}"`).join('\n');

  // v8: explicit 3-word opener n-gram ban list, derived from the last 5
  // cards. Beats the prompt's verbal "first 5 words" rule because the
  // banned strings are concrete, not abstract.
  const banList = buildOpenerBanList(priorCards);
  const banListBlock =
    banList.length === 0
      ? '(no openers to avoid yet)'
      : banList.map((b) => `- "${b}"`).join('\n');

  // PR 42 (Hugo 2026-04-27): forward-only stage progression. The model
  // is independent per utterance, so without this it'll happily fire
  // SCRIPT — Open mid-call (Hugo's screenshot 2026-04-27). We inject
  // the last fired SCRIPT stage so the model knows what's already
  // happened and refuses to regress.
  const stageLockBlock =
    currentStage && currentStage.trim().length > 0
      ? (stageOrder && stageOrder.length > 0
          ? [
              '=== STAGE LOCK ===',
              `Your last SCRIPT card on this call was at: "${currentStage}".`,
              `You are PAST this stage. Do NOT fire any earlier SCRIPT stage on this call. Stage order: ${stageOrder.join(' → ')}.`,
              'Only fire SCRIPT cards that are at the same stage or LATER. If the caller diverges or asks something off-script, fire [SUGGESTION] or [EXPLAIN] — never roll back to an earlier SCRIPT stage.',
            ].join('\n')
          : [
          '=== STAGE LOCK ===',
          `Your last SCRIPT card on this call was at: "${currentStage}".`,
          'You are PAST this stage. Do NOT fire any earlier SCRIPT stage on this call (no SCRIPT — Open if you already fired Qualify; no SCRIPT — Qualify if you already fired Permission to pitch; etc.). Stage order: Open → Qualify → Permission to pitch → Pitch → Pricing → SMS close → Follow-up lock.',
          'Only fire SCRIPT cards that are at the same stage or LATER. If the caller diverges or asks something off-script, fire [SUGGESTION] or [EXPLAIN] — never roll back to an earlier SCRIPT stage.',
        ].join('\n'))
      : '=== STAGE LOCK ===\n(no prior SCRIPT card yet — you may fire any stage that fits the caller\'s utterance)';

  // THIS LEAD block — the real name/reviews/rank so the coach substitutes
  // them into the script line instead of reading a placeholder like "[X]
  // reviews" or "[Name]" aloud (Hugo 2026-07-22).
  const leadBlock = leadFacts
    ? [
        '=== THIS LEAD — use these REAL values, NEVER read a placeholder like [X], [Name], [reviews] aloud ===',
        leadFacts,
        'When the script references their name, business, review count, rating, rank, or competitors, put the real value above into the line. If a value is missing, phrase around it — never say a bracketed token.',
      ].join('\n')
    : '=== THIS LEAD ===\n(no lead facts loaded — do NOT invent a name or numbers; keep the line generic and avoid brackets.)';

  // Empty array on a cold call, so the assembled cold user message is
  // byte-identical to what it has always been.
  const closeCallBlock = callKind === 'vsl_close' ? [CLOSE_CALL_CONTEXT, '']
    : callKind === 'property_call' ? [PROPERTY_CALL_CONTEXT, '']
    : [];

  const userMsg = [
    'Recent conversation (most recent line at bottom):',
    recentTranscript || '(no prior context yet)',
    '',
    ...closeCallBlock,
    leadBlock,
    '',
    stageLockBlock,
    '',
    '=== YOUR LAST FEW COACH CARDS (most recent first) ===',
    'Don\'t ship a card whose opening matches a recent one. Move forward through the script — don\'t loop the same line.',
    priorCardsBlock,
    '',
    '=== DO NOT START WITH — banned opener n-grams (first 3 words from your last 5 cards) ===',
    'Your next card MUST NOT begin with any of these phrases. Pick a different opener.',
    banListBlock,
    '',
    '=== POSSIBLY RELEVANT FACTS (matched to the caller\'s last utterance) ===',
    relevantFactsHint,
    '',
    `Caller just said: "${latestUtterance}"`,
    '',
    'Return ONE classified line per the OUTPUT FORMAT block — `[SCRIPT: <stage>]`, `[SUGGESTION]`, `[EXPLAIN]`, or the bare `STAY_ON_SCRIPT` marker. Plain UK English. No quotation marks around the line. No acting notes. No variants. Do NOT start with any banned opener n-gram listed above.',
  ].join('\n');

  try {
    return await streamCoachInternal({
      apiKey,
      model: liveCoachModel,
      systemMessages: [
        stylePrompt,
        scriptPrompt,
        knowledgeBaseSystemPrompt,
        agentScriptSystemPrompt,
      ],
      userMsg,
      onChunk,
      isAborted,
    });
  } catch (e) {
    console.warn('[wk-voice-transcription] openai chat threw', e);
    return null;
  }
}

/** Models that accept `reasoning_effort`. The GPT-5 family reasons before it
 *  emits a visible token, which is exactly what we are turning down; everything
 *  else rejects the parameter outright with a 400. */
const REASONING_MODEL = /^(gpt-5|o[1-9])/i;

// Internal streaming worker — separated so tests / future callers can
// invoke without rebuilding the prompt. Returns the post-processed
// final text or null on rejection.
async function streamCoachInternal(args: {
  apiKey: string;
  model: string;
  /** Three-layer system messages — style, script, knowledge base.
   *  OpenAI accepts multiple system messages; treating each as a
   *  separate message gives cleaner separation than one big concatenated
   *  prompt. */
  systemMessages: string[];
  userMsg: string;
  onChunk: (accumulated: string, isFirst: boolean) => void;
  isAborted: () => boolean;
}): Promise<CoachOutput | null> {
  const { apiKey, model, systemMessages, userMsg, onChunk, isAborted } = args;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify({
      model,
      // v9 (PR D 2026-04-30): dropped temperature 0.55 → 0.4. Hugo's
      // call: coach is too noisy / too creative; with the SILENCE RULE
      // doing the variety-reduction work, lower temp keeps coach lines
      // tighter and closer to the script when they DO fire.
      temperature: 0.4,
      presence_penalty: 0.3,
      frequency_penalty: 0.2,
      // GPT-5 family rejects `max_tokens` — use max_completion_tokens.
      max_completion_tokens: 120,
      // The coach runs on a GPT-5 family model, which reasons before it emits a
      // visible token, and the hidden reasoning also eats the same 120-token
      // budget the card is supposed to use.
      //
      // BE HONEST ABOUT WHAT THIS BUYS. Measured 2026-08-10 against the live
      // model on a real-sized 8.4KB coach prompt, three runs each:
      //   default : 0.52 / 0.47 / 0.78s   mean 0.59s
      //   none    : 0.52 / 0.48 / 0.50s   mean 0.50s
      // That is about 90ms and a tighter spread, NOT the 1 to 2.5 seconds first
      // estimated. The model is not the bottleneck and turning this down does
      // not fix a late card. Kept because it is free and removes the outlier,
      // but the real cost is elsewhere: Twilio will not release a word until
      // its endpointer calls the sentence over (partialResults="false" in
      // wk-voice-twiml-outgoing), which is 1.5 to 2.5s of the budget, and the
      // fix that actually put the right words in front of Pedro in time is the
      // no-model card in src/core/coach/instantCoach.ts.
      //
      // 'none', NOT 'minimal'. Measured against the live model on 2026-08-10:
      //   minimal -> 400 "does not support 'minimal' with this model"
      //   none    -> 200
      //   low     -> 200
      // 'minimal' is the documented value on some GPT-5 models and not on this
      // one, and the failure mode is not a slow coach, it is NO coach at all,
      // on every card, on a live calling day. Check before changing it.
      //
      // Sent ONLY to models that understand the parameter. live_coach_model is
      // an admin setting, so gpt-4o and friends can be selected at any time and
      // would reject it outright.
      ...(REASONING_MODEL.test(model) ? { reasoning_effort: 'none' } : {}),
      stream: true,
      // v8: tag this prompt prefix so OpenAI prompt-caching buckets
      // calls with the same three system messages together. Cache TTL
      // is ~5 min; back-to-back calls in a session reuse the prefix.
      // v18 (2026-07-15): default style/script prompts rewritten from
      // the source project's investment-sales script to generic UK
      // service-business content. Material prompt change → invalidate cache.
      prompt_cache_key: 'elsie-coach-v18',
      messages: [
        ...systemMessages
          .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
          .map((content) => ({ role: 'system' as const, content })),
        { role: 'user', content: userMsg },
      ],
    }),
  });

  if (!resp.ok) {
    let errBody = '';
    try { errBody = await resp.text(); } catch { /* ignore */ }
    console.warn('[wk-voice-transcription] openai chat failed', resp.status, errBody.slice(0, 500));
    return null;
  }
  if (!resp.body) {
    console.warn('[wk-voice-transcription] openai response had no body');
    return null;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let isFirst = true;

  try {
    while (true) {
      if (isAborted()) {
        try { await reader.cancel(); } catch { /* ignore */ }
        return null;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, remaining } = parseSseChunk(buffer);
      buffer = remaining;
      for (const ev of events) {
        if (ev.done) {
          // [DONE] marker — finish naturally.
          break;
        }
        if (ev.delta) {
          accumulated += ev.delta;
          onChunk(accumulated, isFirst);
          isFirst = false;
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  // Post-processor on the final accumulated text.
  return postProcessCoachText(accumulated);
}

// Coach card kinds shipped in PR 6 (Hugo 2026-04-26):
//   script     — model echoed (or paraphrased) the next script line
//   suggestion — caller went off-script, model wrote a fresh line
//   explain    — caller raised an objection / KB question, model
//                composed a KB-grounded answer
//
// `scriptSection` carries the human label of the section the SCRIPT
// card belongs to (e.g. "Qualify", "Permission to pitch") — surfaced
// in the UI as `SCRIPT — Qualify`. Null for non-script kinds.
type CoachKind = 'script' | 'suggestion' | 'explain';

interface CoachOutput {
  kind: CoachKind;
  scriptSection: string | null;
  body: string;
}

// Recognises the v10 prefix the model emits to classify its own line.
// Tolerates the colon being absent for SUGGESTION / EXPLAIN, and any
// whitespace inside the brackets. Match is anchored to the start —
// must run BEFORE the generic [bracket-tag] strip below or that
// regex will eat the prefix.
const COACH_KIND_PREFIX_RE =
  /^\[\s*(script|suggestion|explain)\s*(?::\s*([^\]]+))?\s*\]\s*/i;

// Pulled out so streaming and any future non-streaming caller share the
// same rejection rules. Returns null when the line should be dropped.
function postProcessCoachText(raw: string): CoachOutput | null {
  let text = (raw ?? '').trim();
  if (!text) return null;

  // v9 (PR D 2026-04-30): SILENCE RULE marker. The script prompt
  // instructs the model to output exactly `STAY_ON_SCRIPT` when the
  // caller's last utterance is filler, an acknowledgement, mid-thought,
  // or a question already covered by the script / knowledge base.
  // Strip surrounding quotes / backticks / punctuation before matching
  // so a stray wrapper doesn't leak the marker into the agent's UI.
  const stripped = text.replace(/^[\s"“”'`.\-–—]+|[\s"“”'`.\-–—]+$/g, '');
  if (/^stay[_\s-]?on[_\s-]?script$/i.test(stripped)) {
    return null;
  }
  // Hugo 2026-07-22: the marker LEAKED as a card ("SUGGESTION · STAY_ON_SCRIPT")
  // when the model wrapped it in a classifier prefix, e.g. "[SUGGESTION]
  // STAY_ON_SCRIPT" — the strip above keeps the brackets so the anchored regex
  // missed it. Bracket-tolerant catch: drop every [..] group and all non-letters
  // and compare. Legit lines ("Stay on script and confirm the mobile") survive.
  const bareMarker = text.replace(/\[[^\]]*\]/g, ' ').replace(/[^a-z]/gi, '').toLowerCase();
  if (bareMarker === 'stayonscript') {
    return null;
  }

  // v10 (PR 6 2026-04-26): parse the kind prefix BEFORE generic bracket
  // stripping. If absent, fall back to suggestion (the legacy default).
  let kind: CoachKind = 'suggestion';
  let scriptSection: string | null = null;
  const prefixMatch = COACH_KIND_PREFIX_RE.exec(text);
  if (prefixMatch) {
    const tag = prefixMatch[1].toLowerCase();
    if (tag === 'script' || tag === 'suggestion' || tag === 'explain') {
      kind = tag as CoachKind;
    }
    if (prefixMatch[2]) {
      scriptSection = prefixMatch[2].trim();
    }
    text = text.slice(prefixMatch[0].length).trim();
  }

  // Strip leading "Tip:" / "Coach:" / leading dash, etc.
  text = text.replace(/^["“”'`]*(tip|coach|suggestion|say|script)\s*[:\-—]\s*/i, '').replace(/^[-•—]\s*/, '').trim();
  text = text.replace(/^["“”'`]+|["“”'`]+$/g, '').trim();
  // Hugo 2026-04-28: prompt v6 forbids acting notes, but defend
  // anyway. Strip leading [warm] / [firm] / [low] / [reasonable man] /
  // any other [bracket-tag] from the start of the line so the agent
  // never reads "[reasonable man] Fair enough..." aloud. Also strip
  // any bracketed tag that survives mid-line at sentence start.
  text = text.replace(/^\s*(?:\[[^\]]+\]\s*)+/, '').trim();
  text = text.replace(/(^|[.!?]\s+)(?:\[[^\]]+\]\s*)+/g, '$1').trim();
  if (!text) return null;
  if (/^skip\.?$/i.test(text)) return null;
  if (/mirror\s+(their|the)\s+energy/i.test(text)) return null; // belt-and-braces
  // Reject instructional output that slipped through.
  if (/^(reintroduce|ask\b|describe\b|pivot\b|mention\b|tell them\b|explain\b|suggest\b|confirm\b|probe\b|emphasi[sz]e\b|highlight\b|address\b|acknowledge\b|reassure\b|offer\b|propose\b|invite\b|encourage\b|remind\b|clarify\b|share\b|present\b|discuss\b|outline\b|summari[sz]e\b)/i.test(text)) {
    console.warn('[wk-voice-transcription] coach produced instructional output, dropping:', text);
    return null;
  }
  return { kind, scriptSection, body: text };
}

// ----------------------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    // Twilio signs the public URL it POSTed to, not the proxied internal URL.
    const url = `${SUPABASE_URL}/functions/v1/wk-voice-transcription`;
    const formData = await req.formData();
    const params: Record<string, string> = {};
    formData.forEach((v, k) => { params[k] = v.toString(); });

    const sig = req.headers.get('x-twilio-signature') ?? '';
    if (!TWILIO_AUTH_TOKEN || !sig
        || !(await validateTwilioSignature(TWILIO_AUTH_TOKEN, sig, url, params))) {
      console.warn('[wk-voice-transcription] invalid Twilio signature');
      return new Response('forbidden', { status: 403, headers: corsHeaders });
    }

    const event = params.TranscriptionEvent ?? '';
    const callSid = params.CallSid ?? '';
    if (!callSid) {
      return new Response('missing CallSid', { status: 200, headers: corsHeaders });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Resolve our wk_calls.id once (Twilio sends multiple events per call).
    // Also pull agent_id + contact_id so we can fetch the agent's actual
    // call script and substitute the contact's first name into it (PR 8).
    const { data: call } = await supa
      .from('wk_calls')
      .select('id, ai_coach_enabled, agent_id, contact_id, current_stage, campaign_id, script_key')
      .eq('twilio_call_sid', callSid)
      .maybeSingle();

    if (!call) {
      console.warn('[wk-voice-transcription] call not found', callSid);
      return new Response('ok', { status: 200, headers: corsHeaders });
    }

    if (event === 'transcription-started') {
      await supa.from('wk_calls').update({ ai_status: 'running' }).eq('id', call.id);
      return new Response('ok', { status: 200, headers: corsHeaders });
    }

    if (event === 'transcription-stopped' || event === 'transcription-error') {
      if (event === 'transcription-error') {
        await supa.from('wk_calls').update({ ai_status: 'failed' }).eq('id', call.id);
      }
      return new Response('ok', { status: 200, headers: corsHeaders });
    }

    if (event !== 'transcription-content') {
      return new Response('ok', { status: 200, headers: corsHeaders });
    }

    // Twilio packs the actual transcript inside a JSON-encoded
    // `TranscriptionData` field on the form body.
    const dataJson = params.TranscriptionData ?? '';
    let transcriptText = '';
    try {
      const parsed = JSON.parse(dataJson) as { transcript?: string; confidence?: number };
      transcriptText = String(parsed.transcript ?? '').trim();
    } catch {
      transcriptText = '';
    }
    const isFinal = (params.Final ?? '').toLowerCase() === 'true';
    if (!transcriptText) {
      return new Response('ok', { status: 200, headers: corsHeaders });
    }

    // Map Twilio's track label back to our speaker enum.
    //
    // Per Twilio Real-Time Transcription docs, the meaning of inbound vs.
    // outbound depends on the DIRECTION of the call:
    //   - For OUTBOUND calls (the parent leg dials someone), inbound_track
    //     = the agent (the originator who triggered the dial), and
    //     outbound_track = the customer (the dialed recipient).
    //   - For INBOUND calls (the parent leg received the call), it's the
    //     other way around.
    //
    // smsv2's softphone dials out via device.connect() → outbound call →
    // inbound_track = agent, outbound_track = caller. Earlier code had this
    // inverted, which caused Hugo's recent test to label the caller's voice
    // as "You" (agent) in the transcript pane (2026-04-26 evidence).
    const track = (params.Track ?? '').toLowerCase();
    const speaker: 'caller' | 'agent' = track.startsWith('outbound') ? 'caller' : 'agent';

    // Persist transcript line ONLY for finalized chunks. Hugo
    // 2026-04-28: "Interim chunks for coach only — keep transcript
    // pane clean." Interim chunks would spam the pane with partial
    // re-writes ("Hello", "Hello there", "Hello there um"…).
    if (isFinal) {
      await supa.from('wk_live_transcripts').insert({
        call_id: call.id,
        speaker,
        body: transcriptText,
      });

      // THE EMAIL ADDRESS, THE MOMENT IT IS SAID. Hugo, 2026-08-14: Pedro was
      // typing it by hand mid-sentence, or asking the branch to repeat it, and
      // "a call with no email cannot turn into an offer".
      //
      // PROPERTY CALLS ONLY. The same words on a plumber dial mean nothing and
      // this must not touch Marr's 200 dials a day.
      //
      // BOTH SPEAKERS on purpose: the branch says it, and Pedro reads it back
      // to check. Either one is the address.
      //
      // It is filed as a coach card carrying meta.captured_email, NOT written
      // onto the contact. The Email pane picks it up over realtime and types it
      // into a field Pedro can see and correct. A mistyped address is an offer
      // that silently never arrives, so a human confirms it by pressing send.
      if (call.script_key === 'property_call' && mentionsEmail(transcriptText)) {
        try {
          const heard = extractEmail(transcriptText);
          if (heard) {
            const { data: already } = await supa
              .from('wk_live_coach_events')
              .select('id')
              .eq('call_id', call.id)
              .eq('kind', 'metric')
              .contains('meta', { captured_email: heard })
              .limit(1);
            if (!already || already.length === 0) {
              await supa.from('wk_live_coach_events').insert({
                call_id: call.id,
                kind: 'metric',
                title: 'Email heard',
                body: `${heard} is now in the Email tab. Say "I'm sending you something now, can you confirm it lands?" and press Send.`,
                meta: { captured_email: heard, heard_from: speaker },
                status: 'final',
              });
            }
          }
        } catch (e) {
          // Never let a nicety break the transcript pipeline mid-call.
          console.warn('[wk-voice-transcription] email capture failed', String(e));
        }
      }

      // WHO HE IS SPEAKING TO, the moment they say it. Hugo, 2026-08-14: "we
      // need to ask for the agent name, and if the AI captured the agent name
      // then it has to add automatically." It is said in the first ten seconds
      // of nearly every call and typed on almost none of them, which is why a
      // branch Pedro had rung twice still showed "Name not available".
      //
      // PROPERTY CALLS ONLY, same as the address above: the same words on a
      // plumber dial mean nothing and must not touch Marr's day.
      //
      // ONLY THE FIRST ONE. A branch names its colleagues all call long ("I'll
      // put you through to Lucy"), and the person Pedro actually spoke to is
      // whoever answered. Filed as a coach card carrying meta.captured_name,
      // never written onto the contact: the Houses checklist fills the field
      // from it and Pedro can correct it before he presses an outcome.
      if (call.script_key === 'property_call' && mentionsName(transcriptText)) {
        try {
          const person = extractSpokenName(transcriptText);
          if (person) {
            const { data: already } = await supa
              .from('wk_live_coach_events')
              .select('id')
              .eq('call_id', call.id)
              .eq('kind', 'metric')
              .not('meta->>captured_name', 'is', null)
              .limit(1);
            if (!already || already.length === 0) {
              await supa.from('wk_live_coach_events').insert({
                call_id: call.id,
                kind: 'metric',
                title: 'Name heard',
                body: `You are speaking to ${person}. It is in the Houses checklist, correct it there if that is not right.`,
                meta: { captured_name: person, heard_from: speaker },
                status: 'final',
              });
            }
          }
        } catch (e) {
          console.warn('[wk-voice-transcription] name capture failed', String(e));
        }
      }

      // PR 58 (Hugo 2026-04-27): when the agent reads aloud one of
      // the script's section anchor lines, advance current_stage to
      // that section so the coach's STAGE LOCK accounts for what
      // the agent just covered. Forward-only — never moves the
      // cursor backward.
      if (speaker === 'agent' && call.ai_coach_enabled) {
        try {
          // Resolve the agent's effective script body (own > campaign-
          // pinned > workspace default) — same chain useAgentScript
          // applies on the client so the matcher sees what the agent
          // actually has on screen.
          let scriptBody = '';
          if (call.agent_id) {
            const { data: own } = await supa
              .from('wk_call_scripts')
              .select('body_md')
              .eq('owner_agent_id', call.agent_id)
              .limit(1);
            if (own && own.length > 0) {
              scriptBody = own[0].body_md as string;
            }
          }
          if (!scriptBody && call.campaign_id) {
            const { data: campRow } = await supa
              .from('wk_dialer_campaigns')
              .select('call_script_id')
              .eq('id', call.campaign_id)
              .maybeSingle();
            const pinnedId = campRow?.call_script_id as string | null | undefined;
            if (pinnedId) {
              const { data: pinned } = await supa
                .from('wk_call_scripts')
                .select('body_md')
                .eq('id', pinnedId)
                .maybeSingle();
              if (pinned) scriptBody = pinned.body_md as string;
            }
          }
          if (!scriptBody) {
            const { data: def } = await supa
              .from('wk_call_scripts')
              .select('body_md')
              .eq('is_default', true)
              .limit(1);
            if (def && def.length > 0) scriptBody = def[0].body_md as string;
          }

          if (scriptBody) {
            const sections = parseScriptAnchors(scriptBody);
            const currentStage = (call.current_stage as string | null) ?? null;
            const advancedTo = detectStageFromAgent(transcriptText, sections, currentStage);
            if (advancedTo) {
              console.log(
                `[wk-voice-transcription] [stage-from-voice] call=${call.id.slice(0, 8)} from='${currentStage ?? 'null'}' → '${advancedTo}' triggered by agent: "${transcriptText.slice(0, 80)}"`,
              );
              await supa
                .from('wk_calls')
                .update({ current_stage: advancedTo })
                .eq('id', call.id);
            }
          }
        } catch (e) {
          console.warn('[wk-voice-transcription] stage-from-voice threw', e);
        }
      }
    }

    // Coaching path — fires on BOTH interim and final chunks for the
    // caller, so the coach card starts streaming within ~400ms of the
    // caller speaking instead of waiting for Twilio to finalize the
    // utterance (which can be 1-3s after the caller stops).
    //
    // Per-call lock + generation_id keep the streams sane:
    //   - interim with a recent active lock → debounced (skipped)
    //   - interim past 400ms debounce → supersedes prior generation
    //   - final → ALWAYS supersedes (force=true); the final transcript
    //     is the most accurate, so the last word goes to it
    //
    // EdgeRuntime.waitUntil keeps the streaming worker alive past the
    // 200 we return to Twilio.
    // A FRAGMENT IS NOT A TURN. With partials on, the first interim of a
    // sentence is often two words ("they would"), and answering that produces a
    // card about nothing which then gets replaced a beat later. Our own voice
    // caller learned this on a live call: at a 0.45s settle with no length
    // floor it fired on "Uh, who's" and replied to half a question, which is
    // why bridge/config.py now carries SETTLED_PARTIAL_MIN_WORDS = 4.
    //
    // Finals are never gated: a genuinely short answer ("Yeah." / "No chance.")
    // is a real turn and often the most important one on the call.
    const wordCount = transcriptText.split(/\s+/).filter(Boolean).length;
    const tooShortToAnswer = !isFinal && wordCount < 4;

    if (call.ai_coach_enabled && speaker === 'caller' && !tooShortToAnswer) {
      const generationId = crypto.randomUUID();
      const genShort = generationId.slice(0, 8);
      const t0 = Date.now();
      const log = (event: string, extra: string = '') =>
        console.log(`[wk-voice-transcription] [coach gen=${genShort}] ${event} +${Date.now() - t0}ms ${extra}`.trim());
      log('interim received', `final=${isFinal} chars=${transcriptText.length}`);

      const coachPromise = (async () => {
        try {
          // 1. Try to acquire the lock. Interim chunks debounce on
          //    400ms; final chunks force-supersede.
          const { data: lockResult, error: lockErr } = await supa.rpc(
            'wk_acquire_coach_lock',
            {
              p_call_id: call.id,
              p_gen_id: generationId,
              p_force: isFinal,
              // v9 (PR D 2026-04-30): debounce raised 250 → 700ms to cut
              // OpenAI call volume. Hugo 2026-07-22: coach felt slow —
              // lowered 700 → 400ms so a caller utterance triggers the
              // coach line ~300ms sooner. Final chunks still force-
              // supersede, and the SILENCE RULE keeps most generations
              // returning STAY_ON_SCRIPT, so the extra fires stay cheap.
              p_min_age_ms: 400,
            }
          );
          if (lockErr) {
            console.warn(`[wk-voice-transcription] [coach gen=${genShort}] lock RPC error`, lockErr.message);
            return;
          }
          if (lockResult !== generationId) {
            // Lost the race — another generation is already in flight
            // and the debounce window hasn't elapsed.
            log('lock lost — debounced');
            return;
          }
          log('lock acquired');

          // 2. Read AI settings (now includes the three-layer prompts).
          const { data: ai } = await supa
            .from('wk_ai_settings')
            .select('ai_enabled, live_coach_enabled, openai_api_key, live_coach_system_prompt, coach_style_prompt, coach_script_prompt, live_coach_model')
            .limit(1)
            .maybeSingle();
          const envOpenAiKey = Deno.env.get('OPENAI_API_KEY') ?? '';
          if (!envOpenAiKey) {
            console.warn('[wk-voice-transcription] OPENAI_API_KEY secret not set — falling back to wk_ai_settings.openai_api_key');
          }
          const openaiKey = envOpenAiKey || ((ai?.openai_api_key as string | null) ?? '');
          if (!ai?.ai_enabled || !ai?.live_coach_enabled || !openaiKey) {
            log('ai disabled — bailing');
            return;
          }

          // 3. Read recent transcripts + prior cards + coach facts +
          //    agent profile + contact + agent's call script in parallel.
          //    Agent's call script (PR 8): prefer the agent's OWN row
          //    (wk_call_scripts WHERE owner_agent_id = call.agent_id),
          //    fall back to the default row (is_default = true).
          //
          //    PR 56 (Hugo 2026-04-27): also read per-campaign overrides
          //    (wk_campaign_ai_settings + wk_campaign_facts + the campaign
          //    row's call_script_id). Cascade lookup happens after the
          //    parallel fetch — null fields fall through to workspace.
          const campaignId = (call.campaign_id as string | null) ?? null;
          // The agent's on-screen script choice, persisted by wk-calls-create.
          // NULL on every existing row and every cold dial, so the whole close
          // branch below is dead code on a normal call.
          const isCloseCall = (call.script_key as string | null) === 'vsl_close';
          // Ringing an estate agency about a house. Mutually exclusive with
          // isCloseCall by construction: script_key holds one value.
          const isPropertyCall = (call.script_key as string | null) === 'property_call';
          const [
            recentRes,
            priorCardsRes,
            factsRes,
            agentProfileRes,
            contactRes,
            ownScriptRes,
            defaultScriptRes,
            campaignRes,
            campaignAiRes,
            campaignFactsRes,
          ] = await Promise.all([
            supa
              .from('wk_live_transcripts')
              .select('speaker, body, ts')
              .eq('call_id', call.id)
              .order('ts', { ascending: false })
              .limit(6),
            supa
              .from('wk_live_coach_events')
              .select('body, ts')
              .eq('call_id', call.id)
              .eq('status', 'final')
              .order('ts', { ascending: false })
              // v8 (PR #575): expanded 3 → 5 to give buildOpenerBanList
              // and the prompt's anti-repetition rule more material.
              .limit(5),
            supa
              .from('wk_coach_facts')
              .select('key, label, value, keywords, sort_order')
              .eq('is_active', true)
              .order('sort_order', { ascending: true }),
            call.agent_id
              ? supa
                  .from('profiles')
                  .select('name')
                  .eq('id', call.agent_id)
                  .maybeSingle()
              : Promise.resolve({ data: null, error: null }),
            call.contact_id
              ? supa
                  .from('wk_contacts')
                  .select('name, pipeline_column_id, custom_fields')
                  .eq('id', call.contact_id)
                  .maybeSingle()
              : Promise.resolve({ data: null, error: null }),
            call.agent_id
              ? supa
                  .from('wk_call_scripts')
                  .select('name, body_md')
                  .eq('owner_agent_id', call.agent_id)
                  .limit(1)
              : Promise.resolve({ data: null, error: null }),
            supa
              .from('wk_call_scripts')
              .select('name, body_md')
              .eq('is_default', true)
              .limit(1),
            // PR 56: campaign row → call_script_id pin
            campaignId
              ? supa
                  .from('wk_dialer_campaigns')
                  .select('call_script_id, coach_profile_id')
                  .eq('id', campaignId)
                  .maybeSingle()
              : Promise.resolve({ data: null, error: null }),
            // PR 56: per-campaign AI settings (style/script overrides)
            campaignId
              ? supa
                  .from('wk_campaign_ai_settings')
                  .select('coach_style_prompt, coach_script_prompt, live_coach_model')
                  .eq('campaign_id', campaignId)
                  .maybeSingle()
              : Promise.resolve({ data: null, error: null }),
            // PR 56: per-campaign KB facts (override workspace by `key`)
            campaignId
              ? supa
                  .from('wk_campaign_facts')
                  .select('key, label, value, keywords, sort_order')
                  .eq('campaign_id', campaignId)
                  .eq('is_active', true)
                  .order('sort_order', { ascending: true })
              : Promise.resolve({ data: null, error: null }),
          ]);
          const ctx = (recentRes.data ?? [])
            .reverse()
            .map((r: { speaker: string; body: string }) =>
              `${r.speaker === 'agent' ? 'Agent' : 'Caller'}: ${r.body}`
            )
            .join('\n');
          const priorCards: string[] = ((priorCardsRes.data ?? []) as { body: string }[])
            .map((c) => c.body)
            .filter((s): s is string => typeof s === 'string' && s.length > 0);

          // 4. Sweep prior streaming placeholders for THIS call (from
          //    superseded generations). They get DELETEd so the client
          //    realtime DELETE event clears the stale card.
          const { data: superseded } = await supa.rpc(
            'wk_supersede_streaming_coach',
            { p_call_id: call.id, p_keep_gen_id: generationId }
          );
          if (typeof superseded === 'number' && superseded > 0) {
            log('superseded prior streaming rows', `count=${superseded}`);
          }

          // 5. Pre-INSERT placeholder so the client gets a card to
          //    morph in place as tokens arrive.
          const { data: placeholder, error: insErr } = await supa
            .from('wk_live_coach_events')
            .insert({
              call_id: call.id,
              kind: 'suggestion',
              body: '…',
              generation_id: generationId,
              status: 'streaming',
            })
            .select('id')
            .single();
          if (insErr || !placeholder) {
            console.warn(`[wk-voice-transcription] [coach gen=${genShort}] placeholder insert failed`, insErr?.message);
            return;
          }
          const placeholderId = placeholder.id as string;
          log('placeholder inserted');

          // 6. Set up the throttled writer. UPDATE the placeholder body
          //    at most every 200ms so we don't hammer the DB. The
          //    eq('id', ...) WITHOUT eq('generation_id', ...) catches
          //    DELETEs (row gone) — UPDATE returns 0 rows when our
          //    placeholder was superseded by a newer generation.
          let aborted = false;
          let firstUpdate = true;
          const writer = createThrottledWriter<string>(async (text) => {
            const { data, error: updErr } = await supa
              .from('wk_live_coach_events')
              .update({ body: text })
              .eq('id', placeholderId)
              .select('id');
            if (updErr) {
              console.warn(`[wk-voice-transcription] [coach gen=${genShort}] update error`, updErr.message);
              aborted = true;
              return;
            }
            if (!data || data.length === 0) {
              // Our placeholder is gone — newer generation deleted it.
              if (!aborted) log('placeholder deleted — superseded, aborting');
              aborted = true;
              return;
            }
            if (firstUpdate) {
              log('first update');
              firstUpdate = false;
            }
          }, 100); // PR 117: tightened from 200ms — smoother token stream to UI.

          // 7. Resolve the three layers (style + script + KB facts).
          //    Hugo 2026-04-29: each layer is independently editable
          //    via Settings UI. The legacy live_coach_system_prompt is
          //    only used as a back-compat fallback if BOTH new layer
          //    columns are empty.
          //
          //    PR 56 (Hugo 2026-04-27): cascade fallback for the active
          //    campaign. wk_campaign_ai_settings overrides the workspace
          //    style/script when non-null. wk_campaign_facts override
          //    workspace facts on `key` collision (campaign wins).
          const wsStyle = (ai.coach_style_prompt as string | null) ?? '';
          const wsScript = (ai.coach_script_prompt as string | null) ?? '';
          const campAi = (campaignAiRes.data ?? null) as
            | { coach_style_prompt: string | null; coach_script_prompt: string | null; live_coach_model: string | null }
            | null;
          // (campaign-profile fallback below may fill these when empty, so `let`)
          let campStyle = (campAi?.coach_style_prompt ?? '').trim();
          let campScript = (campAi?.coach_script_prompt ?? '').trim();
          const campModel = (campAi?.live_coach_model ?? '').trim();
          const legacyPrompt = (ai.live_coach_system_prompt as string | null) ?? '';
          // PR 8 (2026-04-26): the AGENT'S CALL SCRIPT is now a separate
          // layer the coach can see. Resolution priority mirrors the
          // useAgentScript hook on the client:
          //   1. Agent's own row in wk_call_scripts (per-agent edits)
          //   2. is_default = true row (admin-controlled fallback)
          //   3. Empty (coach falls through to its built-in stage map)
          //
          // We substitute {{first_name}} with the contact's first name
          // and {{agent_first_name}} with the agent's first name BEFORE
          // passing to the model, so the model never echoes raw
          // placeholders into the agent's UI.
          const ownScriptRow = Array.isArray(ownScriptRes.data)
            ? (ownScriptRes.data[0] as { name: string; body_md: string } | undefined)
            : undefined;
          const defaultScriptRow = Array.isArray(defaultScriptRes.data)
            ? (defaultScriptRes.data[0] as { name: string; body_md: string } | undefined)
            : undefined;

          // v17 (Hugo 2026-05-08): coach profiles — pipeline column or
          // campaign can reference a wk_coach_profiles row that bundles
          // script + style + script prompt. Resolution chain:
          //   own > column profile > campaign profile > workspace default profile
          const contactData = (contactRes.data ?? null) as
            | { name?: string | null; pipeline_column_id?: string | null; custom_fields?: Record<string, string> | null }
            | null;
          const pipelineColumnId = contactData?.pipeline_column_id ?? null;
          // Close-call overrides. Both empty on every cold dial.
          // coach_style_prompt is deliberately NOT overridden: it holds the
          // voice AND the UK compliance bans (never guarantee a ranking, never
          // call a paid start free), every word of which is still true on a
          // close call. Forking it would mean maintaining those bans twice.
          // Which STEP of the deal process this branch is on, so a chase call
          // is not coached as a first call (Hugo 2026-08-12). Unknown or
          // missing step appends nothing at all.
          const propertyStep = isPropertyCall
            ? (contactData?.custom_fields?.next_step ?? '').trim()
            : '';
          const stepOverlay = PROPERTY_STEP_PROMPT[propertyStep] ?? '';
          const STEP_HEADER = 'THIS IS NOT THE FIRST CALL TO THIS BRANCH. Everything below OVERRIDES the six beats above wherever they disagree.';
          const propertyPrompt = isPropertyCall && stepOverlay
            ? `${PROPERTY_SCRIPT_PROMPT}\n\n${'='.repeat(60)}\n${STEP_HEADER}\n${stepOverlay}`
            : isPropertyCall ? PROPERTY_SCRIPT_PROMPT : '';
          const closeScript = isCloseCall ? CLOSE_SCRIPT_PROMPT : propertyPrompt;
          const closeScriptRow = isCloseCall
            ? { name: 'VSL close', body_md: CLOSE_AGENT_SCRIPT_MD }
            : isPropertyCall
              ? { name: 'Property call', body_md: PROPERTY_AGENT_SCRIPT_MD }
              : undefined;
          let columnScriptRow:
            | { name: string; body_md: string }
            | undefined;
          let columnStyle = '';
          let columnScript = '';
          if (!ownScriptRow && pipelineColumnId) {
            const { data: colRow } = await supa
              .from('wk_pipeline_columns')
              .select('call_script_id, coach_style_prompt, coach_script_prompt, coach_profile_id')
              .eq('id', pipelineColumnId)
              .maybeSingle();
            const colData = colRow as {
              call_script_id: string | null;
              coach_style_prompt: string | null;
              coach_script_prompt: string | null;
              coach_profile_id: string | null;
            } | null;
            // v17: if column has a coach_profile_id, load the profile and
            // use its bundled script + prompts (overrides individual fields).
            const colProfileId = colData?.coach_profile_id ?? null;
            if (colProfileId) {
              const { data: profile } = await supa
                .from('wk_coach_profiles')
                .select('call_script_id, coach_style_prompt, coach_script_prompt')
                .eq('id', colProfileId)
                .maybeSingle();
              const profData = profile as {
                call_script_id: string | null;
                coach_style_prompt: string | null;
                coach_script_prompt: string | null;
              } | null;
              if (profData) {
                columnStyle = (profData.coach_style_prompt ?? '').trim();
                columnScript = (profData.coach_script_prompt ?? '').trim();
                if (profData.call_script_id) {
                  const { data: pinned } = await supa
                    .from('wk_call_scripts')
                    .select('name, body_md')
                    .eq('id', profData.call_script_id)
                    .maybeSingle();
                  if (pinned) {
                    columnScriptRow = pinned as { name: string; body_md: string };
                  }
                }
              }
            } else {
              // Fallback: direct column fields (v16 compat)
              columnStyle = (colData?.coach_style_prompt ?? '').trim();
              columnScript = (colData?.coach_script_prompt ?? '').trim();
              const colScriptId = colData?.call_script_id ?? null;
              if (colScriptId) {
                const { data: pinned } = await supa
                  .from('wk_call_scripts')
                  .select('name, body_md')
                  .eq('id', colScriptId)
                  .maybeSingle();
                if (pinned) {
                  columnScriptRow = pinned as { name: string; body_md: string };
                }
              }
            }
          }

          // Campaign-level: check coach_profile_id first, then legacy call_script_id.
          let campaignScriptRow:
            | { name: string; body_md: string }
            | undefined;
          const campRow = (campaignRes.data ?? null) as {
            call_script_id: string | null;
            coach_profile_id?: string | null;
          } | null;
          if (!ownScriptRow && !columnScriptRow) {
            const campProfileId = campRow?.coach_profile_id ?? null;
            if (campProfileId && !campStyle.length && !campScript.length) {
              const { data: profile } = await supa
                .from('wk_coach_profiles')
                .select('call_script_id, coach_style_prompt, coach_script_prompt')
                .eq('id', campProfileId)
                .maybeSingle();
              const profData = profile as {
                call_script_id: string | null;
                coach_style_prompt: string | null;
                coach_script_prompt: string | null;
              } | null;
              if (profData) {
                if (!campStyle.length) campStyle = (profData.coach_style_prompt ?? '').trim();
                if (!campScript.length) campScript = (profData.coach_script_prompt ?? '').trim();
                if (profData.call_script_id) {
                  const { data: pinned } = await supa
                    .from('wk_call_scripts')
                    .select('name, body_md')
                    .eq('id', profData.call_script_id)
                    .maybeSingle();
                  if (pinned) {
                    campaignScriptRow = pinned as { name: string; body_md: string };
                  }
                }
              }
            } else {
              const pinnedScriptId = campRow?.call_script_id ?? null;
              if (pinnedScriptId) {
                const { data: pinned } = await supa
                  .from('wk_call_scripts')
                  .select('name, body_md')
                  .eq('id', pinnedScriptId)
                  .maybeSingle();
                if (pinned) {
                  campaignScriptRow = pinned as { name: string; body_md: string };
                }
              }
            }
          }

          // v16: cascade column > campaign > workspace for style/script
          // prompts. Computed HERE — after the column + campaign profile
          // blocks above have declared and filled columnStyle/columnScript
          // and (possibly) campStyle/campScript.
          const dbStyle = columnStyle.length > 0 ? columnStyle : campStyle.length > 0 ? campStyle : wsStyle;
          // The close term sits ABOVE the whole cold cascade, and is '' on a
          // cold dial so the rest resolves exactly as it always did.
          const dbScript = closeScript.length > 0
            ? closeScript
            : columnScript.length > 0 ? columnScript : campScript.length > 0 ? campScript : wsScript;

          // Resolution chain: vsl_close > own > column > campaign > default.
          // Above `own` on purpose: an agent's personal script is their COLD
          // script, and a close call is not a variant of one.
          const resolvedAgentScript =
            closeScriptRow ?? ownScriptRow ?? columnScriptRow ?? campaignScriptRow ?? defaultScriptRow ?? null;
          const agentScriptSource: 'own' | 'column' | 'campaign' | 'default' | 'vsl_close' | 'property_call' | 'none' = closeScriptRow
            ? (isPropertyCall ? 'property_call' : 'vsl_close')
            : ownScriptRow
            ? 'own'
            : columnScriptRow
              ? 'column'
              : campaignScriptRow
                ? 'campaign'
                : defaultScriptRow
                ? 'default'
                : 'none';

          const agentName = (
            (agentProfileRes.data as { name?: string | null } | null)?.name ?? ''
          ).trim();
          const agentFirstName = agentName.split(/\s+/)[0] || 'the agent';
          const contactName = (contactData?.name ?? '').trim();

          // Lead data — for plumber leads wk_contacts.name is the BUSINESS
          // name; the PERSON's name lives in custom_fields.owner_name. Greet
          // by the owner's first name, and give the coach the real review
          // count / rating / rank so it fills the script instead of emitting
          // placeholders like [X] / [Name] (Hugo 2026-07-22).
          const cf = (contactData?.custom_fields ?? {}) as Record<string, string>;
          const ownerName = (cf.owner_name ?? '').trim();
          const businessName = (cf.business_name ?? '').trim() || contactName;
          const contactFirstName =
            ownerName.split(/\s+/)[0] || contactName.split(/\s+/)[0] || 'the caller';
          const leadFactLines: string[] = [];
          if (cf.lead_type === 'estate_agent') {
            // A PROPERTY CALL. Every fact in the plumber branch below is either
            // empty or actively wrong here: an estate agency has no review count
            // we care about, no local rank we are selling against, and no
            // competitors. Left on the plumber branch the coach would prompt
            // the agent about Google reviews mid-negotiation over a house.
            //
            // These values are written onto the contact by
            // scripts/assign-properties-to-pedro-houses.mjs and refreshed by the
            // Houses tab when the agent switches property, because the coach
            // rebuilds from the database on every utterance and cannot see the
            // browser's selection.
            const f = (k: string) => (cf[k] ?? '').trim();
            if (f('agency')) leadFactLines.push(`Estate agency you are calling: ${f('agency')}`);
            if (f('property_address')) leadFactLines.push(`The property: ${f('property_address')}`);
            {
              const bits = [
                f('bedrooms') ? `${f('bedrooms')} bed` : '',
                f('property_type'),
              ].filter(Boolean).join(' ');
              if (bits) leadFactLines.push(`Type: ${bits}`);
            }
            if (f('asking_price')) leadFactLines.push(`Asking price: ${f('asking_price')}`);
            if (f('days_on_market')) leadFactLines.push(`Days on the market: ${f('days_on_market')}`);
            if (f('property_worth')) leadFactLines.push(`What the sold evidence says it is worth today: ${f('property_worth')}`);
            if (f('worth_after_bed') && f('worth_after_bed') !== 'not established') {
              leadFactLines.push(`Worth after the kitchen becomes a bedroom: ${f('worth_after_bed')}. This is why we are buying it.`);
            }
            if (f('offer_open')) leadFactLines.push(`OPEN AT this figure, say this one number: ${f('offer_open')}`);
            // ONE ladder key: `ladder` (16 Aug). Every writer (assign script,
            // ballpark apply, the dialer's mid-call refresh) writes `ladder`
            // now; `offer_ladder` is the legacy key still sitting on older
            // contacts, read second so a fresh mid-call refresh always wins.
            // Reading offer_ladder FIRST was the bug: the dialer merges its
            // tokens over the contact, so the stale assign-time ladder beat
            // the fresh one for the rest of the call.
            const ladder = f('ladder') || f('offer_ladder');
            if (ladder) leadFactLines.push(`Climb this ladder, one rung at a time: ${ladder}`);
            if (f('offer_ceiling')) {
              leadFactLines.push(
                `WALK AWAY at ${f('offer_ceiling')}. This figure is PRIVATE. Never say it, never hint at it, never confirm a guess at it.`,
              );
            }
            if (f('comp_evidence')) leadFactLines.push(`Sold nearby, use one at a time as justification: ${f('comp_evidence')}`);
            if (f('valuation_notes')) leadFactLines.push(`Worth knowing about this one: ${f('valuation_notes')}`);
            // What the deal engine concluded, the same three things pinned on
            // the strip above the agent's script. Blank on a property the
            // engine has not judged, and blank means say nothing about it: the
            // dialer deliberately writes an EMPTY string rather than omitting
            // the key, so switching listing mid-call clears the last one
            // instead of leaving the coach coaching the previous house.
            if (f('deal_strategy')) leadFactLines.push(`The plan for this house: ${f('deal_strategy')}`);
            if (f('bmv_band')) leadFactLines.push(`How hard to push: ${f('bmv_band')} Never say the band out loud, it is for your judgement only.`);
            if (f('deal_reason')) leadFactLines.push(`Why this one is worth buying: ${f('deal_reason')}`);
            if (f('properties_count')) leadFactLines.push(`This branch has ${f('properties_count')} listings on our list.`);
          } else {
            if (ownerName) leadFactLines.push(`Owner's name (greet them by this): ${ownerName}`);
            if (businessName) leadFactLines.push(`Business name: ${businessName}`);
            if ((cf.reviews ?? '').trim()) leadFactLines.push(`Google reviews they have right now: ${(cf.reviews ?? '').trim()}`);
            if ((cf.rating ?? '').trim()) leadFactLines.push(`Google star rating: ${(cf.rating ?? '').trim()}`);
            if ((cf.rank ?? '').trim()) {
              const ahead = (cf.plumbers_ahead ?? '').trim();
              leadFactLines.push(`Local Google rank: #${(cf.rank ?? '').trim()}${ahead ? ` (${ahead} businesses ahead of them)` : ''}`);
            }
            if ((cf.town ?? '').trim()) leadFactLines.push(`Town / area: ${(cf.town ?? '').trim()}`);
            {
              const comps = [cf.competitor_1, cf.competitor_2].map((c) => (c ?? '').trim()).filter(Boolean);
              if (comps.length) leadFactLines.push(`Competitors ranking above them: ${comps.join(', ')}`);
            }
          }
          const leadFacts = leadFactLines.join('\n');

          // PR 87: accept both {x} and {{x}} so single-brace templates
          // don't leak the literal placeholder into the LLM prompt.
          const agentScriptBody = resolvedAgentScript
            ? resolvedAgentScript.body_md
                .replace(/\{\{?\s*first_name\s*\}?\}/gi, contactFirstName)
                .replace(/\{\{?\s*agent_first_name\s*\}?\}/gi, agentFirstName)
            : '';

          // PR 56: merge workspace + campaign facts. Campaign wins on
          // key collision; workspace facts that aren't overridden are
          // preserved so the model still has the full company context.
          const wsFacts = (factsRes.data ?? []) as CoachFact[];
          const campFacts = (campaignFactsRes.data ?? []) as CoachFact[];
          // A property call REPLACES the workspace knowledge base rather than
          // adding to it: every workspace fact is an Elsie product fact (price,
          // what is included, how reviews work) and all of them are wrong when
          // the person on the phone is selling a house. Campaign facts still
          // override by key on both paths, so nothing about a cold dial moves.
          const baseFacts: CoachFact[] = isPropertyCall ? PROPERTY_OBJECTIONS : wsFacts;
          const overrideKeys = new Set(campFacts.map((f) => f.key));
          const mergedFacts: CoachFact[] = [
            ...baseFacts.filter((f) => !overrideKeys.has(f.key)),
            ...campFacts,
          ];

          const layers = {
            stylePrompt:
              dbStyle.trim().length > 0
                ? dbStyle
                : dbScript.trim().length > 0
                  ? '' // script set, style empty — let the in-fn DEFAULT_STYLE_PROMPT apply
                  : legacyPrompt, // both new layers empty — fall back to the old single prompt
            scriptPrompt:
              dbScript.trim().length > 0
                ? dbScript
                : dbStyle.trim().length > 0
                  ? '' // style set, script empty — DEFAULT_SCRIPT_PROMPT
                  : '', // legacy prompt is fine in stylePrompt slot; let script default apply
            facts: mergedFacts,
            agentScriptBody,
            agentScriptSource,
          };
          log(
            'layers loaded',
            `style=${layers.stylePrompt.length}c script=${layers.scriptPrompt.length}c facts=${layers.facts.length}(base=${baseFacts.length}+cam=${campFacts.length}) agentScript=${agentScriptBody.length}c(${agentScriptSource}) close=${isCloseCall} property=${isPropertyCall} campaign=${campaignId ?? 'none'} caller=${contactFirstName}`
          );

          // 8. Build the user message + run streaming.
          // PR 56: live_coach_model can be overridden per-campaign.
          let firstToken = true;
          const effectiveModel =
            campModel.length > 0 ? campModel : (ai.live_coach_model as string) ?? '';
          const cleaned = await generateCoachSuggestion({
            apiKey: openaiKey,
            model: effectiveModel,
            layers,
            recentTranscript: ctx,
            latestUtterance: transcriptText,
            speaker,
            priorCards,
            currentStage: (call.current_stage as string | null) ?? null,
            leadFacts,
            // Both undefined on a cold dial.
            stageOrder: isCloseCall ? CLOSE_STAGE_ORDER
              : isPropertyCall ? PROPERTY_STAGE_ORDER
              : undefined,
            callKind: isCloseCall ? 'vsl_close'
              : isPropertyCall ? 'property_call'
              : undefined,
            onChunk: (accumulated) => {
              if (firstToken) {
                log('first token');
                firstToken = false;
              }
              writer.schedule(accumulated);
            },
            isAborted: () => aborted,
          });

          // 9. Flush any pending UPDATE so the final body lands.
          await writer.flush();

          if (aborted) {
            log('aborted (superseded mid-stream)');
            return;
          }

          // 10. Finalize: post-processor either keeps the row (status
          //     = 'final', body / kind / script_section from cleaned)
          //     or deletes it.
          if (!cleaned) {
            await supa.from('wk_live_coach_events').delete().eq('id', placeholderId);
            log('rejected by post-processor', 'deleted');
            return;
          }
          await supa
            .from('wk_live_coach_events')
            .update({
              body: cleaned.body,
              status: 'final',
              kind: cleaned.kind,
              script_section: cleaned.scriptSection,
            })
            .eq('id', placeholderId);
          log('final update', `chars=${cleaned.body.length} kind=${cleaned.kind}${cleaned.scriptSection ? ` section="${cleaned.scriptSection}"` : ''}`);

          // PR 42 (Hugo 2026-04-27): write the stage cursor on every
          // SCRIPT card so the next generation can read it and refuse
          // to regress (no firing OPEN once we're past it).
          if (cleaned.kind === 'script' && cleaned.scriptSection) {
            await supa
              .from('wk_calls')
              .update({ current_stage: cleaned.scriptSection })
              .eq('id', call.id);
          }
        } catch (e) {
          console.warn(`[wk-voice-transcription] [coach gen=${genShort}] pipeline threw`, e);
        }
      })();

      // Supabase Edge Functions expose EdgeRuntime.waitUntil to extend the
      // worker's lifetime past the response. Without this, the OpenAI fetch
      // is killed when the function returns 200 to Twilio.
      // deno-lint-ignore no-explicit-any
      const er = (globalThis as any).EdgeRuntime;
      if (er && typeof er.waitUntil === 'function') {
        er.waitUntil(coachPromise);
      } else {
        // Fallback: still run but no lifetime guarantee.
        void coachPromise;
      }
    }

    return new Response('ok', { status: 200, headers: corsHeaders });
  } catch (e) {
    console.error('[wk-voice-transcription] handler error', e);
    return new Response('ok', { status: 200, headers: corsHeaders });
  }
});
