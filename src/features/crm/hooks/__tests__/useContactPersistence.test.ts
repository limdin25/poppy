import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
  },
}));

import { isRealContactId, UUID_RE } from '../useContactPersistence';

describe('isRealContactId', () => {
  it('accepts a canonical UUIDv4', () => {
    expect(isRealContactId('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
  });

  it('accepts uppercase + mixed case UUID', () => {
    expect(isRealContactId('AABBCCDD-1234-5678-9ABC-DEF012345678')).toBe(true);
  });

  it('rejects mock IDs (contact-1, contact-vip-x)', () => {
    expect(isRealContactId('contact-1')).toBe(false);
    expect(isRealContactId('contact-vip-x')).toBe(false);
  });

  it('rejects empty + bogus strings so we never hit Supabase with garbage', () => {
    expect(isRealContactId('')).toBe(false);
    expect(isRealContactId('not a uuid')).toBe(false);
    expect(isRealContactId('123-456')).toBe(false);
  });

  it('UUID_RE is exported for callers that need their own check', () => {
    expect(UUID_RE.test('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(UUID_RE.test('contact-1')).toBe(false);
  });
});
