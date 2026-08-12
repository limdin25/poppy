// NextStepChip — the "what do I do with this one next" tag on a pipeline card.
//
// Hugo 2026-08-12: "on the card of the leads the next step is labeled there
// with the tag, and when we click on top of it or hover it shows exactly what
// we have to do, the information explaining what has to be done next."
//
// The tag itself comes from the deal, not from this component: the property
// brain writes `next_step` into wk_contacts.custom_fields and this reads it.
// The explanation behind the tag is the single list in
// components/templates/dealProcessSteps.ts, which also drives the Deal process
// tab on the Templates page. One list, so the card and the playbook can never
// drift apart.
//
// That file is named nothing like PropertyDealProcess.tsx on purpose: macOS is
// case insensitive, so when the data file was called propertyDealProcess.ts the
// component import resolved to the data file and the whole tab crashed with
// "does not provide an export named default".
//
// Renders nothing at all when there is no next step, so plumber leads and every
// other non-property card are untouched.

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, X, Copy, Check } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import {
  DEAL_STAGES,
  resolveStage,
  type DealTemplate,
} from '../templates/dealProcessSteps';

function TemplateRow({ template }: { template: DealTemplate }) {
  const [copied, setCopied] = useState(false);
  const full = template.subject
    ? `Subject: ${template.subject}\n\n${template.body}`
    : template.body;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(full).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="w-full flex items-center gap-1.5 text-left px-2 py-1.5 rounded-lg border border-[#E5E7EB] hover:bg-[#F9FAFB]"
    >
      {copied ? (
        <Check className="w-3 h-3 text-[#15803D] flex-shrink-0" />
      ) : (
        <Copy className="w-3 h-3 text-[#6B7280] flex-shrink-0" />
      )}
      <span className="text-[11px] text-[#1A1A1A] flex-1 min-w-0 truncate">
        {template.label}
      </span>
      <span className="text-[9px] uppercase tracking-wide text-[#9CA3AF] flex-shrink-0">
        {copied ? 'Copied' : template.channel}
      </span>
    </button>
  );
}

export interface NextStepChipProps {
  /** The raw value off the card: a tag, a step number, or nothing. */
  value?: string | null;
  className?: string;
}

export default function NextStepChip({ value, className = '' }: NextStepChipProps) {
  const stage = resolveStage(value);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  const close = useCallback(() => setAt(null), []);

  useEffect(() => {
    if (!at) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [at, close]);

  if (!stage) return null;

  // Hovering alone has to tell you something, so the whole step goes in the
  // native tooltip. Clicking gets the panel with the messages to send.
  const hover = [
    `Step ${stage.n} of ${DEAL_STAGES.length}: ${stage.title} (${stage.who})`,
    '',
    `Where we are: ${stage.where}`,
    `Do now: ${stage.doNow}`,
    `Done when: ${stage.doneWhen}`,
    '',
    ...stage.points.map((p) => `- ${p}`),
  ].join('\n');

  const PANEL_WIDTH = 300;

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        title={hover}
        aria-label={`Next step: ${stage.tag}. Click for what to do.`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (at) { close(); return; }
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setAt({
            left: Math.min(r.left, window.innerWidth - PANEL_WIDTH - 12),
            top: r.bottom + 6,
          });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setAt(at ? null : { left: r.left, top: r.bottom + 6 });
          }
        }}
        className={cn(
          'inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded cursor-pointer',
          'bg-[#3C5A87] text-white hover:bg-[#31486D]',
          className
        )}
        data-testid="next-step-chip"
      >
        <ArrowRight className="w-2.5 h-2.5" />
        {stage.tag}
      </span>

      {at &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[60]" onClick={(e) => { e.stopPropagation(); close(); }} />
            <div
              className="fixed z-[61] bg-white border border-[#E5E7EB] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] p-3"
              style={{ left: at.left, top: at.top, width: PANEL_WIDTH }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 shrink-0 rounded-full bg-[#3C5A87] text-white text-[10px] font-bold flex items-center justify-center">
                  {stage.n}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold text-[#1A1A1A] leading-tight">
                    {stage.title}
                  </p>
                  <p className="text-[10px] text-[#6B7280]">{stage.who}</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); close(); }}
                  aria-label="Close"
                  className="p-0.5 rounded hover:bg-[#F3F4F6] text-[#9CA3AF]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* The three lines Pedro reads first. Everything else is detail. */}
              <div className="mt-2 space-y-1.5">
                <p className="text-[11px] leading-snug text-[#6B7280]">{stage.where}</p>
                <div className="rounded-lg bg-[#EEF2F8] px-2 py-1.5">
                  <p className="text-[9px] font-bold uppercase tracking-wide text-[#3C5A87]">
                    Do now
                  </p>
                  <p className="text-[11px] leading-snug text-[#1A1A1A]">{stage.doNow}</p>
                </div>
                <p className="text-[10px] leading-snug text-[#6B7280]">
                  <span className="font-semibold text-[#1A1A1A]">Done when:</span> {stage.doneWhen}
                </p>
              </div>

              <ul className="mt-2 space-y-1.5">
                {stage.points.map((point) => (
                  <li key={point} className="text-[11px] leading-snug text-[#1A1A1A] pl-3 relative">
                    <span className="absolute left-0 top-[6px] w-1 h-1 rounded-full bg-[#3C5A87]" />
                    {point}
                  </li>
                ))}
              </ul>

              {stage.chaseAfterDays !== null && (
                <p className="text-[10px] text-[#6B7280] mt-2">
                  Chase it if it sits here more than {stage.chaseAfterDays}{' '}
                  {stage.chaseAfterDays === 1 ? 'day' : 'days'}.
                </p>
              )}

              {stage.templates.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
                    Copy and send
                  </p>
                  {stage.templates.map((t) => (
                    <TemplateRow key={t.label} template={t} />
                  ))}
                </div>
              )}

              <p className="text-[10px] text-[#9CA3AF] mt-2">
                Full process: Templates, Deal process tab.
              </p>
            </div>
          </>,
          document.body
        )}
    </>
  );
}
