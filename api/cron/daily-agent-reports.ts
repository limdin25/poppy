// Daily agent reports — 17:30 UK, every day.
//
// Hugo 2026-07-24: "every day at 5:30pm it gives the daily reports, they write
// there on the leaderboard so they can read, and there's a history they can
// always go back and see. Also email me the report."
//
// For each competing agent: pull today's calls + live transcripts, compute the
// stats deterministically (never let the model count), then have Claude write a
// short coaching report from the actual conversations. Upsert into
// wk_agent_daily_reports (both agents see BOTH reports — Hugo's call, for the
// competition), then email Hugo the lot.
//
// Node runtime, not edge: two Claude calls with adaptive thinking can run well
// past the edge budget.

import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../src/integrations/resend/client.js';

export const config = { maxDuration: 300 };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const MODEL = 'claude-opus-4-8';
/** Per agent, per day. Plenty for a coaching card; keeps the job bounded. */
const MAX_TOKENS = 8000;
/** Cap transcripts sent to the model so one heavy day can't blow up the bill. */
const MAX_CONVERSATIONS = 40;
const MAX_CHARS_PER_CONVERSATION = 2600;

const VOICEMAIL = new RegExp(
  [
    'leave (your|a) (message|name)', 'after the tone', 'unable to (take|get)',
    "can'?t (take|get)", 'cannot (take|get)', 'voicemail', 'not available',
    'please record', 'record your (name|message)', 'answer ?phone',
    'messaging service', 'try again later', 'been forwarded',
    "person you'?re? (are )?(calling|trying)", 'get back to you',
    'currently unavailable', "you'?re through to", 'thank you for calling',
    'press one', 'press 1', 'finished your message', "i'?ll see if this person",
    "sorry we can'?t",
  ].join('|'),
  'i',
);

interface Line { speaker: string; body: string | null }
interface CallRow {
  id: string;
  started_at: string | null;
  duration_sec: number | null;
  status: string;
  disposition: string | null;
  company: string | null;
  lines: Line[];
}

/** Today's date in UK time as YYYY-MM-DD (the cron fires at 17:30 UK). */
function ukToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** UTC bounds for a UK calendar day. */
function ukDayBounds(dateKey: string): { since: string; until: string } {
  // Probe midday UTC to read the day's UK offset without a tz library.
  const probe = new Date(`${dateKey}T12:00:00Z`);
  const uk = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', hour12: false,
  }).format(probe);
  const offsetHours = Number(uk) - 12; // 0 in GMT, 1 in BST
  const start = new Date(`${dateKey}T00:00:00Z`);
  start.setUTCHours(start.getUTCHours() - offsetHours);
  const end = new Date(start.getTime() + 86_400_000);
  return { since: start.toISOString(), until: end.toISOString() };
}

const text = (c: CallRow, who?: string) =>
  (c.lines ?? [])
    .filter((l) => !who || l.speaker === who)
    .map((l) => (l.body ?? '').trim())
    .join(' ');

const agentWords = (c: CallRow) => text(c, 'agent').split(/\s+/).filter(Boolean).length;
const isVoicemail = (c: CallRow) => VOICEMAIL.test(text(c, 'caller'));

function computeStats(calls: CallRow[]) {
  const connected = calls.filter((c) => c.status === 'completed');
  const voicemail = calls.filter((c) => c.lines?.length && isVoicemail(c));
  const conversations = calls.filter(
    (c) => c.lines?.length && agentWords(c) > 0 && !isVoicemail(c),
  );
  const real = conversations.filter((c) => (c.duration_sec ?? 0) >= 60);
  // Human picked up, agent said nothing at all — the mic-fault signature.
  const deadAir = calls.filter(
    (c) =>
      c.lines?.length &&
      agentWords(c) === 0 &&
      !isVoicemail(c) &&
      text(c, 'caller').split(/\s+/).filter(Boolean).length >= 2,
  );
  const outcome = (name: string) =>
    calls.filter((c) => (c.disposition ?? '').toLowerCase() === name).length;
  const talkSec = calls.reduce((s, c) => s + (c.duration_sec ?? 0), 0);
  const convWords = conversations.reduce((s, c) => s + agentWords(c), 0);
  const callerWords = conversations.reduce(
    (s, c) => s + text(c, 'caller').split(/\s+/).filter(Boolean).length,
    0,
  );
  const fillers = (text({ lines: conversations.flatMap((c) => c.lines) } as CallRow, 'agent')
    .match(/\b(uh|um)\b/gi) ?? []).length;

  return {
    dials: calls.length,
    connected: connected.length,
    voicemail: voicemail.length,
    conversations: conversations.length,
    real_conversations: real.length,
    dead_air: deadAir.length,
    interested: outcome('interested'),
    booked: outcome('booked'),
    nurturing: outcome('nurturing'),
    not_interested: outcome('not interested'),
    talk_minutes: Math.round(talkSec / 60),
    longest_call_sec: calls.reduce((m, c) => Math.max(m, c.duration_sec ?? 0), 0),
    talk_ratio: callerWords > 0 ? Number((convWords / callerWords).toFixed(2)) : null,
    filler_per_100_words: convWords > 0 ? Number(((fillers * 100) / convWords).toFixed(1)) : null,
  };
}

