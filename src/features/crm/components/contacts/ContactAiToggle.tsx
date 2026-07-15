import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';

/**
 * Per-contact AI warm-up switch. Reads/writes wk_contacts.ai_enabled directly
 * (independent of the SmsV2 store). When off, the AI never auto-replies to this
 * lead — the VA owns the conversation.
 */
export default function ContactAiToggle({ contactId }: { contactId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (supabase.from('wk_contacts') as any)
      .select('ai_enabled')
      .eq('id', contactId)
      .maybeSingle()
      .then(({ data }: { data: { ai_enabled?: boolean } | null }) => {
        if (active) setEnabled(data?.ai_enabled ?? true);
      });
    return () => { active = false; };
  }, [contactId]);

  const toggle = async () => {
    if (enabled === null) return;
    const next = !enabled;
    setEnabled(next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('wk_contacts') as any).update({ ai_enabled: next }).eq('id', contactId);
  };

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-1">
        AI warm-up
      </div>
      <button
        onClick={toggle}
        disabled={enabled === null}
        className="flex items-center gap-2 text-[13px] text-[#1A1A1A]"
      >
        <Bot className="w-3.5 h-3.5 text-[#3C5A87]" />
        <span className={`w-9 h-5 rounded-full transition-colors relative ${enabled ? 'bg-[#3C5A87]' : 'bg-[#D1D5DB]'}`}>
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
        </span>
        <span className="text-[12px] text-[#6B7280]">{enabled === null ? '…' : enabled ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}
