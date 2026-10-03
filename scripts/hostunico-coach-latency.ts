// Dry-run latency harness for the Hostunico live coach (3 Oct 2026).
//
// Replays real owner utterances from Pedro's sa calls through the same pure
// functions and the same model request the edge function uses, and times how
// long a complete suggestion takes. It READS the database and calls the model.
// It writes nothing, and it never texts, emails or rings anybody.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... \
//     npx tsx scripts/hostunico-coach-latency.ts [--variant=before|after] [--n=40]
//
// Secrets are read from the environment and never printed.

import { createClient } from '@supabase/supabase-js';
import { HOSTUNICO_COACH_PROMPT } from '../supabase/functions/_shared/hostunico-coach.ts';
import { hostunicoInstantAnswer } from '../supabase/functions/_shared/hostunico-sales.ts';
import { hostunicoCoachRequest } from '../supabase/functions/_shared/hostunico-coach-request.ts';

const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const variant = arg('variant', 'after');
const n = Number(arg('n', '40'));
const PEDRO = '6b26172e-d98d-4cc4-9e22-b3b4e24624ee';
const model = 'gpt-5.4-mini';

const supa = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function beforeBody(userMsg: string) {
  return {
    model, temperature: 0.4, presence_penalty: 0.3, frequency_penalty: 0.2, max_completion_tokens: 170,
    reasoning_effort: 'none', stream: true, prompt_cache_key: 'elsie-coach-v18',
    messages: [{ role: 'system', content: HOSTUNICO_COACH_PROMPT }, { role: 'user', content: userMsg }],
  };
}

async function timeModel(body: unknown): Promise<{ ms: number; text: string }> {
  const t0 = performance.now();
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) throw new Error(`model ${resp.status}`);
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let text = '', buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
      try { text += JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || ''; } catch { /* partial */ }
    }
  }
  return { ms: performance.now() - t0, text };
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };

async function main() {
  const { data: calls } = await supa.from('wk_calls').select('id,contact_id').eq('agent_id', PEDRO).eq('script_key', 'sa_call').order('started_at', { ascending: false }).limit(120);
  const samples: { latest: string; transcript: { speaker: string; body: string }[] }[] = [];
  for (const call of calls || []) {
    if (samples.length >= n) break;
    const { data: lines } = await supa.from('wk_live_transcripts').select('speaker,body,ts').eq('call_id', call.id).order('ts');
    (lines || []).forEach((line, i) => {
      if (samples.length < n && line.speaker === 'caller' && line.body.split(/\s+/).length >= 3 && i % 3 === 0) samples.push({ latest: line.body, transcript: (lines || []).slice(Math.max(0, i - 11), i + 1).map(({ speaker, body }) => ({ speaker, body })) });
    });
  }
  // Pipeline overhead before generation starts, measured from the database.
  const overheadMs = 400;
  const totals: number[] = [], modelOnly: number[] = [];
  let instantCount = 0;
  for (const s of samples) {
    const instant = hostunicoInstantAnswer(s.latest, 'GB');
    if (instant) { instantCount++; totals.push(0); continue; }
    const userMsg = JSON.stringify({ lead: 'Owner', country: 'GB', mode: 'spareroom', advertisedProperty: { property_type: 'studio', rent_pcm: 950 }, report: null, transcript: s.transcript, latestCaller: s.latest });
    const body = variant === 'before' ? beforeBody(userMsg) : hostunicoCoachRequest({ model, userMsg, latestCaller: s.latest, transcript: s.transcript });
    try {
      const { ms, text } = await timeModel(body);
      modelOnly.push(ms); totals.push(ms + overheadMs);
      if (process.argv.includes('--show')) console.log(`${Math.round(ms)}ms | ${s.latest.slice(0, 60)} => ${text.replace(/\n/g, ' | ').slice(0, 140)}`);
    } catch (e) { console.log('model error', (e as Error).message); }
  }
  console.log(JSON.stringify({ variant, samples: samples.length, instant: instantCount, modelCalls: modelOnly.length,
    modelP50: Math.round(pct(modelOnly, 0.5)), modelP90: Math.round(pct(modelOnly, 0.9)),
    endToEndP50: Math.round(pct(totals, 0.5)), endToEndP90: Math.round(pct(totals, 0.9)), overheadMs }));
}
main();
