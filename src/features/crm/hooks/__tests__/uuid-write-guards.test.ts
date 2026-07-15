// Systematic guard against mock IDs leaking into Supabase writes.
//
// Bug pattern that surfaced on 2026-04-25: the local store was seeded
// with MOCK_* data using synthetic IDs (e.g. "col-interested", "a-hugo").
// When those IDs flowed into wk_contacts INSERT/UPDATE statements,
// Postgres rejected with "invalid input syntax for type uuid".
//
// These tests pin the contract at every write boundary — no mock ID
// may reach the .insert/.update/.upsert call. If you add a new write,
// add a test here.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted — the factory must not capture outer variables.
// We import the mocked module *after* the mock and pull the spied fns
// off it inside each test.
vi.mock('@/integrations/supabase/browser', () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
      }),
    },
  },
}));

import { renderHook, act } from '@testing-library/react';
import { supabase } from '@/integrations/supabase/browser';
import { useContactPersistence } from '../useContactPersistence';

beforeEach(() => {
  vi.clearAllMocks();
});

function makeQueryBuilder() {
  // PostgREST chain: .insert().select().single() / .update().eq() /
  // .select().eq().maybeSingle() (PR 119: createContact pre-flight
  // lookup for the duplicate-phone case)
  const single = vi.fn().mockResolvedValue({ data: { id: 'inserted-uuid' }, error: null });
  const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  // .select() returns BOTH .single (for insert chain) and .eq (for
  // pre-flight phone lookup). Calling .eq().maybeSingle() returns
  // null = no existing contact.
  const selectEq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ single, eq: selectEq }));
  const eq = vi.fn().mockResolvedValue({ data: null, error: null });
  const insert = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  return { insert, update, select, eq, single, maybeSingle, selectEq };
}

