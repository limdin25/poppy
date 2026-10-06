import { describe, expect, it, vi } from 'vitest';
import { loadReviewedFollowup, claimReviewedFollowup, finishReviewedFollowup } from '../supabase/functions/_shared/hostunico-followup-delivery';
const row = { id: 'item', contact_id: 'contact', agent_id: 'agent', channel: 'sms', recipient: '+447700900999', body: 'Exact reviewed text', subject: '', version: 2, status: 'edited', armed_at: '2026-10-01T10:00:00Z' };
function db(value = row) {
  const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: value, error: null }), update: vi.fn(() => q), then: (resolve: any) => resolve({ error: null }) };
  return { from: vi.fn(() => q), rpc: vi.fn(async () => ({ data: true, error: null })), q };
}
describe('reviewed follow-up dispatch', () => {
  it('accepts only the dedicated internal key and loads the persisted message', async () => {
    const d = db();
    await expect(loadReviewedFollowup(d, 'ordinary-user-token', 'internal-key', { report_followup_id: 'item', body: 'Injected text' }, 'sms')).rejects.toThrow();
    expect(d.from).not.toHaveBeenCalled();
    const item = await loadReviewedFollowup(d, 'internal-key', 'internal-key', { report_followup_id: 'item', body: 'Injected text' }, 'sms');
    expect(item?.body).toBe('Exact reviewed text');
    await expect(loadReviewedFollowup(d, 'internal-key', 'internal-key', { report_followup_id: 'item' }, 'email')).rejects.toThrow();
  });
  it('leaves ordinary human sends alone and cannot accept a missing internal key', async () => {
    expect(await loadReviewedFollowup(db(), 'user', '', { body: 'Hello' }, 'sms')).toBeNull();
    await expect(loadReviewedFollowup(db(), '', '', { report_followup_id: 'item' }, 'sms')).rejects.toThrow();
  });
  it('stops if a reply, booking or stage change wins the final database claim', async () => {
    const d = db(); d.rpc.mockResolvedValue({ data: false, error: null });
    await expect(claimReviewedFollowup(d, row)).rejects.toThrow(/stopped|changed/i);
    expect(d.rpc).toHaveBeenCalledWith('sa_claim_report_followup', { p_item: 'item', p_version: 2 });
  });
  it('stores the provider receipt as sent and does not reset the item for another try', async () => {
    const d = db(); await finishReviewedFollowup(d, row, 'provider-receipt');
    expect(d.q.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent', provider_id: 'provider-receipt' }));
  });
});
