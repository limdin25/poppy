import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import ContactMetaCompact from '../src/features/crm/components/live-call/ContactMetaCompact';
import HostunicoCallMessages from '../src/features/crm/components/live-call/HostunicoCallMessages';
import { hostunicoReportDelivery } from '../supabase/functions/_shared/hostunico-report-delivery';
import { scriptForContactFields } from '../src/features/crm/lib/scriptForCall';
import { hostunicoCallStep } from '../supabase/functions/_shared/hostunico-call-step';

vi.mock('../src/features/crm/store/SmsV2Store', () => ({ useSmsV2: () => ({ columns: [] }) }));
vi.mock('../src/features/crm/components/live-call/VideoLinkButton', () => ({ default: () => 'OLD VIDEO' }));
vi.mock('../src/features/crm/components/live-call/SubscribeButton', () => ({ default: () => 'OLD SUBSCRIPTION' }));
vi.mock('../src/features/crm/components/live-call/SendSiteButton', () => ({ default: () => 'OLD WEBSITE' }));
vi.mock('../src/features/crm/hooks/useContactMessages', () => ({ useContactMessages: (contactId: string) => ({ loading: false, error: null, messages: [{ id: contactId, direction: 'inbound', body: `Reply from ${contactId}`, createdAt: '2026-10-01T07:00:00Z', channel: 'sms', status: 'received', mediaUrls: [] }] }) }));

describe('Hostunico calling audit', () => {
  const base = { id: 'test', name: 'Test', phone: '+447700900123', tags: [], customFields: {} } as any;
  it.each(['hostunico_owner', 'sa_agency'])('hides all retired sales actions for %s', (lead_type) => {
    const html = renderToStaticMarkup(createElement(ContactMetaCompact, { contact: { ...base, customFields: { lead_type, rank: '5', website: 'old-product.example' } } }));
    expect(html).not.toMatch(/OLD VIDEO|OLD SUBSCRIPTION|OLD WEBSITE|rank #|old-product.example/);
    expect(scriptForContactFields({ lead_type })).toBe('sa_call');
  });
  it('also protects an unlabelled contact in the Hostunico room, while retaining other desks', () => {
    expect(renderToStaticMarkup(createElement(ContactMetaCompact, { contact: base, isHostunico: true }))).not.toContain('OLD');
    expect(renderToStaticMarkup(createElement(ContactMetaCompact, { contact: base }))).toContain('OLD VIDEO');
  });
  it('renders the current contact messages next to the composer', () => {
    const first = renderToStaticMarkup(createElement(HostunicoCallMessages, { contactId: 'first' }));
    const second = renderToStaticMarkup(createElement(HostunicoCallMessages, { contactId: 'second' }));
    expect(first).toContain('Reply from first');
    expect(second).toContain('Reply from second');
    expect(second).not.toContain('Reply from first');
    const room = readFileSync('src/features/crm/components/live-call/SaCallRoom.tsx', 'utf8');
    expect(room).not.toContain('setEmailReport');
    expect(room).toContain('contactId={contact.id} contactEmail={contact.email}');
    const inbound = readFileSync('src/features/crm/components/live-call/LiveCallScreen.tsx', 'utf8');
    expect(inbound.match(/lead_type === 'hostunico_owner'/g)).toHaveLength(2);
  });
  it('recognises a sent email as report delivery, without mistaking drafts, failure or another report', () => {
    const message = { body: 'Your report: https://hostunico.com/r/A1b2C', status: 'queued', channel: 'email', created_at: '2026-10-01T07:00:00Z' };
    expect(hostunicoReportDelivery('https://hostunico.com/r/A1b2C', [message])).toEqual(message);
    expect(hostunicoReportDelivery('https://hostunico.com/r/X9y8Z', [message])).toBeNull();
    for (const status of ['draft', 'discarded', 'failed', 'undelivered']) expect(hostunicoReportDelivery('https://hostunico.com/r/A1b2C', [{ ...message, status }])).toBeNull();
    expect(hostunicoReportDelivery(null, [message])).toBeNull();
  });
  it('answers first-call permission immediately with the real comparison and never invents a missing report', () => {
    const input = { mode: 'spareroom', latestCaller: 'Okay, tell me more.', transcript: [{ speaker: 'agent', body: 'Have you got one minute for me to explain why I called?' }], report: { state: 'ready', report_pitch: { monthly: '£2,268', rent: '£1,250', difference: '£1,018', higher: true, areaEstimate: true, studioComparison: false, afterAirbnbFee: true } } };
    const answer = hostunicoCallStep(input)!;
    expect(answer).toContain('We partner with landlords');
    expect(answer).toContain('£2,268 a month, compared with the £1,250');
    expect(answer).toContain('ASK: Would you like me to send');
    expect(hostunicoCallStep({ ...input, report: null })).not.toMatch(/£|I've put together|it shows/);
    expect(hostunicoCallStep({ ...input, report: { ...input.report, state: 'queued' } })).not.toContain('£2,268');
    expect(hostunicoCallStep({ ...input, mode: 'followup' })).toBeNull();
    expect(hostunicoCallStep({ ...input, latestCaller: 'Yes but how do you handle the keys?' })).toBeNull();
    expect(hostunicoCallStep({ ...input, transcript: [{ speaker: 'agent', body: 'Would you like me to explain cleaning?' }] })).toBeNull();
  });
  it('goes from confirmed email receipt to callback, without restarting the pitch', () => {
    const input = { mode: 'spareroom', latestCaller: 'Yes I got your email, thanks.', transcript: [], report: { latestDelivery: { channel: 'email', status: 'queued' } } };
    expect(hostunicoCallStep(input)).toContain('Would tomorrow work for a quick call');
    expect(hostunicoCallStep({ ...input, report: null })).toBeNull();
    expect(hostunicoCallStep({ ...input, latestCaller: 'I got your email, but what does it cost?' })).toBeNull();
  });
});
