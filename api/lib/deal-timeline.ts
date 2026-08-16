// Everything that has ever happened on one deal, in one ordered list.
//
// Hugo, 2026-08-16: "the history should be like, even if it's the voice
// recording of the call, everything should be on the cockpit. You should see
// there on the history."
//
// So the history column stops being a log of what the machine thought and
// becomes the whole file: the calls with their recordings and what was said,
// every email in and out, every button pressed, every stage move, and the
// machine's own reasoning threaded through it in the order it all happened.
//
// WHY THE MERGE HAPPENS ON THE SERVER. Four tables, one round trip, and the
// recording URLs are signed here with the service role so the browser never
// has to go back for them one at a time. The page renders what it is given.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LogRow } from './deal-manager-run.js';
import { satelliteContactIds } from './satellite-contacts.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = SupabaseClient<any, any, any>;

export type TimelineKind =
  | 'call' | 'email_in' | 'email_out' | 'sms_in' | 'sms_out'
  | 'assessment' | 'fallback_refused'
  | 'action_executed' | 'action_blocked' | 'human_note';

export interface TimelineEntry {
  id: string;
  at: string;
  kind: TimelineKind;
  /** One line, always present, so nothing renders as an empty row. */
  title: string;
  /** The substance: what was said, what was written, what was decided. */
  body: string | null;

  // ---- calls -----------------------------------------------------------
  durationSec?: number | null;
  outcome?: string | null;
  /** Signed, ten minutes, straight into an <audio> tag. Null when the call has
   *  no recording, which is normal for a very short one. */
  recordingUrl?: string | null;
  /** What was actually said, speaker by speaker. */
  transcript?: Array<{ speaker: string; body: string }> | null;

  // ---- email and sms ---------------------------------------------------
  subject?: string | null;

  // ---- the machine -----------------------------------------------------
  attention?: number | null;
  action?: string | null;
  who?: string | null;
  flags?: string[];
  evidence?: string[];
  refusedReason?: string | null;
  checks?: unknown;
  blocked?: boolean;
  source?: string | null;
}

const RECORDING_BUCKET = 'call-recordings';
const SIGNED_FOR_SECONDS = 600;

/** The whole file for one deal, newest first.
 *
 *  `sb` must be the SERVICE ROLE client for the recordings to sign. The log
 *  rows are passed IN rather than read here, because those have to come through
 *  the caller's own client so RLS keeps Hugo's escalation lane off Pedro's
 *  screen. Mixing the two clients up in one function is exactly how that leaks,
 *  so the split is deliberate and the caller owns it. */
export async function buildDealTimeline(
  sb: Sb,
  args: {
    contactId: string | null;
    /** The branch's email, when it has one: it unlocks the SATELLITES, other
     *  people at the same office whose replies land on their own auto-created
     *  contacts. Lexi's rejection of the Orion Way offer lived on hers for two
     *  days while this timeline said nothing had come in. */
    contactEmail?: string | null;
    log: LogRow[];
    limit?: number;
  },
): Promise<TimelineEntry[]> {
  const out: TimelineEntry[] = [];

  // ---- what the machine and the humans did ----------------------------
  for (const row of args.log) {
    out.push({
      id: row.id ?? `${row.created_at}-${row.kind}`,
      at: row.created_at ?? new Date(0).toISOString(),
      kind: row.kind as TimelineKind,
      title: titleForLog(row),
      body: row.instruction ?? row.note ?? null,
      attention: row.attention ?? null,
      action: row.action ?? null,
      who: row.who ?? null,
      flags: row.flags ?? [],
      evidence: row.evidence ?? [],
      refusedReason: row.refused_reason ?? null,
      checks: row.checks ?? null,
      blocked: Boolean(row.blocked),
      source: row.source ?? null,
    });
  }

  if (args.contactId) {
    const satellites = await satelliteContactIds(sb, {
      id: args.contactId, email: args.contactEmail ?? null,
    });
    const [calls, messages] = await Promise.all([
      loadCalls(sb, args.contactId),
      loadMessages(sb, [args.contactId, ...satellites]),
    ]);
    out.push(...calls, ...messages);
  }

  // Newest first. A history column is read downwards into the past.
  out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return out.slice(0, args.limit ?? 120);
}

