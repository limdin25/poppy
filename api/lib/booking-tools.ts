import type { RetellTool } from '../../src/integrations/retell/client.js';

export function getBookingTools(appUrl: string, toolSecret: string, businessId: string, agentId?: string): RetellTool[] {
  const qs = agentId ? `bid=${businessId}&aid=${agentId}` : `bid=${businessId}`;
  return [
    {
      type: 'end_call',
      name: 'end_call',
    },
    {
      type: 'custom',
      name: 'check_availability',
      description: 'Check available appointment slots. Call this when the caller wants to book a meeting or appointment. Returns a list of free time slots. If the result has zero slots, try again with a wider date range covering the next working days.',
      url: `${appUrl}/api/calendar/availability?${qs}`,
      method: 'POST',
      headers: { 'x-tool-secret': toolSecret },
      parameters: {
        type: 'object',
        properties: {
          date_from: { type: 'string', description: 'First date to check in YYYY-MM-DD format. Use today if the caller wants something soon.' },
          date_to: { type: 'string', description: 'Last date to check (inclusive) in YYYY-MM-DD format. For a single day, set date_to equal to date_from. Usually 3-5 days from date_from.' },
        },
        required: ['date_from', 'date_to'],
      },
      speak_during_execution: true,
      speak_after_execution: true,
    },
    {
      type: 'custom',
      name: 'book_appointment',
      description: 'Book a confirmed appointment. Only call this after the caller has explicitly confirmed a specific time slot.',
      url: `${appUrl}/api/calendar/book?${qs}`,
      method: 'POST',
      headers: { 'x-tool-secret': toolSecret },
      parameters: {
        type: 'object',
        properties: {
          service_name: { type: 'string', description: 'Name of the service being booked' },
          start_time: { type: 'string', description: 'ISO 8601 start time of the confirmed slot' },
          caller_name: { type: 'string', description: 'Full name of the caller' },
          caller_phone: { type: 'string', description: 'Phone number of the caller. Use the phone number shown in the system prompt unless the caller gave a different one.' },
          caller_email: { type: 'string', description: 'Email address if provided' },
          notes: { type: 'string', description: 'Brief description of what the meeting or appointment is about' },
        },
        required: ['service_name', 'start_time', 'caller_name', 'caller_phone'],
      },
      speak_during_execution: true,
      speak_after_execution: true,
    },
  ];
}

export function getDefaultTools(): RetellTool[] {
  return [{ type: 'end_call', name: 'end_call' }];
}
