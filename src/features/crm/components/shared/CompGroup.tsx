// One block of sold comps under its own plain-English heading.
//
// LIFTED 2026-08-15 out of components/live-call/PropertiesPane.tsx, unchanged,
// so the cockpit's Comparisons reveal shows a house's evidence in exactly the
// words Pedro sees mid-call. Copying it instead would be the same mistake as
// every other pair of comp renderers this codebase has had: they agree until
// one of them is edited.
//
// Draws nothing when the engine found none of that kind, which is common:
// plenty of properties have same-size sales nearby and no converted ones.

import type { PropertyComp } from '../../hooks/usePropertyListings';

export default function CompGroup({ heading, comps }: { heading: string; comps: PropertyComp[] }) {
  if (comps.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] font-semibold text-[#6B7280]">{heading}</div>
      <ul className="mt-0.5 space-y-0.5">
        {comps.map((c) => (
          <li key={`${c.text}${c.url}`} className="text-[11.5px] leading-snug text-[#4B5563] break-words">
            {c.url ? (
              <a href={c.url} target="_blank" rel="noreferrer" className="hover:underline">
                {c.text}
              </a>
            ) : c.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
