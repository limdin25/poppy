// Reading what the model actually said.
//
// A pure module on purpose: api/lib/llm.ts builds a Supabase client at import
// time, and this has to be importable (and testable) without one.

/**
 * The first block of actual text in an Anthropic response.
 *
 * NOT content[0]. A thinking-capable model (claude-sonnet-5, and everything
 * after it) answers with a `thinking` block FIRST and the words after it, so
 * content[0].text is undefined and the whole call reads back as "the model did
 * not answer".
 *
 * That is exactly what happened to the AI email drafts: they failed every
 * single time on production, from the day they shipped, while the API call
 * itself was perfectly fine. Found 2026-08-14 by replaying the request by hand
 * against the production key and looking at the raw response.
 *
 * For a model with no thinking block this is identical to content[0].text.
 */
export function firstText(
  content: Array<{ type?: string; text?: string }> | undefined | null,
): string {
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if (typeof block?.text === 'string' && block.text.trim()) return block.text;
  }
  return '';
}
