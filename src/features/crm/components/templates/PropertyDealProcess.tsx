// The property deal process on screen: the 14 steps, what the agent asks the
// moment you offer, and every message to copy and send.
//
// Read-only on purpose. This is the reference Hugo asked to be able to open at
// any time, not another thing to maintain in a database.

import { useState } from 'react';
import { Copy, Check, ChevronDown, Mail, MessageSquare, Phone } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { DEAL_STAGES, AGENT_QUESTIONS, type DealTemplate } from './dealProcessSteps';

const CARD = 'bg-white border border-[#E5E7EB] rounded-2xl p-5';

const CHANNEL_ICON = {
  Email: Mail,
  WhatsApp: MessageSquare,
  Phone: Phone,
} as const;

function TemplateBlock({ template }: { template: DealTemplate }) {
  const [copied, setCopied] = useState(false);
  const Icon = CHANNEL_ICON[template.channel];

  const full = template.subject
    ? `Subject: ${template.subject}\n\n${template.body}`
    : template.body;

  const copy = async () => {
    await navigator.clipboard.writeText(full).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-3 border border-[#E5E7EB] rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-[#F9FAFB] border-b border-[#E5E7EB]">
        <Icon className="w-3.5 h-3.5 text-[#6B7280]" />
        <span className="text-[12px] font-semibold text-[#1A1A1A] flex-1">{template.label}</span>
        <span className="text-[10px] uppercase tracking-wide text-[#6B7280]">
          {template.channel}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={`Copy ${template.label}`}
          className="flex items-center gap-1 text-[11px] font-medium text-[#3C5A87] hover:underline"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {template.subject && (
        <div className="px-3 pt-2 text-[11px] text-[#6B7280]">
          Subject: <span className="text-[#1A1A1A]">{template.subject}</span>
        </div>
      )}
      <pre className="px-3 py-2 text-[12px] leading-relaxed text-[#1A1A1A] whitespace-pre-wrap font-sans">
        {template.body}
      </pre>
    </div>
  );
}

export default function PropertyDealProcess() {
  const [open, setOpen] = useState<number | null>(1);

  return (
    <div className="space-y-4">
      <section className={CARD}>
        <h2 className="text-[15px] font-bold text-[#1A1A1A] mb-1">
          Property deals, start to finish
        </h2>
        <p className="text-[12px] text-[#6B7280] leading-relaxed">
          Two calls, never one. Call one is discovery and never says a number of ours. The
          homework and the builder price it, call two floats the confirmed figure, the offer
          goes over in writing, and the viewing only happens once the ballpark is agreed.
          Click a step for the detail and the message to copy.
        </p>
      </section>

      <section className={CARD}>
        <h2 className="text-[15px] font-bold text-[#1A1A1A] mb-3">The steps</h2>
        <div className="space-y-2">
          {DEAL_STAGES.map((stage) => {
            const isOpen = open === stage.n;
            return (
              <div key={stage.n} className="border border-[#E5E7EB] rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : stage.n)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[#F9FAFB]"
                >
                  <span className="w-6 h-6 shrink-0 rounded-full bg-[#3C5A87] text-white text-[11px] font-bold flex items-center justify-center">
                    {stage.n}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-[#1A1A1A] truncate">
                      {stage.title}
                    </span>
                    <span className="block text-[11px] text-[#6B7280] truncate">
                      {stage.who} · {stage.doNow}
                    </span>
                  </span>
                  <span className="shrink-0 px-2 py-0.5 rounded-full bg-[#EEF2F7] text-[#3C5A87] text-[10px] font-semibold">
                    {stage.tag}
                  </span>
                  <ChevronDown
                    className={cn(
                      'w-4 h-4 text-[#6B7280] transition-transform shrink-0',
                      isOpen && 'rotate-180'
                    )}
                  />
                </button>

                {isOpen && (
                  <div className="px-3 pb-3 pt-1 border-t border-[#E5E7EB]">
                    <ul className="space-y-1.5 mt-2">
                      {stage.points.map((point) => (
                        <li
                          key={point}
                          className="text-[12px] leading-relaxed text-[#1A1A1A] pl-4 relative"
                        >
                          <span className="absolute left-0 top-[7px] w-1.5 h-1.5 rounded-full bg-[#3C5A87]" />
                          {point}
                        </li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-[#6B7280] mt-2">
                      <span className="font-semibold text-[#1A1A1A]">Done when:</span>{' '}
                      {stage.doneWhen}
                    </p>

                    {stage.templates.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[12px] font-semibold text-[#3C5A87]">
                          {stage.templates.length === 1
                            ? 'Show the message'
                            : `Show the messages (${stage.templates.length})`}
                        </summary>
                        {stage.templates.map((template) => (
                          <TemplateBlock key={template.label} template={template} />
                        ))}
                      </details>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className={CARD}>
        <h2 className="text-[15px] font-bold text-[#1A1A1A] mb-1">
          What the agent asks the second you offer
        </h2>
        <p className="text-[12px] text-[#6B7280] leading-relaxed mb-3">
          Have these ready. They all come in the same phone call.
        </p>
        <div className="space-y-1.5">
          {AGENT_QUESTIONS.map((item) => (
            <div key={item.q} className="flex gap-2 text-[12px] leading-relaxed">
              <span className="font-semibold text-[#1A1A1A] shrink-0 w-[46%]">{item.q}</span>
              <span className="text-[#1A1A1A]">{item.answer}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={CARD}>
        <h2 className="text-[15px] font-bold text-[#1A1A1A] mb-1">Before the first offer goes out</h2>
        <p className="text-[12px] text-[#6B7280] leading-relaxed mb-2">
          None of this is code and all of it stops a deal dead if it is missing.
        </p>
        <ul className="space-y-1.5">
          {[
            'A solicitor lined up. The agent asks on the first call, every time.',
            'A builder in each target area, ideally two, and one of them willing to view.',
            'Anti money laundering supervision, ICO registration, a redress scheme, and professional indemnity insurance. Legally required to take a sourcing fee in the UK.',
            'A client account, separate from the business account, for reservation money that is not yours yet.',
          ].map((item) => (
            <li key={item} className="text-[12px] leading-relaxed text-[#1A1A1A] pl-4 relative">
              <span className="absolute left-0 top-[7px] w-1.5 h-1.5 rounded-full bg-[#C2410C]" />
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
