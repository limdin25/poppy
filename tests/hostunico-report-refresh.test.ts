import { describe, expect, it, vi } from 'vitest';
import { refreshHostunicoReports } from '../src/features/crm/lib/hostunicoPreparation';

describe('recovered reports reach the calling queue', () => {
  it('refreshes held leads after twenty existing ready reports instead of starving them', async () => {
    const offsets: number[] = [];
    const totals = await refreshHostunicoReports(async (offset) => {
      offsets.push(offset);
      return { ready: 2, nextOffset: offset < 22 ? offset + 2 : null };
    }, () => {}, () => false);
    expect(offsets).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
    expect(totals.ready).toBe(24);
  });
  it('reaches held reports beyond the old 100-contact window', async () => {
    const batch = vi.fn(async (offset: number) => ({ ready: offset === 104 ? 2 : 0, nextOffset: offset < 104 ? offset + 2 : null }));
    const totals = await refreshHostunicoReports(batch, () => {}, () => false);
    expect(totals.ready).toBe(2);
    expect(batch).toHaveBeenLastCalledWith(104);
  });
  it('stops on cancellation and rejects a repeated cursor instead of looping forever', async () => {
    let cancelled = false;
    const batch = vi.fn(async () => ({ ready: 2, nextOffset: 2 }));
    await refreshHostunicoReports(batch, () => { cancelled = true; }, () => cancelled);
    expect(batch).toHaveBeenCalledTimes(1);
    await expect(refreshHostunicoReports(async () => ({nextOffset: 0}), () => {}, () => false)).rejects.toThrow('cursor');
  });
});
