// WHICH HOUSE IS THIS CONVERSATION ABOUT.
//
// Hugo, 2026-08-24: "all card you need to tag which deal is whatsapp
// conversation for, make very clean on chat card and everywhere."
//
// The inbox holds three kinds of thread that all look identical in a list: a
// plumber lead, an estate agency, and a builder we invited to look at a house.
// The last two both belong to a DEAL, and until now the list row said nothing
// about it. A builder replying "yeah Wednesday's fine" was unattributable
// without opening the thread and reading back through it, and by then you have
// lost the thing you opened the inbox to check.
//
// ONE function decides the label, because the answer has to be the same
// wherever it is shown. Two screens each working out "which house is this"
// their own way is precisely the class of bug this repo keeps being bitten by
// (see api/lib/uk-places.ts and api/lib/brrr-offer.ts for the same rule).
//
// The two sources are deliberately different and both are already written:
//
//   a BUILDER  custom_fields.builder_property, put there by
//              ensureBuilderContact() when we invite them. A builder has no
//              property link of their own because they are not the branch, so
//              the address has to travel on their contact record.
//   a BRANCH   the deal itself, off usePropertyLinks (matched on phone). A
//              branch can hold several houses; the caller passes the one that
//              already speaks for the thread rather than us picking again.
//
// Renders nothing for a plumber lead, so the reviews inbox is untouched.

/** The shortening rule, the same one api/lib/builder-outreach.ts uses when it
 *  writes the tag: "Windsor Road, Buxton" out of "Windsor Road, Buxton,
 *  Derbyshire, SK17 7NS". Kept here as well as there on purpose, because this
 *  side also shortens a raw deal address that never went through that path.
 *  tests/deal-tag.test.ts pins the two to the same output. */
export function shortAddress(address: string | null | undefined): string {
  const parts = String(address ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return '';
  return parts.slice(0, 2).join(', ').slice(0, 60);
}

export type DealTagKind = 'builder' | 'branch';

export interface DealTag {
  /** What the chip prints. Short. */
  label: string;
  /** The full address, for the hover title. Falls back to the label. */
  full: string;
  /** Which side of the deal this thread is, so the chip can say so. A builder
   *  and the branch selling the same house are two different conversations and
   *  reading one as the other is how a viewing gets confirmed with the wrong
   *  person. */
  kind: DealTagKind;
}

export interface DealTagSource {
  /** wk_contacts.custom_fields, as the inbox already holds it. */
  customFields?: Record<string, string> | null | undefined;
  /** The deal already resolved for this thread, if there is one. */
  deal?: { address?: string | null } | null | undefined;
}

/** The house this conversation is about, or null when it is not a deal thread. */
export function dealTagFor({ customFields, deal }: DealTagSource): DealTag | null {
  const cf = customFields ?? {};

  // A builder first, because a builder can also be sitting in a property
  // pipeline and we must never label them with the branch's own deal.
  if (cf.lead_type === 'builder') {
    const tag = String(cf.builder_property ?? '').trim();
    if (!tag) return null;
    return { label: shortAddress(tag) || tag, full: tag, kind: 'builder' };
  }

  // The live deal wins, because it is the house that currently speaks for the
  // thread. custom_fields.property_address is the fallback for screens that do
  // not load deal links at all (the contacts table), so a branch is labelled
  // there too rather than only in the inbox.
  const address = String(deal?.address ?? '').trim()
    || String(cf.property_address ?? '').trim();
  if (!address) return null;
  return { label: shortAddress(address) || address, full: address, kind: 'branch' };
}
