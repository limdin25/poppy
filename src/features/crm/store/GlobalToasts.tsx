import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { useSmsV2 } from './SmsV2Store';

const ICON = {
  success: CheckCircle2,
  info: Info,
  error: AlertCircle,
} as const;

const STYLE = {
  success: 'bg-[#EEF2F8] border-[#3C5A87]/30 text-[#3C5A87]',
  info: 'bg-[#EFF6FF] border-[#3B82F6]/30 text-[#1D4ED8]',
  error: 'bg-[#FEF2F2] border-[#EF4444]/30 text-[#B91C1C]',
} as const;

/**
 * Global toast stack — bottom-right, above the softphone.
 * Listens to store.toasts (auto-dismissed after 4s by SmsV2Store).
 */
export default function GlobalToasts() {
  const { toasts, dismissToast } = useSmsV2();

  return (
    <div className="fixed bottom-[120px] right-5 z-[300] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex items-start gap-2 px-3 py-2 rounded-xl border shadow-[0_8px_24px_rgba(0,0,0,0.08)] max-w-[360px] animate-in slide-in-from-right-2',
              STYLE[t.kind]
            )}
          >
            <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="text-[12px] font-medium leading-snug flex-1">{t.text}</span>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-current opacity-50 hover:opacity-100"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
