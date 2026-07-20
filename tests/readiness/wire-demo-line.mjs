// Wire +447576558278 as a live RECEPTIONIST test line: Retell agent (answering)
// + Elsie DB (capture) + SMS-from that number. Reversible: prints the old inbound
// agent so we can restore the property-enquiry line.
//
// Run: set -a; . ./.env; set +a; export ANTHROPIC_API_KEY=..; npx tsx tests/readiness/wire-demo-line.mjs
import { readFileSync } from 'node:fs';

const NUMBER = '+447576558278';
const APP_URL = 'https://app.heyelsie.com';
const RETELL = 'https://api.retellai.com';

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
const sHead = { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function j(url, opts) { const r = await fetch(url, opts); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } if (!r.ok) throw new Error(`${r.status} ${url}\n${t.slice(0, 400)}`); return d; }

const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

// 0. Save current inbound agent on the number (for restore)
step(0, `Reading current state of ${NUMBER}`);
const cur = await j(`${RETELL}/get-phone-number/${encodeURIComponent(NUMBER)}`, { headers: rHead });
console.log('  RESTORE INFO — current inbound_agents:', JSON.stringify(cur.inbound_agents));

// 1. Business defaults from e2593e2f (owner_id + locale)
step(1, 'Fetching owner_id + defaults from live business e2593e2f');
const [tmpl] = await j(`${SB}/rest/v1/businesses?select=owner_id,currency,country_code,timezone&id=eq.e2593e2f-a78e-4878-8c6c-67539af2f955`, { headers: sHead });
console.log('  owner_id:', tmpl.owner_id, 'currency:', tmpl.currency, 'country:', tmpl.country_code);

// 2. Create Retell LLM (placeholder prompt) — sync-prompt overwrites it with the real one
step(2, 'Creating Retell LLM');
const llm = await j(`${RETELL}/create-retell-llm`, { method: 'POST', headers: rHead, body: JSON.stringify({
  model: 'claude-4.6-sonnet',
  general_prompt: 'You are Elsie, a professional AI receptionist. (This prompt is replaced on first sync.)',
  general_tools: [{ name: 'end_call', type: 'end_call' }],
}) });
console.log('  llm_id:', llm.llm_id);

// 3. Create Retell agent (webhook -> app.heyelsie.com, British voice)
step(3, 'Creating Retell agent');
const agent = await j(`${RETELL}/create-agent`, { method: 'POST', headers: rHead, body: JSON.stringify({
  agent_name: 'Elsie Demo Receptionist (market test)',
  response_engine: { type: 'retell-llm', llm_id: llm.llm_id },
  voice_id: 'cartesia-Emma',
  language: 'en-GB',
  enable_backchannel: true,
  webhook_url: `${APP_URL}/api/webhooks/retell`,
}) });
console.log('  agent_id:', agent.agent_id, 'webhook:', agent.webhook_url);

// 4. Create the demo business
step(4, 'Creating demo business');
const slug = `elsie-demo-line-${Date.now().toString(36)}`;
const [biz] = await j(`${SB}/rest/v1/businesses`, { method: 'POST', headers: sHead, body: JSON.stringify({
  owner_id: tmpl.owner_id,
  name: 'Elsie Demo Line',
  slug,
  industry: 'Local service business',
  greeting: "Hello, thanks for calling — you're through to Elsie. How can I help today?",
  tone: 'warm, professional and efficient',
  ai_model: 'claude-sonnet-4-6',
  timezone: tmpl.timezone || 'Europe/London',
  currency: tmpl.currency || 'GBP',
  country_code: tmpl.country_code || 'GB',
  working_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  working_hours_start: 8,
  working_hours_end: 19,
  status: 'active',
}) });
console.log('  business_id:', biz.id);