function titleForLog(row: LogRow): string {
  switch (row.kind) {
    case 'assessment': return 'The brain looked at this';
    case 'fallback_refused': return 'Fell back to the brief';
    case 'action_blocked': return 'A move was refused';
    case 'human_note': return 'Note';
    default: return 'Done from the cockpit';
  }
}

async function loadCalls(sb: Sb, contactId: string): Promise<TimelineEntry[]> {
  const { data: calls } = await (sb.from('wk_calls') as any)
    .select('id, created_at, started_at, direction, duration_sec, disposition_column_id, agent_note')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(40);
  const rows = (calls ?? []) as Array<{
    id: string; created_at: string | null; started_at: string | null;
    direction: string | null; duration_sec: number | null;
    disposition_column_id: string | null; agent_note: string | null;
  }>;
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);

  const [{ data: recs }, { data: cols }, { data: lines }] = await Promise.all([
    (sb.from('wk_recordings') as any)
      .select('call_id, storage_path, status').in('call_id', ids),
    (sb.from('wk_pipeline_columns') as any).select('id, name'),
    (sb.from('wk_live_transcripts') as any)
      .select('call_id, speaker, body, ts').in('call_id', ids)
      .order('ts', { ascending: true }).limit(4000),
  ]);

  const columnById = new Map(((cols ?? []) as Array<{ id: string; name: string }>)
    .map((c) => [c.id, c.name]));

  const pathByCall = new Map<string, string>();
  for (const r of (recs ?? []) as Array<{ call_id: string; storage_path: string | null }>) {
    if (r.storage_path) pathByCall.set(r.call_id, r.storage_path);
  }

  const saidByCall = new Map<string, Array<{ speaker: string; body: string }>>();
  for (const l of (lines ?? []) as Array<{ call_id: string; speaker: string; body: string }>) {
    const list = saidByCall.get(l.call_id) ?? [];
    list.push({ speaker: l.speaker, body: l.body });
    saidByCall.set(l.call_id, list);
  }

  // Sign every recording at once. Ten minutes is plenty to press play, and a
  // signed URL that has expired is better than a public bucket.
  const signed = new Map<string, string>();
  await Promise.all([...pathByCall.entries()].map(async ([callId, path]) => {
    try {
      const { data } = await sb.storage.from(RECORDING_BUCKET)
        .createSignedUrl(path, SIGNED_FOR_SECONDS);
      if (data?.signedUrl) signed.set(callId, data.signedUrl);
    } catch { /* a missing recording is not a broken history */ }
  }));

  return rows.map((r) => {
    const outcome = r.disposition_column_id
      ? columnById.get(r.disposition_column_id) ?? null : null;
    const said = saidByCall.get(r.id) ?? null;
    return {
      id: `call-${r.id}`,
      at: r.started_at ?? r.created_at ?? new Date(0).toISOString(),
      kind: 'call' as const,
      title: outcome
        ? `Call, ${outcome.toLowerCase()}`
        : (r.duration_sec ?? 0) > 0 ? 'Call' : 'Call, no answer',
      body: r.agent_note ?? null,
      durationSec: r.duration_sec,
      outcome,
      recordingUrl: signed.get(r.id) ?? null,
      transcript: said && said.length ? said : null,
    };
  });
}

async function loadMessages(sb: Sb, contactIds: string[]): Promise<TimelineEntry[]> {
  const { data } = await (sb.from('wk_sms_messages') as any)
    .select('id, created_at, direction, channel, subject, body')
    .in('contact_id', contactIds)
    .order('created_at', { ascending: false })
    .limit(60);

  return ((data ?? []) as Array<{
    id: string; created_at: string; direction: string;
    channel: string; subject: string | null; body: string;
  }>).map((m) => {
    const email = m.channel === 'email';
    const inbound = m.direction === 'inbound';
    return {
      id: `msg-${m.id}`,
      at: m.created_at,
      kind: (email
        ? (inbound ? 'email_in' : 'email_out')
        : (inbound ? 'sms_in' : 'sms_out')) as TimelineKind,
      title: `${email ? 'Email' : 'Message'} ${inbound ? 'from them' : 'from us'}`,
      body: m.body,
      subject: m.subject,
    };
  });
}
