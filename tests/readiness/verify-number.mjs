// Proof test: pull the LIVE deployed prompt+tools from Retell and verify Elsie
// (a) asks for the caller's number instead of saying she can't see it, and
// (b) passes a correct +44 E.164 number to send_sms (never "{{from_number}}" / never 0-leading).
import { readFileSync } from 'node:fs';
const L = 'llm_5c6e20b7804fa63df957c9c9e607';
const MODEL = 'claude-sonnet-4-6';

function env() { const e = { ...process.env }; for (const l of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !e[m[1]]) e[m[1]] = m[2].replace(/^["']|["']$/g, ''); } return e; }
const E = env();
async function anthropic(body) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': E.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300)); return j;
}

// pull live prompt + tools
const llm = await (await fetch(`https://api.retellai.com/get-retell-llm/${L}`, { headers: { Authorization: `Bearer ${E.RETELL_API_KEY}` } })).json();
const system = llm.general_prompt;
const tools = (llm.general_tools || []).filter(t => t.name !== 'end_call').map(t => ({
  name: t.name,
  description: t.description || t.name,
  input_schema: t.parameters || { type: 'object', properties: {} },
})).concat([{ name: 'end_call', description: 'End the call', input_schema: { type: 'object', properties: {} } }]);

// scripted caller lines (deterministic) — the key: caller gives a UK 0-leading number verbally
const callerScript = [
  'Hi there. Could you text me a quick confirmation of this call, please?',
  "Yeah, it's oh seven, eight six three, nine nine two, five five five.",
  "That's the one, thanks!",
  "My name's Dave Wilkinson.",
  "Nothing else — just please send me that text confirmation now, then I'll let you go.",
  "Great, thanks — bye!",
];

const msgs = [{ role: 'user', content: '[Call connected. Greet as instructed, then handle the caller.]' }];
const smsCalls = [];
let elsieSaidCantSee = false;
let askedForNumber = false;

async function elsieTurn() {
  let spokenAll = '';
  for (let hop = 0; hop < 5; hop++) {
    const j = await anthropic({ model: MODEL, max_tokens: 500, system, tools, messages: msgs });
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join(' ').trim();
    if (text) spokenAll += (spokenAll ? ' ' : '') + text;
    const uses = (j.content || []).filter(c => c.type === 'tool_use');
    msgs.push({ role: 'assistant', content: j.content });
    if (!uses.length) break;
    const results = uses.map(u => {
      if (u.name === 'send_sms') smsCalls.push(u.input);
      return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify({ ok: true, spoken: 'sent' }) };
    });
    msgs.push({ role: 'user', content: results });
    if (uses.some(u => u.name === 'end_call')) break;
  }
  return spokenAll;
}

let firstAsk = null;
for (let turn = 0; turn <= callerScript.length; turn++) {
  const said = await elsieTurn();
  console.log(`Elsie: ${said}`);
  if (/can'?t (see|find|access).*(number|you)/i.test(said) || /don'?t have your number/i.test(said)) elsieSaidCantSee = true;
  if (/best number|what.*number|number to (reach|text|call)/i.test(said)) { askedForNumber = true; firstAsk ??= turn; }
  if (turn < callerScript.length) {
    console.log(`Caller: ${callerScript[turn]}`);
    msgs.push({ role: 'user', content: callerScript[turn] });
  }
}

console.log('\n=== RESULT ===');
console.log('send_sms invocations:', JSON.stringify(smsCalls));
const good = smsCalls.find(c => /^\+447863992555$/.test((c.to_phone || '').replace(/\s/g, '')));
const badTemplate = smsCalls.some(c => (c.to_phone || '').includes('{{'));
const badZero = smsCalls.some(c => /^0/.test((c.to_phone || '').trim()));
console.log('asked for number:', askedForNumber);
console.log('ever said "can\'t see your number":', elsieSaidCantSee);
console.log('texted correct +44 E.164 (+447863992555):', !!good);
console.log('passed {{from_number}} template:', badTemplate);
console.log('passed 0-leading number:', badZero);
const PASS = askedForNumber && !elsieSaidCantSee && !!good && !badTemplate && !badZero;
console.log(PASS ? '\n✅ PASS — Elsie asks, formats to +44, and texts the right number.' : '\n❌ FAIL — see above.');
