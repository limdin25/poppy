import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { hostunicoReportIntroduction, hostunicoReportHook, hostunicoReportRecipient, type HostunicoReportPitch } from '../src/features/crm/lib/hostunicoReportPitch';
import HostunicoScriptPane from '../src/features/crm/components/live-call/HostunicoScriptPane';

const pitch: HostunicoReportPitch = { monthly: '£2,400', rent: '£1,000', difference: '£1,400', higher: true, areaEstimate: true, studioComparison: false, afterAirbnbFee: true };
const render = (reportPitch?: HostunicoReportPitch | null) => renderToStaticMarkup(createElement(HostunicoScriptPane, { listing: null, agentName: 'Pedro', onOpener: () => {}, reportPitch }));

describe('first-call report comparison', () => {
  it('uses actual supplied figures in a short spoken pitch', () => {
    const copy = hostunicoReportHook(pitch);
    expect(copy).toContain("it shows you could make around £2,400 a month, compared with the £1,000 you're asking");
    expect(copy).toContain("I've put together a report for your property");
    expect(copy).not.toMatch(/rough guide|proxy|guarantee|before.*costs|after.*fee/);
    expect(copy).toMatch(/Would you like me to send you the report so you can have a look and see if it's something you'd like to explore\?$/);
    expect(copy).not.toMatch(/[\u2013\u2014]/);
  });
  it('keeps studio methodology in the report and never claims a lower estimate is higher', () => {
    const copy = hostunicoReportHook({ ...pitch, monthly: '$900', rent: '$1,000', difference: '$100', higher: false, studioComparison: true, afterAirbnbFee: false });
    expect(copy).toContain("around $900 a month, compared with the $1,000 you're asking");
    expect(copy).not.toMatch(/one-bedroom|rough guide|more|higher/);
    expect(copy).not.toContain('£');
  });
  it('does not invent rent, uplift or completed research when unavailable', () => {
    expect(hostunicoReportHook({ ...pitch, rent: null, difference: null })).not.toMatch(/you're asking|compared with/);
    for (const unavailable of [undefined, null, { ...pitch, monthly: '' }]) {
      const copy = hostunicoReportHook(unavailable);
      expect(copy).toContain('Would you like me to prepare that');
      expect(copy).toContain('send it when it is ready');
      expect(copy).not.toMatch(/£|\$|shows about|I've put together/);
      expect(hostunicoReportIntroduction()).not.toContain('I have put together');
    }
  });
  it('switches report figures and keeps call one to permission, report, receipt and callback', () => {
    const first = render(pitch);
    const next = render({ ...pitch, monthly: '£1,800', rent: '£900', difference: '£900', areaEstimate: false });
    expect(first).toContain('£2,400');
    expect(next).toContain('it shows you could make around £1,800');
    expect(next).not.toContain('£2,400');
    expect(next.indexOf('Is it still available?')).toBeLessThan(next.indexOf('Have you got one minute'));
    expect(next.indexOf('Have you got one minute')).toBeLessThan(next.indexOf('We partner with landlords'));
    expect(next.indexOf('We partner with landlords')).toBeLessThan(next.indexOf('around £1,800'));
    expect(next.indexOf('Would you like me to send you the report')).toBeLessThan(next.indexOf('What mobile number can I text'));
    const mainScript = next.split('Quick answers, including price')[0];
    expect(mainScript).not.toMatch(/available for guests|Before I send it, when|Optional details after permission|setup budget/);
    expect(mainScript).toContain('we run the entire process');
    expect(next).toContain('only after a successful manual send');
    expect(render()).toContain('send it when it is ready');
    expect(next).toContain('Would tomorrow work for a quick call');
    expect(hostunicoReportRecipient('+447700900123')).toBe('Perfect. Can I text it to this number?');
    expect(hostunicoReportRecipient('+442079460123')).toContain('What mobile number');
    expect(hostunicoReportRecipient('+442079460123', '+447700900456')).toContain('mobile ending 0456');
    expect(hostunicoReportRecipient('+12025550123')).toContain('What mobile number');
  });
});
