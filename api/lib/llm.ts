import { createClient } from '@supabase/supabase-js';

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

export async function callLLM(
  model: string,
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens = 1024,
): Promise<string> {
  const provider = getProvider(model);
  const apiKey = await getApiKey(provider);

  if (!apiKey) {
    console.error(`[llm] No API key for provider ${provider} (model: ${model})`);
    return '';
  }

  let msgs = messages.length > 0 ? messages : [{ role: 'user' as const, content: '(new conversation)' }];
  if (msgs[0]?.role === 'assistant') {
    msgs = [{ role: 'user' as const, content: '(prior context)' }, ...msgs];
  }

  if (provider === 'anthropic') {
    const res = await fetch(`${getBaseUrl(provider)}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, messages: msgs }),
    });
    if (!res.ok) {
      console.error(`[llm] Anthropic error: ${res.status} ${await res.text()}`);
      return '';
    }
    const data = await res.json() as { content?: Array<{ text?: string }> };
    return data.content?.[0]?.text || '';
  }

  const res = await fetch(`${getBaseUrl(provider)}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: systemPrompt }, ...msgs],
    }),
  });
  if (!res.ok) {
    console.error(`[llm] ${provider} error: ${res.status} ${await res.text()}`);
    return '';
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content || '';
}
