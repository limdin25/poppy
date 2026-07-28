// Push the SITE DEMO prompt to the demo line's Retell brain.
//
// A separate script from push-prompt.mjs on purpose, not an edit to it.
// push-prompt.mjs remains the way to restore today's generic receptionist
// prompt if this experiment is pulled, and having both on disk means the
// restore path is one command rather than a git archaeology exercise.
//
// WHAT THIS CHANGES
// The prompt branches on {{site_demo_match}}, which api/webhooks/retell-inbound.ts
// sets by looking the caller's number up against wk_site_pages:
//   yes -> greet as THEIR business, because they are ringing the number printed
//          on the website we built them and the whole demo is hearing their own
//          receptionist answer.
//   no  -> today's generic "Elsie speaking" behaviour, completely untouched.
//          A caller ringing from a different phone than the one on file is a
//          soft miss, not a broken call.
//
// Run:  node tests/readiness/push-site-demo-prompt.mjs
import { readFileSync } from 'node:fs';
import { getCallTools } from '../../api/lib/booking-tools.ts';

const BUSINESS_ID = 'f8b98eb2-192e-4c22-87fd-90c865123fe7';
const AGENT_ROW = '32fe8ca3-eca7-4d0c-9835-9a1dd90aee02';
const RETELL_AGENT = 'agent_ee268fbbb679c28d9c9ab0e852';
const RETELL_LLM = 'llm_5c6e20b7804fa63df957c9c9e607';
const DEMO_NUMBER = '%2B447576558278';
// app.heyelsie.com DNS has been missing before, which makes tool and webhook
// callbacks ENOTFOUND. Point at the working Vercel alias.
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
const RKEY = need('RETELL_API_KEY');
const SB = need('SUPABASE_URL');
const SK = need('SUPABASE_SERVICE_ROLE_KEY');
const TOOL = need('TOOL_SECRET');
const rHead = { Authorization: `Bearer ${RKEY}`, 'Content-Type': 'application/json' };
const sHead = { apikey: SK, Authorization: `Bearer ${SK}` };
async function j(url, opts) {
  const r = await fetch(url, opts);
  const t = await r.text();
  let d;
  try { d = JSON.parse(t); } catch { d = t; }
  if (!r.ok) throw new Error(`${r.status} ${url}\n${t.slice(0, 500)}`);
  return d;
}

const [biz] = await j(
  `${SB}/rest/v1/businesses?select=timezone&id=eq.${BUSINESS_ID}`,
  { headers: sHead },
);
const tz = biz?.timezone || 'Europe/London';
const todayStr = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz,
}).format(new Date());

const prompt = `# You are Elsie, a warm, sharp British AI phone receptionist. THIS IS A LIVE DEMO LINE.

Today is ${todayStr} (${tz}).

## FIRST, CHECK WHO IS CALLING
The variable {{site_demo_match}} tells you which of two completely different
calls this is. Read it before you say anything.

---

## IF {{site_demo_match}} IS "yes"

This caller is {{owner_first}} from {{business_name}}, a {{trade}} in {{town}}.
We built them a website and they are ringing the number printed on it. You ARE
the receptionist for {{business_name}}. That is the entire demo: they want to
hear their own business answered properly.

Open with: "Hello, thanks for calling {{business_name}}, how can I help?"

Then:
- Answer as their business would. Take the job, the name and roughly when.
- If they say something like "it's me, I built this" or "this is my business",
  drop the role-play warmly: "Ha, hello {{owner_first}}. That is how I would
  answer every call that comes in for {{business_name}}."
- Keep it short. One question at a time. Sound like a person.

WHAT YOU MUST NOT INVENT for {{business_name}}, because we do not know it and
some of it is illegal to claim:
- No prices, quotes, hourly rates or callout fees.
- No Gas Safe, NICEIC, insurance, certifications or memberships.
- No guarantees, no response times, no arrival windows.
- No years in business, no team size.
If asked, say plainly you would take the details and have someone come straight
back to them.

Near the end, once, lightly:
"If you want this answering your real calls, I can text you a link to get it
set up properly. Shall I send it over?"
Whatever they say, do not push it twice. A text with the link goes out after
every call automatically, so a "maybe" is already handled.

---

## IF {{site_demo_match}} IS ANYTHING ELSE

Behave exactly as the standard demo line. You are Elsie, and you do NOT know
whose business this is.

Open with: "Hey, Elsie speaking, how can I help?"

Most callers are small business owners trying you out:
1. Get their first name.
2. Ask in one quick line what kind of business they run.
3. Set up the role-play in one breath: "Perfect, {name}. Let me show you how I
   would answer for you. Go ahead and call in like one of your own customers."
4. Become their receptionist for that trade. Take the job, the name, and what
   happens next. Keep it brief and human, this is the wow moment.
5. If it is going well: "If you like how that felt, I can get Elsie answering
   your real calls. Are you free tomorrow for a quick 15 minute onboarding?"
6. Wrap up warmly and say you will text a summary.

---

## ALWAYS

- Be fast. Short sentences. One question at a time.
- Do NOT spell names back, read numbers back, or repeat details to confirm.
- Never say you are an AI unless you are asked directly. If asked, be honest.
- You can see the caller's number ({{from_number}}). Never ask for it.
- To text the caller, use send_sms with just the message and leave to_phone
  EMPTY. A summary text also goes automatically after every call.
- Never use a long dash, an en dash, a curly quote or an ellipsis character.
  Use a comma, a full stop or a new sentence. Anything you write can end up in
  a text message, where one long dash halves how many characters fit in a
  single message and doubles what it costs to send.`;

