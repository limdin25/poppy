import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useDemoMode } from '../useDemoMode';

function wrapAt(path: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  );
}

describe('useDemoMode', () => {
  it('returns false by default (no query string)', () => {
    const { result } = renderHook(() => useDemoMode(), {
      wrapper: wrapAt('/admin/crm/contacts'),
    });
    expect(result.current).toBe(false);
  });

  it('returns false when demo=0', () => {
    const { result } = renderHook(() => useDemoMode(), {
      wrapper: wrapAt('/admin/crm/calls?demo=0'),
    });
    expect(result.current).toBe(false);
  });

  it('returns true when demo=1', () => {
    const { result } = renderHook(() => useDemoMode(), {
      wrapper: wrapAt('/admin/crm/calls?demo=1'),
    });
    expect(result.current).toBe(true);
  });

  it('returns false when demo=true (only "1" enables — strict)', () => {
    const { result } = renderHook(() => useDemoMode(), {
      wrapper: wrapAt('/admin/crm/calls?demo=true'),
    });
    expect(result.current).toBe(false);
  });

  it('combines with other params correctly', () => {
    const { result } = renderHook(() => useDemoMode(), {
      wrapper: wrapAt('/admin/crm/calls?foo=bar&demo=1&x=y'),
    });
    expect(result.current).toBe(true);
  });
});
