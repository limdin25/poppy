import { requireAuth } from '../lib/auth.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

export const config = { runtime: 'edge' };

type RefineType = 'instructions' | 'greeting' | 'rules' | 'followup' | 'training_text';

const TYPE_PROMPTS: Record<RefineType, string> = {
  instructions: 'Rewrite these custom instructions for an AI receptionist. Make them clear, concise, and actionable. Remove redundancy. Keep the same meaning but improve clarity.',
  greeting: 'Rewrite this opening greeting for an AI receptionist. Make it warm and natural. Keep it under 2 sentences. It should feel like a real person answering.',
  rules: 'Rewrite these custom rules for an AI receptionist. Make each rule short, specific, and unambiguous. One clear instruction per rule.',
  followup: 'Rewrite this follow-up message template. Make it feel personal and natural — not salesy or robotic. Keep the {name} placeholder. Keep it under 200 characters for SMS compatibility.',
  training_text: 'Clean up and structure this business information for an AI receptionist to learn from. Organise it clearly, fix grammar, remove irrelevant content, and make facts easy to extract.',
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

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `${typePrompt}\n\n${toneGuide}\n\nOriginal text:\n${body.text}\n\nReturn ONLY the refined text, nothing else. No explanations, no quotes, no markdown.`,
      }],
    }),
  });

  const data = await res.json() as { content?: Array<{ text?: string }> };
  const refined = data.content?.[0]?.text?.trim() || body.text;

  return new Response(JSON.stringify({ refined }), { status: 200 });
}
