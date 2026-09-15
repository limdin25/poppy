// A builder's quote lands on the builder's card, not on a stranger named after
// his email address.
//
// Hugo, 2026-09-15, the third time a builder quote went missing: "we cant find
// quote this guys send again, those issues must stop". C E Bettridge & Son Ltd
// emailed a Word quote for 125 Shakespeare Street on 10 September. It was saved,
// file and all, on a new contact called "jon_bettridge@outlook.com", while the
// builder card Pedro texts, "C E Bettridge & Son Ltd", showed nothing. On 15
// September the builder texted "The quote was sent on Friday". Sycamore
// Carpentry's Conway Road quote on 2 September did exactly the same thing.
//
// WHY THE EXISTING RULES COULD NOT HELP. Builder cards are made from Google
// Maps: a name and a phone, no email (323 of 325 on the day). The branch rule in
// wk-email-webhook compares the email DOMAIN to the name, and refuses public
// mail providers on purpose, which is exactly where a one-van builder's mail
// comes from (outlook.com, hotmail.co.uk). The named-house rule only looks at
// estate agent branches.
//
// THE RULE. A builder's trading name is the first real word of his card, and
// sole traders put it in their address: jon_bettridge@, sycamorecarpentry@. So
// take that one word ("bettridge", "sycamore") and look for it in the sender's
// address and display name, as a whole token or as the start or end of the
// squeezed address. Generic trade words never count ("builders", "carpentry"),
// and neither do short ones. The webhook then only accepts a builder we have
// actually messaged, and refuses when two builders match.
//
// VERBATIM TWIN in supabase/functions/wk-email-webhook/index.ts, because Deno
// cannot import from api/. tests/builder-email-match.test.ts fails the build if
// the two drift.

// --- twin:start ---
const TRADE_WORDS = new Set([
  'builder', 'builders', 'building', 'buildings', 'build', 'built', 'construction',
  'constructions', 'contractor', 'contractors', 'contracting', 'service', 'services',
  'solution', 'solutions', 'property', 'properties', 'maintenance', 'development',
  'developments', 'home', 'homes', 'improvement', 'improvements', 'carpentry',
  'joinery', 'joiner', 'joiners', 'roofing', 'roofers', 'plumbing', 'heating',
  'electrical', 'electrics', 'decorating', 'decorators', 'painting', 'plastering',
  'brickwork', 'bricklaying', 'groundworks', 'landscaping', 'renovation',
  'renovations', 'refurbishment', 'refurbishments', 'interiors', 'limited', 'group',
  'projects', 'design', 'designs', 'kitchens', 'bathrooms', 'windows', 'lofts',
  'extensions', 'damp', 'specialist', 'specialists', 'general', 'trade', 'trades',
  'quality', 'master', 'premier', 'family', 'brothers', 'north', 'south', 'east',
  'west', 'british', 'national', 'local', 'total', 'complete', 'modern', 'point',
]);
// A first name is not a trading name: "Steve McBride Walling" must key on
// "mcbride", or every steve@ on earth is Steve McBride.
const FIRST_NAMES = new Set([
  'steve', 'steven', 'stephen', 'darren', 'james', 'jamie', 'jonathan', 'david',
  'michael', 'peter', 'andrew', 'richard', 'robert', 'chris', 'christopher',
  'daniel', 'danny', 'matthew', 'simon', 'craig', 'kevin', 'jason', 'wayne',
  'shaun', 'lewis', 'thomas', 'anthony', 'martin', 'stuart', 'graham', 'colin',
  'keith', 'barry', 'scott', 'gareth', 'philip', 'phillip', 'nicholas', 'joseph',
  'samuel', 'benjamin', 'william', 'george', 'edward', 'charles', 'kieran',
  'callum', 'connor', 'aaron', 'dean', 'derek', 'trevor', 'terry', 'jonny',
  'johnny', 'bobby', 'billy', 'mohammed', 'muhammad', 'ahmed',
]);
const PUBLIC_MAIL = new Set([
  'gmail', 'googlemail', 'outlook', 'hotmail', 'live', 'msn', 'yahoo', 'ymail',
  'icloud', 'me', 'mac', 'aol', 'proton', 'protonmail', 'pm', 'gmx', 'zoho',
  'btinternet', 'sky', 'talktalk', 'virginmedia', 'blueyonder', 'ntlworld',
]);

/** "C E Bettridge & Son Ltd" -> "bettridge". The first word of five or more
 *  letters that is not a trade word. Towns come after the trading name on a
 *  Google listing ("Gulliver Builders Blackpool"), so only the first counts. */
export function builderKeyword(name: string | null | undefined): string | null {
  const words = String(name ?? '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    if (w.length >= 5 && !TRADE_WORDS.has(w) && !FIRST_NAMES.has(w)) return w;
  }
  return null;
}

/**
 * Does this sender carry the builder's trading name?
 *
 * WHERE we look depends on the mailbox. At a free provider the address and the
 * display name are the person's own choice, so a sole trader's name is in them
 * (jon_bettridge@outlook.com). At a company domain the local part is an
 * EMPLOYEE's name and says nothing about the company: helen.jackson@whitakers is
 * an estate agent, not "Jackson's Builders". There only the domain counts.
 */
export function senderCarriesKeyword(
  keyword: string | null,
  email: string,
  displayName: string | null | undefined,
): boolean {
  if (!keyword || keyword.length < 5) return false;
  const [local = '', domain = ''] = String(email ?? '').toLowerCase().split('@');
  const label = domain.split('.')[0] ?? '';
  if (!label) return false;
  if (!PUBLIC_MAIL.has(label)) {
    // A company domain must BE the trading name, optionally followed by trade
    // words: bettridgebuilders.co.uk yes, taylorsestate.agency no (that is an
    // estate agent, and "sestate" is not a trade).
    const squeezed = label.replace(/[^a-z]/g, '');
    return squeezed.startsWith(keyword) && onlyFillerWords(squeezed.slice(keyword.length));
  }
  for (const place of [local, String(displayName ?? '').toLowerCase()]) {
    if (place.split(/[^a-z]+/).includes(keyword)) return true;
    const squeezed = place.replace(/[^a-z]/g, '');
    if (keyword.length >= 6 && (squeezed.startsWith(keyword) || squeezed.endsWith(keyword))) return true;
  }
  return false;
}

const FILLER = new Set([...TRADE_WORDS, 'ltd', 'uk', 'and', 'son', 'sons', 'co', 'the', 's']);

/** "builders", "andsonltd", "" -> true. "sestate", "bespoke" -> false. */
function onlyFillerWords(rest: string): boolean {
  if (!rest) return true;
  if (rest.length > 40) return false;
  for (let i = 1; i <= rest.length; i++) {
    if (FILLER.has(rest.slice(0, i)) && onlyFillerWords(rest.slice(i))) return true;
  }
  return false;
}
// --- twin:end ---
