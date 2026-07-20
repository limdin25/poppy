// Push the REAL receptionist prompt + tools + voice to the demo line's Retell
// brain directly (mirrors api/agent/sync-prompt.ts). Used because the sandbox
// can't reach app.heyelsie.com to trigger the app's own sync.
import { readFileSync } from 'node:fs';
import { buildSystemPrompt } from '../../src/prompts/system-builder.ts';
import { getCallTools } from '../../api/lib/booking-tools.ts';

const BUSINESS_ID = 'f8b98eb2-192e-4c22-87fd-90c865123fe7';
const AGENT_ROW = '32fe8ca3-eca7-4d0c-9835-9a1dd90aee02';
const RETELL_AGENT = 'agent_ee268fbbb679c28d9c9ab0e852';
const RETELL_LLM = 'llm_5c6e20b7804fa63df957c9c9e607';
// app.heyelsie.com DNS record is currently missing, so tool/webhook callbacks
// ENOTFOUND. Point at the working Vercel production alias until DNS is restored.
const APP_URL = 'https://poppy-henna.vercel.app';
const RB = 'https://api.retellai.com';

function loadEnv() {
  const env = { ...process.env };
  for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
const ENV = loadEnv();
const need = (k) => { const v = ENV[k]; if (!v) throw new Error(`missing ${k}`); return v; };
const RKEY = need('RETELL_API_KEY'); const SB = need('SUPABASE_URL'); const SK = need('SUPABASE_SERVICE_ROLE_KEY'); const TOOL = need('TOOL_SECRET');
const rHead = { Authorization: `Bearer ${RKEY}`, 'Content-Type': 'application/json' };
const sHead = { apikey: SK, Authorization: `Bearer ${SK}` };
async function j(url, opts) { const r = await fetch(url, opts); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } if (!r.ok) throw new Error(`${r.status} ${url}\n${t.slice(0, 500)}`); return d; }

// fetch business + resources
const [biz] = await j(`${SB}/rest/v1/businesses?select=name,industry,address,phone,website,greeting,tone,timezone&id=eq.${BUSINESS_ID}`, { headers: sHead });
const services = await j(`${SB}/rest/v1/services?select=name,description,price_from,price_to,bookable&business_id=eq.${BUSINESS_ID}`, { headers: sHead });
const faqs = await j(`${SB}/rest/v1/faqs?select=question,answer&business_id=eq.${BUSINESS_ID}`, { headers: sHead });
const infoRows = await j(`${SB}/rest/v1/call_info_types?select=name,enabled,fields&business_id=eq.${BUSINESS_ID}&order=sort_order`, { headers: sHead });
const callInfoTypes = infoRows.map((r) => ({ name: r.name, enabled: r.enabled, fields: r.fields?.length ? r.fields : [{ name: r.name.toLowerCase().replace(/\s+/g, '_'), type: 'text', required: false }] }));

const tz = biz.timezone || 'Europe/London';
const todayStr = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz }).format(new Date());
const prompt = `# You are Elsie — a warm, sharp British AI phone receptionist. THIS IS A LIVE DEMO LINE.

Today is ${todayStr} (${tz}).

Most callers are small-business owners trying you out. Your goal: quickly WOW them by role-playing as THEIR receptionist.

## Keep it SNAPPY (this is a trial)
- Be fast and to the point. Short sentences. One question at a time.
- Do NOT spell names back. Do NOT read phone numbers or emails back. Do NOT repeat details back to confirm. Just keep the conversation moving.
- Sound like a friendly, efficient human. Never say you're an AI unless asked. Never say you can't see their number.

## How the call goes
1. You've already opened with "Hi, thanks for calling! Who am I speaking with?" — get their first name.
2. In one quick line, ask what kind of business they run (plumber, salon, garage, etc.).
3. Then set up the role-play in one breath, e.g.: "Perfect, {name}! Let me show you how I'd answer for you. I'll be your receptionist now — go ahead and call in like one of your own customers would, and I'll take it from there."
4. Now BECOME their receptionist for that trade. Greet as their business, e.g.: "Hello, thanks for calling {their trade}, how can I help?" Then handle the pretend customer:
   - Find out what they need and roughly when.
   - Get the customer's name and the gist of the job.
   - Offer to book them in or take a message, and say clearly what happens next.
   - Keep it brief and human — this is the wow moment.
5. If it's going well, pitch it before wrapping up: "If you like how that felt, I can get Elsie answering your real calls — are you free tomorrow for a quick 15-minute onboarding?" If they say yes, agree a rough time.
6. Wrap up warmly: tell them you'll text over a summary and the onboarding details, then end the call.

## Caller's number & texting
- You can see the caller's number ({{from_number}}) — never ask for it.
- To text the caller, use send_sms with just the message and leave to_phone EMPTY (it goes to them automatically).
- A summary text is ALSO sent automatically after every call, so don't worry if you don't send one yourself.`;

