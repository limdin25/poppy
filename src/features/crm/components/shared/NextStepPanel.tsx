// NextStepPanel — the step this deal is on, in the dialer's left column, where
// the SMS fold-out used to be.
//
// Hugo 2026-08-12: "on that strip the next step is written now, as well as
// everywhere else." Same source as the chip on the pipeline card and the Deal
// process page: dealProcessSteps.ts. One list, three places, no drift.
//
// It opens folded to the three lines that matter (where we are, do now, done
// when) and expands to the full step with the messages to copy. Renders nothing
// when the deal has no step yet, so a card with no tag looks exactly as it did.

import { useState } from 'react';
import { ChevronDown, ArrowRight, Copy, Check } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { resolveStage, type DealTemplate } from '../templates/dealProcessSteps';

function CopyRow({ template }: { template: DealTemplate }) {
  const [copied, setCopied] = useState(false);
  const full = template.subject
    ? `Subject: ${template.subject}\n\n${template.body}`
    : template.body;
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(full).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="w-full flex items-center gap-1.5 text-left px-2 py-1.5 rounded-lg border border-[#E5E7EB] hover:bg-[#F9FAFB]"
    >
      {copied
        ? <Check className="w-3 h-3 text-[#15803D] flex-shrink-0" />
        : <Copy className="w-3 h-3 text-[#6B7280] flex-shrink-0" />}
      <span className="text-[11px] text-[#1A1A1A] flex-1 min-w-0 truncate">{template.label}</span>
      <span className="text-[9px] uppercase tracking-wide text-[#9CA3AF] flex-shrink-0">
        {copied ? 'Copied' : template.channel}
      </span>
    </button>
  );
}

export interface NextStepPanelProps {
  /** The raw value off the deal: a tag, a step number, or nothing. */
  value?: string | null;
  className?: string;
}

export default function NextStepPanel({ value, className = '' }: NextStepPanelProps) {
  const stage = resolveStage(value);
  const [open, setOpen] = useState(false);

  if (!stage) return null;

  return (
    <div
      className={cn('border-b border-[#E5E7EB] flex-shrink-0 bg-[#EEF2F8]/60', className)}
      data-testid="dialer-next-step"
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="dialer-next-step-toggle"
        className="w-full flex items-center gap-1.5 px-4 py-2 text-left hover:bg-[#EEF2F8] transition-colors"
      >
        <ArrowRight className="w-3 h-3 text-[#3C5A87] flex-shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-wide text-[#3C5A87] flex-shrink-0">
          Next step
        </span>
        <span className="text-[11px] font-semibold text-[#1A1A1A] truncate flex-1 min-w-0">
          {stage.tag}
        </span>
        <ChevronDown className={cn('w-3 h-3 text-[#6B7280] transition-transform flex-shrink-0', !open && '-rotate-90')} />
      </button>

      <div className="px-4 pb-2.5">
        <p className="text-[11px] leading-snug text-[#1A1A1A]">
          <span className="font-semibold">{stage.who}:</span> {stage.doNow}
        </p>

        {open && (
          <div className="mt-2 space-y-1.5 max-h-[40vh] overflow-y-auto">
            <p className="text-[11px] leading-snug text-[#6B7280]">{stage.where}</p>
            <p className="text-[10px] leading-snug text-[#6B7280]">
              <span className="font-semibold text-[#1A1A1A]">Done when:</span> {stage.doneWhen}
            </p>
            <ul className="space-y-1">
              {stage.points.map((point) => (
                <li key={point} className="text-[11px] leading-snug text-[#1A1A1A] pl-3 relative">
                  <span className="absolute left-0 top-[6px] w-1 h-1 rounded-full bg-[#3C5A87]" />
                  {point}
                </li>
              ))}
            </ul>
            {stage.templates.length > 0 && (
              <div className="space-y-1 pt-1">
                {stage.templates.map((t) => <CopyRow key={t.label} template={t} />)}
              </div>
            )}
            <a
              href="/admin/crm/deal-process"
              target="_blank"
              rel="noreferrer"
              className="block text-[10px] text-[#3C5A87] hover:underline pt-1"
            >
              The whole process, step by step
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
