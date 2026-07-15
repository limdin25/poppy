#!/usr/bin/env node
/**
 * Creates the CRM AI warm-up voice agent in Retell (LLM + agent) with the
 * qualify+book prompt and the book_appointment tool wired to the CRM.
 * Prints the agent_id + llm_id to store as CRM_WARMUP_AGENT_ID.
 *
 * Does NOT touch any phone number — the 833 cutover is a separate deliberate
 * step. Env required: RETELL_API_KEY, APP_URL, TOOL_SECRET.
 * Usage: node scripts/crm-voice-setup.mjs
 */
import { readFileSync } from 'fs';

const RETELL_KEY = process.env.RETELL_API_KEY;
const APP_URL = process.env.APP_URL || 'https://elsie-preview.vercel.app';
const TOOL_SECRET = process.env.TOOL_SECRET;
if (!RETELL_KEY || !TOOL_SECRET) { console.error('Need RETELL_API_KEY + TOOL_SECRET'); process.exit(1); }

const BASE = 'https://api.retellai.com';
const H = { Authorization: `Bearer ${RETELL_KEY}`, 'Content-Type': 'application/json' };
const prompt = readFileSync(new URL('./crm-warmup-agent-prompt.txt', import.meta.url), 'utf8');

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);
  return JSON.parse(text);
}

const tools = [
  { type: 'end_call', name: 'end_call', description: 'End the call politely when finished.' },
  {
    type: 'custom',
    name: 'book_appointment',
    description: 'Book the lead a callback slot with the team. Call this only after they agree a time.',
    url: `${APP_URL}/api/crm/book`,
    method: 'POST',
    headers: { 'x-tool-secret': TOOL_SECRET },
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "The lead's name." },
        when: { type: 'string', description: 'The day/time they agreed, plain text e.g. "Tuesday afternoon".' },
        notes: { type: 'string', description: 'One line about what they are after.' },
      },
      required: ['when'],
    },
    speak_during_execution: true,
    speak_after_execution: true,
  },
];

const llm = await post('/create-retell-llm', {
  general_prompt: prompt,
  model: 'claude-4.6-sonnet',
  general_tools: tools,
  begin_message: 'Hi there, thanks for calling back! Who am I speaking with?',
});
console.log('LLM:', llm.llm_id);

const agent = await post('/create-agent', {
  agent_name: 'CRM Warm-up (Maya)',
  response_engine: { type: 'retell-llm', llm_id: llm.llm_id },
  voice_id: 'cartesia-Willa',
  language: 'en-GB',
  enable_backchannel: true,
  webhook_url: `${APP_URL}/api/webhooks/retell`,
});
console.log('AGENT:', agent.agent_id);
console.log('\nSet in Vercel:  CRM_WARMUP_AGENT_ID=' + agent.agent_id);
