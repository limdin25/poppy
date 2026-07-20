// Voicemail-drop aggregation shared by reports + dashboard stats.
// A drop is orthogonal to call status (status='voicemail' means AMD said
// machine and counts as *answered*), so drops are tallied off the dedicated
// wk_calls.voicemail_dropped flag only. Pure (vitest: tests/call-stats).

export interface DropCountRow {
  agent_id?: string | null;
  voicemail_dropped?: boolean | null;
}

export function countVoicemailDrops(rows: DropCountRow[]): number {
  return rows.reduce((n, r) => n + (r.voicemail_dropped === true ? 1 : 0), 0);
}

/** Per-agent drop counts; rows with no agent land under 'unknown'. */
export function voicemailDropsByAgent(rows: DropCountRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.voicemail_dropped !== true) continue;
    const aid = r.agent_id ?? 'unknown';
    m.set(aid, (m.get(aid) ?? 0) + 1);
  }
  return m;
}
