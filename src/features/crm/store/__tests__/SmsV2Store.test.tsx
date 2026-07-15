import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { SmsV2Provider, useSmsV2, type SmsV2API } from '../SmsV2Store';
import type { Contact } from '../../types';

// Helper: render the provider, capture the API surface, and run a callback
// that drives store mutations through act().
function withStore(run: (api: SmsV2API) => void): void {
  let api: SmsV2API | null = null;
  function Probe(): null {
    api = useSmsV2();
    return null;
  }
  function Wrapper({ children }: { children: ReactNode }) {
    return <SmsV2Provider>{children}</SmsV2Provider>;
  }
  render(
    <Wrapper>
      <Probe />
    </Wrapper>
  );
  if (!api) throw new Error('store not ready');
  // captured api closes over the latest reducer state via SmsV2API getters
  // (selectors), so callers can re-read after dispatching.
  run(api);
}

// useSmsV2 returns a memoised object that updates when state changes.
// To re-read state after dispatch, render a probe that pushes the api
// into a ref each render.
function withLiveStore(run: (getApi: () => SmsV2API) => void): void {
  const apiRef: { current: SmsV2API | null } = { current: null };
  function Probe(): null {
    const api = useSmsV2();
    useEffect(() => {
      apiRef.current = api;
    });
    apiRef.current = api;
    return null;
  }
  render(
    <SmsV2Provider>
      <Probe />
    </SmsV2Provider>
  );
  run(() => {
    if (!apiRef.current) throw new Error('store not ready');
    return apiRef.current;
  });
}

const REAL_A: Contact = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Real A',
  phone: '+447700900001',
  tags: [],
  isHot: false,
  customFields: {},
  createdAt: '2026-04-25T00:00:00Z',
};

const REAL_B: Contact = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Real B',
  phone: '+447700900002',
  tags: [],
  isHot: false,
  customFields: {},
  createdAt: '2026-04-25T01:00:00Z',
};

describe('SmsV2Store initialState', () => {
  it('contacts is empty (no mock seed)', () => {
    withStore((api) => {
      expect(api.contacts).toEqual([]);
    });
  });

  it('columns is empty (no mock pipeline seed)', () => {
    withStore((api) => {
      expect(api.columns).toEqual([]);
    });
  });

  it('agents is empty (no mock agent seed)', () => {
    withStore((api) => {
      expect(api.agents).toEqual([]);
    });
  });

  it('queue is empty', () => {
    withStore((api) => {
      expect(api.queue).toEqual([]);
    });
  });
});

describe('SmsV2Store setContacts (atomic replace)', () => {
  it('replaces contacts entirely with the supplied list', () => {
    withLiveStore((getApi) => {
      act(() => {
        getApi().upsertContact(REAL_A);
      });
      expect(getApi().contacts).toHaveLength(1);

      act(() => {
        getApi().setContacts([REAL_B]);
      });

      expect(getApi().contacts).toEqual([REAL_B]);
    });
  });

  it('rebuilds queue from the new contacts list', () => {
    withLiveStore((getApi) => {
      act(() => {
        getApi().setContacts([REAL_A, REAL_B]);
      });
      expect(getApi().queue).toEqual([REAL_A.id, REAL_B.id]);
    });
  });

  it('clears queue when contacts replaced with empty list', () => {
    withLiveStore((getApi) => {
      act(() => {
        getApi().setContacts([REAL_A]);
      });
      expect(getApi().queue).toEqual([REAL_A.id]);

      act(() => {
        getApi().setContacts([]);
      });
      expect(getApi().queue).toEqual([]);
      expect(getApi().contacts).toEqual([]);
    });
  });
});

describe('SmsV2Store upsertContact (additive)', () => {
  it('adds a single contact to an empty store', () => {
    withLiveStore((getApi) => {
      act(() => {
        getApi().upsertContact(REAL_A);
      });
      expect(getApi().contacts).toEqual([REAL_A]);
    });
  });

  it('updates an existing contact in place', () => {
    withLiveStore((getApi) => {
      act(() => {
        getApi().upsertContact(REAL_A);
        getApi().upsertContact({ ...REAL_A, name: 'Real A Updated' });
      });
      expect(getApi().contacts).toHaveLength(1);
      expect(getApi().contacts[0].name).toBe('Real A Updated');
    });
  });
});
