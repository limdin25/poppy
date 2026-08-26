// hook-writer.ts: the model call that keeps the hook bank full.
//
// Hugo, 26 Aug 2026: "it has to always use the AI to generate a new text."
// It does, but in BATCHES, not per post. A call per post would be 3,700 calls a
// day, would put a line in front of a hundred thousand people that no human had
// read, and would stop the machine dead every time the API had a bad minute.
// Batches mean Hugo can open the table and read what is queued before it goes
// anywhere.
//
// Everything the model sends back goes through validateHook. Anything that
// fails is dropped, never repaired. The prompt asks for the rules and the code
// enforces them, because a prompt is a request.

import {
  BANNED_PUNCTUATION,
  MAX_LINE_CHARS,
  hookKey,
  parseHookBatch,
  type Hook,
} from "@/lib/data/hook-bank";

const SYSTEM = `You write the opening text for short vertical videos on Instagram.

Each opening is THREE BEATS shown one after another over a blurred clip, about
1.5 seconds each, before the real video starts. Beat one creates tension or says
something people think but do not say. Beat two escalates it. Beat three tells
the viewer to keep watching.

FORMAT, exactly, one opening per line, nothing else on the line:
beat one line a | beat one line b / beat two line a | beat two line b / beat three line a | beat three line b

A beat may be one line instead of two, in which case leave out the "|".

HARD RULES. An opening that breaks any of these is thrown away.
1. NEVER mention AI, artificial intelligence, generating, filming, cameras,
   robots, software, or anything being fake, unreal or not real. The video
   reveals at the very end that it was made by AI. Saying it at the start
   destroys the only surprise the video has.
2. No long dashes, no curly quotes, no ellipsis characters. Straight
   apostrophes only.
3. Every line ${MAX_LINE_CHARS} characters or shorter. Count them.
4. No claims anybody would have to back up. No numbers, no money, no promises
   about results, no naming real people or brands.
5. Plain spoken English. No hashtags, no emoji, no quotation marks.

Write openings that would make somebody stop scrolling and stay for five
seconds. Vary them hard: different angles, different rhythms, some blunt, some
curious, some slightly confrontational. Do not write variations of one idea.

Output ONLY the lines. No preamble, no numbering, no explanation.`;

export interface HookWriterResult {
  readonly ok: boolean;
  readonly hooks: readonly Hook[];
  readonly asked: number;
  readonly kept: number;
  readonly error?: string;
}

/**
 * Ask for a batch. `avoid` is a sample of what the bank already holds, so the
 * model steers away from what exists rather than rediscovering the same eight
 * good lines every run, which is what it does when asked cold.
 */
export async function writeHooks(
  count: number,
  avoid: readonly string[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<HookWriterResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, hooks: [], asked: count, kept: 0, error: "no api key" };

  const user = [
    `Write ${count} openings.`,
    avoid.length
      ? `We already have these, so do not write anything close to them:\n${avoid
          .slice(0, 60)
          .map((a) => `- ${a}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  let res: Response;
  try {
    res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    return {
      ok: false,
      hooks: [],
      asked: count,
      kept: 0,
      error: e instanceof Error ? e.message : "network",
    };
  }
  if (!res.ok) {
    return { ok: false, hooks: [], asked: count, kept: 0, error: `api ${res.status}` };
  }

  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");

  // The model is asked not to use this punctuation and mostly does not, but one
  // curly apostrophe would fail every hook in the batch on a rule that is
  // trivially fixable without changing a single word.
  const cleaned = text.replace(BANNED_PUNCTUATION, "'").replace(/[“”]/g, "");
  const hooks = parseHookBatch(cleaned);
  return { ok: true, hooks, asked: count, kept: hooks.length };
}

/** Drop anything already in the bank. The database has a unique index too, so
 *  this is about not sending 40 rows to have 38 rejected, not about safety. */
export function dedupeAgainst(
  hooks: readonly Hook[],
  existingKeys: ReadonlySet<string>,
): Hook[] {
  const out: Hook[] = [];
  const seen = new Set(existingKeys);
  for (const h of hooks) {
    const k = hookKey(h);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out;
}
