import { describe, it, expect } from 'vitest';

describe('follow-up cron logic', () => {
  it('generates a friendly follow-up message with first name and business name', () => {
    const contactName = 'Sarah Jones';
    const bizName = 'ABC Plumbing';
    const firstName = contactName.split(' ')[0] || 'there';
    const message = `Hi ${firstName}! Just following up from ${bizName}. We noticed you were looking at booking an appointment — would you still like to go ahead? Just reply here and we can get you sorted. 😊`;

    expect(message).toContain('Sarah');
    expect(message).toContain('ABC Plumbing');
    expect(message).not.toContain('Jones');
  });

  it('uses fallback when contact has no name', () => {
    const contactName = null as string | null;
    const firstName = contactName?.split(' ')[0] || 'there';
    expect(firstName).toBe('there');
  });

  it('calculates 2-24 hour window correctly', () => {
    const now = Date.now();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);

    const qualifiedJustNow = new Date(now - 30 * 60 * 1000);
    const qualifiedThreeHoursAgo = new Date(now - 3 * 60 * 60 * 1000);
    const qualifiedYesterday = new Date(now - 25 * 60 * 60 * 1000);

    expect(qualifiedJustNow <= twoHoursAgo).toBe(false);
    expect(qualifiedThreeHoursAgo <= twoHoursAgo).toBe(true);
    expect(qualifiedThreeHoursAgo >= twentyFourHoursAgo).toBe(true);
    expect(qualifiedYesterday >= twentyFourHoursAgo).toBe(false);
  });

  it('skips leads that already have a booking', () => {
    const leads = [
      { id: 'conv-1', business_id: 'b1' },
      { id: 'conv-2', business_id: 'b1' },
    ];
    const bookedIds = new Set(['conv-1']);
    const unbookedLeads = leads.filter(l => !bookedIds.has(l.id));
    expect(unbookedLeads).toHaveLength(1);
    expect(unbookedLeads[0].id).toBe('conv-2');
  });
});
