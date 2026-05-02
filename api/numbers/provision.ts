import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const RETELL_API_KEY = process.env.RETELL_API_KEY!;

async function twilioFetch(path: string, method: string, body?: Record<string, string>) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}${path}`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  return res.json();
}

async function retellFetch(path: string, method: string, body?: object) {
  const res = await fetch(`https://api.retellai.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${RETELL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { businessId } = await req.json();

    if (!businessId) {
      return new Response(JSON.stringify({ error: 'businessId is required' }), { status: 400 });
    }

    // Fetch business and its system prompt
    const { data: business, error: bizErr } = await supabase
      .from('businesses')
      .select('id, name, system_prompt')
      .eq('id', businessId)
      .single();

    if (bizErr || !business) {
      return new Response(JSON.stringify({ error: 'Business not found' }), { status: 404 });
    }

    // 1. Provision a UK number from Twilio
    const availableNumbers = await twilioFetch(
      '/AvailablePhoneNumbers/GB/Local.json?PageSize=1',
      'GET',
    );

    if (!availableNumbers.available_phone_numbers?.length) {
      return new Response(
        JSON.stringify({ error: 'No UK numbers available' }),
        { status: 503 },
      );
    }

    const phoneNumber = availableNumbers.available_phone_numbers[0].phone_number;

    // Purchase the number
    await twilioFetch('/IncomingPhoneNumbers.json', 'POST', {
      PhoneNumber: phoneNumber,
    });

    // 2. Create Retell AI agent with the business system prompt
    const agent = await retellFetch('/create-agent', 'POST', {
      agent_name: `${business.name} Receptionist`,
      voice_id: 'eleven_turbo_v2', // Default — can be changed later
      general_prompt: business.system_prompt || `You are the AI receptionist for ${business.name}.`,
      enable_backchannel: true,
      language: 'en-GB',
    });

    if (!agent.agent_id) {
      return new Response(
        JSON.stringify({ error: 'Failed to create Retell agent' }),
        { status: 500 },
      );
    }

    // 3. Create SIP trunk in Retell and link number
    const phoneNumberResource = await retellFetch('/create-phone-number', 'POST', {
      phone_number: phoneNumber,
      agent_id: agent.agent_id,
      area_code: null,
    });

    // 4. Store in channels table
    const { error: channelErr } = await supabase.from('channels').insert({
      business_id: businessId,
      type: 'voice',
      provider: 'retell',
      provider_id: agent.agent_id,
      phone_number: phoneNumber,
      config: {
        retell_agent_id: agent.agent_id,
        retell_phone_id: phoneNumberResource.phone_number_id,
      },
      enabled: true,
    });

    if (channelErr) {
      return new Response(JSON.stringify({ error: channelErr.message }), { status: 500 });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        phoneNumber,
        agentId: agent.agent_id,
      }),
      { status: 200 },
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
