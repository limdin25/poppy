import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
const reports = vi.hoisted(() => ({ listings: [{ id: 'first', address: 'First property' }, { id: 'last-call', address: 'Property from the call' }] }));
vi.mock('../src/features/crm/hooks/useSaListings', () => ({ useSaListings: () => ({ ...reports, loading: false, error: null }) }));
vi.mock('../src/features/crm/components/live-call/SaReportPanel', () => ({ default: (props: any) => createElement('div', { 'data-property': props.listing?.id, 'data-contact': props.contactId }, 'Same manual report composer') }));
vi.mock('../src/features/crm/hooks/useCurrentAgent', () => ({ useCurrentAgent: () => ({ firstName: 'Pedro' }) }));
import { HostunicoReportContent } from '../src/features/crm/components/contacts/HostunicoReportButton';
it('opens the same saved property report from contact, pipeline and history without making a call', () => {
  const html = renderToStaticMarkup(createElement(HostunicoReportContent, { contact: { id: 'lead', name: 'Owner', phone: '+447700900123', customFields: { hostunico_listing_id: 'last-call' } } }));
  expect(html).toContain('data-property="last-call"');
  expect(html).toContain('data-contact="lead"');
  expect(html).toContain('Same manual report composer');
  expect(html).toContain('Property report to send');
});
