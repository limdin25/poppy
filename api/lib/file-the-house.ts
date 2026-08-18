// A DISCOVERY CALL LEAVES A HOUSE BEHIND.
//
// Hugo, 2026-08-18: "I also see many discovery calls done but it didnt go to
// cockpit for the decision", and then the ruling that governs all of this:
// "upload pedro only with 100% good houses that we value them after first call
// and give the ballpark, this is unnegotiable."
//
// ---------------------------------------------------------------------------
// WHY A GOOD CALL PRODUCED NOTHING
// ---------------------------------------------------------------------------
//
// Measured on the board the day this was written: of 26 branches sitting in
// "Discovery done, evaluating", 23 had NO `brrr_properties` row. Follow up: 12
// branches, 1 house. The cockpit and the ballpark are both keyed on that row,
// so those calls could not produce a card, could not be priced, and could not
// reach a decision. Pedro could have a perfect conversation about a house and
// the system had nowhere to put it.
//
// The house was never missing. The discovery lane files it on the CONTACT,
// because that lane deliberately creates no property row: address, asking
// price, bedrooms, type, and a `property_url` that carries the scraper's own
// property id, which is the exact id `api/lib/ballpark.ts` needs to ask the
// engine to price it. So this is a copy, not an invention.
//
// ---------------------------------------------------------------------------
// ONLY AFTER SOMEBODY ACTUALLY SPOKE
// ---------------------------------------------------------------------------
//
// A house is filed when the branch has had a real CONVERSATION, never on a
// voicemail or a number nobody answered. Filing on a dial would put 250 houses
// a day into the cockpit, which is the exact noise the cockpit filter was built
// to remove (of 179 cards on its first day, 144 were a dial nobody answered).
//
// Nothing here decides money. It files the house; the engine prices it.

/** The scraper's own property id, out of the listing URL the branch card
 *  already carries.
 *
 *  Proven against the live table: `source_property_id` IS the number in the
 *  Rightmove path, so this is a lookup and not a guess.
 *      rightmove | 90352227 | https://www.rightmove.co.uk/properties/90352227
 *
 *  Anything that is not a plain Rightmove property id returns null, and a house
 *  with no engine id is never filed: it would sit in the cockpit for ever as a
 *  card the engine refuses with `no_engine_id`, which is worse than not being
 *  there at all. */
export function engineIdFromUrl(url: string | null | undefined): string | null {
  const m = String(url ?? '').match(/rightmove\.co\.uk\/properties\/(\d{6,12})/i);
  return m ? m[1] : null;
}

/** A price the branch card wrote as text ("£75,000", "Offers over £120,000"). */
export function askingFromText(text: string | null | undefined): number | null {
  const digits = String(text ?? '').replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  // A UK house, not a service charge and not a phone number.
  return Number.isFinite(n) && n >= 10_000 && n <= 5_000_000 ? n : null;
}

const int = (v: unknown): number | null => {
  const n = Number(String(v ?? '').replace(/[^0-9]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export interface FiledHouse {
  source: string;
  source_property_id: string;
  listing_url: string;
  address: string;
  asking_price: number | null;
  price_text: string | null;
  bedrooms: number | null;
  property_type: string | null;
  days_on_market: number | null;
  agent_name: string | null;
  agent_phone: string | null;
  wk_contact_id: string;
  /** 'human' means a person owns this branch, which is what every property is
   *  now. See the standing rule: no robot ever calls an estate agent. */
  call_channel: string;
  status: string;
}

/** Build the house row from what the branch card already holds.
 *
 *  Returns null when the card cannot support one, and the two things it insists
 *  on are the two the engine cannot work without: an ADDRESS to show a human
 *  and an ENGINE ID to price against. Everything else is optional and simply
 *  absent when the card does not have it. */
export function houseFromContact(contact: {
  id: string;
  name?: string | null;
  phone?: string | null;
  custom_fields?: Record<string, string> | null;
}): FiledHouse | null {
  const cf = contact.custom_fields ?? {};
  const url = cf.property_url ?? '';
  const engineId = engineIdFromUrl(url);
  const address = String(cf.property_address ?? '').trim();
  if (!engineId || !address) return null;

  return {
    source: 'rightmove',
    source_property_id: engineId,
    listing_url: url,
    address,
    asking_price: askingFromText(cf.asking_price),
    price_text: (cf.asking_price ?? '').trim() || null,
    bedrooms: int(cf.bedrooms),
    property_type: (cf.property_type ?? '').trim() || null,
    days_on_market: int(cf.days_on_market),
    agent_name: (cf.agency ?? contact.name ?? '').trim() || null,
    agent_phone: (contact.phone ?? '').trim() || null,
    wk_contact_id: contact.id,
    call_channel: 'human',
    status: 'new',
  };
}
