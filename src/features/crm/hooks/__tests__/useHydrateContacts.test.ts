import { describe, it, expect, vi } from 'vitest';

// Stub the supabase client before the hook module imports it.
// rowToContact is a pure function and never touches the network — but
// useHydrateContacts.ts imports the client at module top-level.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

import { rowToContact } from '../useHydrateContacts';

describe('rowToContact', () => {
  const baseRow = {
    id: 'c-1',
    name: 'John Doe',
    phone: '+447700900000',
    email: null,
    owner_agent_id: null,
    pipeline_column_id: null,
    deal_value_pence: null,
    is_hot: false,
    custom_fields: null,
    last_contact_at: null,
    created_at: '2026-04-25T12:00:00Z',
  };

  it('maps a minimum row to a Contact with empty tags', () => {
    const c = rowToContact(baseRow, []);
    expect(c).toEqual({
      id: 'c-1',
      name: 'John Doe',
      phone: '+447700900000',
      email: undefined,
      ownerAgentId: undefined,
      pipelineColumnId: undefined,
      tags: [],
      isHot: false,
      dealValuePence: undefined,
      customFields: {},
      createdAt: '2026-04-25T12:00:00Z',
      lastContactAt: undefined,
    });
  });

  it('preserves tags when provided', () => {
    const c = rowToContact(baseRow, ['vip', 'hot-lead']);
    expect(c.tags).toEqual(['vip', 'hot-lead']);
  });

  it('coerces nullable fields to undefined (not null) for clean React rendering', () => {
    const c = rowToContact(baseRow, []);
    expect(c.email).toBeUndefined();
    expect(c.lastContactAt).toBeUndefined();
    expect(c.dealValuePence).toBeUndefined();
  });

  it('preserves populated fields', () => {
    const row = {
      ...baseRow,
      email: 'john@example.com',
      owner_agent_id: 'agent-1',
      pipeline_column_id: 'col-1',
      deal_value_pence: 12500,
      is_hot: true,
      custom_fields: { source: 'web', notes: 'hot prospect' },
      last_contact_at: '2026-04-25T11:00:00Z',
    };
    const c = rowToContact(row, ['vip']);
    expect(c.email).toBe('john@example.com');
    expect(c.ownerAgentId).toBe('agent-1');
    expect(c.pipelineColumnId).toBe('col-1');
    expect(c.dealValuePence).toBe(12500);
    expect(c.isHot).toBe(true);
    expect(c.customFields).toEqual({ source: 'web', notes: 'hot prospect' });
    expect(c.lastContactAt).toBe('2026-04-25T11:00:00Z');
    expect(c.tags).toEqual(['vip']);
  });

  it('treats null custom_fields as empty object so component never crashes on Object.entries', () => {
    const c = rowToContact(baseRow, []);
    expect(c.customFields).toEqual({});
    expect(() => Object.entries(c.customFields)).not.toThrow();
  });
});
