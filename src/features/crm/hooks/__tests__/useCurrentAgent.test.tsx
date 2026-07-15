// useCurrentAgent — pulls the signed-in agent's identity, status, daily call
// counts, and spend from supabase. Replaces the mock CURRENT_AGENT export.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { rowToCurrentAgent } from '../useCurrentAgent';
import type { Agent } from '../../types';

vi.mock('@/integrations/supabase/browser', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

import { supabase } from '@/integrations/supabase/browser';
import { useCurrentAgent } from '../useCurrentAgent';

describe('rowToCurrentAgent (pure mapper)', () => {
  it('maps a full real-data shape to a CurrentAgent', () => {
    const agent = rowToCurrentAgent({
      profile: {
        id: 'user-1',
        name: 'Hugo Rodrigo De Souza',
        email: 'hugo@heyelsie.com',
        agent_status: 'available',
        agent_extension: '100',
        workspace_role: 'admin',
      },
      limit: {
        agent_id: 'user-1',
        daily_limit_pence: 99999,
        daily_spend_pence: 240,
        is_admin: true,
      },
      callsToday: 12,
      answeredToday: 8,
    });
    expect(agent).toMatchObject<Partial<Agent>>({
      id: 'user-1',
      name: 'Hugo Rodrigo De Souza',
      email: 'hugo@heyelsie.com',
      status: 'available',
      callsToday: 12,
      answeredToday: 8,
      spendPence: 240,
      limitPence: 99999,
      isAdmin: true,
    });
  });

  it('falls back to email when name is null', () => {
    const a = rowToCurrentAgent({
      profile: {
        id: 'u',
        name: null,
        email: 'foo@bar.com',
        agent_status: null,
        agent_extension: null,
        workspace_role: 'agent',
      },
      limit: undefined,
      callsToday: 0,
      answeredToday: 0,
    });
    expect(a.name).toBe('foo@bar.com');
  });

  it('defaults status to "offline" when profile has no agent_status', () => {
    const a = rowToCurrentAgent({
      profile: {
        id: 'u',
        name: 'X',
        email: 'x@y.com',
        agent_status: null,
        agent_extension: null,
        workspace_role: 'agent',
      },
      limit: undefined,
      callsToday: 0,
      answeredToday: 0,
    });
    expect(a.status).toBe('offline');
  });

  it('defaults spend/limit to 0 when no limit row', () => {
    const a = rowToCurrentAgent({
      profile: {
        id: 'u',
        name: 'X',
        email: 'x@y.com',
        agent_status: 'available',
        agent_extension: null,
        workspace_role: 'agent',
      },
      limit: undefined,
      callsToday: 0,
      answeredToday: 0,
    });
    expect(a.spendPence).toBe(0);
    expect(a.limitPence).toBe(0);
    expect(a.isAdmin).toBe(false);
  });

  it('respects workspace_role=admin even when limit row is missing', () => {
    const a = rowToCurrentAgent({
      profile: {
        id: 'u',
        name: 'Admin',
        email: 'a@b.com',
        agent_status: 'available',
        agent_extension: null,
        workspace_role: 'admin',
      },
      limit: undefined,
      callsToday: 0,
      answeredToday: 0,
    });
    expect(a.isAdmin).toBe(true);
  });
});

describe('useCurrentAgent (integration with mocked supabase)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null state while loading', async () => {
    // Pretend auth.getUser never resolves to keep the hook in loading state.
    (supabase.auth.getUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {})
    );
    const { result } = renderHook(() => useCurrentAgent());
    expect(result.current.agent).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('builds the CurrentAgent shape from supabase rows + first-name selector', async () => {
    (supabase.auth.getUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { user: { id: 'user-1', email: 'hugo@heyelsie.com' } },
      error: null,
    });

    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      id: 'user-1',
                      name: 'Hugo Rodrigo De Souza',
                      email: 'hugo@heyelsie.com',
                      agent_status: 'available',
                      agent_extension: '100',
                      workspace_role: 'admin',
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'wk_voice_agent_limits') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      agent_id: 'user-1',
                      daily_limit_pence: 99999,
                      daily_spend_pence: 240,
                      is_admin: true,
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'wk_calls') {
          return {
            select: () => ({
              eq: () => ({
                gte: () =>
                  Promise.resolve({
                    data: [
                      { status: 'completed' },
                      { status: 'completed' },
                      { status: 'voicemail' },
                      { status: 'no-answer' },
                    ],
                    error: null,
                  }),
              }),
            }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      }
    );

    const { result } = renderHook(() => useCurrentAgent());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.agent).not.toBeNull();
    expect(result.current.agent?.id).toBe('user-1');
    expect(result.current.agent?.name).toBe('Hugo Rodrigo De Souza');
    expect(result.current.firstName).toBe('Hugo');
    expect(result.current.agent?.callsToday).toBe(4);
    expect(result.current.agent?.answeredToday).toBe(3); // completed + voicemail
    expect(result.current.agent?.spendPence).toBe(240);
    expect(result.current.agent?.isAdmin).toBe(true);
  });
});
