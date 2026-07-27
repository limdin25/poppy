// Daily agent reports — 17:30 UK, every day.
//
// Hugo 2026-07-24: "every day at 5:30pm it gives the daily reports, they write
// there on the leaderboard so they can read, and there's a history they can
// always go back and see. Also email me the report."
//
// For each competing agent: pull today's calls + live transcripts, compute the
// stats deterministically (never let the model count), then have Claude write a
// short coaching report from the actual conversations.
//
// Each agent reads ONLY their own report (Hugo 2026-07-24, reversing an earlier
// "both see both" — conduct criticism read in front of a colleague gets
// defended rather than acted on, and it wasn't a fair contest while our own mic
// fault was suppressing one agent's numbers). The leaderboard TABLE stays public
// — that's the competition.
//
// The report stays fully candid. Conduct and compliance items are additionally
// extracted into `flags` and headline Hugo's email, so a swear word or a
// misleading claim about reviews can't sit unnoticed in paragraph four.
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

/** The six script steps, counted in code so the report grades the same way
 *  every day and the model never has to tally.
 *
 *  Hugo 2026-07-27: "make sure daily feedback reports all those things as well,
 *  what needs to improve together with what we already tell them."
 *
 *  These run over ASR text, so they are close but not perfect. The model sees
 *  the transcripts too and is told to believe those over the counter when the
 *  two disagree.
 */
const SAYS_WHO_I_AM = /my name is|it'?s \w+ (from|with|here)|i'?m \w+ from|from hey ?els?ie|hey ?els?ie|from l\.? ?c\b/i;
const SAYS_RECORDING = /record(ed|ing) for|being recorded|call'?s recorded|calls? (is|are) recorded/i;
const SAYS_HOOK = /new to the area|only got .{0,12}reviews|only have .{0,12}reviews/i;
const SAYS_OFFER = /90[- ]second|ninety second|audit/i;
const SAYS_CLOSE = /will you watch|you'?ll watch it|watch it\?/i;
/** A question asking for their number. "I'll send it to this number" is fine
 *  and must not match — we dialled their mobile, we already have it. */
const ASKS_FOR_NUMBER = /(best|right|correct|good) number|what'?s your (mobile|number)|which number|number to (text|reach) you|number for a text/i;
const READS_OUT_TIERS = /£ ?(99|179|279)|\b(99|179|279) (a|per) month/i;

export function scriptCheck(calls: CallRow[]) {
  const convs = calls.filter((c) => c.lines?.length && agentWords(c) > 0 && !isVoicemail(c));
  const agentLines = (c: CallRow) =>
    (c.lines ?? []).filter((l) => l.speaker === 'agent').map((l) => (l.body ?? '').trim());
  const any = (c: CallRow, re: RegExp) => agentLines(c).some((b) => re.test(b));
  const firstIdx = (c: CallRow, re: RegExp) => agentLines(c).findIndex((b) => re.test(b));
  const n = (f: (c: CallRow) => boolean) => convs.filter(f).length;

  return {
    conversations_graded: convs.length,
    // Step 1. Two halves, and the ORDER between them is the whole point: the
    // name earns the right to say the recording line, not the other way round.
    said_who_they_are: n((c) => any(c, SAYS_WHO_I_AM)),
    said_recording_notice: n((c) => any(c, SAYS_RECORDING)),
    name_before_recording: n((c) => {
      const a = firstIdx(c, SAYS_WHO_I_AM);
      const b = firstIdx(c, SAYS_RECORDING);
      return a !== -1 && (b === -1 || a <= b);
    }),
    // Steps 2 to 4.
    reached_hook: n((c) => any(c, SAYS_HOOK)),
    reached_offer: n((c) => any(c, SAYS_OFFER)),
    used_close: n((c) => any(c, SAYS_CLOSE)),
    // Rule breaks. Both should be zero.
    asked_for_their_number: n((c) => any(c, ASKS_FOR_NUMBER)),
    read_out_monthly_tiers: n((c) => any(c, READS_OUT_TIERS)),
  };
}

