import { describe, it, expect } from 'vitest';
import { getCallTools, getBookingTools, getDefaultTools } from '../api/lib/booking-tools';

const APP = 'https://app.heyelsie.com';
const SECRET = 'tool-secret-123';
const BID = 'biz-1';
const AID = 'agent-1';

function names(tools: { name: string }[]): string[] {
  return tools.map((t) => t.name);
}
function byName(tools: { name: string }[], name: string) {
  return tools.find((t) => t.name === name) as any;
}

describe('getCallTools', () => {
  it('always exposes end_call and the three real-time delivery tools', () => {
    const tools = getCallTools(APP, SECRET, BID, AID, { booking: false, webSearch: false });
    expect(names(tools)).toEqual(
      expect.arrayContaining(['end_call', 'send_email', 'send_sms', 'send_whatsapp']),
    );
  });

  it('includes web_search only when enabled', () => {
    const off = getCallTools(APP, SECRET, BID, AID, { booking: false, webSearch: false });
    expect(names(off)).not.toContain('web_search');
    const on = getCallTools(APP, SECRET, BID, AID, { booking: false, webSearch: true });
    expect(names(on)).toContain('web_search');
  });

  it('includes the calendar tools only when booking is enabled', () => {
    const off = getCallTools(APP, SECRET, BID, AID, { booking: false, webSearch: true });
    expect(names(off)).not.toContain('check_availability');
    expect(names(off)).not.toContain('book_appointment');
    const on = getCallTools(APP, SECRET, BID, AID, { booking: true, webSearch: true });
    expect(names(on)).toEqual(
      expect.arrayContaining(['check_availability', 'book_appointment']),
    );
  });

  it('points each delivery tool at the right endpoint with bid + aid and the tool secret', () => {
    const tools = getCallTools(APP, SECRET, BID, AID, { booking: false, webSearch: true });
    const email = byName(tools, 'send_email');
    expect(email.url).toBe(`${APP}/api/tools/send-email?bid=${BID}&aid=${AID}`);
    expect(email.headers['x-tool-secret']).toBe(SECRET);
    expect(byName(tools, 'send_sms').url).toContain('/api/tools/send-sms?bid=biz-1&aid=agent-1');
    expect(byName(tools, 'send_whatsapp').url).toContain('/api/tools/send-whatsapp?');
    expect(byName(tools, 'web_search').url).toContain('/api/tools/web-search?');
  });

  it('marks required params on each delivery tool', () => {
    const tools = getCallTools(APP, SECRET, BID, AID, { booking: false, webSearch: true });
    expect(byName(tools, 'send_email').parameters.required).toEqual(['to_email', 'body']);
    expect(byName(tools, 'send_sms').parameters.required).toEqual(['to_phone', 'message']);
    expect(byName(tools, 'send_whatsapp').parameters.required).toEqual(['to_phone', 'message']);
    expect(byName(tools, 'web_search').parameters.required).toEqual(['query']);
  });

  it('omits aid from the query string when no agent id is given', () => {
    const tools = getCallTools(APP, SECRET, BID, undefined, { booking: false, webSearch: false });
    expect(byName(tools, 'send_email').url).toBe(`${APP}/api/tools/send-email?bid=${BID}`);
  });
});

describe('legacy builders still work', () => {
  it('getBookingTools returns end_call + the two calendar tools', () => {
    expect(names(getBookingTools(APP, SECRET, BID, AID))).toEqual([
      'end_call', 'check_availability', 'book_appointment',
    ]);
  });

  it('getDefaultTools returns only end_call', () => {
    expect(names(getDefaultTools())).toEqual(['end_call']);
  });
});
