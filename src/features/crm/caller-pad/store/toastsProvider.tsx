// CallerToasts — global toast surface.
//
// Pure context-based toast queue. Replaces the console.warn placeholders
// in activeCallProvider + every settings save path. Toasts auto-dismiss
// after 4s (errors stay 7s); the user can dismiss manually.
//
// Usage:
//   const toasts = useCallerToasts();
//   toasts.push('Saved.', 'success');
//   toasts.push(`Could not place call: ${msg}`, 'error');

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, Info, AlertCircle, X } from 'lucide-react';

export type ToastKind = 'success' | 'info' | 'error';

interface Toast {
  id: string;
  text: string;
  kind: ToastKind;
}

interface ToastsApi {
  push: (text: string, kind?: ToastKind) => void;
  dismiss: (id: string) => void;
}

const Ctx = createContext<ToastsApi | null>(null);

let counter = 0;

export function CallerToastsProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (t) clearTimeout(t);
    timersRef.current.delete(id);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const push = useCallback<ToastsApi['push']>(
    (text, kind = 'info') => {
      const id = `t-${Date.now()}-${++counter}`;
      setToasts((prev) => [...prev, { id, text, kind }]);
      const ttl = kind === 'error' ? 7000 : 4000;
      const tm = setTimeout(() => dismiss(id), ttl);
      timersRef.current.set(id, tm);
    },
    [dismiss]
  );

  useEffect(() => {
    const map = timersRef.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const value = useMemo<ToastsApi>(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        className="fixed top-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none"
        data-feature="CALLER__TOASTS"
      >
        {toasts.map((t) => (
          <ToastBubble key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastBubble({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon =
    toast.kind === 'success'
      ? CheckCircle2
      : toast.kind === 'error'
        ? AlertCircle
        : Info;
  const tint =
    toast.kind === 'success'
      ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]'
      : toast.kind === 'error'
        ? 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
        : 'bg-white border-[#E5E7EB] text-[#1A1A1A]';
  return (
    <div
      role="status"
      className={`pointer-events-auto inline-flex items-start gap-2 px-3 py-2 rounded-[10px] border shadow-[0_4px_24px_rgba(0,0,0,0.08)] text-[12px] max-w-[360px] ${tint}`}
    >
      <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      <span className="flex-1 leading-relaxed">{toast.text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="opacity-50 hover:opacity-100 -mr-0.5 -mt-0.5 p-0.5"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export function useCallerToasts(): ToastsApi {
  const v = useContext(Ctx);
  if (!v) {
    // Safe fallback — log to console if the provider isn't mounted.
    return {
      push: (text, kind) => console.warn(`[caller toast:${kind ?? 'info'}]`, text),
      dismiss: () => {
        /* no-op */
      },
    };
  }
  return v;
}