/** Transcripts of real conversations only — voicemails carry no coaching signal. */
function transcriptBlock(calls: CallRow[]): string {
  return calls
    .filter((c) => c.lines?.length && agentWords(c) > 0 && !isVoicemail(c))
    .sort((a, b) => (b.duration_sec ?? 0) - (a.duration_sec ?? 0))
    .slice(0, MAX_CONVERSATIONS)
    .map((c) => {
      const head = `### ${c.company ?? 'Unknown'} — ${c.duration_sec ?? 0}s — outcome: ${c.disposition ?? 'none'} — call_id: ${c.id}`;
      const body = (c.lines ?? [])
        .map((l) => `${l.speaker === 'agent' ? 'AGENT' : 'LEAD '}: ${(l.body ?? '').trim()}`)
        .join('\n')
        .slice(0, MAX_CHARS_PER_CONVERSATION);
      return `${head}\n${body}`;
    })
    .join('\n\n');
}

const SYSTEM = `You write the end-of-day coaching report for a UK outbound sales agent selling a Google-reviews service to plumbers.

The agent reads this report themselves, and so does the other agent on the team — write it to be read by the person it is about.

Be direct and complete. Your job is to tell them everything that would make them better tomorrow, not to be gentle. Do not soften, omit, or generalise a problem to spare feelings. At the same time you are a coach, not a disciplinarian: give the fix, not a telling-off.

Non-negotiable — you MUST report these explicitly if they appear anywhere in the transcripts:
- Swearing or crude language by the agent. Quote it verbatim, name the company and call_id, and say plainly that it is not acceptable on a customer call.
- Rudeness, arguing with a prospect, talking over them, or pressuring someone who has clearly said no.
- Anything misleading about price, what is free, or what the product does.
- Getting the prospect's or company's name wrong.
Never leave one of these out because the day went well otherwise.

Ground every point in what actually happened. Quote the agent's own words, and cite the company name so they can find the call. Never invent a quote. The statistics are given to you and are correct — never recompute or contradict them.

Write in British English, plain language, second person ("you"). Markdown, no title heading, roughly 250-400 words, in this order:

**Today** — two or three sentences on how the day actually went.
**What worked** — up to three specific things, each with a quote or a company name.
**Fix tomorrow** — every genuine problem you found, most important first, each with the concrete words or action to use instead. Include the non-negotiables above here if they occurred.
**Tomorrow's one thing** — a single sentence naming the one change that would make the biggest difference.`;