const webSearch = !!ENV.TAVILY_API_KEY;
const hasBookable = services.some((s) => s.bookable);
const tools = getCallTools(APP_URL, TOOL, BUSINESS_ID, AGENT_ROW, { booking: hasBookable, webSearch });
// Make to_phone OPTIONAL so the agent can text the current caller without knowing
// their number — send-sms.ts fills it from Retell's call.from_number.
const smsTool = tools.find((t) => t.name === 'send_sms');
if (smsTool) {
  smsTool.description = 'Text the caller during the call. To text the person you are speaking to, OMIT to_phone (leave it empty) — it is sent to the caller automatically. Only set to_phone to text a DIFFERENT number (in +44 format).';
  if (smsTool.parameters) smsTool.parameters.required = ['message'];
}

// 1. push LLM
const DEMO_GREETING = 'Hi — thanks for calling! Who am I speaking with?';
const llmPayload = { general_prompt: prompt, general_tools: tools, begin_message: DEMO_GREETING, start_speaker: 'agent', model: 'claude-4.6-sonnet' };
await j(`${RB}/update-retell-llm/${RETELL_LLM}`, { method: 'PATCH', headers: rHead, body: JSON.stringify(llmPayload) });
console.log('LLM updated. prompt length:', prompt.length, 'tools:', tools.map((t) => t.name).join(', '));

// 2. update agent voice/timing then publish
const upd = await j(`${RB}/update-agent/${RETELL_AGENT}`, { method: 'PATCH', headers: rHead, body: JSON.stringify({
  voice_id: 'cartesia-Willa', language: 'en-GB', interruption_sensitivity: 0.9,
  max_call_duration_ms: 3600000, post_call_analysis_model: 'gpt-4.1-mini', volume: 1.4,
  webhook_url: `${APP_URL}/api/webhooks/retell`,
}) });
await j(`${RB}/publish-agent/${RETELL_AGENT}`, { method: 'POST', headers: rHead, body: JSON.stringify(upd.version != null ? { version: upd.version } : {}) });
console.log('Agent published, version:', upd.version);

// 3. re-point number (belt & braces)
await j(`${RB}/update-phone-number/%2B447576558278`, { method: 'PATCH', headers: rHead, body: JSON.stringify({ inbound_agents: [{ agent_id: RETELL_AGENT, weight: 1 }] }) });

// verify
const a = await j(`${RB}/get-agent/${RETELL_AGENT}`, { headers: rHead });
const p = await j(`${RB}/get-phone-number/%2B447576558278`, { headers: rHead });
const l = await j(`${RB}/get-retell-llm/${RETELL_LLM}`, { headers: rHead });
console.log('\n=== VERIFY ===');
console.log('agent webhook:', a.webhook_url, '| published:', a.is_published, '| voice:', a.voice_id);
console.log('number inbound:', JSON.stringify(p.inbound_agents));
console.log('LLM tools:', (l.general_tools || []).map((t) => t.name).join(', '));
console.log('prompt head:', String(l.general_prompt).slice(0, 160).replace(/\n/g, ' '));
