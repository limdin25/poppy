// WHO WE ARE, IN ONE PLACE, FOR WHEN A BRANCH ASKS.
//
// Hugo, 2026-08-17, reading a follow-up draft: Keeley at Reeds Rains had asked
// for our full company name, registered address, telephone, email, budget,
// type of property and areas, so she could put us on their database and send us
// stock. The draft answered none of it, because nothing in this repo held those
// facts anywhere a writer could reach them.
//
// They existed three times over, in `src/core/content/property-call-script.html`
// (what Pedro reads out), `src/core/content/one-call-script.html` and
// `src/features/crm/data/salesObjections.ts`, all of them human-facing pages
// that no server code can use. So an email asked for our registration details
// would either leave them out or invent them, and a model inventing a company
// number is a worse outcome than an email that never got written.
//
// The registered facts are PUBLIC and STABLE: they are the Companies House
// record, the same one the property working agreement names. They belong in
// code. `tests/company-facts.test.ts` fails if the script Pedro reads and this
// file ever disagree.
//
// WHAT IS DELIBERATELY NOT HERE: a phone number and an email address. Those are
// per-agent, they belong to whoever is writing, and a constant would put the
// wrong person's line in front of a branch. The caller passes them, and a
// missing one is simply left out of the email, which is the same rule every
// other fact obeys.

/** The Companies House record. Not a marketing description, the register. */
export const COMPANY = {
  legalName: 'ULINC UNICO GROUP LTD',
  companyNumber: '11197856',
  registeredOffice: '483 Green Lanes, London, N13 4BS',
  /** What we say on the phone. The branch knows us by this, not by the legal
   *  name, which is why an email carrying both has to say they are the same
   *  company. */
  tradingName: 'Unico',
} as const;

/** WHAT WE BUY, in the words the call script already uses.
 *
 *  A branch asking for our "budget, type of property and areas" is trying to
 *  fill in a database form, and the honest answer is not a number. It is the
 *  standing brief Pedro leaves on every call (docs/DECISIONS_LOG.md row 80),
 *  kept to the two things a negotiator can actually spot: needs plenty of work,
 *  and the price has to come down. A list of criteria is what gets you filed as
 *  an investor and never rung. */
export const WHAT_WE_BUY = {
  areas: 'Anywhere in England and Wales. We buy across the country and assess remotely first.',
  propertyType: 'Houses and flats that need work. The more work the better, and we are not put off by condition.',
  budget: 'No fixed budget. What we can pay is set by the property and the cost of the works, '
    + 'so we would rather look at anything that needs plenty of work or where the price has to come down.',
  howWeBuy: 'Cash, as a limited company. No mortgage, no chain, and every offer is subject to our builder '
    + 'going round to view and price the works rather than to a survey.',
} as const;

/** The block handed to the email writer when a branch has asked who we are.
 *
 *  Returned as plain labelled lines rather than a sentence, because the writer
 *  composes the email and a pre-written paragraph would fight it. Phone and
 *  email come from the caller or not at all. */
export function companyFactsBlock(contact?: {
  phone?: string | null; email?: string | null; person?: string | null;
} | null): string {
  return [
    'WHO WE ARE. These are real registered facts. Use them EXACTLY as written and never invent one:',
    `- Full company name: ${COMPANY.legalName}`,
    `- Company number: ${COMPANY.companyNumber} (registered at Companies House, they can look it up)`,
    `- Registered office: ${COMPANY.registeredOffice}`,
    `- We trade as ${COMPANY.tradingName}, which is the name they know us by from the phone call. `
      + 'Say the two are the same company, or a second name on an email reads like a different outfit.',
    contact?.person ? `- Who they deal with: ${contact.person}` : null,
    contact?.email ? `- Email address: ${contact.email}` : null,
    contact?.phone ? `- Telephone number: ${contact.phone}` : null,
    '',
    'WHAT WE BUY, if they have asked for a budget, a property type or areas:',
    `- Areas: ${WHAT_WE_BUY.areas}`,
    `- Type of property: ${WHAT_WE_BUY.propertyType}`,
    `- Budget: ${WHAT_WE_BUY.budget}`,
    `- How we buy: ${WHAT_WE_BUY.howWeBuy}`,
  ].filter(Boolean).join('\n');
}

/** Has this branch asked us who we are, or for our details?
 *
 *  Read off THEIR OWN WORDS in the thread, never guessed from a stage. The
 *  live example, Keeley at Reeds Rains: "If you could let me know the
 *  following, I can register your company on our database to send properties
 *  to: Full company name Registered address Telephone number Email address
 *  Budget Type of property Areas you are looking in". */
export function asksWhoWeAre(text: string): boolean {
  const t = (text ?? '').toLowerCase();
  return /company\s*(name|number|details|registration)|registered\s*(address|office)|companies house|register (your|the) company|on (our|the) (data ?base|mailing list)|proof of id|due diligence|what (is|are) your (budget|criteria)|areas you are looking/.test(t);
}
