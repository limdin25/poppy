import type { RetellTool } from '../../src/integrations/retell/client.js';

const END_CALL: RetellTool = { type: 'end_call', name: 'end_call' };

function qs(businessId: string, agentId?: string): string {
  return agentId ? `bid=${businessId}&aid=${agentId}` : `bid=${businessId}`;
}

/** The two calendar tools (no end_call) — only attached when bookable services exist. */
function bookingCustomTools(appUrl: string, toolSecret: string, businessId: string, agentId?: string): RetellTool[] {
  const headers = { 'x-tool-secret': toolSecret };
  return [
    {
      type: 'custom',
      name: 'check_availability',
      description: 'Check available appointment slots. Call this when the caller wants to book a meeting or appointment. Returns a list of free time slots. If the result has zero slots, try again with a wider date range covering the next working days.',
      url: `${appUrl}/api/calendar/availability?${qs(businessId, agentId)}`,
      method: 'POST',
      headers,
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
      url: `${appUrl}/api/calendar/book?${qs(businessId, agentId)}`,
      method: 'POST',
      headers,
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

/** Real-time delivery tools — send email / SMS / WhatsApp to the caller mid-call. */
function messagingTools(appUrl: string, toolSecret: string, businessId: string, agentId?: string): RetellTool[] {
  const headers = { 'x-tool-secret': toolSecret };
  return [
    {
      type: 'custom',
      name: 'send_email',
      description: 'Send an email to the caller during the call (e.g. info, a quote, a summary, a link). Confirm the email address with the caller and read it back before sending.',
      url: `${appUrl}/api/tools/send-email?${qs(businessId, agentId)}`,
      method: 'POST',
      headers,
      parameters: {
        type: 'object',
        properties: {
          to_email: { type: 'string', description: 'The recipient email address, confirmed with the caller.' },
          subject: { type: 'string', description: 'Short subject line for the email.' },
          body: { type: 'string', description: 'The full message to send. Write it in clear, friendly language.' },
        },
        required: ['to_email', 'body'],
      },
      speak_during_execution: false,
      speak_after_execution: true,
    },
    {
      type: 'custom',
      name: 'send_sms',
      description: 'Send a text message (SMS) to the caller during the call. By default send it to the caller\'s own number ({{from_number}}) unless they give a different one.',
      url: `${appUrl}/api/tools/send-sms?${qs(businessId, agentId)}`,
      method: 'POST',
      headers,
      parameters: {
        type: 'object',
        properties: {
          to_phone: { type: 'string', description: 'Recipient phone number. Default to the caller\'s number {{from_number}} unless they give another.' },
          message: { type: 'string', description: 'The text message to send.' },
        },
        required: ['to_phone', 'message'],
      },
      speak_during_execution: false,
      speak_after_execution: true,
    },
    {
      type: 'custom',
      name: 'send_whatsapp',
      description: 'Send a WhatsApp message to the caller during the call. By default send it to the caller\'s own number ({{from_number}}) unless they give a different one.',
      url: `${appUrl}/api/tools/send-whatsapp?${qs(businessId, agentId)}`,
      method: 'POST',
      headers,
      parameters: {
        type: 'object',
        properties: {
          to_phone: { type: 'string', description: 'Recipient phone number. Default to the caller\'s number {{from_number}} unless they give another.' },
          message: { type: 'string', description: 'The WhatsApp message to send.' },
        },
        required: ['to_phone', 'message'],
      },
      speak_during_execution: false,
      speak_after_execution: true,
    },
  ];
}

/** Web research tool — look something up online mid-call (via Tavily). */
function webSearchTool(appUrl: string, toolSecret: string, businessId: string, agentId?: string): RetellTool {
  return {
    type: 'custom',
    name: 'web_search',
    description: 'Look something up on the web during the call when you do not already know the answer (e.g. current info, opening times of another place, prices, facts). Returns a short answer and sources.',
    url: `${appUrl}/api/tools/web-search?${qs(businessId, agentId)}`,
    method: 'POST',
    headers: { 'x-tool-secret': toolSecret },
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query — what you want to find out.' },
      },
      required: ['query'],
    },
    speak_during_execution: true,
    speak_after_execution: true,
  };
}

interface CallToolOptions {
  booking: boolean;
  webSearch: boolean;
}

/**
 * The full set of tools the voice agent gets when an internal tool secret is
 * configured: end_call + real-time messaging (email/SMS/WhatsApp) + optional
 * web search + optional calendar booking.
 */
export function getCallTools(
  appUrl: string,
  toolSecret: string,
  businessId: string,
  agentId: string | undefined,
  opts: CallToolOptions,
): RetellTool[] {
  const tools: RetellTool[] = [END_CALL, ...messagingTools(appUrl, toolSecret, businessId, agentId)];
  if (opts.webSearch) tools.push(webSearchTool(appUrl, toolSecret, businessId, agentId));
  if (opts.booking) tools.push(...bookingCustomTools(appUrl, toolSecret, businessId, agentId));
  return tools;
}

/** Calendar tools + end_call. Kept for backward compatibility / direct use. */
export function getBookingTools(appUrl: string, toolSecret: string, businessId: string, agentId?: string): RetellTool[] {
  return [END_CALL, ...bookingCustomTools(appUrl, toolSecret, businessId, agentId)];
}

/** Minimal toolset when no internal tool secret is configured. */
export function getDefaultTools(): RetellTool[] {
  return [END_CALL];
}
