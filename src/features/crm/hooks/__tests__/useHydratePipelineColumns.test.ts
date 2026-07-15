import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
  },
}));

import { rowToPipelineColumn } from '../useHydratePipelineColumns';

describe('rowToPipelineColumn', () => {
  const baseRow = {
    id: '0ba3c92d-5175-420f-86d3-040f80394aa9',
    pipeline_id: 'd3bcab51-27ae-4539-9483-784eac706972',
    name: 'Interested',
    colour: '#3C5A87',
    icon: null,
    position: 1,
    is_default_on_timeout: false,
  };

  it('produces a PipelineColumn with the real UUID id', () => {
    const c = rowToPipelineColumn(baseRow, undefined);
    expect(c.id).toBe('0ba3c92d-5175-420f-86d3-040f80394aa9');
    expect(c.id).not.toBe('col-interested');
  });

  it('defaults icon when null', () => {
    const c = rowToPipelineColumn(baseRow, undefined);
    expect(c.icon).toBe('Sparkles');
  });

  it('defaults automation flags to false when no row', () => {
    const c = rowToPipelineColumn(baseRow, undefined);
    expect(c.automation).toMatchObject({
      sendSms: false,
      createTask: false,
      retryDial: false,
      addTag: false,
    });
  });

  it('maps automation row when provided', () => {
    const c = rowToPipelineColumn(baseRow, {
      column_id: baseRow.id,
      send_sms: true,
      sms_template_id: 'tmpl-1',
      create_task: true,
      task_title: 'Send rent guide',
      task_due_in_hours: 24,
      retry_dial: false,
      retry_in_hours: null,
      add_tag: true,
      tag: 'interested',
      move_to_pipeline_id: null,
    });
    expect(c.automation).toMatchObject({
      sendSms: true,
      smsTemplateId: 'tmpl-1',
      createTask: true,
      taskTitle: 'Send rent guide',
      taskDueInHours: 24,
      addTag: true,
      tag: 'interested',
    });
  });

  it('null colour defaults to Elsie brand green', () => {
    const c = rowToPipelineColumn({ ...baseRow, colour: null }, undefined);
    expect(c.colour).toBe('#3C5A87');
  });
});
