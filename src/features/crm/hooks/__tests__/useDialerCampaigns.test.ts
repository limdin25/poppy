import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
  },
}));

import { rowToCampaign } from '../useDialerCampaigns';

describe('rowToCampaign', () => {
  const baseRow = {
    id: 'camp-1',
    name: 'Outbound May',
    pipeline_id: 'pipe-1',
    parallel_lines: 3,
    auto_advance_seconds: 10,
    ai_coach_enabled: true,
    ai_coach_prompt_id: null,
    script_md: 'Hello!',
    created_by: 'agent-1',
    is_active: true,
  };

  it('maps a row with no queue rollup to zero counts', () => {
    const c = rowToCampaign(baseRow, undefined);
    expect(c).toMatchObject({
      id: 'camp-1',
      name: 'Outbound May',
      parallelLines: 3,
      autoAdvanceSeconds: 10,
      aiCoachEnabled: true,
      totalLeads: 0,
      doneLeads: 0,
      connectedLeads: 0,
      voicemailLeads: 0,
      pendingLeads: 0,
      dialingLeads: 0,
      missedLeads: 0,
      skippedLeads: 0,
    });
  });

  it('totalLeads sums all 7 statuses; doneLeads = done + missed + skipped', () => {
    // PR (Hugo 2026-04-28): the old rollup ignored missed/skipped/dialing.
    // Now every status is bucketed. Tajul scenario: 11 pending, 0 done,
    // 0 connected, 0 voicemail, 9 missed → "Done" should be 9, not 0.
    const c = rowToCampaign(baseRow, {
      campaign_id: 'camp-1',
      pending: 11,
      dialing: 0,
      connected: 0,
      voicemail: 0,
      missed: 9,
      done: 0,
      skipped: 0,
    });
    expect(c.totalLeads).toBe(20);
    expect(c.pendingLeads).toBe(11);
    expect(c.doneLeads).toBe(9); // missed counts as Done
    expect(c.missedLeads).toBe(9);
    expect(c.connectedLeads).toBe(0);
    expect(c.voicemailLeads).toBe(0);
  });

  it('mixed rollup: pending + done + connected + voicemail + skipped', () => {
    const c = rowToCampaign(baseRow, {
      campaign_id: 'camp-1',
      pending: 7,
      dialing: 1,
      connected: 2,
      voicemail: 1,
      missed: 3,
      done: 3,
      skipped: 2,
    });
    expect(c.totalLeads).toBe(19);
    expect(c.pendingLeads).toBe(7);
    expect(c.dialingLeads).toBe(1);
    expect(c.doneLeads).toBe(3 + 3 + 2); // done + missed + skipped
    expect(c.connectedLeads).toBe(2);
    expect(c.voicemailLeads).toBe(1);
    expect(c.missedLeads).toBe(3);
    expect(c.skippedLeads).toBe(2);
  });

  it('null script + prompt id coerce to undefined', () => {
    const c = rowToCampaign({ ...baseRow, script_md: null, ai_coach_prompt_id: null }, undefined);
    expect(c.scriptMd).toBeUndefined();
    expect(c.aiCoachPromptId).toBeUndefined();
  });

  it('owner falls back to empty string when created_by is null', () => {
    const c = rowToCampaign({ ...baseRow, created_by: null }, undefined);
    expect(c.ownerAgentId).toBe('');
  });

  it('PR 60: maps is_active → isActive (used by Settings Active/Paused toggle)', () => {
    const active = rowToCampaign({ ...baseRow, is_active: true }, undefined);
    const paused = rowToCampaign({ ...baseRow, is_active: false }, undefined);
    expect(active.isActive).toBe(true);
    expect(paused.isActive).toBe(false);
  });
});
