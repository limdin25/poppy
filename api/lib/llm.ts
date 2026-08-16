import { createClient } from '@supabase/supabase-js';
import { firstText } from './anthropic-content.js';

export { firstText };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type Provider = 'anthropic' | 'openai' | 'xai';

function getProvider(model: string): Provider {
  if (model.startsWith('claude')) return 'anthropic';
  if (model.startsWith('grok')) return 'xai';
  return 'openai';
}

const keyCache: Record<string, { value: string; ts: number }> = {};
const CACHE_TTL = 5 * 60 * 1000;

async function getApiKey(provider: Provider): Promise<string> {
  const envMap: Record<Provider, { env: string; db: string }> = {
    anthropic: { env: 'ANTHROPIC_API_KEY', db: 'anthropic_api_key' },
    openai: { env: 'OPENAI_API_KEY', db: 'openai_api_key' },
    xai: { env: 'XAI_API_KEY', db: 'grok_api_key' },
  };
  const { env, db } = envMap[provider];

  if (process.env[env]) return process.env[env]!;

  const cached = keyCache[db];
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.value;

  const { data } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', db)
    .single();
  const val = data?.value || '';
  keyCache[db] = { value: val, ts: Date.now() };
  return val;
}

function getBaseUrl(provider: Provider): string {
  if (provider === 'anthropic') return 'https://api.anthropic.com';
  if (provider === 'xai') return 'https://api.x.ai';
  return 'https://api.openai.com';
}

export async function getModelForAgent(businessId: string, agentId?: string | null): Promise<string> {
  if (agentId) {
    const { data } = await supabase
      .from('agents')
      .select('ai_model')
      .eq('id', agentId)
      .single();
    if (data?.ai_model) return data.ai_model;
  }
  const { data } = await supabase
    .from('businesses')
    .select('ai_model')
    .eq('id', businessId)
    .single();
  if (data?.ai_model) return data.ai_model;
  const { data: setting } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'ai_model')
    .single();
  return setting?.value || 'claude-sonnet-4-6';
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Fix known-bad / legacy model ids so the API doesn't reject them. */
function normalizeModel(model: string): string {
  if (!model) return DEFAULT_MODEL;
  // Common typo: "claude-4.6-sonnet" → "claude-sonnet-4-6"
  if (/^claude-\d/.test(model)) return DEFAULT_MODEL;
  return model;
}

/**
 * One turn's content. A plain string is the common case; the block form exists
 * so a lead's photo can be shown to the model.
 *
 * Only Anthropic is sent blocks. The OpenAI/xAI branch below flattens them to
 * text, because those two take a different image shape and nothing in this
 * codebase sends them pictures. Flattening loses the image but never breaks the
 * call, which is the right trade for a fallback provider.
 */
export type LLMBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string | LLMBlock[];
}

function flattenToText(content: string | LLMBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((b) => (b.type === 'text' ? b.text : '[image]'))
    .join('\n')
    .trim();
}

export async function callLLM(
  model: string,
  systemPrompt: string,
  messages: LLMMessage[],
  maxTokens = 1024,
  /** Anthropic only. claude-sonnet-5 THINKS before it answers, thinking and
   *  answer share max_tokens, and unbounded thinking is how the deal brain
   *  went silent six times in seven and how fetch-ballpark blew the 25 second
   *  edge ceiling into a 504. `thinkingBudget` caps the thinking portion
   *  (must be under maxTokens, so the answer always has room). Omit to keep a
   *  caller's existing behaviour byte for byte. */
  opts?: { thinkingBudget?: number },
): Promise<string> {
  let resolvedModel = normalizeModel(model);
  let provider = getProvider(resolvedModel);
  let apiKey = await getApiKey(provider);

  // No key for the chosen provider (e.g. a grok model with no xAI key) →
  // fall back to the default Claude model if we have an Anthropic key.
  if (!apiKey && provider !== 'anthropic') {
    const anth = await getApiKey('anthropic');
    if (anth) { provider = 'anthropic'; resolvedModel = DEFAULT_MODEL; apiKey = anth; }
  }

  if (!apiKey) {
    console.error(`[llm] No API key for provider ${provider} (model: ${resolvedModel})`);
    return '';
  }

  let msgs: LLMMessage[] = messages.length > 0
    ? messages
    : [{ role: 'user' as const, content: '(new conversation)' }];
  if (msgs[0]?.role === 'assistant') {
    msgs = [{ role: 'user' as const, content: '(prior context)' }, ...msgs];
  }

  if (provider === 'anthropic') {
    const thinking = opts?.thinkingBudget && opts.thinkingBudget < maxTokens
      ? { thinking: { type: 'enabled', budget_tokens: Math.max(1024, opts.thinkingBudget) } }
      : {};
    const callAnthropic = (m: string) => fetch(`${getBaseUrl('anthropic')}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: m, max_tokens: maxTokens, system: systemPrompt, messages: msgs, ...thinking }),
    });
    let res = await callAnthropic(resolvedModel);
    if (!res.ok && resolvedModel !== DEFAULT_MODEL) {
      console.error(`[llm] Anthropic rejected "${resolvedModel}" (${res.status}); retrying with ${DEFAULT_MODEL}`);
      res = await callAnthropic(DEFAULT_MODEL);
    }
    if (!res.ok) {
      console.error(`[llm] Anthropic error: ${res.status} ${await res.text()}`);
      return '';
    }
    const data = await res.json() as { content?: Array<{ type?: string; text?: string }> };
    return firstText(data.content);
  }

  const res = await fetch(`${getBaseUrl(provider)}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: resolvedModel,
      max_tokens: maxTokens,
      // Flattened: this branch is the fallback provider and takes a different
      // image shape. See the LLMBlock comment above.
      messages: [
        { role: 'system', content: systemPrompt },
        ...msgs.map((m) => ({ role: m.role, content: flattenToText(m.content) })),
      ],
    }),
  });
  if (!res.ok) {
    console.error(`[llm] ${provider} error: ${res.status} ${await res.text()}`);
    return '';
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content || '';
}
