import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { hostunicoReportHook, type HostunicoReportPitch } from '../src/features/crm/lib/hostunicoReportPitch';
import HostunicoScriptPane from '../src/features/crm/components/live-call/HostunicoScriptPane';

const pitch: HostunicoReportPitch = { monthly: '£2,400', rent: '£1,000', difference: '£1,400', higher: true, areaEstimate: true, studioComparison: false, afterAirbnbFee: true };
const render = (reportPitch?: HostunicoReportPitch | null) => renderToStaticMarkup(createElement(HostunicoScriptPane, { listing: null, agentName: 'Pedro', onOpener: () => {}, reportPitch }));

describe('first-call report comparison', () => {
  it('uses actual supplied figures with the fee basis and no profit promise', () => {
    const copy = hostunicoReportHook(pitch);
    expect(copy).toContain('The area estimate shows about £2,400 a month versus your asking rent of £1,000');
    expect(copy).toContain('after the Airbnb fee, before our management fee and running costs');
    expect(copy).toContain('£1,400 higher before those costs');
    expect(copy).toContain('not guaranteed profit');
    expect(copy).toMatch(/Can I send you the report\?$/);
    expect(copy).not.toMatch(/[\u2013\u2014]/);
  });
  it('labels a studio proxy and never claims a lower estimate is higher', () => {
    const copy = hostunicoReportHook({ ...pitch, monthly: '$900', rent: '$1,000', difference: '$100', higher: false, studioComparison: true, afterAirbnbFee: false });
    expect(copy).toContain('one-bedroom area comparison for your studio');
    expect(copy).toContain('before the Airbnb fee');
    expect(copy).not.toContain('higher');
    expect(copy).not.toContain('£');
  });
  it('does not invent rent, uplift or completed research when unavailable', () => {
    expect(hostunicoReportHook({ ...pitch, rent: null, difference: null })).not.toMatch(/asking rent|higher/);
    for (const unavailable of [undefined, null, { ...pitch, monthly: '' }]) {
      const copy = hostunicoReportHook(unavailable);
      expect(copy).toContain('Can I prepare a report');
      expect(copy).toContain('send it when it is ready');
      expect(copy).not.toMatch(/£|\$|shows about|I have prepared/);
    }
  });
  it('switches report figures with props and puts permission before collection and optional qualification', () => {
    const first = render(pitch);
    const next = render({ ...pitch, monthly: '£1,800', rent: '£900', difference: '£900', areaEstimate: false });
    expect(first).toContain('£2,400');
    expect(next).toContain('The property estimate shows about £1,800');
    expect(next).not.toContain('£2,400');
    expect(next.indexOf('Is it still available?')).toBeLessThan(next.indexOf('Can I send you the report?'));
    expect(next.indexOf('Can I send you the report?')).toBeLessThan(next.indexOf('What mobile number or email'));
    expect(next.indexOf('What mobile number or email')).toBeLessThan(next.indexOf('Optional details after permission'));
    expect(next).toContain('only after a successful manual send');
    expect(render()).toContain('send it when it is ready');
  });
});
