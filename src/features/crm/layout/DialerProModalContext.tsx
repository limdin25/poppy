import { createContext, useCallback, useContext, useState } from 'react';

interface DialerProModalState {
  isOpen: boolean;
  isMinimized: boolean;
  contactId: string | null;
  pipelineColumnId: string | null;
}

interface DialerProModalApi {
  openDialerPro: (contactId: string, opts?: { pipelineColumnId?: string }) => void;
  closeDialerPro: () => void;
  minimizeDialerPro: () => void;
  expandDialerPro: () => void;
  isOpen: boolean;
  isMinimized: boolean;
  contactId: string | null;
  pipelineColumnId: string | null;
}

const Ctx = createContext<DialerProModalApi | null>(null);

export function DialerProModalProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialerProModalState>({
    isOpen: false,
    isMinimized: false,
    contactId: null,
    pipelineColumnId: null,
  });

  const openDialerPro = useCallback(
    (contactId: string, opts?: { pipelineColumnId?: string }) => {
      setState({
        isOpen: true,
        isMinimized: false,
        contactId,
        pipelineColumnId: opts?.pipelineColumnId ?? null,
      });
    },
    [],
  );

  const closeDialerPro = useCallback(() => {
    setState({ isOpen: false, isMinimized: false, contactId: null, pipelineColumnId: null });
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
        closeDialerPro,
        minimizeDialerPro,
        expandDialerPro,
        isOpen: state.isOpen,
        isMinimized: state.isMinimized,
        contactId: state.contactId,
        pipelineColumnId: state.pipelineColumnId,
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
