// ContactIdentity — the one way a lead's owner + website get rendered.
//
// Hugo's rule (contactIdentity.ts): EVERYWHERE we show a lead's business name we
// ALSO show the owner's name and the website, each with an explicit "not
// available" marker rather than a silent blank — the gap has to be obvious so
// an agent fills it in. Six surfaces were re-implementing that inline and had
// already drifted apart; this is the single presentational home for it.
//
// layout:
//   'stack'  — two lines. For roomy panels and narrow cards, where a truncated
//              gap marker ("Name not availa…") would be useless.
//   'inline' — one line, "owner · website". For dense list rows where vertical
//              space is the scarce axis.

import { personName, websiteLabel, isMissing } from '../../lib/contactIdentity';

export interface ContactIdentityProps {
  owner?: string | null;
  website?: string | null;
  layout?: 'stack' | 'inline';
  size?: 'xs' | 'sm';
  className?: string;
}

const SIZE = { xs: 'text-[10px]', sm: 'text-[11px]' } as const;

export default function ContactIdentity({
  owner,
  website,
  layout = 'stack',
  size = 'sm',
  className = '',
}: ContactIdentityProps) {
  const person = personName(owner);
  const site = websiteLabel(website);
  const personGap = isMissing(person);
  const siteGap = isMissing(site);

  const tone = (gap: boolean, present: string) =>
    gap ? 'text-[#C4302B] italic' : present;

  const personCls = `${SIZE[size]} truncate ${tone(personGap, 'text-[#374151]')}`;
  const siteCls = `${SIZE[size]} truncate ${tone(siteGap, 'text-[#3C5A87]')}`;

  if (layout === 'inline') {
    return (
      <div className={`flex items-center gap-1 min-w-0 ${className}`}>
        <span className={`${personCls} min-w-0`} title={person}>{person}</span>
        <span className={`${SIZE[size]} text-[#D1D5DB] shrink-0`}>·</span>
        <span className={`${siteCls} min-w-0`} title={site}>{site}</span>
      </div>
    );
  }

  return (
    <div className={`min-w-0 ${className}`}>
      <div className={personCls} title={person}>{person}</div>
      <div className={siteCls} title={site}>{site}</div>
    </div>
  );
}
