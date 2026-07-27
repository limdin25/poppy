import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveTrade } from '../api/lib/trades';
import { renderErrorText } from '../src/features/crm/lib/funnelStages';

// Hugo 2026-07-27, on a failed render: "it says render failed, maybe website is
// broken". It was not the website. Clean Blue Water Ltd's site was fine; the
// pipeline refused because we had no TRADE for them, so it could not name
// competitors without inventing them. The panel blamed the website because it
// blamed the website for every failure.

const ENFIELD_PLUMBER = {
  town: 'Enfield',
  website: 'https://cleanbluewater.uk/',
  plumbers_ahead: '3',
  total_plumbers: '120',
  google_search_url: 'https://www.google.com/maps/search/plumbers+Enfield/',
};

describe('the trade a lead was ranked under', () => {
  it('reads the search their own ranking data came from', () => {
    const t = resolveTrade(ENFIELD_PLUMBER, 'Enfield', 'Clean Blue Water Ltd');
    expect(t.key).toBe('plumber');
    expect(t.source).toBe('search');
    expect(t.profile).not.toBeNull(); // i.e. it can render
  });

  it('reads it from the importer’s counter keys too', () => {
    const t = resolveTrade({ total_electricians: '90' }, 'Bath', 'Nondescript Ltd');
    expect(t.key).toBe('electrician');
    expect(t.profile).not.toBeNull();
  });

  it('still refuses a trade we have no vocabulary for', () => {
    // The guard is the point: never invent competitor names for a florist.
    const t = resolveTrade(
      { google_search_url: 'https://www.google.com/maps/search/florists+Bath/' },
      'Bath', 'Nondescript Ltd',
    );
    expect(t.profile).toBeNull();
  });

  it('lets Google’s own category outrank the search term', () => {
    const t = resolveTrade(
      { google_category: 'Electrician', ...ENFIELD_PLUMBER }, 'Enfield', 'X Ltd',
    );
    expect(t.key).toBe('electrician');
    expect(t.source).toBe('category');
  });

  it('does not let the town leak into the trade', () => {
    const t = resolveTrade(
      { google_search_url: 'https://www.google.com/maps/search/plumbers+Enfield/' },
      'Enfield', 'X Ltd',
    );
    expect(t.key).toBe('plumber');
  });

  it('builds its vocabulary from TRADES, so there is no second list to drift', () => {
    const src = readFileSync(resolve(__dirname, '..', 'api/lib/trades.ts'), 'utf8');
    expect(src).toMatch(/Object\.entries\(TRADES\)\.flatMap/);
  });
});

describe('what a failed render tells the agent', () => {
  it('names the real cause instead of blaming the website', () => {
    const msg = renderErrorText('no trade profile for this lead (trade=unknown, category="")');
    expect(msg).toMatch(/trade/i);
    expect(msg).not.toMatch(/website/i);
  });

  it('still says "website" when the website really was the problem', () => {
    expect(renderErrorText('net::ERR_CONNECTION_TIMED_OUT loading website'))
      .toMatch(/website/i);
  });

  it('falls back to the raw error rather than inventing one', () => {
    expect(renderErrorText('something nobody has seen before')).toBe('something nobody has seen before');
    expect(renderErrorText(null)).toMatch(/failed to render/i);
  });

  it('carries no long dash', () => {
    for (const e of [null, 'no trade profile', 'real competitors above', 'missing town', 'website']) {
      expect(renderErrorText(e)).not.toContain('—');
    }
  });
});

describe('the board can rescue a card stuck in Created', () => {
  const board = readFileSync(
    resolve(__dirname, '..', 'src/features/crm/pages/VideoFunnelPage.tsx'), 'utf8',
  );

  it('offers the video on a card with no render, AND on one that failed', () => {
    // A failed card used to say "retry from the dialer", which meant leaving the
    // board, finding the lead in the queue and reopening the panel. Two of them
    // sat dead for half an hour on 2026-07-27 because of a transient network
    // blip during a deploy.
    expect(board).toMatch(/data-testid=\{`funnel-make-video-\$\{p\.id\}`\}/);
    expect(board).toMatch(/\(!p\.render_status \|\| p\.render_status === 'failed'\) && \(/);
    expect(board).toMatch(/Try the video again/);
    // and the card names the real cause rather than guessing
    expect(board).toMatch(/renderErrorText\(p\.render_error\)/);
    expect(board).not.toMatch(/retry from the dialer/);
  });

  it('queues the render WITHOUT arming a send', () => {
    // There is no call in progress and no message on screen here, so arming
    // would be the blind send that was removed on 2026-07-27.
    const fn = (board.split('const makeVideo = useCallback')[1]?.split('}, []);')[0] ?? '')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(fn).toMatch(/request_render: true/);
    expect(fn).not.toMatch(/auto_send/);
  });
});
