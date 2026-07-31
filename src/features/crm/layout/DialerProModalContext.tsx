import { createContext, useCallback, useContext, useState } from 'react';
import type { ScriptKey } from '@/features/crm/components/live-call/DialerScriptPane';

interface DialerProModalState {
  isOpen: boolean;
  isMinimized: boolean;
  contactId: string | null;
  pipelineColumnId: string | null;
  scriptKey: ScriptKey;
}

interface DialerProModalApi {
  openDialerPro: (contactId: string, opts?: { pipelineColumnId?: string; scriptKey?: ScriptKey }) => void;
  /** Drop the pending auto-call once it has been dialled — see below. */
  clearAutoCall: () => void;
  closeDialerPro: () => void;
  minimizeDialerPro: () => void;
  expandDialerPro: () => void;
  isOpen: boolean;
  isMinimized: boolean;
  contactId: string | null;
  pipelineColumnId: string | null;
  /** Which script the call room shows. Only the video funnel passes anything
   *  but the default, so every other Call button is unchanged. */
  scriptKey: ScriptKey;
}

const Ctx = createContext<DialerProModalApi | null>(null);

export function DialerProModalProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialerProModalState>({
    isOpen: false,
    isMinimized: false,
    contactId: null,
    pipelineColumnId: null,
    scriptKey: 'cold_call',
  });

  const openDialerPro = useCallback(
    (contactId: string, opts?: { pipelineColumnId?: string; scriptKey?: ScriptKey }) => {
      setState({
        isOpen: true,
        isMinimized: false,
        contactId,
        pipelineColumnId: opts?.pipelineColumnId ?? null,
        scriptKey: opts?.scriptKey ?? 'cold_call',
      });
    },
    [],
  );

  // Hugo 2026-07-24: contactId used to stick around after the auto-call
  // fired. Minimize unmounts the dialer content and expand remounts it, so
  // the same lead got dialled again on its own. Clearing it means the
  // auto-call happens exactly once, when the agent pressed Call.
  const clearAutoCall = useCallback(() => {
    setState((s) => (s.contactId === null ? s : { ...s, contactId: null }));
  }, []);

  const closeDialerPro = useCallback(() => {
    setState({ isOpen: false, isMinimized: false, contactId: null, pipelineColumnId: null, scriptKey: 'cold_call' });
  }, []);

  const minimizeDialerPro = useCallback(() => {
    setState((s) => ({ ...s, isMinimized: true }));
  }, []);

  const expandDialerPro = useCallback(() => {
    setState((s) => ({ ...s, isMinimized: false }));
  }, []);

  return (
    <Ctx.Provider
      value={{
        openDialerPro,
        clearAutoCall,
        closeDialerPro,
        minimizeDialerPro,
        expandDialerPro,
        isOpen: state.isOpen,
        isMinimized: state.isMinimized,
        contactId: state.contactId,
        pipelineColumnId: state.pipelineColumnId,
        scriptKey: state.scriptKey,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useDialerProModal(): DialerProModalApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDialerProModal must be used inside DialerProModalProvider');
  return ctx;
}
