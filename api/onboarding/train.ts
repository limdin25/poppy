import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

async function fetchPlaceDetails(placeId: string): Promise<string> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || !placeId) return '';

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,formatted_phone_number,website,types,opening_hours,reviews&key=${apiKey}`,
    );
    const data = await res.json();
    if (data.result) {
      const r = data.result;
      const parts = [
        `Name: ${r.name}`,
        r.formatted_address ? `Address: ${r.formatted_address}` : '',
        r.formatted_phone_number ? `Phone: ${r.formatted_phone_number}` : '',
        r.website ? `Website: ${r.website}` : '',
        r.types ? `Categories: ${r.types.join(', ')}` : '',
        r.opening_hours?.weekday_text
          ? `Hours:\n${r.opening_hours.weekday_text.join('\n')}`
          : '',
        r.reviews
          ? `Recent reviews:\n${r.reviews.slice(0, 5).map((rev: any) => `- "${rev.text}"`).join('\n')}`
          : '',
      ];
      return parts.filter(Boolean).join('\n');
    }
  } catch {
    // Non-critical — continue without place data
  }
  return '';
}

async function scrapeWebsite(url: string): Promise<string> {
  if (!url) return '';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PoppyBot/1.0 (onboarding scraper)' },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    // Basic text extraction — strip tags, scripts, styles
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000); // Limit to 8k chars for the prompt
    return text;
  } catch {
    return '';
  }
}

async function generateWithOpenAI(context: string, businessName: string, industry: string): Promise<{
  services: Array<{ name: string; description: string; price_from?: number; price_to?: number; bookable: boolean }>;
  faqs: Array<{ question: string; answer: string }>;
  greeting: string;
}> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are helping set up an AI receptionist for a UK service business. Given context about the business, generate a JSON object with:
- "services": array of { name, description, price_from (number or null), price_to (number or null), bookable (boolean) }
- "faqs": array of { question, answer } — common questions a caller might ask
- "greeting": a natural phone greeting for the receptionist

Generate 5-10 services and 5-8 FAQs based on available info. If pricing isn't clear, leave price fields null. Mark services as bookable if they're appointment-based.
UK English only. Prices in GBP.`,
        },
        {
          role: 'user',
          content: `Business: ${businessName}\nIndustry: ${industry || 'unknown'}\n\nContext:\n${context}`,
        },
      ],
    }),
  });

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned empty response');
  return JSON.parse(content);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { businessId, googlePlaceId, websiteUrl, businessName, industry } = await req.json();

    if (!businessId) {
      return new Response(JSON.stringify({ error: 'businessId is required' }), { status: 400 });
    }

    // Gather context from available sources
    const contextParts: string[] = [];

    if (googlePlaceId) {
      const placeText = await fetchPlaceDetails(googlePlaceId);
      if (placeText) contextParts.push(`--- Google Places ---\n${placeText}`);
    }

    if (websiteUrl) {
      const siteText = await scrapeWebsite(websiteUrl);
      if (siteText) contextParts.push(`--- Website content ---\n${siteText}`);
    }

    const context = contextParts.join('\n\n') || 'No external data available. Generate sensible defaults for this type of business.';

    // Generate services, FAQs, greeting via OpenAI
    const generated = await generateWithOpenAI(
      context,
      businessName || 'the business',
      industry || '',
    );

    // Store services
    if (generated.services.length > 0) {
      const serviceRows = generated.services.map((s) => ({
        business_id: businessId,
        name: s.name,
        description: s.description,
        price_from: s.price_from,
        price_to: s.price_to,
        bookable: s.bookable,
      }));
      await supabase.from('services').insert(serviceRows);
    }

    // Store FAQs
    if (generated.faqs.length > 0) {
      const faqRows = generated.faqs.map((f) => ({
        business_id: businessId,
        question: f.question,
        answer: f.answer,
      }));
      await supabase.from('faqs').insert(faqRows);
    }

    // Update business with greeting
    await supabase
      .from('businesses')
      .update({ greeting: generated.greeting, industry })
      .eq('id', businessId);

    // Build and store system prompt
    const { buildSystemPrompt } = await import('../src/prompts/system-builder.js');
    const business = { name: businessName || 'the business', industry, greeting: generated.greeting };
    const prompt = buildSystemPrompt(business, generated.services, generated.faqs, []);

    await supabase
      .from('businesses')
      .update({ system_prompt: prompt })
      .eq('id', businessId);

    return new Response(
      JSON.stringify({
        ok: true,
        services_count: generated.services.length,
        faqs_count: generated.faqs.length,
        greeting: generated.greeting,
      }),
      { status: 200 },
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
