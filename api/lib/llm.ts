import { createClient } from '@supabase/supabase-js';
import { firstText } from './anthropic-content.js';
import {
  logAiUsage, tokensFromAnthropic, tokensFromGemini, tokensFromOpenAI, type AiProvider,
} from '../../supabase/functions/_shared/ai-usage.js';

export { firstText };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type Provider = 'anthropic' | 'openai' | 'xai' | 'openrouter' | 'gemini';

// The name each provider goes by in Admin, AI Costs.
const COST_PROVIDER: Record<Provider, AiProvider> = {
  anthropic: 'anthropic', openai: 'openai', xai: 'xai', openrouter: 'openrouter', gemini: 'google',
};

function getProvider(model: string): Provider {
  if (model.startsWith('claude')) return 'anthropic';
  if (model.startsWith('grok')) return 'xai';
  // Straight to Google, no middleman. "google/gemini-..." goes through
  // OpenRouter instead, the slash rule below.
  if (model.startsWith('gemini')) return 'gemini';
  // OpenRouter ids are namespaced ("deepseek/deepseek-v4-pro-0813",
  // "qwen/qwen3.8-max"): the slash is the tell. Added 19 Aug when Hugo moved
  // the deal brain off Sonnet: "get DeepSeek or Qwen through OpenRouter."
  if (model.includes('/')) return 'openrouter';
  return 'openai';
}

const keyCache: Record<string, { value: string; ts: number }> = {};
const CACHE_TTL = 5 * 60 * 1000;