describe('createContact — UUID guards on Supabase INSERT', () => {
  it('drops a non-UUID pipelineColumnId before INSERT (the col-interested bug)', async () => {
    const qb = makeQueryBuilder();
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(qb);

    const { result } = renderHook(() => useContactPersistence());
    await act(async () => {
      await result.current.createContact({
        name: 'Test',
        phone: '+447380308316',
        pipelineColumnId: 'col-interested', // <- mock id from MOCK_PIPELINES
      });
    });

    expect(qb.insert).toHaveBeenCalledTimes(1);
    const payload = qb.insert.mock.calls[0][0];
    // pipeline_column_id MUST be null when the input is a non-UUID
    expect(payload.pipeline_column_id).toBeNull();
  });

  it('keeps a real UUID pipelineColumnId in the INSERT payload', async () => {
    const qb = makeQueryBuilder();
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(qb);

    const { result } = renderHook(() => useContactPersistence());
    const realUuid = '0ba3c92d-5175-420f-86d3-040f80394aa9';
    await act(async () => {
      await result.current.createContact({
        name: 'Test',
        phone: '+447380308316',
        pipelineColumnId: realUuid,
      });
    });

    const payload = qb.insert.mock.calls[0][0];
    expect(payload.pipeline_column_id).toBe(realUuid);
  });

  it('drops a non-UUID ownerAgentId and falls back to auth.uid (the a-hugo bug)', async () => {
    const qb = makeQueryBuilder();
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(qb);

    const { result } = renderHook(() => useContactPersistence());
    await act(async () => {
      await result.current.createContact({
        name: 'Test',
        phone: '+447380308316',
        ownerAgentId: 'a-hugo', // <- mock id from MOCK_AGENTS
      });
    });

    const payload = qb.insert.mock.calls[0][0];
    expect(payload.owner_agent_id).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('keeps a real UUID ownerAgentId in the INSERT payload', async () => {
    const qb = makeQueryBuilder();
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(qb);

    const { result } = renderHook(() => useContactPersistence());
    const realAgent = '11111111-1111-1111-1111-111111111111';
    await act(async () => {
      await result.current.createContact({
        name: 'Test',
        phone: '+447380308316',
        ownerAgentId: realAgent,
      });
    });

    const payload = qb.insert.mock.calls[0][0];
    expect(payload.owner_agent_id).toBe(realAgent);
  });
});

describe('moveToColumn — UUID guards on Supabase UPDATE', () => {
  it('no-ops (no UPDATE call) when columnId is a mock id', async () => {
    const qb = makeQueryBuilder();
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(qb);

    const { result } = renderHook(() => useContactPersistence());
    const realContactId = '22222222-2222-2222-2222-222222222222';
    let ok = false;
    await act(async () => {
      ok = await result.current.moveToColumn(realContactId, 'col-interested');
    });

    // moveToColumn should return true (idempotent no-op for mock targets)
    expect(ok).toBe(true);
    // UPDATE must NOT have fired with a bogus uuid
    expect(qb.update).not.toHaveBeenCalled();
  });

  it('no-ops when contactId is a mock id (already covered, here for completeness)', async () => {
    const qb = makeQueryBuilder();
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(qb);

    const { result } = renderHook(() => useContactPersistence());
    await act(async () => {
      await result.current.moveToColumn('contact-1', 'col-interested');
    });
    expect(qb.update).not.toHaveBeenCalled();
  });

  it('issues UPDATE only when both contactId and columnId are real UUIDs', async () => {
    const qb = makeQueryBuilder();
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(qb);

    const { result } = renderHook(() => useContactPersistence());
    const realContact = '22222222-2222-2222-2222-222222222222';
    const realCol = '0ba3c92d-5175-420f-86d3-040f80394aa9';
    await act(async () => {
      await result.current.moveToColumn(realContact, realCol);
    });
    expect(qb.update).toHaveBeenCalledTimes(1);
    const patch = qb.update.mock.calls[0][0];
    expect(patch.pipeline_column_id).toBe(realCol);
  });
});

describe('patchContact — UUID guards on Supabase UPDATE', () => {
  it('strips a mock pipeline_column_id before UPDATE', async () => {
    const qb = makeQueryBuilder();
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(qb);

    const { result } = renderHook(() => useContactPersistence());
    const realContact = '22222222-2222-2222-2222-222222222222';
    await act(async () => {
      await result.current.patchContact(realContact, {
        pipeline_column_id: 'col-callback',
        name: 'New name',
      });
    });

    expect(qb.update).toHaveBeenCalledTimes(1);
    const sent = qb.update.mock.calls[0][0];
    // Mock pipeline_column_id removed; non-uuid fields preserved
    expect(sent.pipeline_column_id).toBeUndefined();
    expect(sent.name).toBe('New name');
  });

  it('strips a mock owner_agent_id before UPDATE', async () => {
    const qb = makeQueryBuilder();
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(qb);

    const { result } = renderHook(() => useContactPersistence());
    const realContact = '22222222-2222-2222-2222-222222222222';
    await act(async () => {
      await result.current.patchContact(realContact, {
        owner_agent_id: 'a-hugo',
        is_hot: true,
      });
    });

    const sent = qb.update.mock.calls[0][0];
    expect(sent.owner_agent_id).toBeUndefined();
    expect(sent.is_hot).toBe(true);
  });

  it('keeps real UUID values in the patch unchanged', async () => {
    const qb = makeQueryBuilder();
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(qb);

    const { result } = renderHook(() => useContactPersistence());
    const realContact = '22222222-2222-2222-2222-222222222222';
    const realCol = '0ba3c92d-5175-420f-86d3-040f80394aa9';
    const realAgent = '11111111-1111-1111-1111-111111111111';
    await act(async () => {
      await result.current.patchContact(realContact, {
        pipeline_column_id: realCol,
        owner_agent_id: realAgent,
      });
    });

    const sent = qb.update.mock.calls[0][0];
    expect(sent.pipeline_column_id).toBe(realCol);
    expect(sent.owner_agent_id).toBe(realAgent);
  });
});
