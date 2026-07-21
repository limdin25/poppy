// SalesCalculatorPane — the "Gap calculator" from the sales script, rebuilt as
// a clean React tab. Punch in the prospect's numbers as you talk and read the
// review gap + payback out loud. Mirrors calc() in one-call-script.html so the
// maths stays identical: jobs = years×12×perMonth, should-have = 20% of jobs,
// gap = should − have, annual cost = price×12, payback = cost / job value.

import { useState } from 'react';
import { Calculator } from 'lucide-react';

const fmt = (n: number) => Math.round(n).toLocaleString('en-GB');

function Row({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[12px] text-[#374151]">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 px-2 py-1 text-[13px] text-right tabular-nums bg-white border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30 focus:border-[#3C5A87]"
      />
    </label>
  );
}

export default function SalesCalculatorPane() {
  const [years, setYears] = useState('10');
  const [jobs, setJobs] = useState('15');
  const [have, setHave] = useState('25');
  const [price, setPrice] = useState('179');
  const [jobVal, setJobVal] = useState('2000');

  const n = (v: string) => parseFloat(v) || 0;
  const total = n(years) * 12 * n(jobs);
  const should = total * 0.2;
  const ten = total * 0.1;
  const gap = Math.max(0, should - n(have));
  const year = n(price) * 12;
  const need = n(jobVal) > 0 ? year / n(jobVal) : 0;
  const payback = need <= 1.15 ? 'Just one extra job a year covers the lot.' : `About ${Math.ceil(need)} extra jobs a year covers it.`;

  return (
    <div className="flex flex-col h-full bg-white overflow-y-auto">
      <div className="px-4 py-3 border-b border-[#E5E7EB]">
        <div className="flex items-center gap-2">
          <Calculator className="w-3.5 h-3.5 text-[#3C5A87]" />
          <span className="text-[12px] font-semibold text-[#1A1A1A]">Gap calculator</span>
        </div>
        <p className="text-[11px] text-[#9CA3AF] mt-0.5 leading-snug">
          Punch in their numbers as you go, read the gap out loud.
        </p>
      </div>

      <div className="px-4 py-3 space-y-2.5">
        <Row label="Years in business" value={years} onChange={setYears} />
        <Row label="Jobs per month" value={jobs} onChange={setJobs} />
        <Row label="Reviews they have" value={have} onChange={setHave} />
      </div>

      <div className="mx-4 rounded-xl bg-[#F3F3EE] px-3 py-3">
        <div className="flex items-center justify-between text-[12px] text-[#6B7280]">
          <span>Jobs they've done</span><b className="text-[#1A1A1A] tabular-nums">{fmt(total)}</b>
        </div>
        <div className="text-center mt-2">
          <div className="text-[34px] font-bold text-[#3C5A87] leading-none tabular-nums">{fmt(should)}</div>
          <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] mt-1">reviews they should have (at 20%)</div>
        </div>
        <div className="flex items-center justify-between text-[12px] text-[#6B7280] mt-2">
          <span>Even at 10%</span><b className="text-[#1A1A1A] tabular-nums">{fmt(ten)}</b>
        </div>
        <div className="flex items-center justify-between text-[12px] text-[#6B7280]">
          <span>They've got</span><b className="text-[#1A1A1A] tabular-nums">{fmt(n(have))}</b>
        </div>
        <div className="flex items-center justify-between text-[13px] font-semibold text-[#B91C1C] mt-1 pt-1 border-t border-[#E5E7EB]">
          <span>Missing</span><b className="tabular-nums">{fmt(gap)}</b>
        </div>
      </div>

      <div className="px-4 pt-4 pb-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-2">What it pays for</div>
        <div className="space-y-2.5">
          <Row label="Your price /mo (£)" value={price} onChange={setPrice} />
          <Row label="Value of one job (£)" value={jobVal} onChange={setJobVal} />
        </div>
      </div>

      <div className="mx-4 mt-2 mb-4 rounded-xl bg-[#EEF2F8] border border-[#3C5A87]/20 px-3 py-3">
        <div className="flex items-center justify-between text-[12px] text-[#3C5A87]">
          <span>Costs them a year</span><b className="tabular-nums">£{fmt(year)}</b>
        </div>
        <div className="text-[12px] text-[#1A1A1A] mt-1 leading-snug">{payback}</div>
      </div>
    </div>
  );
}
