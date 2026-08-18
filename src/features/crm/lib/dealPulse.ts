// dealPulse — the one line on a pipeline card that says what last happened to
// the deal, so the board and the cockpit tell the same story.
//
// Hugo, 2026-08-17: "the actions that I'm taking on the cockpit are not
// reflecting fully on the pipelines... for Zest it should show that the mail
// was sent, the time, and what we are waiting for. Same for DDM Residential,
// they responded already. It shows in the cockpit but not on the pipeline."
//
// Newest wins, and only two kinds of event exist:
//   'replied'  their message is the latest thing on the file, so the ball is
//              ours and the card says so.
//   'done'     the latest thing is a cockpit press, so the card names it and
//              when. What we are waiting for is the column the press already
//              moved the card to.
//
// Pure on purpose: the same rows always pick the same pulse, so the whole
// decision is testable without a browser (tests/deal-pulse.test.ts).

export interface PulseAction {
  action: string;
  created_at: string;
  instruction?: string | null;
}

export interface PulseReply {
  created_at: string;
  body?: string | null;
}

export interface DealPulse {
  kind: 'replied' | 'done';
  /** "They replied" or the plain-English name of the press. */
  label: string;
  /** When it happened (ISO), for formatRelativeTime. */
  at: string;
  /** The reply body or the log line, capped, for the tooltip. */
  preview: string | null;
}

/** Presses that are not events. A hold, a note or a comparison changes nothing
 *  the branch would notice, so it must never bury "Email sent" on the card. */
export const PULSE_SILENT = ['hold', 'add_note', 'compare_comps'] as const;

const LABELS: Record<string, string> = {
  send_email: 'Email sent',
  call_branch: 'Rang the branch',
  fetch_ballpark: 'Ballpark armed',
  book_followup: 'Follow-up booked',
  book_builder: 'Builder booked',
  move_stage: 'Stage moved',
  mark_lost: 'Sent to Lost',
  escalate_hugo: 'Sent to Hugo',
  draft_offer_email: 'Offer drafted',
  draft_counter_reply: 'Reply drafted',
  draft_follow_up_email: 'Follow-up drafted',
  draft_video_email: 'Video email drafted',
  draft_address_only_email: 'Address email drafted',
  assemble_investor_pack: 'Investor pack complete',
};

/** Plain English for a press. An unmapped action reads as words, not a slug. */
export function pulseLabel(action: string): string {
  const mapped = LABELS[action];
  if (mapped) return mapped;
  const words = action.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const cap = (s: string | null | undefined): string | null => {
  const t = (s ?? '').trim();
  if (!t) return null;
  return t.length > 140 ? `${t.slice(0, 137)}...` : t;
};

/** Pick the pulse for one card. `actions` in any order; `reply` is the
 *  newest inbound message from the branch, when there is one. */
export function pickPulse(
  actions: readonly PulseAction[],
  reply: PulseReply | null,
): DealPulse | null {
  const meaningful = actions
    .filter((a) => !(PULSE_SILENT as readonly string[]).includes(a.action))
    .filter((a) => Number.isFinite(Date.parse(a.created_at)))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const latest = meaningful[0] ?? null;

  const replyAt = reply && Number.isFinite(Date.parse(reply.created_at))
    ? Date.parse(reply.created_at) : null;

  if (replyAt !== null && (!latest || replyAt > Date.parse(latest.created_at))) {
    return {
      kind: 'replied',
      label: 'They replied',
      at: new Date(replyAt).toISOString(),
      preview: cap(reply!.body),
    };
  }
  if (!latest) return null;
  return {
    kind: 'done',
    label: pulseLabel(latest.action),
    at: new Date(Date.parse(latest.created_at)).toISOString(),
    preview: cap(latest.instruction),
  };
}