async function getApiKey(provider: Provider): Promise<string> {
  const envMap: Record<Provider, { env: string; db: string }> = {
    anthropic: { env: 'ANTHROPIC_API_KEY', db: 'anthropic_api_key' },
    openai: { env: 'OPENAI_API_KEY', db: 'openai_api_key' },
    xai: { env: 'XAI_API_KEY', db: 'grok_api_key' },
    openrouter: { env: 'OPENROUTER_API_KEY', db: 'openrouter_api_key' },
    gemini: { env: 'GEMINI_API_KEY', db: 'gemini_api_key' },
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
  // The live CRM coach predates platform_settings and keeps its OpenAI key here.
  const { data: coachKey } = provider === 'openai' && !data?.value
    ? await supabase.from('wk_ai_settings').select('openai_api_key').limit(1).maybeSingle()
    : { data: null };
  const val = data?.value || coachKey?.openai_api_key || '';
  keyCache[db] = { value: val, ts: Date.now() };
  return val;
}

function getBaseUrl(provider: Provider): string {
  if (provider === 'anthropic') return 'https://api.anthropic.com';
  if (provider === 'xai') return 'https://api.x.ai';
  if (provider === 'openrouter') return 'https://openrouter.ai/api';
  if (provider === 'gemini') return 'https://generativelanguage.googleapis.com';
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

/** Fix known-bad / legacy model ids so the API doesn't reject them.
 *
 *  The claude ids come from FREE-TEXT settings fields (per-agent, per-business,
 *  per-campaign, platform-wide), so a typo must degrade to the default, never
 *  reach the API as a mystery string. */
function normalizeModel(model: string): string {
  if (!model) return DEFAULT_MODEL;
  // Common typo: "claude-4.6-sonnet" → "claude-sonnet-4-6"
  if (/^claude-\d/.test(model)) return DEFAULT_MODEL;
  if (model.startsWith('claude') && !/^claude-(haiku|sonnet|opus|fable)-\d/.test(model)) {
    return DEFAULT_MODEL;
  }
  return model;
}

/** Models that THINK before answering by default, with thinking and answer
 *  sharing one token pot. Left unbounded this is the repo's worst production
 *  failure class, found three separate times on 2026-08-16: the deal brain
 *  went silent six times in seven, "Fetch the ballpark" 504'd in Hugo's
 *  hands, and an audit found three more interactive routes carrying the same
 *  bomb (one with a 300-token pot that thinking alone can eat). */
const THINKS_BY_DEFAULT = /^claude-(haiku|sonnet|opus|fable)-([5-9]|\d{2,})/;

/** The class-wide immunity: when the model thinks by default and the caller
 *  set no explicit budget, the pot is GROWN by a fixed thinking allowance and
 *  thinking is capped to that allowance, so the answer always keeps every
 *  token the caller asked for. Callers that pass opts.thinkingBudget keep
 *  their exact semantics. */
const AUTO_THINKING_ALLOWANCE = 1536;

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
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  // The URL form, added 2026-08-25 for the refurb estimator. Anthropic fetches
  // the picture itself, so a route showing twenty listing photographs does not
  // have to download and base64 twenty JPEGs inside a serverless function
  // first. Verified against the live API the same day. PUBLIC URLs ONLY: the
  // fetch happens from Anthropic and carries none of our credentials, so a
  // signed or private URL simply fails.
  | { type: 'image'; source: { type: 'url'; url: string } };

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

// ---- Gemini, straight to Google ------------------------------------------
//
// Google refuses the whole account when its prepaid credit runs out (HTTP 402)
// or the key is bad. Stop asking for a while rather than fail every call first.
let geminiBlockedUntil = 0;
const GEMINI_BLOCK_MS: Record<number, number> = { 401: 600_000, 402: 600_000, 403: 600_000, 429: 60_000 };

/** Gemini THINKS before it answers and thinking shares maxOutputTokens with the
 *  answer. A low ceiling comes back as an EMPTY reply that looks like a model
 *  that could not do the task (the VPS floor-plan reader lost plans to exactly
 *  this). So the ceiling is always maxTokens PLUS the thinking allowance, and
 *  the allowance is capped. 512 is what the VPS property reader runs on. */
const GEMINI_DEFAULT_THINKING = 512;
const MAX_INLINE_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_INLINE_TOTAL_BYTES = 18 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Gemini does not fetch a picture's link itself, so download it here. */
async function geminiImagePart(url: string, room: { left: number }): Promise<Record<string, unknown>> {
  try {
    if (!/^https:\/\//i.test(url)) return { text: '[image skipped: not an https link]' };
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!res.ok || !type.startsWith('image/')) return { text: '[image unavailable]' };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_INLINE_IMAGE_BYTES || bytes.length > room.left) return { text: '[image too large to include]' };
    room.left -= bytes.length;
    return { inline_data: { mime_type: type, data: toBase64(bytes) } };
  } catch {
    return { text: '[image unavailable]' };
  }
}

async function geminiParts(content: string | LLMBlock[], room: { left: number }): Promise<Array<Record<string, unknown>>> {
  if (typeof content === 'string') return [{ text: content }];
  return Promise.all(content.map(async (b) => {
    if (b.type === 'text') return { text: b.text };
    if (b.source.type === 'base64') return { inline_data: { mime_type: b.source.media_type, data: b.source.data } };
    return geminiImagePart(b.source.url, room);
  }));
}

interface GeminiReply { text: string; usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number }; status: number }

async function callGemini(
  apiKey: string, model: string, systemPrompt: string, msgs: LLMMessage[], maxTokens: number, opts?: LLMOptions,
): Promise<GeminiReply> {
  const room = { left: MAX_INLINE_TOTAL_BYTES };
  const contents = await Promise.all(msgs.map(async (m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: await geminiParts(m.content, room),
  })));
  const thinking = Math.max(0, Math.min(opts?.thinkingBudget ?? GEMINI_DEFAULT_THINKING, 16_000));
  const body = (withThinking: boolean) => JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens + (withThinking ? thinking : GEMINI_DEFAULT_THINKING),
      ...(withThinking ? { thinkingConfig: { thinkingBudget: thinking } } : {}),
      ...(opts?.jsonOutput ? { responseMimeType: 'application/json' } : {}),
    },
  });
  const post = (withThinking: boolean) => fetch(`${getBaseUrl('gemini')}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 55_000),
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: body(withThinking),
  });
  const failed = (status: number): GeminiReply => ({ text: '', usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, status });
  try {
    let res = await post(true);
    if (res.status === 400) {
      // A model that does not take a thinking budget answers 400 and says so. Ask again without one.
      const detail = await res.text();
      if (!/thinking/i.test(detail)) { console.error(`[llm] gemini error: 400 ${detail.slice(0, 200)}`); return failed(400); }
      res = await post(false);
    }
    if (!res.ok) {
      console.error(`[llm] gemini error: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return failed(res.status);
    }
    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
      usageMetadata?: Record<string, number>;
      promptFeedback?: { blockReason?: string };
    };
    const text = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim();
    if (!text) console.warn(`[llm] gemini returned no text (finish: ${data.candidates?.[0]?.finishReason ?? 'none'}, blocked: ${data.promptFeedback?.blockReason ?? 'no'})`);
    return { text, usage: tokensFromGemini(data.usageMetadata), status: 200 };
  } catch (e) {
    console.error('[llm] gemini request failed:', e instanceof Error ? e.message : e);
    return failed(0);
  }
}

