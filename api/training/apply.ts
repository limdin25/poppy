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

  const body = await req.json().catch(() => ({})) as { sections?: { personality?: boolean; services?: boolean; faqs?: boolean; followups?: boolean } };
  const sec = {
    personality: body.sections?.personality ?? true,
    services: body.sections?.services ?? true,
    faqs: body.sections?.faqs ?? true,
    followups: body.sections?.followups ?? true,
  };

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
  "greeting": "A warm opening line Elsie says first (under 160 chars), in the business's voice",
  "tone": "professional | friendly | casual | formal",
  "personality": "2-3 sentences describing how Elsie should speak and behave for this business",
  "rules": ["3-5 specific rules Elsie must always follow for this business"],
  "services": [{"name": "Service name", "description": "short", "price_from": null}],
  "faqs": [{"question": "A real customer question", "answer": "Short answer from the knowledge"}],
  "classification_guidance": "1-2 sentences: how to tell a HOT vs WARM vs COLD lead for this business"
}

Rules:
- 4-6 services and 4-6 FAQs, all grounded in the knowledge (never invent prices — use null if unknown).
- Keep answers short (1-2 sentences). Return ONLY the JSON object, nothing else.`;

  const text = await callLLM(model, systemPrompt, [{ role: 'user', content: userContent }], 2000);
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

  // 1) Business + agent personality + greeting + tone + draft-by-default (only if ticked)
  if (sec.personality) {
    await supabase.from('businesses').update({
      greeting: cfg.greeting || null,
      tone: cfg.tone || 'friendly',
      ai_system_prompt: sysPrompt || null,
    }).eq('id', businessId);
    applied.business = true;

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

    const { data: chans } = await supabase.from('channels').select('id').eq('business_id', businessId);
    if (chans?.length) {
      await supabase.from('channels').update({ auto_reply_enabled: true, draft_mode: true }).eq('business_id', businessId);
      applied.channels = chans.length;
    }
  }

  // 2) Services — replace existing when ticked
  if (sec.services && Array.isArray(cfg.services)) {
    const rows = cfg.services.slice(0, 12).filter((s: any) => s?.name).map((s: any, i: number) => ({
      business_id: businessId,
      name: String(s.name).slice(0, 200),
      description: s.description ? String(s.description).slice(0, 500) : null,
      price_from: typeof s.price_from === 'number' ? s.price_from : null,
      bookable: false,
      sort_order: i,
    }));
    if (rows.length) {
      await supabase.from('services').delete().eq('business_id', businessId);
      await supabase.from('services').insert(rows);
      applied.services = rows.length;
    }
  }

  // 3) FAQs — replace existing when ticked
  if (sec.faqs && Array.isArray(cfg.faqs)) {
    const rows = cfg.faqs.slice(0, 12).filter((f: any) => f?.question && f?.answer).map((f: any, i: number) => ({
      business_id: businessId,
      question: String(f.question).slice(0, 500),
      answer: String(f.answer).slice(0, 2000),
      sort_order: i,
    }));
    if (rows.length) {
      await supabase.from('faqs').delete().eq('business_id', businessId);
      await supabase.from('faqs').insert(rows);
      applied.faqs = rows.length;
    }
  }

  if (!sec.followups) {
    return new Response(JSON.stringify({ ok: true, applied, summary: { greeting: cfg.greeting || '', tone: cfg.tone || '', services: applied.services, faqs: applied.faqs, sequences: 0 } }), { status: 200 });
  }

  // 4) Follow-up sequences — 3 ready-made, named types (fast + reliable; editable later)
  const seqRows = [
    {
      business_id: businessId,
      name: 'Gentle nudge',
      steps: [
        { after_hours: 24, message: 'Hi {name}, just following up — did you still want to go ahead? Happy to help whenever suits you.' },
        { after_hours: 72, message: 'Hi {name}, checking back in case my last message got buried. Any questions I can answer?' },
      ],
    },
    {
      business_id: businessId,
      name: 'Value reminder',
      steps: [
        { after_hours: 48, message: 'Hi {name}, just a reminder we’d love to help — let me know if you’d like to get booked in.' },
        { after_hours: 120, message: 'Hi {name}, still happy to sort this for you whenever you’re ready. Want me to find you a time?' },
      ],
    },
    {
      business_id: businessId,
      name: 'Last chance',
      steps: [
        { after_hours: 72, message: 'Hi {name}, last quick nudge from me — shall I get you booked in, or is now not the right time?' },
      ],
    },
  ];
  await supabase.from('followup_sequences').delete().eq('business_id', businessId);
  await supabase.from('followup_sequences').insert(seqRows);
  applied.sequences = seqRows.length;

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
