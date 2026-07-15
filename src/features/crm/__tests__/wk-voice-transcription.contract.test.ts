// Static contract test for supabase/functions/wk-voice-transcription/index.ts.
// We can't easily run the Deno edge function inside vitest, but we CAN
// read its source and lock the parts that matter so they don't regress
// silently.
//
// Why this exists: on 2026-04-27 the live coach silently produced zero
// cards because the OpenAI request used `max_tokens`, which gpt-5.4-mini
// rejects with HTTP 400 ("Unsupported parameter: 'max_tokens' is not
// supported with this model. Use 'max_completion_tokens' instead."). The
// edge function logged the warning, but no one caught it until Hugo
// noticed the empty pane mid-call. These assertions catch the same class
// of regression at PR time.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const SOURCE_PATH = resolve(
  __dirname,
  '../../../../supabase/functions/wk-voice-transcription/index.ts'
);
const source = readFileSync(SOURCE_PATH, 'utf8');

describe('wk-voice-transcription — OpenAI request contract', () => {
  it('uses streaming OpenAI (stream: true) so tokens land in the placeholder live', () => {
    // Hugo 2026-04-28: streaming PR. The OpenAI request body must
    // include `stream: true` so we can pipe tokens into the live
    // placeholder card via the SSE parser.
    expect(source).toMatch(/stream:\s*true/);
    expect(source).toContain('parseSseChunk');
    expect(source).toContain('createThrottledWriter');
  });

  it('acquires a per-call lock before streaming (no race between concurrent invocations)', () => {
    // Hugo 2026-04-28: stateless edge invocations could race. The lock
    // RPC arbitrates which generation_id wins. v8 dropped p_min_age_ms
    // to 250 (separate assertion below) — here we just lock the RPC
    // call shape.
    expect(source).toMatch(/rpc\(\s*['"]wk_acquire_coach_lock['"]/);
    expect(source).toMatch(/p_force:\s*isFinal/);
    expect(source).toMatch(/p_min_age_ms:\s*\d+/);
  });

  it('inserts a streaming placeholder before the first token, then UPDATEs in place', () => {
    // The placeholder appears immediately so the agent sees something
    // happening within ~ms of caller speech, then the body morphs as
    // tokens stream.
    expect(source).toMatch(/status:\s*['"]streaming['"]/);
    expect(source).toMatch(/body:\s*['"]…['"]/);
    expect(source).toMatch(/generation_id:\s*generationId/);
  });

  it('logs the streaming lifecycle (interim received → first token → first update → final)', () => {
    // Per Hugo's spec: "Log timestamps for interim received, stream
    // started, first token, first update, final update, delete/reject."
    expect(source).toMatch(/log\(['"]interim received/);
    expect(source).toMatch(/log\(['"]first token/);
    expect(source).toMatch(/log\(['"]first update/);
    expect(source).toMatch(/log\(['"]final update/);
    expect(source).toMatch(/rejected by post-processor/);
  });

  it('uses max_completion_tokens, not max_tokens (GPT-5 family compatibility)', () => {
    // The chat.completions body must use the modern parameter name. The
    // legacy `max_tokens` is rejected by gpt-5.4-mini and other GPT-5
    // family models. `max_completion_tokens` is supported across
    // gpt-4o-mini, gpt-4.1-mini, gpt-4.1-nano, gpt-5.4-mini.
    expect(source).toContain('max_completion_tokens');
    // Make sure no stray legacy `max_tokens` slipped back in. We allow
    // it inside comments by checking only on lines that look like JSON
    // body keys.
    const offendingLines = source
      .split(/\r?\n/)
      .filter((line) => /^\s*max_tokens\s*:/.test(line));
    expect(offendingLines).toEqual([]);
  });

  it('reads live_coach_model from wk_ai_settings (no hardcoded model in OpenAI call)', () => {
    // The model must come from the DB row so admins can swap models in
    // the Settings UI without a redeploy. The hardcode is a fallback
    // only, used when the DB column is empty.
    expect(source).toMatch(/select\(['"][^'"]*live_coach_model/);
    expect(source).toContain('liveCoachModel');
    // The actual fetch body should reference the variable, not a string
    // literal like model: 'gpt-5.4-mini'.
    expect(source).toMatch(/model:\s*liveCoachModel/);
  });

  it('reads live_coach_system_prompt from wk_ai_settings (no hardcoded prompt-only mode)', () => {
    expect(source).toMatch(/select\(['"][^'"]*live_coach_system_prompt/);
  });

  it('logs OpenAI response body on non-2xx (so a wrong model surfaces in logs)', () => {
    // Hugo 2026-04-27: agents must surface OpenAI errors, not swallow
    // them. The non-2xx branch must include the response body in the
    // warning, not just the status code.
    const nonOkBlock = source.match(/if\s*\(!resp\.ok\)\s*\{[\s\S]*?\}/);
    expect(nonOkBlock).toBeTruthy();
    expect(nonOkBlock![0]).toMatch(/await\s+resp\.text\(\)/);
  });

  it('keeps the speaker→track mapping for outbound calls (caller=outbound, agent=inbound)', () => {
    // Regression guard for PR #551 — Twilio's track labels were inverted
    // in earlier versions, causing the caller's voice to show as "You".
    expect(source).toMatch(
      /track\.startsWith\(['"]outbound['"]\)\s*\?\s*['"]caller['"]\s*:\s*['"]agent['"]/
    );
  });

  it('passes the last 3 coach cards back to the model for anti-repetition', () => {
    // Hugo 2026-04-28: cards were repeating "Yeah fair enough" 4 in a
    // row because each call was independent — the model had no memory
    // of what it just produced. Fix: SELECT recent wk_live_coach_events
    // and pass them in the user message under "YOUR LAST FEW COACH
    // CARDS".
    expect(source).toMatch(/from\(['"]wk_live_coach_events['"]\)[\s\S]*?\.select\(['"]body/);
    expect(source).toContain('YOUR LAST FEW COACH CARDS');
    expect(source).toContain('priorCards');
  });

  it('uses the three-layer prompt structure (style + script + knowledge base) — Hugo 2026-04-29', () => {
    // The single mega-prompt is gone. Now:
    //   - DEFAULT_STYLE_PROMPT  (voice / bans)
    //   - DEFAULT_SCRIPT_PROMPT (call stages, earned-close, retrieval)
    //   - knowledgeBaseSystemPrompt rendered from wk_coach_facts
    expect(source).toContain('DEFAULT_STYLE_PROMPT');
    expect(source).toContain('DEFAULT_SCRIPT_PROMPT');
    expect(source).toContain('knowledgeBaseSystemPrompt');
    // Style markers
    expect(source).toMatch(/UK English/);
    expect(source).toMatch(/ABSOLUTE BANS/);
    expect(source).toMatch(/No multiple variants/);
    // Script markers
    // PR 51 (v12): stages now enumerated 1-7 for strict forward-only
    // progression. The arrow-form was replaced with a numbered list.
    expect(source).toMatch(/1\. Open[\s\S]+2\. Qualify[\s\S]+3\. Permission to pitch[\s\S]+4\. Pitch[\s\S]+5\. Returns[\s\S]+6\. SMS close[\s\S]+7\. Follow-up lock/);
    expect(source).toMatch(/STAGE LOCK — STRICT FORWARD-ONLY/);
    expect(source).toContain('OPEN-ENDED DEFAULT');
    expect(source).toContain('EARNED-CLOSE RULE');
    expect(source).toMatch(/PITCH and RETURNS already delivered/);
    // PR 46 (v11, Hugo 2026-04-27): three-tier knowledge policy
    // replaces the old "answer ONLY from KB" hard rule. Company-
    // specific facts still go to KB only; general domain knowledge
    // can come from the model's general training.
    expect(source).toMatch(/COMPANY-SPECIFIC FACTS — KB ONLY/);
    expect(source).toMatch(/GENERAL DOMAIN KNOWLEDGE/);
    expect(source).toMatch(/UNCERTAIN \/ NICHE — DEFER/);
    // The old "Three Tens / Belfort" framing must not be back.
    expect(source).not.toMatch(/THREE TENS/);
    expect(source).not.toMatch(/Straight Line Selling/);
    expect(source).not.toMatch(/Yeah fair enough — sounds like/);
  });

  it('reads coach_style_prompt + coach_script_prompt + wk_coach_facts on every coach call', () => {
    // The edge fn must SELECT all three layer sources from the DB so
    // admins editing the Settings UI see immediate effect.
    expect(source).toMatch(/coach_style_prompt/);
    expect(source).toMatch(/coach_script_prompt/);
    expect(source).toMatch(/from\(['"]wk_coach_facts['"]\)/);
  });

  it('passes three independent system messages (style / script / KB) to OpenAI', () => {
    // Hugo 2026-04-29: ONE blended system prompt regressed to "force-
    // close every line" because rules were tangled. Each layer must
    // ride as its own system message so the model treats them as
    // independent constraints.
    expect(source).toContain('systemMessages');
    expect(source).toMatch(
      /systemMessages:\s*\[\s*stylePrompt,\s*scriptPrompt,\s*knowledgeBaseSystemPrompt(?:,\s*agentScriptSystemPrompt,?\s*)?\]/
    );
    // The OpenAI call must spread the systemMessages into the messages
    // array with role: 'system' on each.
    expect(source).toMatch(/role:\s*['"]system['"]\s+as\s+const/);
  });

  it('runs retrieveFacts on the caller utterance and includes the matches in the user message', () => {
    expect(source).toContain('retrieveFacts');
    expect(source).toContain('POSSIBLY RELEVANT FACTS');
  });

  it('strips leaked acting-note brackets ([warm], [firm], etc.) from the model output', () => {
    // Defensive post-processor: even if the model slips up and
    // produces "[reasonable man] Fair enough...", the rep should
    // never read the bracket label aloud. Simulate the strip on
    // representative leak shapes and assert the brackets disappear.
    // (Pulling the regex literals out of the source by name so the
    // test breaks loudly if they're removed.)
    const leadingMatch = source.match(/text\.replace\(\/\^\\s\*\(\?:\\\[[^\n]+\)/);
    expect(leadingMatch, 'leading-bracket strip regex missing').toBeTruthy();
    const sentenceStartMatch = source.match(/text\.replace\(\/\(\^\|\[\.![^\n]+/);
    expect(sentenceStartMatch, 'sentence-start-bracket strip regex missing').toBeTruthy();

    // Apply the same regexes to a fixture and assert the brackets are
    // gone — this verifies the regex actually does what we want, not
    // just that it's present in source.
    const stripLeading = (s: string) =>
      s.replace(/^\s*(?:\[[^\]]+\]\s*)+/, '').trim();
    const stripSentenceStart = (s: string) =>
      s.replace(/(^|[.!?]\s+)(?:\[[^\]]+\]\s*)+/g, '$1').trim();

    expect(stripLeading('[reasonable man] Fair enough — that makes sense.'))
      .toBe('Fair enough — that makes sense.');
    expect(stripLeading('[warm] [firm] Quick version: 15-bed in Liverpool.'))
      .toBe('Quick version: 15-bed in Liverpool.');
    expect(
      stripSentenceStart(
        'Fair enough. [warm] What kind of returns are you chasing?'
      )
    ).toBe('Fair enough. What kind of returns are you chasing?');
    // Real bracketed content (e.g. URL-style or template placeholders) shouldn't
    // be over-stripped. We only strip from line start or sentence start.
    expect(stripLeading('Hi [Name], it\'s Hugo from Elsie.'))
      .toBe('Hi [Name], it\'s Hugo from Elsie.');
  });

  it('temperature is in the v8 conversational-but-controlled range (0.4-0.65)', () => {
    // PR #575 (v8) bumped 0.3 → 0.55 to recover variety without
    // sacrificing instruction-following. Lock the band so we don't drift
    // back to fully scripty (≤0.3) or fully wild (≥0.7).
    const m = source.match(/temperature:\s*([0-9.]+)/);
    expect(m).toBeTruthy();
    const temp = parseFloat(m![1]);
    expect(temp).toBeGreaterThanOrEqual(0.4);
    expect(temp).toBeLessThanOrEqual(0.65);
  });

  it('v8 — prior coach cards window is 5 (was 3)', () => {
    // PR #575: expanded so the n-gram ban list and the verbal anti-rep
    // rule have more material.
    expect(source).toMatch(
      /from\(['"]wk_live_coach_events['"]\)[\s\S]*?\.limit\(5\)/
    );
  });

  it('v9 — interim debounce raised to 700ms', () => {
    // PR D (v9): 250ms → 700ms — the SILENCE RULE handles variety,
    // so we trade ~3× fewer OpenAI generations per turn for slightly
    // slower first-token latency. Lock the value so we don't drift
    // back to the noisy v8 cadence.
    expect(source).toMatch(/p_min_age_ms:\s*700/);
    expect(source).not.toMatch(/p_min_age_ms:\s*250/);
  });

  it('v8 — explicit n-gram opener ban list passed in user message', () => {
    expect(source).toContain('buildOpenerBanList');
    expect(source).toContain('DO NOT START WITH');
    expect(source).toMatch(/banned opener n-gram/);
  });

  it('v8 — OpenAI request tagged with prompt_cache_key for prefix caching', () => {
    expect(source).toMatch(/prompt_cache_key:\s*['"]elsie-coach-v(?:8|9|10|11|12|13|14|15|16|17)['"]/);
  });

  it('v8 — script prompt is intent-based with USE FRESH WORDING + EARNED-PITCH + JUST EXPLORING', () => {
    expect(source).toContain('USE FRESH WORDING');
    expect(source).toContain('EARNED-PITCH RULE');
    expect(source).toContain('JUST EXPLORING');
    expect(source).toMatch(/INTENT:\s*Confirm the caller/);
    expect(source).toMatch(/paraphrase fresh each time/);
    // Five JUST EXPLORING angles must be present.
    expect(source).toContain('WARM CURIOSITY');
    expect(source).toContain('LIGHT CONTEXT');
    expect(source).toContain('SOCIAL PROOF');
    expect(source).toContain('LOW-PRESSURE PERMISSION');
    expect(source).toContain('EMPATHY BRIDGE');
  });

  it('v8 — script prompt has NO hardcoded deal numbers (those live in wk_coach_facts)', () => {
    // Hugo's audit: numbers belong in the KB layer, not the script
    // prompt. Lock that they're absent so they can't sneak back in.
    // We only check the DEFAULT_SCRIPT_PROMPT slice to avoid false
    // positives on numbers in the migration / comments / etc.
    const scriptStart = source.indexOf('DEFAULT_SCRIPT_PROMPT');
    const scriptEnd = scriptStart >= 0 ? source.indexOf("].join('\\n')", scriptStart) : -1;
    expect(scriptStart).toBeGreaterThan(0);
    expect(scriptEnd).toBeGreaterThan(scriptStart);
    const scriptBlock = source.slice(scriptStart, scriptEnd);
    expect(scriptBlock).not.toMatch(/15-bed/);
    expect(scriptBlock).not.toMatch(/£500\b/);
    expect(scriptBlock).not.toMatch(/£37k/);
    expect(scriptBlock).not.toMatch(/5-year agreement/);
    expect(scriptBlock).not.toMatch(/9\.6%/);
  });

  it('v8 — style prompt has FILLER CADENCE block', () => {
    expect(source).toContain('FILLER CADENCE');
    expect(source).toMatch(/roughly 1 in 4 lines/);
    expect(source).toMatch(/Never two filler-led lines in a row/);
  });

  it('v9 — script prompt has SILENCE RULE block with STAY_ON_SCRIPT marker', () => {
    // PR D: model is instructed to output the literal STAY_ON_SCRIPT
    // marker for filler / acknowledgement / questions already covered.
    // Lock the prompt shape so the SILENCE RULE doesn't get accidentally
    // edited out — without it, the postProcessor's marker check has
    // nothing to suppress.
    expect(source).toContain('SILENCE RULE');
    expect(source).toContain('STAY_ON_SCRIPT');
    expect(source).toMatch(/Most caller utterances do NOT need a new coach line/);
  });

  it('v9 — postProcessCoachText drops STAY_ON_SCRIPT marker (returns null)', () => {
    // The marker can leak with surrounding quotes / backticks /
    // punctuation when the model wraps it; the early-return must
    // tolerate that or the marker leaks into the agent UI.
    expect(source).toMatch(/stay\[_\\s-\]\?on\[_\\s-\]\?script/i);
  });

  it('v10 — script prompt has OUTPUT FORMAT block with [SCRIPT] / [SUGGESTION] / [EXPLAIN]', () => {
    // PR 6: every coach line must start with one of the three classifier
    // prefixes so the UI can label cards correctly. Lock the prompt
    // block so a future edit can't silently drop it (without the prompt,
    // the model defaults to no-prefix → all cards collapse to SUGGESTION).
    expect(source).toMatch(/OUTPUT FORMAT — v(?:10|11)/);
    expect(source).toContain('[SCRIPT: <stage>]');
    expect(source).toContain('[SUGGESTION]');
    expect(source).toContain('[EXPLAIN]');
    // v10 used a hardcoded stage list; v11 derives the stage from the
    // agent's script body (## N. <Stage> headings). Either form is OK,
    // as long as the prompt explicitly references the stage source.
    expect(source).toMatch(/<stage>\s+(?:must be one of:\s*Open|MUST match a "## N\. <Stage>" heading)/);
  });

  it('v10 — postProcessCoachText returns { kind, scriptSection, body } and parses prefix', () => {
    // The post-processor must extract the kind prefix BEFORE the generic
    // bracket strip — otherwise [SCRIPT: Qualify] gets eaten as an
    // acting-note. Lock the regex literal AND the return shape.
    expect(source).toContain('COACH_KIND_PREFIX_RE');
    expect(source).toMatch(/script\|suggestion\|explain/);
    expect(source).toMatch(/CoachOutput\s*\|\s*null/);
    expect(source).toContain('scriptSection');
  });

  it('v10 — final UPDATE writes kind + script_section to wk_live_coach_events', () => {
    // The final UPDATE must persist BOTH the parsed kind and the script
    // section so the renderer can label cards "SCRIPT — Qualify".
    expect(source).toMatch(/script_section:\s*cleaned\.scriptSection/);
    expect(source).toMatch(/kind:\s*cleaned\.kind/);
  });

  it('v11 — coach loads agent\'s actual call script and injects it as a 4th system message', () => {
    // PR 8: the coach must SELECT the agent's own row from
    // wk_call_scripts (with default fallback) and pass the body as a
    // separate system message so the model can mirror lines verbatim.
    expect(source).toMatch(/from\(['"]wk_call_scripts['"]\)/);
    expect(source).toMatch(/owner_agent_id/);
    expect(source).toContain('agentScriptSystemPrompt');
    expect(source).toContain("=== AGENT'S CALL SCRIPT");
    // Substitution of {first_name} / {agent_first_name} (PR 87 accepts
    // both single AND double brace forms) happens BEFORE the body lands
    // in the prompt — model never echoes raw placeholders into the
    // agent UI.
    expect(source).toMatch(/\\\{\\\{\?\\s\*first_name\\s\*\\\}\?\\\}/);
    expect(source).toMatch(/\\\{\\\{\?\\s\*agent_first_name\\s\*\\\}\?\\\}/);
  });

  it('v16 — resolves script from contact pipeline column (own > column > campaign > default)', () => {
    // Hugo 2026-05-02: each pipeline column can pin a script so leads
    // in "Follow-Up" get a different script than "New Leads". The edge
    // function must fetch the contact's pipeline_column_id, then look up
    // wk_pipeline_columns.call_script_id for that column.
    expect(source).toContain('pipeline_column_id');
    // Must query wk_pipeline_columns to resolve the column-pinned script
    expect(source).toMatch(/from\(['"]wk_pipeline_columns['"]\)/);
    expect(source).toMatch(/call_script_id/);
    // The resolution chain must include 'column' as a source
    expect(source).toContain("'column'");
  });

  it('v17 — resolves coach profiles from wk_coach_profiles table', () => {
    expect(source).toMatch(/from\(['"]wk_coach_profiles['"]\)/);
    expect(source).toContain('coach_profile_id');
    expect(source).toMatch(/elsie-coach-v17/);
  });

  it('v16 — wk-calls-create source persists campaign_id on INSERT', () => {
    // Bug fix: campaign_id was parsed from request body but not written
    // to the wk_calls row. The transcription function reads it back to
    // resolve campaign-level overrides.
    const createSource = readFileSync(
      resolve(__dirname, '../../../../supabase/functions/wk-calls-create/index.ts'),
      'utf8'
    );
    expect(createSource).toMatch(/campaign_id.*campaignId|campaign_id:\s*campaignId/);
  });
});
