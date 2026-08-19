// ONE reader for "what was said on this call".
//
// There are two transcripts of every call and they are not equally good:
//
//   wk_live_transcripts  Twilio's REAL-TIME transcription, written while the
//                        call is happening. The live coach needs it and could
//                        not wait for anything better.
//   wk_call_transcripts  made afterwards from the recording. Measured
//                        2026-08-18 on three of Pedro's property calls: 93%
//                        agreement with a reference transcript against
//                        Twilio's 86%, and it keeps money magnitudes Twilio
//                        drops ("£150,000" where Twilio wrote "£150").
//
// Anything reading a FINISHED call should prefer the accurate one and fall
// back to the realtime one, which is all this does. Do not hand-roll this read
// again: five places already did, and one of them asked for columns that do
// not exist and silently produced "no transcript" for every offer email from
// launch until 2026-08-14.

import type { SupabaseClient } from '@supabase/supabase-js';

export type TranscriptLine = { speaker: string; body: string; ts: string };

export type CallTranscript = {
  lines: TranscriptLine[];
  /** Which table answered, so a caller can log or display the provenance. */
  source: 'assemblyai' | 'twilio_realtime' | 'none';
};

/** Rows for one call, oldest first, best available source. */
export async function readCallTranscript(
  sb: SupabaseClient,
  callId: string,
  opts: { limit?: number } = {},
): Promise<CallTranscript> {
  const limit = opts.limit ?? 400;

  const { data: good, error: goodErr } = await sb
    .from('wk_call_transcripts')
    .select('speaker, body, ts')
    .eq('call_id', callId)
    .order('seq', { ascending: true })
    .limit(limit);
  // A broken read must be visible. The silent catch is what hid the
  // draft-offer-email bug for two months.
  if (goodErr) console.warn('[call-transcript] accurate read failed', goodErr.message);
  if (good && good.length) {
    return { lines: good as TranscriptLine[], source: 'assemblyai' };
  }

  const { data: live, error: liveErr } = await sb
    .from('wk_live_transcripts')
    .select('speaker, body, ts')
    .eq('call_id', callId)
    .order('ts', { ascending: true })
    .limit(limit);
  if (liveErr) console.warn('[call-transcript] realtime read failed', liveErr.message);
  if (live && live.length) {
    return { lines: live as TranscriptLine[], source: 'twilio_realtime' };
  }

  return { lines: [], source: 'none' };
}

/**
 * The same preference, for many calls at once.
 *
 * Two queries total, not two per call: the timeline and the daily report both
 * load a whole day or a whole deal, and a per-call read there would be dozens
 * of round trips. A call that has accurate rows uses them; a call that does
 * not keeps its realtime rows, decided per call rather than per batch, so one
 * un-transcribed call cannot drag the rest back to the worse source.
 */
export async function readCallTranscriptsBulk(
  sb: SupabaseClient,
  callIds: string[],
  opts: { limit?: number } = {},
): Promise<Map<string, TranscriptLine[]>> {
  const out = new Map<string, TranscriptLine[]>();
  if (!callIds.length) return out;
  const limit = opts.limit ?? 4000;

  type Row = TranscriptLine & { call_id: string };
  const push = (map: Map<string, TranscriptLine[]>, r: Row) => {
    const list = map.get(r.call_id) ?? [];
    list.push({ speaker: r.speaker, body: r.body, ts: r.ts });
    map.set(r.call_id, list);
  };

  const [good, live] = await Promise.all([
    sb.from('wk_call_transcripts').select('call_id, speaker, body, ts')
      .in('call_id', callIds).order('seq', { ascending: true }).limit(limit),
    sb.from('wk_live_transcripts').select('call_id, speaker, body, ts')
      .in('call_id', callIds).order('ts', { ascending: true }).limit(limit),
  ]);
  if (good.error) console.warn('[call-transcript] bulk accurate read failed', good.error.message);
  if (live.error) console.warn('[call-transcript] bulk realtime read failed', live.error.message);

  for (const r of (good.data ?? []) as Row[]) push(out, r);
  const fallback = new Map<string, TranscriptLine[]>();
  for (const r of (live.data ?? []) as Row[]) push(fallback, r);
  for (const [callId, lines] of fallback) {
    if (!out.has(callId)) out.set(callId, lines);
  }
  return out;
}

/**
 * The same thing as one block of text, in the `SPEAKER: line` shape every
 * existing prompt already expects. `cap` is a character budget, not a row
 * count, because that is what protects the model context and the bill.
 */
export function formatTranscript(lines: TranscriptLine[], cap = 14_000): string {
  return lines
    .map((r) => `${(r.speaker ?? 'other').toUpperCase()}: ${(r.body ?? '').trim()}`)
    .filter((l) => l.length > 8)
    .join('\n')
    .slice(0, cap);
}
