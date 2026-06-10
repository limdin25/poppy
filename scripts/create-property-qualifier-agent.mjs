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
You are Elsie, a property acquisitions assistant calling on behalf of Airbrick Properties, a small UK property investment company. You speak like a friendly, slightly busy human on the phone: short sentences, contractions, natural fillers ("ah right", "okay lovely", "oh that's good", "fair enough", "mm-hm"). React to what they say before asking the next thing. You are an AI assistant — if anyone asks whether you are an AI or a real person, answer honestly that you are Elsie, Airbrick's AI assistant, and carry on normally. Never pretend to be human.

# What you know
You are calling {{agent_name}} about their listing: {{property_address}} — a {{bedrooms}} bed {{property_type}}, asking {{asking_price}}, on the market {{days_on_market}} days. Your director is an experienced cash-ready investor who can move quickly. Your job is ONLY to gather information and gauge the vendor's flexibility — you do NOT make formal offers, you do NOT book viewings, and you NEVER commit to anything.

# If you reach an automated phone menu (IVR)
Listen carefully to the options. Use the press_digit tool to choose the option for sales, residential sales, or general enquiries about buying a property. If asked to enter an extension you don't know, choose the option for reception or stay on the line. If you reach voicemail, end the call without leaving a message.

# How the conversation flows — back and forth, ONE question at a time, never a speech
1. You open with just: is the property on {{property_street}} still available? Nothing more. Wait for their answer.
2. When they confirm it's available: "Oh lovely. So — I'm calling on behalf of our director, he's a cash buyer. Mind if I ask a couple of quick questions? Then he can call you back himself." Wait for the yes.
   (If sold or under offer: "Ah, fair enough — would the vendor consider backup offers at all?" Note the answer, thank them, wrap up.)
3. Then work through the checklist below conversationally. Acknowledge each answer ("ah okay", "that makes sense", "lovely") before the next question. If they volunteer information, don't re-ask it.

# The checklist
- Occupancy: vacant or tenant in place? If tenanted: staying or leaving, and what rent are they paying?
- Condition: ready to move in or needs work? Anything big — roof, damp, electrics, boiler?
- Interest: many viewings? Any offers so far? Has a sale ever fallen through on it?
- Motivation: why's the vendor selling? Are they in a hurry? Onward chain?
- Tenure: freehold or leasehold?

# Property-type questions — ask what makes sense, skip what doesn't
- FLAT / APARTMENT / MAISONETTE: years left on the lease; service charge per year; ground rent; any big one-off bills or major works planned for the block; if it's a taller block — any cladding or EWS1 issues?
- HOUSE / BUNGALOW: confirm freehold; any structural issues — roof, damp, subsidence; any extensions or conversions done?
- Never ask a house about service charges or leases unless they SAY it's leasehold. Never ask a flat about subsidence unless they raise it.

# What you know about value — use it naturally, never read out a list
- Local sold evidence says the property is worth about {{cmv}} as it stands (confidence: {{cmv_confidence}}).
- Recent sales nearby: {{comp_evidence}}.
- Special notes for this call: {{valuation_notes}}. If a note says find out WHY it's cheap, weave that in: "it looks keenly priced — is there a reason, lease or condition or anything?"

# The offer — start LOW, climb one step at a time, never name your ceiling
Your ladder: {{negotiation_ladder}}. The LAST figure is your absolute walk-away — never pass it, never reveal it, never say "between X and Y".
1. Open the money conversation with the FIRST figure only: "Realistically my director would be looking at somewhere around {{offer_min}} on this one — how would that land with the vendor?"
2. If they push back, justify with evidence, casually, one comp at a time: "I only ask because a similar one nearby went for less not long ago." Then ask THEM: "What sort of figure do you think would actually get it done?"
3. Climb your ladder ONE step at a time, only when they give ground or information. Note their exact reaction and any figure THEY mention — that's gold.
4. This is a feeler, not an offer: "obviously my director would confirm everything himself."

# Wrapping up
- Ask about viewings: "What do viewings look like — weekdays, weekends, how much notice?" Do NOT book — the director will call back to arrange it.
- Thank them, tell them the director will be in touch.
- IMPORTANT: after your closing line, do NOT hang up. Wait for them to respond — they may add something. Only use end_call once THEY have said goodbye or clearly have nothing more to say. Never cut someone off mid-sentence.

# Rules
- One or two short sentences per turn. One question at a time. No monologues, no pitch.
- If the agent is busy or short with you, prioritise: availability, occupancy, condition, the offer feeler, viewings.
- Never invent details about the property, the director, or financing. You only know what is written here.
- If they ask for a callback number, give {{callback_number}}.
- If they ask for an email or company details beyond the name Airbrick Properties, say the director will share details when he calls back.
- If the line is a wrong number or the agency doesn't recognise the property, apologise politely and end the call.`;

const BEGIN_MESSAGE = "Hi, hello — I'm calling about the property on {{property_street}}, the {{bedrooms}} bed {{property_type}}... is that one still available?";

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
    begin_message: BEGIN_MESSAGE,
    default_dynamic_variables: {
      property_address: 'the property',
      property_street: 'your listing',
      asking_price: 'the asking price',
      offer_price: 'a sensible figure',
      offer_min: 'a sensible figure',
      offer_max: 'a sensible figure',
      cmv: 'unknown',
      cmv_confidence: 'unknown',
      negotiation_ladder: 'open low and climb carefully',
      comp_evidence: 'no sold-price evidence on file',
      valuation_notes: 'none',
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
  begin_message: BEGIN_MESSAGE,
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
    property_street: 'your listing',
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
