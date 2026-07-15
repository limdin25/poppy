// Pure helpers for the streaming coach pipeline.
//
// Lives next to wk-voice-transcription/index.ts and is imported by both
// the Deno edge runtime AND the vitest test harness. KEEP THIS FILE
// PLATFORM-FREE — no Deno globals, no node:* imports, no fetch, no
// timers other than the standard `setTimeout` / `clearTimeout`.

// ----------------------------------------------------------------------------
// SSE parser for OpenAI chat.completions stream=true responses.
//
// OpenAI emits one event per token (sometimes batched) as
//   data: {"choices":[{"delta":{"content":"..."}}]}\n\n
// terminated by
//   data: [DONE]\n\n
// We feed the parser the raw decoded bytes from each chunk and it
// returns:
//   - events: every complete SSE event in this chunk
//   - remaining: trailing bytes that didn't end with a newline yet
//     (caller carries this forward into the next chunk)
// ----------------------------------------------------------------------------

export interface SseEvent {
  delta: string;
  done: boolean;
}

export interface SseParseResult {
  events: SseEvent[];
  remaining: string;
}

export function parseSseChunk(buf: string): SseParseResult {
  if (!buf) return { events: [], remaining: '' };
  const events: SseEvent[] = [];
  const lines = buf.split('\n');
  // The last element is whatever came after the final newline. If the
  // chunk did NOT end on \n, that tail is incomplete and must be
  // carried into the next chunk.
  const remaining = lines.pop() ?? '';

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '').trimEnd();
    if (!line) continue;
    if (!line.startsWith('data:')) continue; // ignore comments / event:/id:
    const data = line.slice(5).trim();
    if (!data) continue;
    if (data === '[DONE]') {
      events.push({ delta: '', done: true });
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      // Malformed JSON — skip rather than blow up the stream.
      continue;
    }
    const delta =
      (json as { choices?: { delta?: { content?: string } }[] })?.choices?.[0]
        ?.delta?.content ?? '';
    events.push({ delta, done: false });
  }
  return { events, remaining };
}

// ----------------------------------------------------------------------------
// Throttled async write.
//
// During streaming we want to UPDATE the placeholder coach card row as
// tokens arrive, but we don't want to hammer the DB at 30 writes/sec.
// This helper:
//   - runs the first schedule() immediately
//   - coalesces rapid follow-ups inside the throttle window into a single
//     trailing call with the LATEST value
//   - flush() drains any pending value synchronously (used at end of
//     stream so the final UPDATE always lands)
// ----------------------------------------------------------------------------

export interface ThrottledWriter<T> {
  schedule: (value: T) => void;
  flush: () => Promise<void>;
}

export function createThrottledWriter<T>(
  fn: (value: T) => Promise<void> | void,
  intervalMs: number
): ThrottledWriter<T> {
  let lastFiredAt = 0;
  let pendingValue: T | undefined;
  let hasPending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> | null = null;

  const fire = async (value: T) => {
    lastFiredAt = Date.now();
    hasPending = false;
    pendingValue = undefined;
    inflight = Promise.resolve(fn(value)).then(
      () => {
        inflight = null;
      },
      () => {
        inflight = null;
      }
    );
    await inflight;
  };

  return {
    schedule(value: T) {
      const now = Date.now();
      const elapsed = now - lastFiredAt;
      if (elapsed >= intervalMs && !timer) {
        // Cool — fire immediately.
        void fire(value);
        return;
      }
      // Inside the window. Replace pending and arm a trailing timer.
      pendingValue = value;
      hasPending = true;
      if (!timer) {
        const delay = Math.max(0, intervalMs - elapsed);
        timer = setTimeout(() => {
          timer = null;
          if (hasPending) {
            const v = pendingValue as T;
            void fire(v);
          }
        }, delay);
      }
    },

    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (hasPending) {
        const v = pendingValue as T;
        await fire(v);
      }
      // Wait for any in-flight write to settle so callers can rely on
      // "after flush(), every write has hit the DB".
      if (inflight) await inflight;
    },
  };
}

// ----------------------------------------------------------------------------
// Knowledge base retrieval — pulls facts whose keywords match the caller's
// last utterance. Pure, case-insensitive substring match. Each fact is
// returned at most once even if several of its keywords hit.
//
// We pass the FULL knowledge base in a system message AND the matched-
// facts subset as a hint in the user message. The model uses the hint to
// focus, but the full KB is always there as a safety net.
// ----------------------------------------------------------------------------

export interface CoachFact {
  key: string;
  label: string;
  value: string;
  keywords: string[];
}

export function retrieveFacts(
  utterance: string | null | undefined,
  facts: CoachFact[]
): CoachFact[] {
  const u = (utterance ?? '').toLowerCase();
  if (!u) return [];
  const out: CoachFact[] = [];
  for (const f of facts) {
    if (!f.keywords || f.keywords.length === 0) continue;
    const hit = f.keywords.some((kw) => {
      const k = kw.toLowerCase().trim();
      return k.length > 0 && u.includes(k);
    });
    if (hit) out.push(f);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Opener n-gram ban list — extracts the first 3 words of each prior coach
// card (lowercased, deduped). The edge fn passes this in the user message
// as a "DO NOT START WITH" list so the model can't open with the same
// 3-word opener as a recent card.
//
// PR #575 (v8) — anti-repetition tightened from "first 5 words" rule in
// the prompt to an explicit ban list constructed from the actual last 5
// cards. More precise than the prompt's verbal rule.
// ----------------------------------------------------------------------------

export function buildOpenerBanList(
  priorCards: (string | null | undefined)[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const card of priorCards) {
    if (typeof card !== 'string') continue;
    const normalised = card.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!normalised) continue;
    const words = normalised.split(' ').slice(0, 3);
    if (words.length < 2) continue; // too short to form a useful 3-gram
    const key = words.join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
