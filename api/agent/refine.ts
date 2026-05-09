import { requireAuth } from '../lib/auth.js';
import { callLLM, getModelForAgent } from '../lib/llm.js';

export const config = { runtime: 'edge' };

type RefineType = 'instructions' | 'greeting' | 'rules' | 'followup' | 'training_text';

const TYPE_PROMPTS: Record<RefineType, string> = {
  instructions: 'Rewrite these instructions. Make them clear, concise, and actionable. Remove redundancy. Keep the same meaning and intent exactly. Do not change the purpose or add your own interpretation.',
  greeting: 'Rewrite this opening greeting. Make it natural. Keep it under 2 sentences.',
  rules: 'Rewrite these rules. Make each rule short, specific, and unambiguous. One clear instruction per rule. Do not change their meaning.',
  followup: 'Rewrite this follow-up message template. Make it feel personal and natural. Keep the {name} placeholder. Keep it under 200 characters.',
  training_text: 'Clean up and restructure this text. Fix grammar, improve formatting and readability. You MUST preserve ALL original content, meaning, intent, tone, and style exactly as written. Do not remove, censor, reinterpret, or editorialize any part of it. Just make it cleaner and better organised.',
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json() as {
    text: string;
    type: RefineType;
    tone?: string;
    agentId?: string;
    businessId?: string;
  };

  if (!body.text?.trim()) {
    return new Response(JSON.stringify({ error: 'text is required' }), { status: 400 });
  }

  const toneGuide = body.tone === 'professional'
    ? 'Use a professional, businesslike tone. No emojis, no slang.'
    : body.tone === 'casual'
      ? 'Use a casual, chatty tone. Short sentences. Can use one emoji if natural.'
      : body.tone === 'formal'
        ? 'Use a formal, polished tone. Proper grammar, no contractions.'
        : 'Use a warm, friendly tone. Approachable but not too casual.';

  const typePrompt = TYPE_PROMPTS[body.type] || TYPE_PROMPTS.instructions;
  const toneSection = body.type === 'training_text' ? 'Preserve the original tone and voice exactly.' : toneGuide;
  const systemPrompt = `${typePrompt}\n\n${toneSection}\n\nReturn ONLY the refined text, nothing else. No explanations, no quotes, no markdown, no commentary, no refusals.`;
  const model = await getModelForAgent(body.businessId || '', body.agentId);

  const refined = await callLLM(model, systemPrompt, [
    { role: 'user', content: `Original text:\n${body.text}` },
  ]);

  return new Response(JSON.stringify({ refined: refined.trim() || body.text }), { status: 200 });
}
