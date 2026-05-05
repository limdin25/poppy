import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();

vi.mock('@/integrations/supabase/browser', () => ({
  supabase: { from: (...args: any[]) => mockFrom(...args) },
}));

import {
  saveServices,
  saveFAQs,
  saveGreeting,
  saveCallInfoFields,
} from '@/features/onboarding/hooks/useOnboardingSave';

describe('Onboarding Persistence', () => {
  const businessId = 'biz-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('saveServices', () => {
    it('deletes existing services then inserts new ones', async () => {
      const deleteEq = vi.fn().mockResolvedValue({ error: null });
      const insertFn = vi.fn().mockResolvedValue({ error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'services') {
          return {
            delete: () => ({ eq: deleteEq }),
            insert: insertFn,
          };
        }
      });

      await saveServices(businessId, ['Emergency Plumbing', 'Boiler Repair']);

      expect(mockFrom).toHaveBeenCalledWith('services');
      expect(deleteEq).toHaveBeenCalledWith('business_id', businessId);
      expect(insertFn).toHaveBeenCalledWith([
        { business_id: businessId, name: 'Emergency Plumbing', sort_order: 0 },
        { business_id: businessId, name: 'Boiler Repair', sort_order: 1 },
      ]);
    });

    it('throws on delete error', async () => {
      const deleteEq = vi.fn().mockResolvedValue({ error: { message: 'fail' } });
      mockFrom.mockImplementation(() => ({
        delete: () => ({ eq: deleteEq }),
      }));

      await expect(saveServices(businessId, ['Test'])).rejects.toThrow('fail');
    });
  });

  describe('saveFAQs', () => {
    it('deletes existing FAQs then inserts new ones', async () => {
      const deleteEq = vi.fn().mockResolvedValue({ error: null });
      const insertFn = vi.fn().mockResolvedValue({ error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'faqs') {
          return {
            delete: () => ({ eq: deleteEq }),
            insert: insertFn,
          };
        }
      });

      const faqs = [
        { question: 'Hours?', answer: '9-5' },
        { question: 'Cost?', answer: 'Free quote' },
      ];

      await saveFAQs(businessId, faqs);

      expect(mockFrom).toHaveBeenCalledWith('faqs');
      expect(deleteEq).toHaveBeenCalledWith('business_id', businessId);
      expect(insertFn).toHaveBeenCalledWith([
        { business_id: businessId, question: 'Hours?', answer: '9-5', sort_order: 0 },
        { business_id: businessId, question: 'Cost?', answer: 'Free quote', sort_order: 1 },
      ]);
    });
  });

  describe('saveGreeting', () => {
    it('updates business greeting field', async () => {
      const eqFn = vi.fn().mockResolvedValue({ error: null });
      const updateFn = vi.fn(() => ({ eq: eqFn }));

      mockFrom.mockImplementation((table: string) => {
        if (table === 'businesses') {
          return { update: updateFn };
        }
      });

      await saveGreeting(businessId, 'Hello, welcome!');

      expect(mockFrom).toHaveBeenCalledWith('businesses');
      expect(updateFn).toHaveBeenCalledWith({ greeting: 'Hello, welcome!' });
      expect(eqFn).toHaveBeenCalledWith('id', businessId);
    });
  });

  describe('saveCallInfoFields', () => {
    it('deletes existing then inserts all fields with enabled state', async () => {
      const deleteEq = vi.fn().mockResolvedValue({ error: null });
      const insertFn = vi.fn().mockResolvedValue({ error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'call_info_types') {
          return {
            delete: () => ({ eq: deleteEq }),
            insert: insertFn,
          };
        }
      });

      const fields = [
        { label: 'Caller name', enabled: true },
        { label: 'Budget range', enabled: false },
        { label: 'Email', enabled: true },
      ];

      await saveCallInfoFields(businessId, fields);

      expect(deleteEq).toHaveBeenCalledWith('business_id', businessId);
      expect(insertFn).toHaveBeenCalledWith([
        { business_id: businessId, name: 'Caller name', enabled: true, sort_order: 0 },
        { business_id: businessId, name: 'Budget range', enabled: false, sort_order: 1 },
        { business_id: businessId, name: 'Email', enabled: true, sort_order: 2 },
      ]);
    });
  });
});
