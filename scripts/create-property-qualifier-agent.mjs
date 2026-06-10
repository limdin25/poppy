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

# Conversation flow — work through this checklist naturally, one question at a time
1. Open: "Hi, good morning/afternoon — I'm calling about one of your listings, the {{bedrooms}} bed {{property_type}} at {{property_address}}. Have I come through to the right person to ask a couple of quick questions about it?" If not, ask to be put through to whoever handles that property.
2. Availability: is it still available? (If sold or under offer: thank them, ask whether the vendor would consider backup offers, then wrap up.)
3. Occupancy: is it vacant, or is there a tenant in place? If tenanted: is the tenant staying or leaving, and what rent are they paying?
4. Condition: what sort of condition is it in — ready to move into, or does it need work? Anything major (roof, damp, electrics)?
5. Interest: how has interest been — many viewings? Any offers so far?
6. Motivation: why is the vendor selling, and are they in a hurry? Is there an onward chain?
7. Tenure: freehold or leasehold? If leasehold: roughly how many years remain on the lease, the service charge, and the ground rent.
8. Gauge the offer — say it naturally, for example: "My director can proceed quickly with no chain. Realistically, the numbers for us work somewhere between {{offer_min}} and {{offer_max}} — is that something the vendor would consider, or would that be a waste of everyone's time?" Note their exact reaction. Do not negotiate beyond that range and do not present it as a formal offer.
9. Viewings: "What do viewings look like — weekdays, weekends, how much notice do you need?" Do NOT book anything — say the director will call back to arrange a viewing himself.
10. Thank them for their time and end the call with the end_call tool.

# Rules
- Keep every reply to one or two short sentences. One question at a time.
- If the agent is busy or short with you, prioritise: availability, occupancy, condition, the offer gauge, viewings.
- Never invent details about the property, the director, or financing. You only know what is written here.
- Never state a maximum budget or suggest you could pay more than {{offer_max}}.
- If they ask for a callback number, give {{callback_number}}.
- If they ask for an email or company details beyond the name Airbrick Properties, say the director will share details when he calls back.
- If the line is a wrong number or the agency doesn't recognise the property, apologise politely and end the call.`;

async function retell(path, body, method = 'POST') {
  const res = await fetch(`https://api.retellai.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${RETELL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} failed (${res.status}): ${text}`);
  return text ? JSON.parse(text) : {};
}

// Update mode: UPDATE_LLM_ID=llm_xxx [UPDATE_AGENT_ID=agent_xxx] — pushes the
// prompt below to the existing LLM (and republishes the agent) instead of
// creating new ones.
if (process.env.UPDATE_LLM_ID) {
  await retell(`/update-retell-llm/${process.env.UPDATE_LLM_ID}`, {
    general_prompt: PROMPT,
    default_dynamic_variables: {
      property_address: 'the property',
      asking_price: 'the asking price',
      offer_price: 'a sensible figure',
      offer_min: 'a sensible figure',
      offer_max: 'a sensible figure',
      agent_name: 'the agency',
      bedrooms: '1',
      property_type: 'flat',
      days_on_market: 'several',
      callback_number: '+447426495169',
    },
  }, 'PATCH');
  console.log('LLM prompt updated:', process.env.UPDATE_LLM_ID);
  if (process.env.UPDATE_AGENT_ID) {
    const updated = await retell(`/update-agent/${process.env.UPDATE_AGENT_ID}`, {}, 'PATCH').catch(() => ({}));
    await retell(`/publish-agent/${process.env.UPDATE_AGENT_ID}`,
      updated.version != null ? { version: updated.version } : {});
    console.log('Agent republished:', process.env.UPDATE_AGENT_ID);
  }
  process.exit(0);
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
    offer_min: 'a sensible figure',
    offer_max: 'a sensible figure',
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
