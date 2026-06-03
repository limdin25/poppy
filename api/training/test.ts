import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { callLLM, getModelForAgent } from '../lib/llm.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

function stripMarkdown(t: string): string {
  return t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/^[-*]\s+/gm, '- ');
}

/** Test Elsie: send a question, get the real AI answer built from the business's
 * knowledge sources + services + FAQs. Used by the Knowledge Base "Test" box. */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  const { question } = await req.json() as { question?: string };
  if (!question || !question.trim()) {
    return new Response(JSON.stringify({ error: 'Type a question to test.' }), { status: 400 });
  }

  const [bizRes, svcRes, faqRes, ksRes] = await Promise.all([
    supabase.from('businesses').select('name, industry, address, phone, website, tone, greeting, ai_system_prompt').eq('id', businessId).single(),
    supabase.from('services').select('name, description, price_from, price_to, bookable').eq('business_id', businessId),
    supabase.from('faqs').select('question, answer').eq('business_id', businessId),
    supabase.from('knowledge_sources').select('summary, content').eq('business_id', businessId).eq('status', 'synced'),
  ]);

  const biz = bizRes.data;
  if (!biz) return new Response(JSON.stringify({ error: 'Business not found' }), { status: 404 });

  let prompt = biz.ai_system_prompt || `You are Elsie, the AI receptionist for ${biz.name || 'this business'}.`;
  if (biz.industry) prompt += ` Industry: ${biz.industry}.`;
  if (biz.address) prompt += ` Location: ${biz.address}.`;
  if (biz.phone) prompt += ` Phone: ${biz.phone}.`;
  if (biz.tone) prompt += ` Tone: ${biz.tone}.`;

  const ks = ksRes.data || [];
  if (ks.length) {
    prompt += '\n\nKnowledge base:\n';
    ks.forEach((k: any) => { if (k.summary) prompt += `${k.summary}\n`; else if (k.content) prompt += `${(k.content as string).slice(0, 3000)}\n`; });
  }
  const svc = svcRes.data || [];
  if (svc.length) {
    prompt += '\n\nServices:\n';
    svc.forEach((s: any) => { prompt += `- ${s.name}${s.description ? `: ${s.description}` : ''}${s.price_from != null ? ` (from £${s.price_from})` : ''}\n`; });
  }
  const faqs = faqRes.data || [];
  if (faqs.length) {
    prompt += '\n\nFAQs:\n';
    faqs.forEach((f: any) => { prompt += `Q: ${f.question}\nA: ${f.answer}\n\n`; });
  }
  prompt += '\n\nAnswer the customer using ONLY the information above. If you do not know, say you will check and get back to them. Plain text only, no markdown. Keep it short and natural.';

  const model = await getModelForAgent(businessId, null);
  const answer = stripMarkdown(await callLLM(model, prompt, [{ role: 'user', content: question.slice(0, 1000) }], 600));

  if (!answer) {
    return new Response(JSON.stringify({ error: 'Elsie could not answer — check your AI key / knowledge and try again.' }), { status: 502 });
  }
  return new Response(JSON.stringify({ ok: true, answer }), { status: 200 });
}
