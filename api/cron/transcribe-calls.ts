// The accurate transcript, made after the call.
//
// Everything that judges a deal after the fact reads the REAL-TIME transcript
// Twilio produced while the call was happening. That is the least accurate way
// to get those words and the most expensive: measured 2026-08-18 on three of
// Pedro's own property calls, Twilio agreed with a reference transcript on 86%
// of words against AssemblyAI's 93%, at GBP 0.0204 a minute against roughly a
// third of a penny.
//
// After the call there is no clock, so this transcribes the stored recording
// properly into wk_call_transcripts. The live coach keeps its realtime feed
// and is not touched.
//
// WHY A CRON AND NOT A JOB. wk_jobs already carries a postcall_ai kind, but
// that path has been a silent no-op since its OpenAI key went empty: it
// returns {skipped:true} with a 200, so the worker marks it done and nothing
// alerts (194 of the last 200 property calls sit at ai_status='queued' with
// the newest wk_transcripts row 8 days old). Rather than revive a pipeline
// that reports success while doing nothing, this stands alone, records its
// own outcome on the recording row, and can be read at a glance.

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { transcribeUrl, type AaiUtterance } from '../lib/assemblyai.js';

export const config = { maxDuration: 300 };

const RECORDING_BUCKET = 'call-recordings';
/** Transcribing a 12-minute call took ~40s in testing; four is a safe pass. */
const PER_RUN = 4;
/** After this many failures the recording is left alone rather than retried forever. */
const MAX_ATTEMPTS = 3;
/** Long enough to outlive the poll loop in transcribeUrl. */
const SIGNED_URL_TTL_SEC = 1800;

type Rec = {
  id: string;
  call_id: string;
  storage_path: string | null;
  transcript_attempts: number | null;
};

/**
 * Which leg is the agent.
 *
 * On an OUTBOUND call the first channel is the agent's own leg, so channel 1
 * is the agent. On an INBOUND call the caller is the one who dialled us, so
 * the labels are the other way round. Getting this backwards does not fail
 * loudly, it produces a transcript in which the agent appears to have said
 * everything the branch said, which is the exact trap already documented in
 * wk-voice-twiml-incoming.
 */
export function speakerFor(channel: string, direction: string | null): 'agent' | 'caller' | 'unknown' {
  if (channel !== '1' && channel !== '2') return 'unknown';
  const agentChannel = (direction ?? 'outbound').startsWith('in') ? '2' : '1';
  return channel === agentChannel ? 'agent' : 'caller';
}

async function transcribeOne(sb: SupabaseClient, rec: Rec): Promise<{ id: string; lines: number }> {
  const { data: callRow } = await sb
    .from('wk_calls')
    .select('id, direction, started_at')
    .eq('id', rec.call_id)
    .maybeSingle();

  const { data: signed, error: signErr } = await sb.storage
    .from(RECORDING_BUCKET)
    .createSignedUrl(rec.storage_path!, SIGNED_URL_TTL_SEC);
  if (signErr || !signed?.signedUrl) {
    throw new Error(`could not sign recording: ${signErr?.message ?? 'no url'}`);
  }

  const utterances: AaiUtterance[] = await transcribeUrl(signed.signedUrl);
  if (!utterances.length) throw new Error('transcription returned no speech');

  // ts is the wall-clock moment the words were said, so these rows sort and
  // read exactly like the realtime ones. Falling back to now() would put a
  // whole call at one instant and break every timeline that reads it.
  const base = callRow?.started_at ? new Date(callRow.started_at).getTime() : Date.now();
  const rows = utterances.map((u, i) => ({
    call_id: rec.call_id,
    speaker: speakerFor(u.channel, callRow?.direction ?? null),
    body: u.text,
    ts: new Date(base + u.start).toISOString(),
    source: 'assemblyai',
    seq: i,
  }));

  const { error: insErr } = await sb
    .from('wk_call_transcripts')
    .upsert(rows, { onConflict: 'call_id,source,seq' });
  if (insErr) throw new Error(`insert failed: ${insErr.message}`);

  return { id: rec.call_id, lines: rows.length };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const auth = req.headers.authorization || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  if (!process.env.ASSEMBLYAI_API_KEY) {
    // Loud, not skipped. The pipeline this replaces went quiet for eight days
    // by reporting success with nothing done; that is the one failure mode
    // worth spending a 500 on.
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'ASSEMBLYAI_API_KEY is not set' }));
    return;
  }

  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const { data, error } = await sb
      .from('wk_recordings')
      .select('id, call_id, storage_path, transcript_attempts')
      .eq('status', 'ready')
      .not('storage_path', 'is', null)
      .or('transcript_status.is.null,transcript_status.eq.failed')
      .lt('transcript_attempts', MAX_ATTEMPTS)
      .order('created_at', { ascending: false })
      .limit(PER_RUN);
    if (error) throw new Error(`queue read failed: ${error.message}`);

    const queue = (data ?? []) as Rec[];
    const done: Array<{ id: string; lines: number }> = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const rec of queue) {
      const attempts = (rec.transcript_attempts ?? 0) + 1;
      try {
        const out = await transcribeOne(sb, rec);
        await sb.from('wk_recordings').update({
          transcript_status: 'done',
          transcript_error: null,
          transcript_attempts: attempts,
          transcript_at: new Date().toISOString(),
        }).eq('id', rec.id);
        done.push(out);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await sb.from('wk_recordings').update({
          transcript_status: 'failed',
          transcript_error: msg.slice(0, 500),
          transcript_attempts: attempts,
        }).eq('id', rec.id);
        console.warn('[transcribe-calls]', rec.call_id, msg);
        failed.push({ id: rec.call_id, error: msg });
      }
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, considered: queue.length, done, failed }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[transcribe-calls] fatal', msg);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: msg }));
  }
}
