import { createClient } from '@supabase/supabase-js';
import { buildSystemPrompt } from '../../src/prompts/system-builder';
import type { Business, Service, FAQ, CallInfoType } from '../../src/prompts/system-builder';
import { requireAuth } from '../lib/auth';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const RETELL_API_KEY = process.env.RETELL_API_KEY!;

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  try {

    const { data: channel } = await supabase
      .from('channels')
      .select('config')
      .eq('business_id', businessId)
      .eq('type', 'voice')
      .single();

    if (!channel?.config) {
      return new Response(JSON.stringify({ error: 'No voice channel configured' }), { status: 404 });
    }

    const cfg = channel.config as Record<string, string>;
    const llmId = cfg.retell_llm_id;
    if (!llmId) {
      return new Response(JSON.stringify({ error: 'No Retell LLM ID found' }), { status: 404 });
    }

    const { data: business } = await supabase
      .from('businesses')
      .select('name, industry, address, phone, website, greeting, tone, ai_system_prompt')
      .eq('id', businessId)
      .single();

    if (!business) {
      return new Response(JSON.stringify({ error: 'Business not found' }), { status: 404 });
    }

    let prompt = business.ai_system_prompt;

    if (!prompt) {
      const { data: services } = await supabase
        .from('services')
        .select('name, description, price_from, price_to, bookable')
        .eq('business_id', businessId)
        .order('sort_order');

      const { data: faqs } = await supabase
        .from('faqs')
        .select('question, answer')
        .eq('business_id', businessId)
        .order('sort_order');

      const { data: callInfoRows } = await supabase
        .from('call_info_types')
        .select('name, enabled, fields')
        .eq('business_id', businessId)
        .order('sort_order');

      const biz: Business = {
        name: business.name,
        industry: business.industry ?? undefined,
        address: business.address ?? undefined,
        phone: business.phone ?? undefined,
        website: business.website ?? undefined,
        greeting: business.greeting ?? undefined,
        tone: business.tone ?? undefined,
      };

      const callInfoTypes: CallInfoType[] = (callInfoRows || []).map((r: Record<string, unknown>) => ({
        name: r.name as string,
        enabled: r.enabled as boolean,
        fields: (r.fields as Array<{ name: string; type: string; required?: boolean }>) || [
          { name: (r.name as string).toLowerCase().replace(/\s+/g, '_'), type: 'text', required: false },
        ],
      }));

      prompt = buildSystemPrompt(
        biz,
        (services || []) as Service[],
        (faqs || []) as FAQ[],
        callInfoTypes,
        'VOICE',
      );
    }

    const res = await fetch(`https://api.retellai.com/update-retell-llm/${llmId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${RETELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ general_prompt: prompt }),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: `Retell update failed: ${err}` }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
