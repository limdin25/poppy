import { describe, expect, it } from 'vitest';
import { isHostunicoAdminTestCall } from '../supabase/functions/_shared/hostunico-test-call';

const phone = '+447700900123';
const contact = { phone, desk: 'sa', custom_fields: { hostunico_internal_test: true } };
describe('manual administrator test call', () => {
  it('lets an administrator call the saved, explicitly marked test number without a fake property', () => {
    expect(isHostunicoAdminTestCall(true, contact, phone)).toBe(true);
  });
  it('cannot bypass property checks for an agent, a different destination or another desk', () => {
    expect(isHostunicoAdminTestCall(false, contact, phone)).toBe(false);
    expect(isHostunicoAdminTestCall(true, contact, '+447700900124')).toBe(false);
    expect(isHostunicoAdminTestCall(true, { ...contact, desk: 'houses' }, phone)).toBe(false);
  });
  it('requires the explicit database flag and a saved valid-format destination', () => {
    expect(isHostunicoAdminTestCall(true, null, phone)).toBe(false);
    expect(isHostunicoAdminTestCall(true, { ...contact, custom_fields: {} }, phone)).toBe(false);
    expect(isHostunicoAdminTestCall(true, { ...contact, custom_fields: { hostunico_internal_test: 'true' } }, phone)).toBe(false);
    expect(isHostunicoAdminTestCall(true, { ...contact, phone: '123' }, '123')).toBe(false);
  });
});
