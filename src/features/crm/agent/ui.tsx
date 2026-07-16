import type { ReactNode } from 'react';

/** Tiny CRM-styled primitives shared by the /admin/crm/agent pages. */

export const input =
  'mt-1 w-full text-[13px] border border-[#E5E7EB] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30 bg-white';

export const hint = 'mt-1.5 text-[11px] text-[#9CA3AF]';

export function Card({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5">
      {eyebrow && <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-0.5">{eyebrow}</p>}
      <h3 className="text-[15px] font-bold text-[#1A1A1A] mb-3">{title}</h3>
      {children}
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="block text-[11px] font-medium text-[#6B7280]">{children}</label>;
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${checked ? 'bg-[#3C5A87]' : 'bg-[#D1D5DB]'}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function DayPicker({ days, onChange }: { days: string[]; onChange: (days: string[]) => void }) {
  return (
    <div className="mt-1 flex gap-1 flex-wrap">
      {DAYS.map((d) => {
        const on = days.includes(d);
        return (
          <button key={d} type="button"
            onClick={() => onChange(on ? days.filter((x) => x !== d) : [...days, d])}
            className={`text-[12px] px-2.5 py-1 rounded-lg border ${on ? 'border-[#3C5A87] bg-[#EEF2F8] text-[#283C5C]' : 'border-[#E5E7EB] text-[#9CA3AF]'}`}>
            {d}
          </button>
        );
      })}
    </div>
  );
}

export function ToggleRow({ title, desc, checked, onChange }: {
  title: string; desc: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-[#1A1A1A]">{title}</p>
        <p className="text-[12px] text-[#6B7280]">{desc}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}
