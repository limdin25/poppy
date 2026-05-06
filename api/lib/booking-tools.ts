import type { RetellTool } from '../../src/integrations/retell/client.js';

export function getBookingTools(appUrl: string, toolSecret: string, businessId: string): RetellTool[] {
  return [
    {
      type: 'end_call',
      name: 'end_call',
    },
    {
      type: 'custom',
      name: 'check_availability',
      description: 'Check available appointment slots. Call this after collecting postcode, issue details, and urgency from the caller. Returns a list of free time slots.',
      url: `${appUrl}/api/calendar/availability?bid=${businessId}`,
      method: 'POST',
      headers: { 'x-tool-secret': toolSecret },
      parameters: {
        type: 'object',
        properties: {
          date_from: { type: 'string', description: 'Start date in YYYY-MM-DD format. Use today if the caller wants something soon.' },
          date_to: { type: 'string', description: 'End date in YYYY-MM-DD format. Usually 3-5 days from date_from.' },
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
      url: `${appUrl}/api/calendar/book?bid=${businessId}`,
      method: 'POST',
      headers: { 'x-tool-secret': toolSecret },
      parameters: {
        type: 'object',
        properties: {
          service_name: { type: 'string', description: 'Name of the service being booked' },
          start_time: { type: 'string', description: 'ISO 8601 start time of the confirmed slot' },
          caller_name: { type: 'string', description: 'Full name of the caller' },
          caller_phone: { type: 'string', description: 'Phone number of the caller' },
          caller_email: { type: 'string', description: 'Email address if provided' },
          postcode: { type: 'string', description: 'Caller postcode' },
          issue_details: { type: 'string', description: 'Description of the issue or job needed' },
        },
        required: ['service_name', 'start_time', 'caller_name'],
      },
      speak_during_execution: true,
      speak_after_execution: true,
    },
  ];
}

export function getDefaultTools(): RetellTool[] {
  return [{ type: 'end_call', name: 'end_call' }];
}
