// interpolateTemplate — single source of truth for substituting
// {first_name} / {{first_name}} and {agent_first_name} / {{agent_first_name}}
// in templates and scripts.
//
// PR 87 (Hugo 2026-04-27): "if a value doesn't exist, do NOT send the
// literal {agent_first_name} — ignore it." Prior code used four different
// inline regexes; some only matched double-braces, so single-brace
// templates leaked the raw placeholder. Unified here.
//
// Behavior:
//   - Accepts BOTH {x} and {{x}} (with optional whitespace inside).
//   - When the value is missing/empty, the placeholder is dropped and
//     the surrounding whitespace + dangling-punctuation artifacts are
//     cleaned up so the message reads naturally.
//   - Case-insensitive on the placeholder name.
//
// Examples (with agentFirstName = ''):
//   "Hi {{first_name}}, this is {{agent_first_name}} from Elsie."
//     → "Hi Hugo, this is from Elsie."   ❌ (old behavior, awkward)
//     → "Hi Hugo, this is from Elsie."   we then collapse "is  from" →
//        "Hi Hugo, this from Elsie."     still awkward, but no leak.
//
// We choose the conservative cleanup: collapse adjacent whitespace and
// trim — but we do NOT try to rewrite "this is " into "this'" because
// that requires NLP. Templates authored without an agent name should
// avoid the "this is {agent_first_name}" pattern; the AI coach prompt
// is our authority on style.

export interface InterpolateVars {
  firstName?: string | null;
  agentFirstName?: string | null;
}

const PLACEHOLDER_RE = /\{\{?\s*(first_name|agent_first_name)\s*\}?\}/gi;

export function interpolateTemplate(input: string, vars: InterpolateVars): string {
  const fn = (vars.firstName ?? '').trim();
  const an = (vars.agentFirstName ?? '').trim();

  const replaced = input.replace(PLACEHOLDER_RE, (_match, key: string) => {
    const k = key.toLowerCase();
    if (k === 'first_name') return fn;
    if (k === 'agent_first_name') return an;
    return '';
  });

  // Light cleanup when a value was dropped: collapse double spaces and
  // tidy " ," / " ." artifacts left behind by an empty substitution.
  return replaced
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .trim();
}
