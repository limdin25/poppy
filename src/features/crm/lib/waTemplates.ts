// Pure helpers for Meta WhatsApp template authoring (Hugo 2026-08-03).
// The server-side twin (authoritative) lives in
// supabase/functions/wk-whatsapp-admin/index.ts, keep the rules aligned.

const VAR_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

// House rule: no long dashes, curly quotes or ellipsis characters anywhere.
// Built from CODE POINTS so this guard does not itself contain the characters
// it forbids, which would make a repo-wide grep for them useless.
//   2013 en dash, 2014 em dash, 2018/2019 curly single, 201C/201D curly double,
//   2026 ellipsis.
export const BANNED_CODEPOINTS = [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026];
const BANNED_PUNCTUATION = new RegExp(
  `[${BANNED_CODEPOINTS.map((c) => String.fromCharCode(c)).join('')}]`,
);
const CURLY_APOSTROPHE = String.fromCharCode(0x2019);

/** Ordered unique variable tokens found in a template body ({{1}} -> "1"). */
export function extractTemplateVars(body: string): string[] {
  const seen: string[] = [];
  for (const m of body.matchAll(VAR_RE)) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
}

/** Meta's template name rules: lowercase letters, digits, underscores. */
export function slugTemplateName(raw: string): string {
  return raw
    .toLowerCase()
    .split(CURLY_APOSTROPHE).join('')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 512);
}

/**
 * Plain-words problem with a template, or null when it is submittable.
 * Mirrors the checks Meta actually enforces plus the house punctuation rule,
 * so the form can refuse before a round trip.
 */
export function templateProblem(name: string, body: string): string | null {
  if (!/^[a-z0-9_]{1,512}$/.test(name)) {
    return 'Template name must be lowercase letters, numbers and underscores only.';
  }
  if (!body.trim()) return 'Write the message body first.';
  if (body.length > 1024) return 'WhatsApp caps template bodies at 1024 characters.';
  if (BANNED_PUNCTUATION.test(body)) {
    return 'Remove the long dash, curly quote or ellipsis character. Straight punctuation only.';
  }
  const vars = extractTemplateVars(body);
  for (const v of vars) {
    if (!/^\d+$/.test(v)) {
      return `Variables must be numbers, like {{1}}. Found {{${v}}}.`;
    }
  }
  const nums = [...new Set(vars.map(Number))].sort((a, b) => a - b);
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) {
      return 'Number the variables 1, 2, 3 with no gaps, starting at {{1}}.';
    }
  }
  const trimmed = body.trim();
  if (/^\{\{\s*\d+\s*\}\}/.test(trimmed) || /\{\{\s*\d+\s*\}\}$/.test(trimmed)) {
    return 'Meta rejects templates that start or end with a variable. Add words around it.';
  }
  return null;
}
