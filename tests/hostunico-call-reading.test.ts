import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { hostunicoCallerName } from '../src/features/crm/lib/hostunicoCaller';
import CallTextSizeControls, { readCallTextSize, saveCallTextSize } from '../src/features/crm/components/live-call/CallTextSizeControls';
import HostunicoScriptPane from '../src/features/crm/components/live-call/HostunicoScriptPane';
import HostunicoCoachView from '../src/features/crm/components/live-call/HostunicoCoachView';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const identity = {
  signedInName: 'Hugo', isAdmin: true, loading: false,
  viewAsId: 'pedro', viewAsName: 'Pedro Almedina', assignedAgentId: 'marr',
  agents: new Map([['pedro', { name: 'Pedro Almedina' }], ['marr', { name: 'Marr Smith' }]]),
};
const coachProps = { lines: [], cards: [], active: true, offline: false, connected: true, opener: 'Hello', country: 'GB' };
afterEach(() => vi.unstubAllGlobals());

describe('Hostunico caller identity', () => {
  it('uses Pedro when an admin views Pedro and renders that name in the opener', () => {
    const agentName = hostunicoCallerName(identity);
    expect(agentName).toBe('Pedro');
    const html = renderToStaticMarkup(createElement(HostunicoScriptPane, { listing: null, agentName, onOpener: () => {} }));
    expect(html).toContain('Hi, this is Pedro here.');
    expect(html).not.toContain('Hugo from Hostunico');
    expect(html).not.toContain('Hi, this is Hugo here.');
  });
  it('uses the assigned seller outside view-as, with Pedro as the unresolved Hostunico fallback', () => {
    expect(hostunicoCallerName({ ...identity, viewAsId: null })).toBe('Marr');
    expect(hostunicoCallerName({ ...identity, viewAsId: null, assignedAgentId: undefined })).toBe('Pedro');
    expect(hostunicoCallerName({ ...identity, agents: new Map() })).toBe('Pedro');
    expect(hostunicoCallerName({ ...identity, loading: true })).toBe('Pedro');
    expect(hostunicoCallerName({ ...identity, viewAsName: null, agents: new Map([['pedro', { name: 'pedro@example.com' }]]) })).toBe('Pedro');
  });
  it('keeps the signed-in seller for non-admins despite stale view-as or a different assigned owner', () => {
    expect(hostunicoCallerName({ ...identity, isAdmin: false, signedInName: 'Maria Silva' })).toBe('Maria');
  });
});

describe('independent script and coach reading sizes', () => {
  it('persists each pane independently and uses its saved size when rendered again', () => {
    const localStorage = storage();
    vi.stubGlobal('window', { localStorage });
    expect(readCallTextSize('script')).toBe(24);
    expect(readCallTextSize('coach')).toBe(44);
    saveCallTextSize('script', 28);
    saveCallTextSize('coach', 36);
    expect(readCallTextSize('script')).toBe(28);
    expect(readCallTextSize('coach')).toBe(36);
    const script = renderToStaticMarkup(createElement(HostunicoScriptPane, { listing: null, agentName: 'Pedro', onOpener: () => {} }));
    const coach = renderToStaticMarkup(createElement(HostunicoCoachView, coachProps));
    expect(script).toContain('font-size:28px');
    expect(script).toContain('Increase script text size');
    expect(coach).toContain('font-size:36px');
    expect(coach).toContain('Decrease coach text size');
    expect(coach).not.toContain('font-size:28px');
  });
  it('bounds adjustments and survives invalid or blocked storage', () => {
    const local = storage();
    expect(saveCallTextSize('coach', 100, local)).toBe(64);
    expect(saveCallTextSize('script', 0, local)).toBe(18);
    local.setItem('hostunico:script-font-size', 'not a number');
    expect(readCallTextSize('script', local)).toBe(24);
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readCallTextSize('coach', blocked)).toBe(44);
    expect(saveCallTextSize('coach', 34, blocked)).toBe(34);
    const controls = renderToStaticMarkup(createElement(CallTextSizeControls, { pane: 'coach', size: 64, onChange: () => {} }));
    expect(controls).toMatch(/disabled="" aria-label="Increase coach text size"/);
  });
  it('enlarges notes, recent speech and history proportionally while keeping the next line dominant', () => {
    vi.stubGlobal('window', { localStorage: storage() });
    saveCallTextSize('script', 36);
    saveCallTextSize('coach', 42);
    const script = renderToStaticMarkup(createElement(HostunicoScriptPane, { listing: null, agentName: 'Pedro', onOpener: () => {} }));
    const coach = renderToStaticMarkup(createElement(HostunicoCoachView, {
      ...coachProps,
      lines: [{ id: 'spoken', speaker: 'agent', body: 'I can help with that.', ts: '1' }],
      cards: [{ id: 'old', body: 'Earlier advice.', ts: '1' }, { id: 'new', body: 'SAY: The next answer.\nASK: The next question?', ts: '2' }],
    }));
    expect(script).toMatch(/font-size:18px[^>]*>Wait for the answer\./);
    expect(script).toMatch(/font-size:18px[^>]*>1\. Start here/);
    expect(coach).toMatch(/font-size:17px[^>]*>I can help with that\./);
    expect(coach).toMatch(/font-size:17px[^>]*>Earlier advice\./);
    expect(coach).toMatch(/font-size:15px[^>]*>Then ask/);
    expect(coach).toMatch(/font-size:42px[^>]*>The next answer\./);
    // 3 Oct 2026: SAY is the biggest thing on screen; the question is three quarters of it.
    expect(coach).toMatch(/font-size:32px[^>]*>The next question\?/);
  });
});

