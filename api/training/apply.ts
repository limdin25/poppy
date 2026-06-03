import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { callLLM, getModelForAgent } from '../lib/llm.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

/**
 * "Set up Elsie from your knowledge" — reads the business's knowledge sources,
 * asks the AI to design a complete setup, then PERSISTS it: personality + system
 * prompt on the business/default agent, services, FAQs, lead-classification
 * guidance, and 3 named follow-up sequences. Leaves Elsie draft-by-default
 * (drafts a reply, owner approves). Everything stays editable afterwards.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  const { data: sources } = await supabase
    .from('knowledge_sources')
    .select('name, type, url, summary, content')
    .eq('business_id', businessId)
    .eq('status', 'synced');

  if (!sources?.length) {
    return new Response(JSON.stringify({ error: 'Add some knowledge first (a website, file, notes, or your Google listing), then set up Elsie.' }), { status: 400 });
  }

  const { data: business } = await supabase
    .from('businesses')
    .select('name, industry, address, phone, website')
    .eq('id', businessId)
    .single();

  const trainingContent = sources
    .map((s) => {
      const label = s.type === 'website' ? `Website (${s.url})` : `Source (${s.name})`;
      return `### ${label}\n${s.summary || s.content || ''}`;
    })
    .join('\n\n');

  const model = await getModelForAgent(businessId, null);

  const systemPrompt = `You configure "Elsie", an AI receptionist, from a business's own knowledge. Read the knowledge carefully and design a setup that fits THIS business exactly. Return ONLY valid JSON — no markdown, no code fences, no commentary.`;

  const userContent = `Business: ${business?.name || 'Unknown'}
Industry: ${business?.industry || 'Unknown'}
${business?.address ? `Address: ${business.address}` : ''}
${business?.phone ? `Phone: ${business.phone}` : ''}

## Knowledge:
${trainingContent}

## Return EXACTLY this JSON (fill every field from the knowledge above):
{
  "greeting": "A warm opening line Elsie says first (under 200 chars), in the business's voice",
  "tone": "professional | friendly | casual | formal",
  "personality": "2-4 sentences describing how Elsie should speak and behave for this business",
  "rules": ["3-6 specific rules Elsie must always follow for this business"],
  "services": [{"name": "Service name", "description": "1 line", "price_from": null}],
  "faqs": [{"question": "A real customer question", "answer": "The answer from the knowledge"}],
  "classification_guidance": "1-3 sentences: how to tell a HOT vs WARM vs COLD lead for this business",
  "follow_up_sequences": [
    {"name": "Gentle nudge", "steps": [{"after_hours": 24, "message": "Friendly check-in with {name}"}, {"after_hours": 72, "message": "Second gentle nudge"}]},
    {"name": "Value reminder", "steps": [{"after_hours": 48, "message": "Reminder highlighting a benefit, with {name}"}, {"after_hours": 120, "message": "Another value point"}]},
    {"name": "Last chance", "steps": [{"after_hours": 72, "message": "Final friendly nudge with {name}"}]}
  ]
}

Rules:
- 4-8 services and 5-8 FAQs, all grounded in the knowledge (never invent prices — use null if unknown).
- Follow-up messages must be friendly, short, plain text, and include the {name} placeholder.
- after_hours must be whole numbers of hours.
- Return ONLY the JSON object.`;

  const text = await callLLM(model, systemPrompt, [{ role: 'user', content: userContent }], 4000);
  if (!text) {
    return new Response(JSON.stringify({ error: 'AI setup failed — please try again.' }), { status: 500 });
  }

  let cfg: any;
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no json');
    cfg = JSON.parse(match[0]);
  } catch {
    return new Response(JSON.stringify({ error: 'Could not read the AI setup — please try again.' }), { status: 500 });
  }

  const sysPrompt = [
    cfg.personality || '',
    Array.isArray(cfg.rules) && cfg.rules.length ? `Rules:\n- ${cfg.rules.join('\n- ')}` : '',
    cfg.classification_guidance ? `Lead classification (HOT/WARM/COLD): ${cfg.classification_guidance}` : '',
  ].filter(Boolean).join('\n\n');

  const applied = { business: false, agent: false, services: 0, faqs: 0, sequences: 0, channels: 0 };

  // 1) Business personality + greeting + tone + system prompt
  await supabase.from('businesses').update({
    greeting: cfg.greeting || null,
    tone: cfg.tone || 'friendly',
    ai_system_prompt: sysPrompt || null,
  }).eq('id', businessId);
  applied.business = true;

  // 2) Default agent (if one exists): same personality + draft-by-default + follow-ups on
  const { data: agent } = await supabase
    .from('agents')
    .select('id')
    .eq('business_id', businessId)
    .eq('is_default', true)
    .maybeSingle();
  if (agent?.id) {
    await supabase.from('agents').update({
      greeting: cfg.greeting || null,
      tone: cfg.tone || 'friendly',
      instructions: cfg.personality || null,
      ai_system_prompt: sysPrompt || null,
      auto_reply_enabled: true,
      draft_mode: true,
      follow_up_enabled: true,
    }).eq('id', agent.id);
    applied.agent = true;
  }

  // 3) Draft-by-default across the business's channels (Elsie drafts, owner approves)
  const { data: chans } = await supabase.from('channels').select('id').eq('business_id', businessId);
  if (chans?.length) {
    await supabase.from('channels').update({ auto_reply_enabled: true, draft_mode: true }).eq('business_id', businessId);
    applied.channels = chans.length;
  }

  // 4) Services — only seed if the business has none yet
  const { count: svcCount } = await supabase.from('services').select('id', { count: 'exact', head: true }).eq('business_id', businessId);
  if (!svcCount && Array.isArray(cfg.services)) {
    const rows = cfg.services.slice(0, 12).filter((s: any) => s?.name).map((s: any, i: number) => ({
      business_id: businessId,
      name: String(s.name).slice(0, 200),
      description: s.description ? String(s.description).slice(0, 500) : null,
      price_from: typeof s.price_from === 'number' ? s.price_from : null,
      bookable: false,
      sort_order: i,
    }));
    if (rows.length) { await supabase.from('services').insert(rows); applied.services = rows.length; }
  }

  // 5) FAQs — only seed if none yet
  const { count: faqCount } = await supabase.from('faqs').select('id', { count: 'exact', head: true }).eq('business_id', businessId);
  if (!faqCount && Array.isArray(cfg.faqs)) {
    const rows = cfg.faqs.slice(0, 12).filter((f: any) => f?.question && f?.answer).map((f: any, i: number) => ({
      business_id: businessId,
      question: String(f.question).slice(0, 500),
      answer: String(f.answer).slice(0, 2000),
      sort_order: i,
    }));
    if (rows.length) { await supabase.from('faqs').insert(rows); applied.faqs = rows.length; }
  }

  // 6) Follow-up sequences — replace with the 3 generated, named types
  if (Array.isArray(cfg.follow_up_sequences) && cfg.follow_up_sequences.length) {
    await supabase.from('followup_sequences').delete().eq('business_id', businessId);
    const rows = cfg.follow_up_sequences.slice(0, 3).filter((s: any) => s?.name).map((s: any) => ({
      business_id: businessId,
      name: String(s.name).slice(0, 80),
      steps: Array.isArray(s.steps)
        ? s.steps.slice(0, 5).map((st: any) => ({ after_hours: Number(st.after_hours) || 24, message: String(st.message || '').slice(0, 1000) }))
        : [],
    }));
    if (rows.length) { await supabase.from('followup_sequences').insert(rows); applied.sequences = rows.length; }
  }

  return new Response(JSON.stringify({
    ok: true,
    applied,
    summary: {
      greeting: cfg.greeting || '',
      tone: cfg.tone || '',
      services: applied.services,
      faqs: applied.faqs,
      sequences: applied.sequences,
    },
  }), { status: 200 });
}
