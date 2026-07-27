// stageHistory — how a lead's last pipeline move is worded.
//
// Hugo 2026-07-27: "the static pipeline always show last movement, even manual
// and by who." Until migration 20260727000006 nothing recorded stage changes at
// all, so three of these states describe genuine gaps rather than data:
//
//   'agent'      — a person moved it. We know who and when.
//   'automation' — a service-role mover did (the video funnel, the AI booking
//                  route). There is no person to name, so we say so.
//   'backfill'   — reconstructed from evidence that pre-dates tracking. We know
//                  roughly when, never where FROM. Never claim more.
//   null         — never moved, or moved before any of this existed.
//
// Pure: no React, no Supabase, so the copy rules are unit-tested for real
// rather than grepped. Same lib/-plus-component split as contactIdentity.ts.

export type StageMoveSource = 'agent' | 'automation' | 'import' | 'backfill' | null;

export interface StageMove {
  at: string | null;
  /** Already resolved through useAgentDirectory — this module never fetches. */
  byName: string | null;
  fromName: string | null;
  toName: string | null;
  source: StageMoveSource;
}

export const NO_STAGE_MOVE = 'No stage moves logged';

export function isAutomaticMove(source: StageMoveSource): boolean {
  return source === 'automation';
}

/** "Pedro" out of "Pedro III Almedina" — cards are 280px wide. */
function firstName(full: string | null): string | null {
  if (!full) return null;
  const first = full.trim().split(/\s+/)[0];
  return first || null;
}

/** Who/what gets the credit, in the fewest words that stay true. */
function actorSuffix(m: StageMove, useFullName: boolean): string {
  const who = useFullName ? m.byName : firstName(m.byName);
  switch (m.source) {
    case 'agent':
      return who ? ` · ${useFullName ? 'by ' : ''}${who}` : '';
    case 'automation':
      return ' · moved automatically';
    case 'backfill':
      // Most backfilled rows came from a call disposition, which DOES record
      // the agent — 697 of the 698 reconstructed on 2026-07-27 name a real
      // person. Throwing that away and printing "recorded before tracking" at
      // all of them would hide a fact we actually hold. The hedge is only for
      // the ones with no evidence of who.
      return who
        ? ` · ${useFullName ? 'by ' : ''}${who}${useFullName ? ' (from an earlier call outcome)' : ''}`
        : ' · recorded before tracking';
    case 'import':
      return ' · imported';
    default:
      return '';
  }
}

/**
 * Short label for a card. `when` is the caller's already-formatted time so this
 * module stays free of date formatting (helpers.ts owns Europe/London).
 *   'Interested · 2h ago · Pedro'
 */
export function stageMoveLabel(m: StageMove, when: string): string {
  if (!m.at) return NO_STAGE_MOVE;
  const head = m.toName ? `${m.toName} · ${when}` : when;
  return `${head}${actorSuffix(m, false)}`;
}

/**
 * Full sentence for the title attribute, with the exact stamp.
 *   'Moved from Voicemail to Interested on 27 Jul, 14:32 · by Pedro III Almedina'
 */
export function stageMoveTitle(m: StageMove, when: string): string {
  if (!m.at) return NO_STAGE_MOVE;
  const to = m.toName ? ` to ${m.toName}` : '';
  // Backfilled rows genuinely have no 'from' — never invent one.
  const from = m.fromName ? ` from ${m.fromName}` : '';
  return `Moved${from}${to} on ${when}${actorSuffix(m, true)}`;
}