describe('the next words stand apart from past speech', () => {
  it('renders the next line at 44px, the question at 33px and past speech small', () => {
    const html = renderToStaticMarkup(createElement(HostunicoCoachView, {
      ...coachProps,
      lines: [{ id: 'spoken', speaker: 'agent', body: 'I can help with that.', ts: '1' }],
      cards: [{ id: 'old', body: 'SAY: Earlier advice.', ts: '1' }, { id: 'new', body: 'SAY: You keep your account.\nASK: When is it available?', ts: '2' }],
    }));
    expect(html).toContain('Pedro just said');
    expect(html).toMatch(/text-xs[^>]*>I can help with that\./);
    expect(html).toMatch(/font-size:44px[^>]*data-testid="hostunico-next-line"[^>]*>You keep your account\./);
    expect(html).toMatch(/font-size:33px[^>]*data-testid="hostunico-next-question"[^>]*>When is it available\?/);
    expect(html).toMatch(/text-xs[^>]*>Earlier advice\./);
  });
  it('never promotes a stale suggestion after the lead speaks again', () => {
    const html = renderToStaticMarkup(createElement(HostunicoCoachView, {
      ...coachProps,
      lines: [{ id: 'lead', speaker: 'caller', body: 'The flat is available next week.', ts: '3' }],
      cards: [{ id: 'old', body: 'SAY: Old advice.\nASK: Old question?', ts: '2' }],
    }));
    const current = html.split('data-testid="hostunico-current-answer"')[1].split('</section>')[0];
    expect(current).toContain('Picking the next answer...');
    expect(current).not.toContain('Old advice');
    expect(current).not.toContain('Old question');
    expect(html).toContain('Earlier suggestions (1)');
  });
  it('keeps instant answers current and does not read a streaming placeholder aloud', () => {
    const html = renderToStaticMarkup(createElement(HostunicoCoachView, {
      ...coachProps,
      lines: [{ id: 'lead', speaker: 'caller', body: 'Not interested', ts: '3' }],
      cards: [{ id: 'old', body: 'SAY: Let me send it.', ts: '2' }],
    }));
    expect(html.split('data-testid="hostunico-current-answer"')[1].split('</section>')[0]).not.toContain('Let me send it');
    const streaming = renderToStaticMarkup(createElement(HostunicoCoachView, {
      ...coachProps,
      lines: [{ id: 'lead', speaker: 'caller', body: 'It is furnished.', ts: '1' }],
      cards: [{ id: 'new', body: '...', ts: '2', status: 'streaming' }],
    }));
    expect(streaming).toContain('Listening');
    expect(streaming).toContain('Picking the next answer...');
  });
});

describe('Pedro, 3 Oct 2026: a bigger coach that does not jump about', () => {
  it('lifts a size saved under the old smaller range and keeps a bigger one', () => {
    const small = storage(); small.setItem('hostunico:coach-font-size', '30');
    expect(readCallTextSize('coach', small)).toBe(44);
    const big = storage(); big.setItem('hostunico:coach-font-size', '48');
    expect(readCallTextSize('coach', big)).toBe(48);
    const now = storage(); saveCallTextSize('coach', 30, now);
    expect(readCallTextSize('coach', now)).toBe(30);
  });
  it('shows only whole sentences while a suggestion streams', () => {
    vi.stubGlobal('window', { localStorage: storage() });
    const coach = (body: string) => renderToStaticMarkup(createElement(HostunicoCoachView, { ...coachProps, lines: [{ id: 'c', speaker: 'caller', body: 'How does it work?', ts: '1' }], cards: [{ id: 'n', body, ts: '2', status: 'streaming' }] }));
    const half = coach('SAY: We run the listing. Guests let themsel');
    expect(half).toContain('We run the listing.');
    expect(half).not.toContain('Guests let themsel');
    expect(coach('SAY: We run the')).toContain('Picking the next answer');
    expect(coach('SAY: We run it. Guests let themselves in\nASK: Is it furnis')).toContain('Guests let themselves in');
    expect(coach('SAY: We run it.\nASK: Is it furnis')).not.toContain('Is it furnis');
  });
  it('gives the coach 60 percent of the room on desktop', async () => {
    const { readFileSync } = await import('node:fs');
    const room = readFileSync(new URL('../src/features/crm/components/live-call/SaCallRoom.tsx', import.meta.url), 'utf8');
    expect(room).toContain('md:grid-cols-[2fr_3fr]');
  });
});
