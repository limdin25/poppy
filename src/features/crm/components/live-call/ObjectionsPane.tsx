// ObjectionsPane — searchable quick-reference of sales objections + rebuttals
// for the dialer's Objections tab. Content is bundled (salesObjections.ts).
// Click a row to open the answer; type to filter. The detailed branch
// objections still live inline inside the script itself.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { SALES_OBJECTIONS, type Objection } from '../../data/salesObjections';

export default function ObjectionsPane() {
  const [filter, setFilter] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matched = q
      ? SALES_OBJECTIONS.filter((o) => o.q.toLowerCase().includes(q) || o.a.toLowerCase().includes(q))
      : SALES_OBJECTIONS;
    const byGroup = new Map<Objection['group'], Objection[]>();
    for (const o of matched) {
      const arr = byGroup.get(o.group) ?? [];
      arr.push(o);
      byGroup.set(o.group, arr);
    }
    return byGroup;
  }, [filter]);

  const total = Array.from(groups.values()).reduce((n, a) => n + a.length, 0);

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-3 py-2 border-b border-[#E5E7EB]">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search objections…"
          className="w-full px-2.5 py-1.5 text-[12px] border border-[#E5E5E5] rounded-[10px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30 focus:border-[#3C5A87]"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {total === 0 && (
          <div className="text-[12px] text-[#9CA3AF] text-center px-4 py-6 leading-snug">
            No matches for "{filter}".
          </div>
        )}
        {(['Objections', 'If they ask'] as const).map((g) => {
          const items = groups.get(g);
          if (!items || items.length === 0) return null;
          return (
            <div key={g}>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-1.5 px-0.5">{g}</div>
              <div className="space-y-1.5">
                {items.map((o) => {
                  const key = `${g}:${o.q}`;
                  const open = openKey === key;
                  return (
                    <div
                      key={key}
                      className={cn(
                        'border rounded-lg transition-colors',
                        open ? 'border-[#3C5A87]/40 bg-[#EEF2F8]/30' : 'border-[#E5E7EB] hover:border-[#3C5A87]/30',
                      )}
                    >
                      <button
                        onClick={() => setOpenKey(open ? null : key)}
                        className="w-full text-left px-3 py-2 flex items-start gap-2"
                      >
                        {open ? (
                          <ChevronDown className="w-3.5 h-3.5 text-[#3C5A87] flex-shrink-0 mt-0.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-[#9CA3AF] flex-shrink-0 mt-0.5" />
                        )}
                        <span className="text-[13px] font-semibold text-[#1A1A1A] leading-snug">{o.q}</span>
                      </button>
                      {open && (
                        <div className="px-3 pb-3 pt-0.5 border-t border-[#E5E7EB] mt-1">
                          <p className="text-[13px] text-[#374151] leading-relaxed mt-2 whitespace-pre-wrap">{o.a}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
