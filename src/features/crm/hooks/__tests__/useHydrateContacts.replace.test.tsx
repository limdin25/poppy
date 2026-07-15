// Verifies that useHydrateContacts atomically REPLACES the store's contacts
// with the loaded list, instead of upserting per row (which used to leak the
// 8 mock seed rows into the UI).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';

const mockOrder = vi.fn();
const mockSelect = vi.fn(() => ({ order: mockOrder }));
const mockSelectFlat = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

import { useHydrateContacts } from '../useHydrateContacts';
import { SmsV2Provider, useSmsV2 } from '../../store/SmsV2Store';

beforeEach(() => {
  mockFrom.mockReset();
  mockSelect.mockReset();
  mockSelectFlat.mockReset();
  mockOrder.mockReset();
});

function setupContactRows(rows: unknown[]): void {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'wk_contacts') {
      return {
        select: () => ({
          order: () => Promise.resolve({ data: rows, error: null }),
        }),
      };
    }
    if (table === 'wk_contact_tags') {
      return {
        select: () => Promise.resolve({ data: [], error: null }),
      };
    }
    return { select: () => Promise.resolve({ data: [], error: null }) };
  });
}

function Probe({ onApi }: { onApi: (api: ReturnType<typeof useSmsV2>) => void }) {
  useHydrateContacts();
  const api = useSmsV2();
  useEffect(() => {
    onApi(api);
  });
  return null;
}

function Wrapper({ children }: { children: ReactNode }) {
  return <SmsV2Provider>{children}</SmsV2Provider>;
}

describe('useHydrateContacts replace semantics', () => {
  it('replaces store contacts atomically (no mock leak when initialState is empty)', async () => {
    setupContactRows([
      {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Real A',
        phone: '+447700900001',
        email: null,
        owner_agent_id: null,
        pipeline_column_id: null,
        deal_value_pence: null,
        is_hot: false,
        custom_fields: null,
        last_contact_at: null,
        created_at: '2026-04-25T00:00:00Z',
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        name: 'Real B',
        phone: '+447700900002',
        email: null,
        owner_agent_id: null,
        pipeline_column_id: null,
        deal_value_pence: null,
        is_hot: false,
        custom_fields: null,
        last_contact_at: null,
        created_at: '2026-04-25T01:00:00Z',
      },
    ]);

    const seen: ReturnType<typeof useSmsV2>[] = [];
    render(
      <Wrapper>
        <Probe onApi={(api) => seen.push(api)} />
      </Wrapper>
    );

    // Wait for the async load to complete
    await new Promise((r) => setTimeout(r, 50));

    const final = seen[seen.length - 1];
    expect(final.contacts).toHaveLength(2);
    expect(final.contacts.map((c) => c.id).sort()).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ]);
    // The store's queue should reflect the real ids exactly, no mock ids.
    expect(final.queue.sort()).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ]);
  });

  it('produces an empty contacts list when no rows returned (and no mock leak)', async () => {
    setupContactRows([]);

    const seen: ReturnType<typeof useSmsV2>[] = [];
    render(
      <Wrapper>
        <Probe onApi={(api) => seen.push(api)} />
      </Wrapper>
    );

    await new Promise((r) => setTimeout(r, 50));

    const final = seen[seen.length - 1];
    expect(final.contacts).toEqual([]);
    expect(final.queue).toEqual([]);
  });
});
