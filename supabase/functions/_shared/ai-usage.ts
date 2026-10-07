// Records what one AI call used, so Admin, AI Costs can show what it cost.
//
// Runs unchanged in the Vercel routes (Node) and the Supabase edge functions
// (Deno), so it imports nothing. A writer sends TOKENS, or audio minutes. The
// database prices them from ai_model_prices (see ai_compute_cost), which keeps
// every writer on one price list.
//
// Logging must never break, slow or change the call it describes: it swallows
// every error and gives up after 2.5 seconds. Awaited on purpose, because
// Vercel can freeze a function the moment it answers and drop a loose promise.

export type AiProvider = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'xai' | 'typesafe' | 'assemblyai';

export interface AiUsageInput {
  provider: AiProvider;
  /** The model that actually answered. */
  model: string;
  /** What the call was for, e.g. 'live-coach', 'daily-report', 'houses-call-review'. */
  feature?: string;
  /** All prompt tokens, cached ones included. */
  inputTokens?: number;
  /** Answer tokens plus thinking tokens, which are billed as output. */
  outputTokens?: number;
  /** The part of inputTokens that was served from the provider's cache. */
  cachedInputTokens?: number;
  /** Audio minutes, for speech services. */
  units?: number;
  ok?: boolean;
  /** Set when a different model had to answer instead of the one asked for. */
  requestedModel?: string | null;
  latencyMs?: number;
  businessId?: string | null;
  ref?: string | null;
}

const whole = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

// Anthropic's input_tokens leave out the cache. Add them back so every provider
// reports the same thing: total prompt tokens, and the cached part of them.
export function tokensFromAnthropic(u: any) {
  const read = whole(u?.cache_read_input_tokens);
  return { inputTokens: whole(u?.input_tokens) + read + whole(u?.cache_creation_input_tokens), outputTokens: whole(u?.output_tokens), cachedInputTokens: read };
}

// OpenAI chat completions, OpenRouter and xAI. completion_tokens already holds the reasoning tokens.
export function tokensFromOpenAI(u: any) {
  return { inputTokens: whole(u?.prompt_tokens), outputTokens: whole(u?.completion_tokens), cachedInputTokens: whole(u?.prompt_tokens_details?.cached_tokens) };
}

// Gemini bills thinking tokens as output, and reports them apart from the answer.
export function tokensFromGemini(m: any) {
  return { inputTokens: whole(m?.promptTokenCount), outputTokens: whole(m?.candidatesTokenCount) + whole(m?.thoughtsTokenCount), cachedInputTokens: whole(m?.cachedContentTokenCount) };
}

export function usageRow(u: AiUsageInput) {
  return {
    provider: u.provider,
    model: u.model,
    feature: u.feature || 'unlabelled',
    input_tokens: whole(u.inputTokens),
    output_tokens: whole(u.outputTokens),
    cached_input_tokens: Math.min(whole(u.cachedInputTokens), whole(u.inputTokens)),
    units: typeof u.units === 'number' && Number.isFinite(u.units) && u.units > 0 ? Math.round(u.units * 10000) / 10000 : 0,
    ok: u.ok !== false,
    requested_model: u.requestedModel || null,
    latency_ms: typeof u.latencyMs === 'number' && Number.isFinite(u.latencyMs) ? Math.round(u.latencyMs) : null,
    business_id: u.businessId || null,
    ref: u.ref ? String(u.ref).slice(0, 120) : null,
  };
}

/** `db` is a Supabase client that holds the service key. Never throws. */
export async function logAiUsage(db: any, u: AiUsageInput): Promise<void> {
  try {
    const write = Promise.resolve(db.from('ai_usage_log').insert(usageRow(u))).then((r: any) => {
      if (r?.error) console.warn('[ai-usage] not saved:', String(r.error.message || r.error.code || '').slice(0, 120));
    });
    await Promise.race([write, new Promise((resolve) => setTimeout(resolve, 2500))]);
  } catch (e) {
    console.warn('[ai-usage] not saved:', e instanceof Error ? e.message.slice(0, 120) : 'unknown');
  }
}