// 5. Enable the info Elsie must collect
step(5, 'Adding call_info_types (name, number, job, address)');
const infoRows = [
  { name: 'Caller name', fields: [{ name: 'caller_name', type: 'text', required: true }] },
  { name: 'Contact number', fields: [{ name: 'contact_number', type: 'text', required: true }] },
  { name: 'Reason for call / job', fields: [{ name: 'reason', type: 'text', required: true }] },
  { name: 'Address', fields: [{ name: 'address', type: 'text', required: false }] },
].map((r, i) => ({ business_id: biz.id, name: r.name, fields: r.fields, enabled: true, sort_order: i }));
const info = await j(`${SB}/rest/v1/call_info_types`, { method: 'POST', headers: sHead, body: JSON.stringify(infoRows) });
console.log('  info types created:', info.length);

// 6. Create the agents row (maps Retell agent -> business for capture)
step(6, 'Creating Elsie agents row');
const [arow] = await j(`${SB}/rest/v1/agents`, { method: 'POST', headers: sHead, body: JSON.stringify({
  business_id: biz.id,
  name: 'Demo Receptionist',
  agent_type: 'voice',
  is_default: true,
  status: 'active',
  greeting: "Hello, thanks for calling — you're through to Elsie. How can I help today?",
  tone: 'warm, professional and efficient',
  ai_model: 'claude-sonnet-4-6',
  voice_id: 'cartesia-Emma',
  language: 'en-GB',
  retell_agent_id: agent.agent_id,
  retell_llm_id: llm.llm_id,
  start_speaker: 'agent',
}) });
console.log('  agents row id:', arow.id);

// 7. Create the connected voice channel (this makes NUMBER the SMS-from number)
step(7, 'Creating connected voice channel');
const [chan] = await j(`${SB}/rest/v1/channels`, { method: 'POST', headers: sHead, body: JSON.stringify({
  business_id: biz.id,
  type: 'voice',
  status: 'connected',
  agent_id: arow.id,
  config: { phone: NUMBER, retell_agent_id: agent.agent_id, retell_llm_id: llm.llm_id, termination_uri: 'retellerminationsipuri.pstn.twilio.com' },
}) });
console.log('  channel id:', chan.id, 'phone:', chan.config.phone);

// 8. Point the number's inbound at the new agent
step(8, `Pointing ${NUMBER} inbound -> new agent`);
await j(`${RETELL}/update-phone-number/${encodeURIComponent(NUMBER)}`, { method: 'PATCH', headers: rHead, body: JSON.stringify({ inbound_agents: [{ agent_id: agent.agent_id, weight: 1 }] }) });
console.log('  pointed.');

// 9. Sync the REAL receptionist prompt + tools + voice via the app (also publishes + repoints)
step(9, 'Syncing real prompt/tools to Retell via app');
const sync = await fetch(`${APP_URL}/api/agent/sync-prompt`, { method: 'POST', headers: { 'x-tool-secret': TOOL, 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: biz.id, agentId: arow.id }) });
console.log('  sync-prompt status:', sync.status, (await sync.text()).slice(0, 200));

// 10. Verify
step(10, 'Verifying');
const a2 = await j(`${RETELL}/get-agent/${agent.agent_id}`, { headers: rHead });
const p2 = await j(`${RETELL}/get-phone-number/${encodeURIComponent(NUMBER)}`, { headers: rHead });
const llm2 = await j(`${RETELL}/get-retell-llm/${llm.llm_id}`, { headers: rHead });
console.log('  agent webhook:', a2.webhook_url);
console.log('  number inbound_agents:', JSON.stringify(p2.inbound_agents));
console.log('  LLM prompt starts:', String(llm2.general_prompt || '').slice(0, 90).replace(/\n/g, ' '));
console.log('  LLM tools:', (llm2.general_tools || []).map((t) => t.name).join(', '));

console.log('\n=== DONE ===');
console.log(JSON.stringify({ business_id: biz.id, agent_row: arow.id, channel: chan.id, retell_agent: agent.agent_id, retell_llm: llm.llm_id, number: NUMBER, restore_prev_inbound: cur.inbound_agents }, null, 2));
