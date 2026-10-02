import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  historyQuery: vi.fn(),
  results: {} as Record<string, any>,
  builders: {} as Record<string, any>,
}));

vi.mock('@/integrations/supabase/browser', () => ({ supabase: { from: mocks.from } }));
vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: mocks.historyQuery,
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/features/crm/lib/ViewAsContext', () => ({ useImpersonatedAgentId: () => 'pedro' }));
vi.mock('@/features/crm/lib/DeskContext', () => ({ useDesk: () => ({ desk: 'sa' }) }));
vi.mock('../src/features/crm/components/shared/AgentChip', () => ({ default: () => null }));
vi.mock('../src/features/crm/components/contacts/HostunicoReportButton', () => ({ default: () => null }));
vi.mock('@/features/crm/hooks/useCalls', () => ({ signCallRecording: vi.fn() }));

import CallHistoryPro, { fetchPage } from '../src/features/crm/dialer-pro/history/CallHistoryPro';

const call = (index: number) => ({
  id: `call-${index}`, contact_id: null, direction: 'outbound', status: 'completed',
  started_at: '2026-10-01T19:00:00Z', duration_sec: 30, agent_note: null,
  from_e164: '+447700900000', to_e164: '+447700900123',
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.results = { wk_calls: { data: Array.from({ length: 25 }, (_, i) => call(i)), count: 85, error: null }, wk_recordings: { data: [], error: null } };
  mocks.builders = {};
  mocks.from.mockImplementation((table: string) => {
    const builder: any = {};
    for (const method of ['select', 'eq', 'order', 'range', 'in']) builder[method] = vi.fn(() => builder);
    builder.then = (resolve: any, reject: any) => Promise.resolve(mocks.results[table] ?? { data: [], error: null }).then(resolve, reject);
    mocks.builders[table] = builder;
    return builder;
  });
  mocks.historyQuery.mockReturnValue({
    data: { pages: [{ calls: Array.from({ length: 25 }, (_, i) => ({ ...call(i), contactName: 'Owner', startedAt: call(i).started_at, durationSec: 30 })), total: 85 }] },
    isLoading: false, isError: false, error: null, hasNextPage: true, isFetchingNextPage: false,
    fetchNextPage: vi.fn(), refetch: vi.fn(),
  });
});

describe('dialer history completeness', () => {
  it('returns the full scoped count even when only the first 25 calls are loaded', async () => {
    const page = await fetchPage(0, 'pedro', 'sa');
    expect(page.total).toBe(85);
    expect(page.calls).toHaveLength(25);
    expect(mocks.builders.wk_calls.select).toHaveBeenCalledWith(expect.any(String), { count: 'exact' });
    expect(mocks.builders.wk_calls.eq).toHaveBeenCalledWith('desk', 'sa');
    expect(mocks.builders.wk_calls.eq).toHaveBeenCalledWith('agent_id', 'pedro');
    expect(mocks.builders.wk_calls.range).toHaveBeenCalledWith(0, 24);
    expect(mocks.builders.wk_recordings.in).toHaveBeenCalledWith('call_id', Array.from({ length: 25 }, (_, i) => `call-${i}`));
  });

  it('loads older pages and uses the actual phone when the call has no contact', async () => {
    const page = await fetchPage(1, null, 'sa');
    expect(mocks.builders.wk_calls.range).toHaveBeenCalledWith(25, 49);
    expect(mocks.builders.wk_calls.eq).not.toHaveBeenCalledWith('agent_id', expect.anything());
    expect(page.calls[0].contactPhone).toBe('+447700900123');
    expect(mocks.builders.wk_calls.order).toHaveBeenCalledWith('id', { ascending: false });
  });

  it('does not turn a failed history request into an empty successful history', async () => {
    mocks.results.wk_calls = { data: null, count: null, error: { message: 'Call history unavailable' } };
    await expect(fetchPage(0, 'pedro', 'sa')).rejects.toThrow('Call history unavailable');
  });

  it('shows the full total and a visible way to load older calls', () => {
    const html = renderToStaticMarkup(createElement(CallHistoryPro));
    expect(html).toContain('Showing 25 of 85 calls');
    expect(html).toContain('Load older calls');
    const opts = mocks.historyQuery.mock.calls[0][0];
    expect(opts.getNextPageParam({ calls: Array(25), total: 85 }, [], 0)).toBe(1);
    expect(opts.getNextPageParam({ calls: Array(25), total: 50 }, [], 1)).toBeUndefined();
    expect(opts.getNextPageParam({ calls: Array(10), total: 85 }, [], 3)).toBeUndefined();
  });

  it('shows an error with retry instead of claiming there were no calls', () => {
    mocks.historyQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('Unavailable'), refetch: vi.fn() });
    const html = renderToStaticMarkup(createElement(CallHistoryPro));
    expect(html).toContain('Could not load call history');
    expect(html).toContain('Retry');
    expect(html).not.toContain('No calls yet');
  });
});