/** Dialling pace and dead time. A perfect script at 49 dials loses to a rough
 *  one at 177, so the report has to see both. Gaps are measured between the end
 *  of one call and the start of the next; a lunch break shows up here as one
 *  long gap, which is exactly what we want the agent to see. */
export function paceStats(calls: CallRow[]) {
  const t = calls
    .filter((c) => c.started_at)
    .map((c) => ({
      start: new Date(c.started_at as string).getTime(),
      end: new Date(c.started_at as string).getTime() + (c.duration_sec ?? 0) * 1000,
    }))
    .sort((a, b) => a.start - b.start);
  if (t.length === 0) {
    return { dials: 0, minutes_on_calls: 0, longest_gap_minutes: 0, gaps_over_10_min: 0, idle_minutes: 0, dials_per_hour: null as number | null };
  }
  const gaps: number[] = [];
  for (let i = 1; i < t.length; i += 1) gaps.push(Math.max(0, (t[i].start - t[i - 1].end) / 60_000));
  const spanMin = (t[t.length - 1].end - t[0].start) / 60_000;
  const onCalls = t.reduce((s, x) => s + (x.end - x.start) / 60_000, 0);
  return {
    dials: calls.length,
    minutes_on_calls: Math.round(onCalls),
    longest_gap_minutes: Math.round(Math.max(0, ...gaps)),
    gaps_over_10_min: gaps.filter((g) => g > 10).length,
    idle_minutes: Math.round(gaps.reduce((s, g) => s + g, 0)),
    dials_per_hour: spanMin > 0 ? Number((calls.length / (spanMin / 60)).toFixed(1)) : null,
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

You are given THE SCRIPT the agent is supposed to follow, and a step-by-step count of how often they actually reached each part of it. Grade them against that script every single day, even on a good day. This is the standing coaching, and it does not get dropped because the day went well or because you found something more interesting to write about.

Write in British English, plain language, second person ("you"). Markdown, no title heading, roughly 300-450 words, in this order:

**Today** — two or three sentences on how the day actually went. Cover pace as well as quality: dials, time actually on the phone, and any long gap with no calls. A perfect script at 49 dials loses to a rough one at 177, so say which of the two is holding them back.
**What worked** — up to three specific things, each with a quote or a company name.
**Script check** — go through the six steps in order and give the number for each: opener (name and HeyElsie BEFORE the recording line), hook, offer, the close, and the two rule breaks (asking for their number, reading out monthly prices). One line per step, the count, then a word on whether that is good or not. Where a step is being missed, quote the words they used instead. Praise the steps they are hitting; do not only list failures.
**Fix tomorrow** — every genuine problem you found, most important first, each with the concrete words or action to use instead. Include the non-negotiables above here if they occurred.
**Tomorrow's one thing** — a single sentence naming the one change that would make the biggest difference.

After the report, and only if one or more of the non-negotiables above actually occurred, append this exact delimiter on its own line:

---FLAGS---

followed by a JSON array, one object per item, and nothing else:
[{"type":"swearing|rudeness|pressure|misleading|wrong_name","quote":"their exact words","company":"company name","call_id":"the call_id","why":"one sentence on why it matters"}]

Emit the delimiter only when there is at least one item. Never emit an empty array. The flags duplicate what you already wrote in the report — they are an index for the business owner, not a replacement.`;

export interface ConductFlag {
  type: string;
  quote: string;
  company: string;
  call_id: string;
  why: string;
}

/** Split the model's output into the agent-facing report and the owner-facing
 *  conduct index. A malformed or missing FLAGS block must never cost us the
 *  report — fall back to the whole text with no flags. */
export function splitReport(raw: string): { body: string; flags: ConductFlag[] } {
  const idx = raw.indexOf('---FLAGS---');
  if (idx === -1) return { body: raw.trim(), flags: [] };
  const body = raw.slice(0, idx).trim();
  const tail = raw.slice(idx + '---FLAGS---'.length).trim();
  const start = tail.indexOf('[');
  const end = tail.lastIndexOf(']');
  if (start === -1 || end <= start) return { body, flags: [] };
  try {
    const parsed = JSON.parse(tail.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return { body, flags: [] };
    return {
      body,
      flags: parsed.filter(
        (f): f is ConductFlag =>
          !!f && typeof f === 'object' && typeof (f as ConductFlag).quote === 'string',
      ),
    };
  } catch {
    return { body, flags: [] };
  }
}

async function writeReport(
  agentName: string,
  dateKey: string,
  stats: ReturnType<typeof computeStats>,
  transcripts: string,
  script: string,
  adherence: ReturnType<typeof scriptCheck>,
  pace: ReturnType<typeof paceStats>,
): Promise<string> {
  const prompt = `Agent: ${agentName}
Date: ${dateKey}

STATISTICS (authoritative — do not recompute):
${JSON.stringify(stats, null, 2)}

Notes on the stats:
- "dead_air" = a human answered but the agent's audio never reached them. This is a KNOWN SYSTEM FAULT, not the agent's fault. If it is above zero, say so explicitly and reassure them it is not counted against them.
- "conversations" excludes voicemail. "real_conversations" are those lasting 60s or more.
- "talk_ratio" is agent words per lead word. Above ~1.8 means they are talking over the prospect.

DIALLING PACE (authoritative):
${JSON.stringify(pace, null, 2)}

Notes on pace:
- "idle_minutes" is the total time between calls. One long gap is a lunch break and is theirs to take; say so rather than treating it as slacking. Several long gaps, or a "longest_gap_minutes" running into hours, is the day leaking away and should be named plainly.

THE SCRIPT THEY ARE MEANT TO FOLLOW:
${script || '(no script on file)'}

SCRIPT STEPS REACHED, out of ${adherence.conversations_graded} live conversations:
${JSON.stringify(adherence, null, 2)}

Notes on the script counts:
- These are detected from the transcript text, which comes from imperfect speech recognition. They are close, not exact. Where a count disagrees with what you can plainly read in the transcripts, believe the transcripts and say what you actually saw.
- "name_before_recording" is the one that matters most in the opener. Saying the recording notice without first saying who you are and that you are from HeyElsie makes the call sound like a scam, and prospects react to it.
- "asked_for_their_number" and "read_out_monthly_tiers" are rule breaks and should both be zero. We dial their mobile, so we already have their number; asking for it makes us sound like we bought a list.

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

// Node runtime handler shape (req, res) — NOT the edge Request/Response API.
// The edge signature compiles fine but throws `req.headers.get is not a
// function` at runtime on Node.
export default async function handler(
  req: {
    headers: Record<string, string | string[] | undefined>;
    query?: Record<string, string | string[] | undefined>;
  },
  res: { status: (n: number) => { json: (b: unknown) => void } },
): Promise<void> {
  const rawAuth = req.headers['authorization'];
  const auth = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // ?date=YYYY-MM-DD re-runs a past day (backfill / manual retry).
  const rawDate = req.query?.date;
  const dateKey = (Array.isArray(rawDate) ? rawDate[0] : rawDate) || ukToday(new Date());
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

  // The script the report grades against. Read live rather than hardcoded, so
  // an edit in the CRM changes tomorrow's coaching with no deploy.
  const { data: scriptRow } = await supabase
    .from('wk_call_scripts')
    .select('body_md')
    .eq('is_default', true)
    .maybeSingle();
  const script = (scriptRow?.body_md as string | undefined) ?? '';

  const written: Array<{
    name: string;
    body: string;
    stats: ReturnType<typeof computeStats>
      & ReturnType<typeof paceStats>
      & { script_check: ReturnType<typeof scriptCheck> };
    flags: ConductFlag[];
  }> = [];

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

    const stats = { ...computeStats(rows), ...paceStats(rows), script_check: scriptCheck(rows) };
    let raw: string;
    try {
      raw = await writeReport(
        name, dateKey, computeStats(rows), transcriptBlock(rows),
        script, scriptCheck(rows), paceStats(rows),
      );
    } catch (e) {
      console.error(`[daily-report] ${name} failed:`, e);
      continue;
    }
    if (!raw) continue;
    const { body, flags } = splitReport(raw);
    if (!body) continue;

    const { error } = await supabase.from('wk_agent_daily_reports').upsert(
      { agent_id: agent.id, report_date: dateKey, stats, body_md: body, flags, model: MODEL, updated_at: new Date().toISOString() },
      { onConflict: 'agent_id,report_date' },
    );
    if (error) console.error(`[daily-report] upsert failed for ${name}:`, error.message);
    else written.push({ name, body, stats, flags });
  }

  // Email Hugo the lot.
  const to = process.env.DAILY_REPORT_EMAIL || 'hugodesouzax@gmail.com';
  if (written.length > 0) {
    const esc = (s: string) =>
      String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
    const flagged = written.filter((w) => w.flags.length > 0);

    // Conduct + compliance first. This is the part that must never be missed.
    const alerts = flagged.length
      ? `<div style="border:1px solid #FCA5A5;background:#FEF2F2;border-radius:12px;padding:16px;margin-bottom:20px">
          <h3 style="margin:0 0 10px;color:#B91C1C">Needs your attention</h3>
          ${flagged
            .map(
              (w) => `<div style="margin-bottom:12px">
                <div style="font-weight:600;font-size:14px">${esc(w.name)}</div>
                ${w.flags
                  .map(
                    (f) => `<div style="font-size:13px;line-height:1.5;margin-top:6px">
                      <span style="display:inline-block;background:#B91C1C;color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;text-transform:uppercase">${esc(f.type)}</span>
                      <span style="color:#6B7280"> ${esc(f.company)}</span><br>
                      &ldquo;${esc(f.quote)}&rdquo;<br>
                      <span style="color:#6B7280">${esc(f.why)}</span>
                      ${f.call_id ? `<br><a href="${appUrl}/admin/crm/calls/${esc(f.call_id)}" style="color:#B91C1C;font-size:12px">Listen to the call &rarr;</a>` : ''}
                    </div>`,
                  )
                  .join('')}
              </div>`,
            )
            .join('')}
        </div>`
      : '';

    const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px;color:#1A1A1A">
      <h2 style="margin:0 0 4px">Daily agent reports — ${dateKey}</h2>
      <p style="color:#6B7280;margin:0 0 20px;font-size:14px">Each agent sees only their own on the leaderboard. You see all of them.</p>
      ${alerts}
      ${written
        .map(
          (r) => `<div style="border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-bottom:16px">
            <h3 style="margin:0 0 8px">${r.name}</h3>
            <p style="color:#6B7280;font-size:13px;margin:0 0 12px">
              ${r.stats.dials} dials · ${r.stats.conversations} conversations · ${r.stats.interested + r.stats.booked} interested/booked · ${r.stats.talk_minutes} min talking · ${r.stats.idle_minutes} min idle
            </p>
            <p style="color:#6B7280;font-size:12px;margin:0 0 12px">
              Script, out of ${r.stats.script_check.conversations_graded}:
              opener ${r.stats.script_check.name_before_recording} ·
              hook ${r.stats.script_check.reached_hook} ·
              offer ${r.stats.script_check.reached_offer} ·
              close ${r.stats.script_check.used_close}${
                r.stats.script_check.asked_for_their_number > 0
                  ? ` · <span style="color:#B91C1C">asked for a number ${r.stats.script_check.asked_for_their_number}</span>`
                  : ''
              }${
                r.stats.script_check.read_out_monthly_tiers > 0
                  ? ` · <span style="color:#B91C1C">read out tiers ${r.stats.script_check.read_out_monthly_tiers}</span>`
                  : ''
              }
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

  res.status(200).json({ ok: true, date: dateKey, reports: written.map((w) => w.name) });
}
