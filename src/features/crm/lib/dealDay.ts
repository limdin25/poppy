// The words and the colours a working day is described in.
//
// LIFTED 2026-08-15 out of components/deals/TodayPanel.tsx so the cockpit and
// the pipeline board's Today panel cannot start telling Pedro different
// stories about the same deal. Copying them would have worked on day one and
// drifted by the first edit, which is how this codebase has been bitten
// before: two competitor lists, two comp counters, two ideas of a stage.
//
// Everything here is pure and free of React, which also means the structural
// test in tests/ can import it. Nothing under src/features/crm is in the
// vitest run (vitest.config.ts excludes it), so a plain module is the only
// part of the cockpit whose logic can be tested directly rather than by
// reading its source.

/** Plain English for the closed flag list in api/lib/deal-manager-contract.ts,
 *  so nobody has to learn the codes. Every flag in FLAGS must appear here, and
 *  a test asserts that both ways round. */
export const FLAG_LABEL: Record<string, string> = {
  reply_unread: 'They replied',
  overdue_followup: 'Follow-up overdue',
  stale_no_touch: 'Nothing has happened',
  figure_mismatch: 'Figures disagree',
  stage_mismatch: 'Wrong column',
  price_cut_on_known_branch: 'Price cut',
  blocked_needs_hugo: 'Needs Hugo',
  pack_incomplete: 'Pack incomplete',
};

export const FLAG_TONE: Record<string, string> = {
  reply_unread: 'bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]',
  overdue_followup: 'bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA]',
  stale_no_touch: 'bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]',
  blocked_needs_hugo: 'bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA]',
  figure_mismatch: 'bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]',
  stage_mismatch: 'bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA]',
};

/** The order flags read in, most important first.
 *
 *  reply_unread leads because that is the one that was actually costing money:
 *  Lexi's rejection sat unread for seven hours while a fresh offer was about to
 *  go out blind. Anything not listed sorts after the named ones, in the order
 *  it arrived. */
export const FLAG_ORDER = [
  'reply_unread', 'blocked_needs_hugo', 'figure_mismatch', 'overdue_followup',
  'price_cut_on_known_branch', 'stage_mismatch', 'pack_incomplete', 'stale_no_touch',
];

export function sortFlags(flags: readonly string[]): string[] {
  const rank = (f: string) => {
    const i = FLAG_ORDER.indexOf(f);
    return i === -1 ? FLAG_ORDER.length : i;
  };
  return [...flags].sort((a, b) => rank(a) - rank(b));
}

/** The three attention bands, kept as literal hexes on purpose.
 *
 *  --danger is exactly #DC2626 so the red is token-identical, but --warning is
 *  yellow (#EAB308) and NOT this amber. Tokenising the amber would silently
 *  restyle TodayPanel, which is not in scope. Structure uses tokens; these
 *  three state tints live here so the two screens cannot drift. */
export function attentionTone(score: number): string {
  if (score >= 70) return 'bg-[#FEF2F2] text-[#DC2626]';
  if (score >= 40) return 'bg-[#FFF7ED] text-[#C2410C]';
  return 'bg-[#F3F4F6] text-[#6B7280]';
}

/** Is this urgent enough to shout about at the top of the list? */
export const URGENT_AT = 70;

/** "3h ago" / "2d ago" / "never touched". */
export function hoursAgo(h: number | null): string {
  if (h === null) return 'never touched';
  if (h < 1) return 'just now';
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Said on both screens, so it has to be said the same way on both. */
export const NOTHING_WAITING =
  'Nothing is waiting on anybody. Every deal has been touched recently and '
  + 'no branch is waiting on a reply.';

/** When the brain is off, say so plainly and say what is showing instead.
 *  Never "AI unavailable" without telling somebody what they are looking at. */
export const BRAIN_OFF_NOTE =
  'The deal brain is off, so this is the deterministic order and every '
  + 'instruction is the brief already on the file.';

export const BRAIN_ON_NOTE = 'Ordered by what needs a person most.';
