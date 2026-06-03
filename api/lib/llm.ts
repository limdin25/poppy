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

const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Fix known-bad / legacy model ids so the API doesn't reject them. */
function normalizeModel(model: string): string {
  if (!model) return DEFAULT_MODEL;
  // Common typo: "claude-4.6-sonnet" → "claude-sonnet-4-6"
  if (/^claude-\d/.test(model)) return DEFAULT_MODEL;
  return model;
}

export async function callLLM(
  model: string,
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens = 1024,
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

  let msgs = messages.length > 0 ? messages : [{ role: 'user' as const, content: '(new conversation)' }];
  if (msgs[0]?.role === 'assistant') {
    msgs = [{ role: 'user' as const, content: '(prior context)' }, ...msgs];
  }

  if (provider === 'anthropic') {
    const callAnthropic = (m: string) => fetch(`${getBaseUrl('anthropic')}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: m, max_tokens: maxTokens, system: systemPrompt, messages: msgs }),
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
      model: resolvedModel,
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
