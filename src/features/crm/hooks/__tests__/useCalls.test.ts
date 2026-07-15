import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
    storage: { from: vi.fn() },
  },
}));

import { rowToCall } from '../useCalls';

describe('rowToCall', () => {
  const baseRow = {
    id: 'call-1',
    contact_id: 'c-1',
    agent_id: 'a-1',
    direction: 'outbound' as const,
    status: 'completed',
    started_at: '2026-04-25T12:00:00Z',
    duration_sec: 145,
    disposition_column_id: null,
    agent_note: null,
  };

  it('maps a complete row with recording + intel + cost', () => {
    const c = rowToCall(
      baseRow,
      { call_id: 'call-1', storage_path: 'call-1/recording.wav', status: 'ready' },
      { call_id: 'call-1', summary: 'Booked viewing for Tuesday' },
      { call_id: 'call-1', total_pence: 18 }
    );
    expect(c).toMatchObject({
      id: 'call-1',
      contactId: 'c-1',
      agentId: 'a-1',
      direction: 'outbound',
      status: 'completed',
      durationSec: 145,
      recordingUrl: 'call-1/recording.wav',
      aiSummary: 'Booked viewing for Tuesday',
      costPence: 18,
    });
  });

  it('maps Twilio status names to UI status enum', () => {
    expect(rowToCall({ ...baseRow, status: 'in_progress' }, undefined, undefined, undefined).status).toBe('connected');
    expect(rowToCall({ ...baseRow, status: 'no_answer' }, undefined, undefined, undefined).status).toBe('missed');
    expect(rowToCall({ ...baseRow, status: 'voicemail' }, undefined, undefined, undefined).status).toBe('voicemail');
    expect(rowToCall({ ...baseRow, status: 'busy' }, undefined, undefined, undefined).status).toBe('failed');
    expect(rowToCall({ ...baseRow, status: 'unknown_zzz' }, undefined, undefined, undefined).status).toBe('completed');
  });

  it('zero cost when no cost row joined', () => {
    const c = rowToCall(baseRow, undefined, undefined, undefined);
    expect(c.costPence).toBe(0);
  });

  it('handles null contact_id without crashing', () => {
    const c = rowToCall({ ...baseRow, contact_id: null }, undefined, undefined, undefined);
    expect(c.contactId).toBe('');
  });

  it('null duration becomes 0 (UI shows "—")', () => {
    const c = rowToCall({ ...baseRow, duration_sec: null }, undefined, undefined, undefined);
    expect(c.durationSec).toBe(0);
  });
});