async function writeReport(
  agentName: string,
  dateKey: string,
  stats: ReturnType<typeof computeStats>,
  transcripts: string,
): Promise<string> {
  const prompt = `Agent: ${agentName}
Date: ${dateKey}

STATISTICS (authoritative — do not recompute):
${JSON.stringify(stats, null, 2)}

Notes on the stats:
- "dead_air" = a human answered but the agent's audio never reached them. This is a KNOWN SYSTEM FAULT, not the agent's fault. If it is above zero, say so explicitly and reassure them it is not counted against them.
- "conversations" excludes voicemail. "real_conversations" are those lasting 60s or more.
- "talk_ratio" is agent words per lead word. Above ~1.8 means they are talking over the prospect.

TRANSCRIPTS OF TODAY'S LIVE CONVERSATIONS (voicemails excluded):
${transcripts || '(no live conversations today)'}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    stop_reason?: string;
  };
  if (data.stop_reason === 'refusal') throw new Error('model refused');
  return (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
    .trim();
}

export default async function handler(req: Request): Promise<Response> {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const url = new URL(req.url);
  // ?date=YYYY-MM-DD re-runs a past day (backfill / manual retry).
  const dateKey = url.searchParams.get('date') || ukToday(new Date());
  const { since, until } = ukDayBounds(dateKey);

  // Roster: same rule as the leaderboard — a CRM agent or an account with a
  // limits row, minus anyone an admin has un-ticked.
  const { data: limits } = await supabase
    .from('wk_voice_agent_limits')
    .select('agent_id, show_on_leaderboard');
  const hidden = new Set(
    (limits ?? []).filter((l) => l.show_on_leaderboard === false).map((l) => l.agent_id),
  );
  const limitIds = (limits ?? []).map((l) => l.agent_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, name, email, workspace_role')
    .or([`workspace_role.eq.agent`, `id.in.(${limitIds.join(',') || '00000000-0000-0000-0000-000000000000'})`].join(','));

  const roster = (profiles ?? []).filter((p) => !hidden.has(p.id));
  const written: Array<{ name: string; body: string; stats: ReturnType<typeof computeStats> }> = [];

  for (const agent of roster) {
    const name = (agent.name || agent.email || 'Agent') as string;
    const { data: calls } = await supabase
      .from('wk_calls')
      .select('id, started_at, duration_sec, status, disposition_column_id, contact_id')
      .eq('agent_id', agent.id)
      .gte('started_at', since)
      .lt('started_at', until);

    if (!calls || calls.length === 0) continue; // no calls, no report

    // Hydrate transcripts, dispositions and company names for the day.
    const ids = calls.map((c) => c.id);
    const [{ data: lines }, { data: cols }, { data: contacts }] = await Promise.all([
      supabase.from('wk_live_transcripts').select('call_id, speaker, body, ts').in('call_id', ids).order('ts'),
      supabase.from('wk_pipeline_columns').select('id, name'),
      supabase.from('wk_contacts').select('id, name').in('id', calls.map((c) => c.contact_id).filter(Boolean) as string[]),
    ]);
    const byCall = new Map<string, Line[]>();
    for (const l of lines ?? []) {
      const arr = byCall.get(l.call_id) ?? [];
      arr.push({ speaker: l.speaker, body: l.body });
      byCall.set(l.call_id, arr);
    }
    const colName = new Map((cols ?? []).map((c) => [c.id, c.name as string]));
    const contactName = new Map((contacts ?? []).map((c) => [c.id, c.name as string]));

    const rows: CallRow[] = calls.map((c) => ({
      id: c.id,
      started_at: c.started_at,
      duration_sec: c.duration_sec,
      status: c.status,
      disposition: c.disposition_column_id ? colName.get(c.disposition_column_id) ?? null : null,
      company: c.contact_id ? contactName.get(c.contact_id) ?? null : null,
      lines: byCall.get(c.id) ?? [],
    }));

    const stats = computeStats(rows);
    let body: string;
    try {
      body = await writeReport(name, dateKey, stats, transcriptBlock(rows));
    } catch (e) {
      console.error(`[daily-report] ${name} failed:`, e);
      continue;
    }
    if (!body) continue;

    const { error } = await supabase.from('wk_agent_daily_reports').upsert(
      { agent_id: agent.id, report_date: dateKey, stats, body_md: body, model: MODEL, updated_at: new Date().toISOString() },
      { onConflict: 'agent_id,report_date' },
    );
    if (error) console.error(`[daily-report] upsert failed for ${name}:`, error.message);
    else written.push({ name, body, stats });
  }

  // Email Hugo the lot.
  const to = process.env.DAILY_REPORT_EMAIL || 'hugodesouzax@gmail.com';
  if (written.length > 0) {
    const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px;color:#1A1A1A">
      <h2 style="margin:0 0 4px">Daily agent reports — ${dateKey}</h2>
      <p style="color:#6B7280;margin:0 0 20px;font-size:14px">Also on the leaderboard, where both agents can read them.</p>
      ${written
        .map(
          (r) => `<div style="border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-bottom:16px">
            <h3 style="margin:0 0 8px">${r.name}</h3>
            <p style="color:#6B7280;font-size:13px;margin:0 0 12px">
              ${r.stats.dials} dials · ${r.stats.conversations} conversations · ${r.stats.interested + r.stats.booked} interested/booked · ${r.stats.talk_minutes} min talking
            </p>
            <div style="font-size:14px;line-height:1.55;white-space:pre-wrap">${r.body
              .replace(/&/g, '&amp;').replace(/</g, '&lt;')
              .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</div>
          </div>`,
        )
        .join('')}
      <p style="font-size:12px;color:#9CA3AF">app.heyelsie.com/admin/crm/leaderboard</p>
    </div>`;
    try {
      await sendEmail(to, `Daily agent reports — ${dateKey}`, html);
    } catch (e) {
      console.error('[daily-report] email failed:', e);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, date: dateKey, reports: written.map((w) => w.name) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}
