// Pins the contract for the live transcript pane.
//   - When callId is null AND demo flag is off → render empty state, no mock data
//   - When callId is null AND ?demo=1 → fall back to MOCK transcripts (so the
//     internal demo deck still works)
//   - When callId is set → no mock leak even before the realtime channel
//     delivers anything

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { type ReactNode } from 'react';

// vi.mock factories are hoisted, so any helper must be inlined.
// The component fires backfill SELECTs on mount when callId is set —
// stub the chain to resolve with empty data so realtime is what
// drives the rendered output, matching how the existing tests assert.
vi.mock('@/integrations/supabase/client', () => {
  const buildQuery = () => {
    const q: Record<string, unknown> = {};
    q.select = vi.fn().mockReturnValue(q);
    q.eq = vi.fn().mockReturnValue(q);
    q.order = vi.fn().mockResolvedValue({ data: [], error: null });
    return q;
  };
  return {
    supabase: {
      from: vi.fn(buildQuery),
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      })),
      removeChannel: vi.fn(),
    },
  };
});

import LiveTranscriptPane from '../LiveTranscriptPane';
import { SmsV2Provider } from '../../../store/SmsV2Store';

beforeEach(() => {
  vi.clearAllMocks();
});

function renderWith(
  props: { callId: string | null; demo?: boolean; agentFirstName?: string },
  search?: string
) {
  return render(
    <MemoryRouter initialEntries={[search ?? '/admin/crm/inbox']}>
      <SmsV2Provider>
        <LiveTranscriptPane
          durationSec={30}
          contactId={'11111111-1111-1111-1111-111111111111'}
          callId={props.callId}
          agentFirstName={props.agentFirstName}
        />
      </SmsV2Provider>
    </MemoryRouter>
  );
}

describe('LiveTranscriptPane — no callId, no demo flag', () => {
  it('renders an explicit empty state, NOT MOCK_TRANSCRIPT', () => {
    const { container, queryByText } = renderWith({ callId: null });

    // The empty-state copy that PR-4 introduces. Must be present.
    expect(queryByText(/no active call/i)).not.toBeNull();

    // None of the mock transcript lines (e.g. "Hi Sarah", "deposit handling")
    // should leak into the DOM.
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/Sarah/i);
    expect(text).not.toMatch(/deposit handling/i);
    expect(text).not.toMatch(/Rightmove gross/i);
  });
});

describe('LiveTranscriptPane — with callId', () => {
  it('renders no mock data while waiting for the realtime channel', () => {
    const { container } = renderWith({
      callId: '22222222-2222-2222-2222-222222222222',
    });
    const text = container.textContent ?? '';
    // Same anti-mock guard while the live subscription has zero rows yet.
    expect(text).not.toMatch(/deposit handling/i);
    expect(text).not.toMatch(/Rightmove gross/i);
  });
});

describe('LiveTranscriptPane — ?demo=1 still allows the legacy mock fallback', () => {
  it('renders MOCK_TRANSCRIPT lines when ?demo=1 is in the URL and no callId', () => {
    const { container } = renderWith({ callId: null }, '/admin/crm/inbox?demo=1');
    const text = container.textContent ?? '';
    // At least one mock transcript line should be visible — we don't pin
    // exact wording (it can change), but presence indicates the fallback
    // path is still reachable behind the demo flag.
    expect(text.length).toBeGreaterThan(50);
  });
});

describe('LiveTranscriptPane — opener prefill (Hugo 2026-04-28)', () => {
  it('shows the synthetic opener card on call connect (no realtime events yet)', () => {
    const { getByTestId, container } = renderWith({
      callId: '33333333-3333-3333-3333-333333333333',
      agentFirstName: 'Hugo',
    });
    // Opener card present with a known testid.
    const openerCard = getByTestId('opener-card');
    expect(openerCard).toBeTruthy();
    // PR #575 (v8) rotates between 6 variants hourly. Each one uses
    // either "from Elsie" or "at Elsie" + "property WhatsApp group".
    // Loosen the regex to match either phrasing so the hour-of-day
    // doesn't determine pass/fail.
    const text = container.textContent ?? '';
    expect(text).toMatch(/Hugo/);
    expect(text).toMatch(/\bElsie\b/);
    expect(text).toMatch(/property WhatsApp group/);
    // The "OPENER · READ WHEN THEY PICK UP" badge tells the rep this
    // is a starter line, not a generated coach card.
    expect(text).toMatch(/OPENER/);
  });

  it('falls back to "Hugo" if no agentFirstName prop is provided', () => {
    const { container } = renderWith({
      callId: '44444444-4444-4444-4444-444444444444',
    });
    const text = container.textContent ?? '';
    expect(text).toMatch(/Hugo/);
    expect(text).toMatch(/\bElsie\b/);
  });

  it('does NOT show the opener card when callId is null (no live call)', () => {
    const { queryByTestId } = renderWith({ callId: null });
    expect(queryByTestId('opener-card')).toBeNull();
  });
});
