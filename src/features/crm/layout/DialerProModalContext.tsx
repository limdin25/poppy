import { createContext, useCallback, useContext, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import type { ScriptKey } from '@/features/crm/components/live-call/DialerScriptPane';
import { scriptForContactFields } from '@/features/crm/lib/scriptForCall';

interface DialerProModalState {
  isOpen: boolean;
  isMinimized: boolean;
  contactId: string | null;
  pipelineColumnId: string | null;
  scriptKey: ScriptKey;
  autoDial: boolean;
}

interface DialerProModalApi {
  openDialerPro: (contactId: string, opts?: { pipelineColumnId?: string; scriptKey?: ScriptKey; autoDial?: boolean }) => void;
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
  /** False = open the room and wait for the agent to press Call. Only the
   *  video funnel passes false; every other Call button still dials at once. */
  autoDial: boolean;
}

const Ctx = createContext<DialerProModalApi | null>(null);

export function DialerProModalProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialerProModalState>({
    isOpen: false,
    isMinimized: false,
    contactId: null,
    pipelineColumnId: null,
    scriptKey: 'cold_call',
    autoDial: true,
  });

  const openDialerPro = useCallback(
    (contactId: string, opts?: { pipelineColumnId?: string; scriptKey?: ScriptKey; autoDial?: boolean }) => {
      const openWith = (scriptKey: ScriptKey) => setState({
        isOpen: true,
        isMinimized: false,
        contactId,
        pipelineColumnId: opts?.pipelineColumnId ?? null,
        scriptKey,
        autoDial: opts?.autoDial ?? true,
      });
      // A button that names a script knows better than the contact (the
      // cockpit says property_call, the video funnel says vsl_close).
      if (opts?.scriptKey) { openWith(opts.scriptKey); return; }
      // THE CONTACT DECIDES (2026-08-18). Every unlabelled Call button used to
      // fall straight to cold_call, so the phone icon on a property card
      // opened the reviews sales script on an estate agent, again (pipeline
      // board, inbox, contacts, contact detail, follow-up banner: none name a
      // script). Resolved BEFORE the room opens, not after: the room stamps
      // wk_calls.script_key at dial time, and the coach and the daily report
      // grade off that stamp, so a script that flips after the dial has
      // already poisoned both. The lookup is one indexed select and the modal
      // opens when it lands; on any failure the old default stands.
      void (async () => {
        let scriptKey: ScriptKey = 'cold_call';
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data } = await (supabase.from('wk_contacts' as any) as any)
            .select('custom_fields')
            .eq('id', contactId)
            .maybeSingle();
          scriptKey = scriptForContactFields(data?.custom_fields) ?? 'cold_call';
        } catch {
          // The contact could not be read, so the old default stands.
        }
        openWith(scriptKey);
      })();
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
    setState({ isOpen: false, isMinimized: false, contactId: null, pipelineColumnId: null, scriptKey: 'cold_call', autoDial: true });
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
        autoDial: state.autoDial,
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