const webSearch = !!ENV.TAVILY_API_KEY;
const tools = getCallTools(APP_URL, TOOL, BUSINESS_ID, AGENT_ROW, { booking: false, webSearch });
const smsTool = tools.find((t) => t.name === 'send_sms');
if (smsTool) {
  smsTool.description =
    'Text the caller during the call. To text the person you are speaking to, OMIT to_phone (leave it empty), it is sent to the caller automatically. Only set to_phone to text a DIFFERENT number (in +44 format).';
  if (smsTool.parameters) smsTool.parameters.required = ['message'];
}

// The opening line has to work before we know which branch we are in, because
// Retell speaks it before the model reasons. Keep it neutral: the prompt above
// re-greets as the business the moment it has the variable.
const DEMO_GREETING = 'Hello, thanks for calling! How can I help?';

await j(`${RB}/update-retell-llm/${RETELL_LLM}`, {
  method: 'PATCH',
  headers: rHead,
  body: JSON.stringify({
    general_prompt: prompt,
    general_tools: tools,
    begin_message: DEMO_GREETING,
    start_speaker: 'agent',
    model: 'claude-4.6-sonnet',
  }),
});
console.log('LLM updated. prompt length:', prompt.length, 'tools:', tools.map((t) => t.name).join(', '));

const upd = await j(`${RB}/update-agent/${RETELL_AGENT}`, {
  method: 'PATCH',
  headers: rHead,
  body: JSON.stringify({
    voice_id: 'cartesia-Willa', language: 'en-GB', interruption_sensitivity: 0.9,
    max_call_duration_ms: 3600000, post_call_analysis_model: 'gpt-4.1-mini', volume: 1.4,
    webhook_url: `${APP_URL}/api/webhooks/retell`,
  }),
});
await j(`${RB}/publish-agent/${RETELL_AGENT}`, {
  method: 'POST',
  headers: rHead,
  body: JSON.stringify(upd.version != null ? { version: upd.version } : {}),
});
console.log('Agent published, version:', upd.version);

await j(`${RB}/update-phone-number/${DEMO_NUMBER}`, {
  method: 'PATCH',
  headers: rHead,
  body: JSON.stringify({ inbound_agents: [{ agent_id: RETELL_AGENT, weight: 1 }] }),
});

const a = await j(`${RB}/get-agent/${RETELL_AGENT}`, { headers: rHead });
const p = await j(`${RB}/get-phone-number/${DEMO_NUMBER}`, { headers: rHead });
const l = await j(`${RB}/get-retell-llm/${RETELL_LLM}`, { headers: rHead });
console.log('\n=== VERIFY ===');
console.log('agent webhook:', a.webhook_url, '| published:', a.is_published, '| voice:', a.voice_id);
console.log('number inbound:', JSON.stringify(p.inbound_agents));
console.log('LLM tools:', (l.general_tools || []).map((t) => t.name).join(', '));
console.log('branches on site_demo_match:', String(l.general_prompt || '').includes('{{site_demo_match}}'));
console.log('\nIMPORTANT: the inbound webhook URL on this number must point at');
console.log('/api/webhooks/retell-inbound, or {{site_demo_match}} is never set');
console.log('and every caller gets the generic branch.');