export interface LLMOptions {
  /** Anthropic: caps the THINKING part of max_tokens (must be under maxTokens).
   *  Gemini: the thinking ALLOWANCE, added on top of maxTokens. */
  thinkingBudget?: number;
  allowProviderFallback?: boolean;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  jsonOutput?: boolean;
  timeoutMs?: number;
  /** What this call is for. Shown in Admin, AI Costs, so give every caller one. */
  feature?: string;
  /** A CLAUDE model to use when the chosen provider has no key, is out of
   *  credit or answers nothing. Defaults to claude-sonnet-4-6. Callers that used
   *  to run on a different Claude name it here, so a Gemini outage costs what
   *  the call cost before and nothing more. */
  fallbackModel?: string;
  /** Internal: the model first asked for, carried through a fallback. */
  requestedModel?: string;
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
  opts?: LLMOptions,
): Promise<string> {
  let resolvedModel = normalizeModel(model);
  let provider = getProvider(resolvedModel);
  const feature = opts?.feature;
  const fallbackTo = normalizeModel(opts?.fallbackModel || DEFAULT_MODEL);
  // The model that was ASKED for, when another one ends up answering.
  let askedFor = opts?.requestedModel;
  const started = Date.now();
  const record = (p: Provider, usedModel: string, usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number }, ok: boolean) =>
    logAiUsage(supabase, {
      provider: COST_PROVIDER[p], model: usedModel, feature, ...usage, ok,
      requestedModel: askedFor && askedFor !== usedModel ? askedFor : null, latencyMs: Date.now() - started,
    });
  const noUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

  let apiKey = provider === 'gemini' && Date.now() < geminiBlockedUntil ? '' : await getApiKey(provider);

  // No key for the chosen provider (e.g. a grok model with no xAI key) →
  // fall back to a Claude model if we have an Anthropic key.
  if (!apiKey && provider !== 'anthropic' && opts?.allowProviderFallback !== false) {
    const anth = await getApiKey('anthropic');
    if (anth) { askedFor = askedFor ?? resolvedModel; provider = 'anthropic'; resolvedModel = fallbackTo; apiKey = anth; }
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

  if (provider === 'gemini') {
    const g = await callGemini(apiKey, resolvedModel, systemPrompt, msgs, maxTokens, opts);
    await record('gemini', resolvedModel, g.usage, g.text.length > 0);
    if (g.text) return g.text;
    if (GEMINI_BLOCK_MS[g.status]) geminiBlockedUntil = Date.now() + GEMINI_BLOCK_MS[g.status];
    // Never hand the caller a blank. A Claude model answers instead, and the
    // log shows which model was asked for and which one answered.
    if (opts?.allowProviderFallback !== false && await getApiKey('anthropic')) {
      console.warn(`[llm] ${resolvedModel} gave nothing (HTTP ${g.status}); falling back to ${fallbackTo}`);
      return callLLM(fallbackTo, systemPrompt, messages, maxTokens, { ...opts, thinkingBudget: undefined, requestedModel: askedFor ?? resolvedModel });
    }
    return '';
  }

  if (provider === 'anthropic') {
    let potTokens = maxTokens;
    let budget = opts?.thinkingBudget && opts.thinkingBudget < maxTokens
      ? Math.max(1024, opts.thinkingBudget)
      : null;
    if (budget === null && THINKS_BY_DEFAULT.test(resolvedModel)) {
      // The caller sized maxTokens for the ANSWER, before thinking models
      // existed. Grow the pot by the allowance and cap thinking to it, so the
      // answer keeps every token the caller asked for. Output tokens are
      // billed as produced, so an unused allowance costs nothing.
      budget = AUTO_THINKING_ALLOWANCE;
      potTokens = maxTokens + AUTO_THINKING_ALLOWANCE;
    }
    const thinking = budget !== null
      ? { thinking: { type: 'enabled', budget_tokens: budget } }
      : {};
    const callAnthropic = (m: string) => fetch(`${getBaseUrl('anthropic')}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: m, max_tokens: potTokens, system: systemPrompt, messages: msgs, ...thinking }),
    });
    let usedModel = resolvedModel;
    let res = await callAnthropic(resolvedModel);
    if (!res.ok && resolvedModel !== DEFAULT_MODEL) {
      console.error(`[llm] Anthropic rejected "${resolvedModel}" (${res.status}); retrying with ${DEFAULT_MODEL}`);
      askedFor = askedFor ?? resolvedModel;
      usedModel = DEFAULT_MODEL;
      res = await callAnthropic(DEFAULT_MODEL);
    }
    if (!res.ok) {
      console.error(`[llm] Anthropic error: ${res.status} ${await res.text()}`);
      await record('anthropic', usedModel, noUsage, false);
      return '';
    }
    const data = await res.json() as { content?: Array<{ type?: string; text?: string }>; usage?: Record<string, number> };
    const answer = firstText(data.content);
    await record('anthropic', usedModel, tokensFromAnthropic(data.usage), answer.length > 0);
    return answer;
  }

  const callChat = (extra: Record<string, unknown>) =>
    fetch(`${getBaseUrl(provider)}/v1/chat/completions`, {
      method: 'POST',
      ...(opts?.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: resolvedModel,
        // OpenRouter hosts hybrid reasoners (DeepSeek v4, Qwen 3.x) whose
        // thinking shares the pot with the answer, same failure class as the
        // Anthropic branch above. Headroom keeps the answer alive; the VPS
        // learnt this on qwen3.7 the hard way (empty answers that look like
        // blindness).
        ...(provider === 'openai' && /^gpt-5/.test(resolvedModel)
          ? { max_completion_tokens: maxTokens, ...(opts?.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}) }
          : { max_tokens: provider === 'openrouter' ? maxTokens + 4096 : maxTokens }),
        ...(opts?.jsonOutput && provider === 'openai' ? { response_format: { type: 'json_object' } } : {}),
        // Reasoning OFF by default: measured 19 Aug on the brain-sized
        // prompt, DeepSeek v4 pro takes 32s thinking and 4.7s not, and the
        // edge routes have a ~25s ceiling. The deterministic contract around
        // the brain is the safety, not the model's soliloquy.
        ...(provider === 'openrouter' ? { reasoning: { enabled: false } } : {}),
        // Flattened: this branch is the fallback provider and takes a
        // different image shape. See the LLMBlock comment above.
        messages: [
          { role: 'system', content: systemPrompt },
          ...msgs.map((m) => ({ role: m.role, content: flattenToText(m.content) })),
        ],
        ...extra,
      }),
    });
  const res = await callChat({});
  if (!res.ok) {
    console.error(`[llm] ${provider} error: ${res.status} ${await res.text()}`);
    await record(provider, resolvedModel, noUsage, false);
    return '';
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: Record<string, unknown> };
  const text = data.choices?.[0]?.message?.content || '';
  await record(provider, resolvedModel, tokensFromOpenAI(data.usage), text.trim().length > 0);
  // OpenRouter out of credit (402) or otherwise silent = fall back to the
  // default Claude model rather than a blank verdict. Found live 19 Aug: the
  // account's five dollars were already spent, so the brain would have gone
  // quiet the moment it switched. With this, DeepSeek serves whenever the
  // account is funded and Sonnet covers every gap, no redeploy either way.
  if (!text.trim() && provider === 'openrouter') {
    const anth = await getApiKey('anthropic');
    if (anth) {
      console.warn(`[llm] ${resolvedModel} unavailable; falling back to ${fallbackTo}`);
      return callLLM(fallbackTo, systemPrompt, messages, maxTokens, { ...opts, requestedModel: askedFor ?? resolvedModel });
    }
  }
  return text;
}
