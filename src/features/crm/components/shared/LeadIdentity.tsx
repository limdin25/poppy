// Who this lead IS, told the right way for the business the lead belongs to.
//
// Hugo, 2026-08-14: "the things on the cards, [the two red gap markers],
// that was for the older project, you can delete that. Maybe add the agent
// name."
//
// An estate agency branch has no "owner" and no "website" in any sense that
// helps Pedro. What he needs is the name of the person to ask for when the
// switchboard picks up, which the call checklist captures
// (`api/crm/property-outcome.ts` writes `custom_fields.branch_contact_name`,
// heard by `api/lib/spoken-name.ts`). Two red "not available" markers on every
// branch card told him nothing and buried the one line that matters.
//
// The owner/website pair still fires for every OTHER kind of lead, because the
// same inbox served the reviews product where the website is the whole point.
//
// This lives in one component because the rule was previously written into the
// pipeline card only, so the inbox kept showing the red gap marker on the
// same branch the board was already labelling "Ask for Doug".

import ContactIdentity from './ContactIdentity';

interface Props {
  /** True when this lead is an estate agency branch. */
  isProperty: boolean;
  /** The person to ask for on the phone, when the call captured one. */
  person?: string | null;
  owner?: string | null;
  website?: string | null;
  layout?: 'inline' | 'stack';
  size?: 'xs' | 'sm';
  className?: string;
  /** Creators are people, not businesses: they will never have a website, so
   *  the gap markers are noise on them. Kept as its own flag rather than
   *  folded into isProperty, because they are different businesses. */
  isCreatorLead?: boolean;
}

export default function LeadIdentity({
  isProperty, person, owner, website,
  layout = 'stack', size = 'sm', className, isCreatorLead = false,
}: Props) {
  if (isCreatorLead) return null;

  if (isProperty) {
    const name = (person ?? '').trim();
    // No name yet is silence, NOT a red warning. It only means nobody has got
    // past the switchboard yet, which is the normal state of a fresh branch.
    if (!name) return null;
    return (
      <div
        className={`truncate text-[${size === 'xs' ? 10 : 11}px] text-[#374151] ${className ?? ''}`}
        title={name}
      >
        Ask for {name}
      </div>
    );
  }

  return (
    <ContactIdentity
      owner={owner}
      website={website}
      layout={layout}
      size={size}
      className={className}
    />
  );
}

/** Is this lead an estate agency branch?
 *
 *  `deal` present is the strongest signal (the board found a house behind the
 *  phone number). `lead_type` catches a branch whose houses have all been
 *  withdrawn, which must still read as a property lead rather than reverting
 *  to owner/website. */
export function isPropertyLead(
  customFields?: Record<string, string> | null,
  hasDeal?: boolean,
): boolean {
  return Boolean(hasDeal) || customFields?.lead_type === 'estate_agent';
}

/** The person to ask for, from either place it can be recorded. */
export function askForName(
  customFields?: Record<string, string> | null,
  dealBranchContactName?: string | null,
): string {
  return (
    (customFields?.branch_contact_name ?? '').trim() ||
    (dealBranchContactName ?? '').trim()
  );
}
