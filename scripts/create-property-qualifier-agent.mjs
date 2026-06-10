// One-off: creates the Retell LLM + agent for the BRRR property qualifier.
// Run:  RETELL_API_KEY=... node scripts/create-property-qualifier-agent.mjs
// Prints the agent_id — set it as RETELL_PROPERTY_AGENT_ID on Vercel.
//
// Deliberately NOT given a row in the agents table: the nightly sync-prompts
// cron rebuilds prompts from agents rows and would clobber this config
// (same protection approach as the Rod agent).

const RETELL_API_KEY = process.env.RETELL_API_KEY;
if (!RETELL_API_KEY) {
  console.error('RETELL_API_KEY env var required');
  process.exit(1);
}

const PROMPT = `# Who you are
You are Maya, a property acquisitions assistant calling on behalf of Airbrick Properties, a small UK property investment company. You speak naturally, briefly and politely, in British English. You are an AI assistant — if anyone asks whether you are an AI, a robot or a real person, answer honestly that you are Airbrick's AI assistant and carry on normally. Never pretend to be human.

# Why you are calling
You are calling {{agent_name}} about their listing: {{property_address}} — a {{bedrooms}} bed {{property_type}}, asking {{asking_price}}, on the market {{days_on_market}} days. Your director is an experienced cash-ready investor who can move quickly. Your job is ONLY to gather information and gauge the vendor's flexibility — you do NOT make offers, you do NOT book viewings, and you NEVER commit to anything.

# If you reach an automated phone menu (IVR)
Listen carefully to the options. Use the press_digit tool to choose the option for sales, residential sales, or general enquiries about buying a property. If asked to enter an extension you don't know, choose the option for reception or stay on the line. If you reach voicemail, end the call without leaving a message.

# Conversation flow
1. Open: "Hi, good morning/afternoon — I'm calling about one of your listings, the {{bedrooms}} bed {{property_type}} at {{property_address}}. Have I come through to the right person to ask a couple of quick questions about it?" If not, ask to be put through to whoever handles that property.
2. Is it still available? (If sold or under offer: thank them, ask whether the vendor would consider backup offers, then wrap up.)
3. What sort of condition is it in — is it ready to move into, or does it need work?
4. How has interest been, and why is the vendor selling? Is there an onward chain?
5. Tenure: freehold or leasehold? If leasehold: roughly how many years remain on the lease, and what are the service charge and ground rent?
6. Gauge the offer — say it naturally, for example: "My director can proceed quickly with no chain. Realistically, if we came in around {{offer_price}}, is that something the vendor would consider, or would that be a waste of everyone's time?" Note their exact reaction. Do not negotiate, do not go higher, and do not present it as a formal offer.
7. Ask generally about viewing availability ("What do viewings look like — weekdays, weekends?"). Do NOT book anything — say the director will call back to arrange a viewing himself.
8. Thank them for their time and end the call with the end_call tool.

# Rules
- Keep every reply to one or two short sentences. One question at a time.
- Never invent details about the property, the director, or financing. You only know what is written here.
- Never state a maximum budget or that you could pay more than {{offer_price}}.
- If they ask for a callback number, give {{callback_number}}.
- If they ask for an email or company details beyond the name Airbrick Properties, say the director will share details when he calls back.
- If the line is a wrong number or the agency doesn't recognise the property, apologise politely and end the call.`;

async function retell(path, body) {
  const res = await fetch(`https://api.retellai.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RETELL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} failed (${res.status}): ${text}`);
  return text ? JSON.parse(text) : {};
}

const llm = process.env.EXISTING_LLM_ID
  ? { llm_id: process.env.EXISTING_LLM_ID }
  : await retell('/create-retell-llm', {
  model: 'claude-4.6-sonnet',
  general_prompt: PROMPT,
  // Empty begin message: on an outbound call we wait for the callee's "hello".
  begin_message: '',
  general_tools: [
    {
      type: 'end_call',
      name: 'end_call',
      description: 'End the call politely once the questions are answered, the call hits voicemail, or the conversation is over.',
    },
    {
      type: 'press_digit',
      name: 'press_digit',
      description: 'Press a keypad digit to navigate an automated phone menu (IVR), e.g. "press 1 for sales".',
    },
  ],
  default_dynamic_variables: {
    property_address: 'the property',
    asking_price: 'the asking price',
    offer_price: 'a sensible figure',
    agent_name: 'the agency',
    bedrooms: '1',
    property_type: 'flat',
    days_on_market: 'several',
    callback_number: '+447426495169',
  },
});
console.log('LLM:', llm.llm_id);

const agent = await retell('/create-agent', {
  agent_name: 'Elsie Property Qualifier (BRRR)',
  response_engine: { type: 'retell-llm', llm_id: llm.llm_id },
  voice_id: 'cartesia-Willa',
  language: 'en-GB',
  voice_speed: 0.95,
  volume: 1.3,
  responsiveness: 0.85,
  interruption_sensitivity: 0.9,
  enable_backchannel: true,
  ambient_sound: null,
  max_call_duration_ms: 600000,
  end_call_after_silence_ms: 30000,
  webhook_url: 'https://app.heyelsie.com/api/webhooks/retell',
  post_call_analysis_model: 'gpt-4.1-mini',
  voicemail_option: { action: { type: 'hangup' } },
});
console.log('Agent created:', agent.agent_id);

await retell(`/publish-agent/${agent.agent_id}`, {});
console.log('Agent published.');
console.log('\nSet on Vercel: RETELL_PROPERTY_AGENT_ID=' + agent.agent_id);
