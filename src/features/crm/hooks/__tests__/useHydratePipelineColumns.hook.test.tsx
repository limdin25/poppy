// Pins useHydratePipelineColumns end-to-end: mock supabase to return 6 rows,
// render under <SmsV2Provider>, assert store.columns.length === 6 after the
// effect resolves.
//
// Also pins resilience: if another store dispatch fires WHILE the columns
// fetch is still in flight, the in-flight fetch must still land in the store.
// In production, useHydrateContacts dispatches inside the same provider, which
// re-memoises the api object and (with unstable effect deps) used to cancel
// the in-flight columns fetch — leaving PostCallPanel with no buttons even
// though the DB had 6 rows.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';

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

import { useHydratePipelineColumns } from '../useHydratePipelineColumns';
import { SmsV2Provider, useSmsV2 } from '../../store/SmsV2Store';

const SIX_ROWS = [
  { id: 'col-1', pipeline_id: 'p1', name: 'Interested', colour: '#1E9A80', icon: 'Sparkles', position: 1, sort_order: 1, is_default_on_timeout: false },
  { id: 'col-2', pipeline_id: 'p1', name: 'Callback', colour: '#1E9A80', icon: 'Clock', position: 2, sort_order: 2, is_default_on_timeout: false },
  { id: 'col-3', pipeline_id: 'p1', name: 'No pickup', colour: '#1E9A80', icon: 'PhoneMissed', position: 3, sort_order: 3, is_default_on_timeout: false },
  { id: 'col-4', pipeline_id: 'p1', name: 'Not interested', colour: '#1E9A80', icon: 'X', position: 4, sort_order: 4, is_default_on_timeout: false },
  { id: 'col-5', pipeline_id: 'p1', name: 'Voicemail', colour: '#1E9A80', icon: 'Voicemail', position: 5, sort_order: 5, is_default_on_timeout: false },
  { id: 'col-6', pipeline_id: 'p1', name: 'Wrong number', colour: '#1E9A80', icon: 'Ban', position: 6, sort_order: 6, is_default_on_timeout: false },
];

beforeEach(() => {
  mockFrom.mockReset();
});

function setupSixColumnsImmediate(): void {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'wk_pipeline_columns') {
      return {
        select: () => ({
          order: () => Promise.resolve({ data: SIX_ROWS, error: null }),
        }),
      };
    }
    if (table === 'wk_pipeline_automations') {
      return {
        select: () => Promise.resolve({ data: [], error: null }),
      };
    }
    return { select: () => Promise.resolve({ data: [], error: null }) };
  });
}

function setupSixColumnsDelayed(delayMs: number): void {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'wk_pipeline_columns') {
      return {
        select: () => ({
          order: () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ data: SIX_ROWS, error: null }), delayMs)
            ),
        }),
      };
    }
    if (table === 'wk_pipeline_automations') {
      return {
        select: () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ data: [], error: null }), delayMs)
          ),
      };
    }
    return { select: () => Promise.resolve({ data: [], error: null }) };
  });
}

function Probe({
  onApi,
}: {
  onApi: (api: ReturnType<typeof useSmsV2>) => void;
}) {
  useHydratePipelineColumns();
  const api = useSmsV2();
  useEffect(() => {
    onApi(api);
  });
  return null;
}

function Wrapper({ children }: { children: ReactNode }) {
  return <SmsV2Provider>{children}</SmsV2Provider>;
}

describe('useHydratePipelineColumns end-to-end', () => {
  it('hydrates store.columns with 6 rows from wk_pipeline_columns', async () => {
    setupSixColumnsImmediate();

    const seen: ReturnType<typeof useSmsV2>[] = [];
    render(
      <Wrapper>
        <Probe onApi={(api) => seen.push(api)} />
      </Wrapper>
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const final = seen[seen.length - 1];
    expect(final.columns).toHaveLength(6);
    expect(final.columns.map((c) => c.name)).toEqual([
      'Interested',
      'Callback',
      'No pickup',
      'Not interested',
      'Voicemail',
      'Wrong number',
    ]);
  });

  it('keeps hydrated columns even if another store dispatch fires while the fetch is in flight', async () => {
    // Real-world race: useHydrateContacts dispatches setContacts mid-flight,
    // which re-memoises the api object. With unstable [setColumns] deps the
    // pipeline-columns effect would cancel its own in-flight fetch and the
    // store would never receive the rows.
    setupSixColumnsDelayed(40);

    const seen: ReturnType<typeof useSmsV2>[] = [];
    let probeApi: ReturnType<typeof useSmsV2> | null = null;
    render(
      <Wrapper>
        <Probe
          onApi={(api) => {
            probeApi = api;
            seen.push(api);
          }}
        />
      </Wrapper>
    );

    // Dispatch a contact upsert mid-flight to trigger a state change inside
    // the same provider (this is what useHydrateContacts does in production).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
      probeApi?.upsertContact({
        id: 'c-1',
        name: 'Dispatcher',
        phone: '+447700900000',
        tags: [],
        isHot: false,
        customFields: {},
        createdAt: '2026-04-26T00:00:00Z',
      });
      await new Promise((r) => setTimeout(r, 100));
    });

    const final = seen[seen.length - 1];
    expect(final.columns).toHaveLength(6);
  });
});
