// wk-email-webhook — inbound email webhook from Resend.
// PR 62 (multi-channel PR 3), Hugo 2026-04-27.
//
// Public endpoint (verify_jwt = false). Resend posts here on email.received.
// MX records for the CRM inbound email domain (CRM_INBOUND_EMAIL_DOMAIN
// Supabase secret) point at Resend so inbound CRM email lands in this
// handler. Recipients outside that domain are dropped at intake.
//
// PR 103 (Hugo 2026-04-28): Resend's email.received WEBHOOK payload is
// metadata-only (from, to, subject, email_id) — no html/text. To get
// the body we must call GET /emails/inbound/{email_id}. The earlier
// /emails/{email_id} (outbound store) returns 404 for inbound IDs;
// /emails/inbound/{email_id} is the dedicated inbound endpoint and
// returns html + text + headers + a pre-signed raw MIME download URL.
//
// Signature verification — Svix HMAC-SHA256 over the raw request body:
//   svix-id          → event id
//   svix-timestamp   → ISO 8601
//   svix-signature   → "v1,<base64-sig>" (or comma-list of versions)
//   secret           → from wk_channel_credentials (provider='resend')
//                       or RESEND_WEBHOOK_SECRET env
//   sig_basis        = svix-id + "." + svix-timestamp + "." + raw-body
//
// We verify against the raw body, not parsed JSON, because Svix signs
// the exact bytes Resend sent.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_WEBHOOK_SECRET_ENV = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';
// Inbound recipient allowlist, comma-separated domains (e.g.
// "heyelsie.com,unicohost.com"). No default — if unset we fail closed rather
// than accepting (or hardcoding) a domain. Widened from a single domain on
// 2026-08-10 when pedro@unicohost.com became Pedro Houses' address for
// estate-agent email: the Resend webhook fires for EVERY receiving domain on
// the account, and a single-domain allowlist meant adding his domain would
// have silently dropped mail to the other one.
const CRM_INBOUND_EMAIL_DOMAINS = (Deno.env.get('CRM_INBOUND_EMAIL_DOMAIN') ?? '')
  .toLowerCase()
  .split(',')
  .map((d) => d.trim().replace(/^@/, ''))
  .filter(Boolean);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ok = (payload: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ ok: true, ...payload }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

interface ResendInboundEvent {
  type?: string;
  created_at?: string;
  // PR 102: Resend's email.received payload carries the full email
  // inline. Fields below cover both the documented shape and minor
  // variations seen in production (string vs object addresses,
  // headers as array vs map).
  data?: {
    email_id?: string;
    id?: string;
    from?: string | { address?: string; name?: string };
    to?: Array<string | { address?: string; name?: string }>;
    subject?: string;
    html?: string;
    text?: string;
    headers?: Array<{ name?: string; value?: string }> | Record<string, string>;
    created_at?: string;
  };
}

interface ResendFullEmail {
  id?: string;
  from?: string | { address?: string; name?: string };
  to?: string[] | Array<{ address?: string }>;
  subject?: string;
  html?: string;
  text?: string;
  created_at?: string;
}

async function loadWebhookSecret(supa: SupabaseClient): Promise<string> {
  const { data } = await supa
    .from('wk_channel_credentials')
    .select('secret')
    .eq('provider', 'resend')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const dbKey = (data as { secret?: string } | null)?.secret ?? '';
  // Env secret first — it's the operator-controlled source of truth; the
  // DB row is only a fallback for workspaces that store it there.
  return RESEND_WEBHOOK_SECRET_ENV || dbKey;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifySvixSignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  rawBody: string,
): Promise<boolean> {
  if (!secret || !svixId || !svixTimestamp || !svixSignature) return false;

  // Svix secrets often arrive prefixed with "whsec_" — strip if present
  // and base64-decode. If decoding fails (custom plain string secret),
  // fall back to using the secret as raw bytes.
  let keyBytes: Uint8Array<ArrayBuffer>;
  const cleaned = secret.replace(/^whsec_/, '');
  try {
    const bin = atob(cleaned);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    keyBytes = bytes;
  } catch {
    keyBytes = new TextEncoder().encode(secret);
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const data = new TextEncoder().encode(`${svixId}.${svixTimestamp}.${rawBody}`);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data);
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  // svixSignature header may be "v1,sig1 v1,sig2" (space-separated),
  // each entry is "<version>,<base64-sig>". Match any.
  const tokens = svixSignature.split(/\s+/);
  for (const tok of tokens) {
    const [, sigPart] = tok.split(',');
    if (!sigPart) continue;
    const a = new TextEncoder().encode(sigPart);
    const b = new TextEncoder().encode(expected);
    if (timingSafeEqual(a, b)) return true;
  }
  return false;
}

// PR 104 (Hugo 2026-04-28): strip quoted reply history so an inbound
// email body only contains the NEW content, not the entire thread.
//
// Gmail / Outlook / Apple Mail all prefix quoted text with `>` and
// introduce it with patterns like:
//   "On <date> <person> wrote:"           (Gmail, single or wrapped line)
//   "-----Original Message-----"           (Outlook)
//   "From: <person>\nSent: <date>..."     (Outlook variant)
//
// We cut at the first such marker and drop any leading or trailing
// quote-prefixed lines. Conservative — if no marker is recognised,
// we return the text as-is so we never accidentally truncate a real
// reply that happens to contain the word "wrote:".
/** A tracking link, which is all machine and no meaning. Kept deliberately
 *  narrow: only http(s) URLs of real length, so a short link somebody typed on
 *  purpose ("see rightmove.co.uk/123") survives. */
const LONG_URL = /https?:\/\/\S{60,}/g;

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: '...',
  mdash: '-', ndash: '-', pound: '£', euro: '€', copy: '(c)', reg: '(r)',
  trade: '(tm)', bull: '*', middot: '·',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => codePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

function codePoint(n: number): string {
  // Long dashes, curly quotes and ellipsis characters are banned in this
  // codebase and would arrive here straight out of somebody else's mail
  // client, so they are folded to their plain equivalents on the way in.
  const FOLD: Record<number, string> = {
    0x2013: '-', 0x2014: '-', 0x2018: "'", 0x2019: "'",
    0x201c: '"', 0x201d: '"', 0x2026: '...', 0x00a0: ' ',
  };
  if (FOLD[n]) return FOLD[n];
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

/**
 * HTML down to something a human can read in a chat bubble.
 *
 * Mirrors htmlToText() in api/cron/daily-agent-reports.ts, with the two things
 * an inbound email needs and a report does not: an <a> keeps its anchor text
 * and loses its href (that is where the tracking junk lives), and <img>,
 * <style> and <head> go entirely.
 */
export function htmlToText(input: string): string {
  return input
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<img[^>]*>/gi, '')
    // Anchor text only. An <a> wrapping an image or nothing at all leaves
    // nothing behind, which is right: a bare tracking pixel is not content.
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (_, inner: string) => inner)
    .replace(/<h[1-6][^>]*>/gi, '\n\n')
    .replace(/<\/(h[1-6]|p|div|tr|li|table|blockquote)>/gi, '\n')
    .replace(/<(p|div|br|tr|li|blockquote)[^>]*>/gi, '\n')
    .replace(/<(td|th)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[#a-z0-9]+;/gi, (m) => decodeEntities(m))
    .replace(LONG_URL, '')
    // Zero-width joiners and BOMs. Mail merges scatter them between
    // words ("Dear \u200bMr\u200b \u200bPedro\u200b") and they render as gaps.
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The plain-text alternative, used only when there is no HTML. Same tidying,
 *  minus the markup work. */
export function tidyPlainText(input: string): string {
  return decodeEntities(input)
    .replace(LONG_URL, '')
    // Zero-width joiners and BOMs. Mail merges scatter them between
    // words ("Dear \u200bMr\u200b \u200bPedro\u200b") and they render as gaps.
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    // Marketing text/plain writes "[Google Play Store] ( <url> )". With the
    // url gone the empty brackets are noise.
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripReplyQuotes(input: string): string {
  if (!input) return '';
  let text = input;

  // 1. Cut at "On ... wrote:" — match across up to ~3 lines because
  //    Gmail often wraps the attribution line.
  const gmailMatch = text.match(/\n[> ]*On [^\n]{0,200}(?:\n[^\n]{0,200}){0,2}wrote:?[ \t]*\n?/);
  if (gmailMatch && gmailMatch.index !== undefined) {
    text = text.slice(0, gmailMatch.index);
  }

  // 2. Cut at "-----Original Message-----" (Outlook).
  text = text.split(/\n-----+\s*Original Message\s*-----+/i)[0];

  // 3. Cut at a "From: ...\nSent: ..." Outlook header pair.
  const outlookHeader = text.match(/\n[> ]*From:[ \t]+.+\n[> ]*(Sent|Date):[ \t]+/);
  if (outlookHeader && outlookHeader.index !== undefined) {
    text = text.slice(0, outlookHeader.index);
  }

  // 4. Drop lines that are pure quote (start with '>' after optional
  //    whitespace). Leaves real reply content intact.
  text = text
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n');

  // 5. Collapse 3+ blank lines and trim ends.
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}

/** Free mailbox providers. Their domain says nothing about who the sender is,
 *  so the company-name join below must never fire on them: an email from
 *  someone@gmail.com must not attach itself to a contact called "Gmail". */
const PUBLIC_MAIL_DOMAINS = new Set([
  'gmail', 'googlemail', 'outlook', 'hotmail', 'live', 'msn', 'yahoo', 'ymail',
  'icloud', 'me', 'mac', 'aol', 'proton', 'protonmail', 'pm', 'gmx', 'zoho',
  'btinternet', 'sky', 'talktalk', 'virginmedia', 'blueyonder', 'ntlworld',
]);

/** "Gascoigne Halman" and "gascoignehalman.co.uk" reduce to the same key. */
function companyKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The first label of an email's domain: sale@gascoignehalman.co.uk -> "gascoignehalman" */
function domainLabel(email: string): string {
  return (email.split('@')[1] ?? '').split('.')[0] ?? '';
}

/**
 * Which agent should own a contact created from an email sent to `toEmail`.
 *
 * The recipient mailbox IS the answer: pedro@hostunico.com is the profile
 * email of the Pedro Houses login, so an email to that address belongs to
 * Pedro. Without this every inbound email was created with owner_agent_id
 * NULL, and wk_sms_messages_read only lets an agent read a message when
 * wk_agent_participates(contact_id) is true, which ownerless means never.
 * The mail landed in the database and no agent on earth could open it.
 */
async function ownerForRecipient(
  supa: SupabaseClient,
  toEmail: string,
): Promise<string | null> {
  if (!toEmail) return null;
  const { data } = await supa
    .from('profiles')
    .select('id')
    .ilike('email', toEmail)
    .limit(1)
    .maybeSingle();
  const direct = (data as { id?: string } | null)?.id ?? null;
  if (direct) return direct;

  // NOBODY SPELLS AN ADDRESS RIGHT ON A PHONE CALL. Pedro reads his address
  // out on every property call and the branch types what it hears, so mail
  // arrives at predro@, petro@ and hello@hostunico.com. The mailbox is a
  // catch-all so it all lands, but none of it matches a profile, so all of it
  // was created ownerless and NO AGENT COULD READ IT. Seven real threads were
  // sitting in that state on 2026-08-14, including the vendor's rejection of
  // our offer on Orion Way.
  //
  // The map is a platform_settings row, not a constant, because the next
  // misspelling is not knowable from here and must not need a deploy.
  try {
    const { data: row } = await supa
      .from('platform_settings')
      .select('value')
      .eq('key', 'mailbox_owners')
      .maybeSingle();
    const map = JSON.parse(String((row as { value?: string } | null)?.value ?? '{}')) as Record<string, string>;
    const alias = map[toEmail.trim().toLowerCase()];
    if (!alias) return null;
    // The map holds an ADDRESS, never a user id: an id in a settings row is
    // unreadable to whoever maintains it, and a wrong one is silent.
    const { data: aliased } = await supa
      .from('profiles')
      .select('id')
      .ilike('email', alias)
      .limit(1)
      .maybeSingle();
    return (aliased as { id?: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Let the agent whose mailbox this arrived at read the thread.
 *
 * Hugo, 2026-08-11, after the ownership fix: "also my test email, still not
 * there". He had mailed pedro@hostunico.com from his own address, and his
 * contact record is owned by Pedro's OLD sales-closer account, so the Pedro
 * Houses login could not see a message that was addressed to it. Ownership of
 * the SENDER decided who could read mail sent to the RECIPIENT, which is the
 * wrong way round.
 *
 * Fixed with an assignment rather than by moving ownership, because moving
 * ownership would quietly take the lead off whichever agent already had it.
 * wk_agent_participates() accepts an active row here, and the inbox's own
 * scoping in useInboxThreads.ts reads the same table, so one row satisfies
 * both the database and the screen.
 */
async function grantRecipientAccess(
  supa: SupabaseClient,
  contactId: string,
  agentId: string | null,
): Promise<void> {
  if (!agentId) return;

  // Already theirs by ownership? Then there is nothing to grant.
  const { data: owned } = await supa
    .from('wk_contacts')
    .select('id')
    .eq('id', contactId)
    .eq('owner_agent_id', agentId)
    .maybeSingle();
  if (owned) return;

  const { data: already } = await supa
    .from('wk_lead_assignments')
    .select('id')
    .eq('contact_id', contactId)
    .eq('agent_id', agentId)
    .in('status', ['assigned', 'in_progress'])
    .limit(1)
    .maybeSingle();
  if (already) return;

  const { error } = await supa.from('wk_lead_assignments').insert({
    contact_id: contactId,
    agent_id: agentId,
    status: 'assigned',
    assigned_at: new Date().toISOString(),
  });
  // Best effort. The message is already saved by the time this runs, and a
  // failure here must not turn a delivered email into a 500 back to Resend.
  if (error) console.error('[wk-email-webhook] could not grant inbox access', error);
}


// ── 2b. THEY NAMED ONE OF OUR HOUSES ──────────────────────────────────────
//
// The strongest evidence there is, and much stronger than a name resembling a
// domain. A branch writing "your offer on 39 Orion Way" is telling us exactly
// which of our deals this is, in their own words.
//
// It exists because the domain rule genuinely cannot help in the common case:
// Zest of Hull trades as movewithzest.co.uk, so "zest" is not the domain and
// matching on the name alone would mean inventing a link. Leanne's email named
// Welwyn Park; Lexi's named Orion Way. Both are unambiguous.
//
// Refuses on two matches, exactly like the domain rule. Nothing is guessed.
const THOROUGHFARE = new Set([
  'road', 'street', 'avenue', 'lane', 'drive', 'close', 'way', 'grove',
  'crescent', 'place', 'terrace', 'court', 'gardens', 'walk', 'rise', 'view',
]);

/** "Welwyn Park Road, Hull, HU6" -> "welwyn park". Verbatim twin of
 *  searchableStreet() in api/lib/branch-email-match.ts. */
function searchableStreet(address: string): string {
  const first = String(address ?? '').split(',')[0].trim();
  if (!first) return '';
  const words = first.split(/\s+/).filter(Boolean);
  if (words.length > 2 && THOROUGHFARE.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  return words.join(' ').replace(/[^a-z0-9 ]/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Street words so common that a street made only of them is not evidence.
// "The Green" appears in an email about a traffic light; "Welwyn Park" and
// "Orion Way" do not appear in anything else. A usable street must carry at
// least one word that is not on this list.
const GENERIC_STREET_WORDS = new Set([
  'the', 'a', 'of', 'old', 'new', 'high', 'low', 'main', 'green', 'hill',
  'park', 'church', 'mill', 'north', 'south', 'east', 'west', 'front', 'back',
  'upper', 'lower', 'little', 'great', 'long', 'short', 'first', 'second',
  'road', 'street', 'avenue', 'lane', 'drive', 'close', 'way', 'grove',
  'crescent', 'place', 'terrace', 'court', 'gardens', 'walk', 'rise', 'view',
]);

/** Is this street distinctive enough to prove which deal an email is about? */
function streetIsEvidence(street: string): boolean {
  if (street.length < 8 || !street.includes(' ')) return false;
  return street.split(' ').some((w) => w.length >= 4 && !GENERIC_STREET_WORDS.has(w));
}

async function matchByNamedHouse(
  supa: ReturnType<typeof createClient>,
  emailText: string,
): Promise<string | null> {
  const text = (emailText ?? '').toLowerCase();
  if (text.length < 20) return null;
  try {
    const { data } = await supa
      .from('brrr_properties')
      .select('address, wk_contact_id')
      .not('wk_contact_id', 'is', null)
      .limit(1000);
    const hits = new Map<string, string>();
    for (const row of (data ?? []) as Array<{ address?: string; wk_contact_id?: string }>) {
      const street = searchableStreet(row.address ?? '');
      if (!streetIsEvidence(street)) continue;
      if (text.includes(street) && row.wk_contact_id) {
        hits.set(row.wk_contact_id, street);
      }
    }
    if (hits.size === 1) {
      const [contactId, street] = [...hits.entries()][0];
      console.log(`[wk-email-webhook] matched by named house "${street}" to contact ${contactId}`);
      return contactId;
    }
    if (hits.size > 1) {
      console.log(`[wk-email-webhook] ${hits.size} branches match a named house, refusing to guess`);
    }
  } catch (e) {
    console.warn('[wk-email-webhook] house match failed', String(e));
  }
  return null;
}

async function findOrCreateContact(
  supa: SupabaseClient,
  email: string,
  contactName: string,
  firstEmailId: string,
  toEmail: string,
  /** Subject and body, so a branch that NAMES one of our houses can be matched
   *  to it. See matchByNamedHouse: much stronger evidence than a domain that
   *  happens to resemble a trading name. */
  emailText = '',
): Promise<string | null> {
  // 1. The sender is already a contact by address. Unchanged, and still first.
  const { data: existing } = await supa
    .from('wk_contacts')
    .select('id')
    .eq('email', email)
    .limit(1)
    .maybeSingle();
  if ((existing as { id?: string } | null)?.id) {
    return (existing as { id: string }).id;
  }

  // 2. The sender is a branch we already know by PHONE, with no email on file.
  //
  //    This is the case that mattered. Pedro rang Gascoigne Halman at 12:35,
  //    they emailed back at 12:48, and matching on the email column alone
  //    could not see the branch he had just spoken to, because a scraped
  //    branch has a phone number and no address. So it minted a second
  //    "Gascoigne Halman", owned by nobody, that no agent could open, while
  //    the card Pedro owns sat there looking like they had never replied.
  //
  //    The join is exact, not fuzzy: strip everything but letters and digits
  //    from the contact's name and from the first label of the sender's
  //    domain, and require them to be equal. Public mail providers are
  //    excluded, and an ambiguous match (two contacts, same key) creates a
  //    new contact rather than guessing which branch replied.
  const label = domainLabel(email);
  if (label && !PUBLIC_MAIL_DOMAINS.has(label)) {
    const CANDIDATE_CAP = 500;
    const { data: candidates } = await supa
      .from('wk_contacts')
      .select('id, name, email')
      .is('email', null)
      // Cheap prefilter so this does not pull the whole contact table. The
      // exact comparison is done below; this only has to not EXCLUDE a match.
      //
      // THREE characters, not four. The domain label has the spaces squeezed
      // out of it and the contact name does not: "ddmresidential".slice(0, 4)
      // is "ddmr", and "DDM Residential, Grimsby" does not contain "ddmr"
      // because of the space after DDM. So the prefilter threw away the row
      // before the comparison below ever saw it, and no amount of fixing the
      // comparison would have helped. Three characters is the most that can be
      // taken before a space can fall inside the window.
      .ilike('name', `%${label.slice(0, 3)}%`)
      .limit(CANDIDATE_CAP);

    const rows = (candidates ?? []) as Array<{ id: string; name: string | null }>;
    if (rows.length === CANDIDATE_CAP) {
      // Say it rather than let a match go missing quietly.
      console.warn(`[wk-email-webhook] candidate prefilter hit its ${CANDIDATE_CAP} cap for "${label}" — a real match may have been cut off`);
    }
    // THE SCRAPER NAMES A BRANCH "Agency, Town". So the contact is called "DDM
    // Residential, Grimsby" and companyKey() gives "ddmresidentialgrimsby",
    // which is never equal to the domain label "ddmresidential". Every estate
    // agency the scraper files is named that way, so this exact-match rule
    // could not attach a single branch reply, and it showed: on 2026-08-14
    // Lexi Collins emailed to say the vendor had REJECTED our offer on Orion
    // Way, it minted its own contact owned by nobody, and it sat unread for
    // seven hours beside a card that looked like DDM had never replied.
    //
    // The town is dropped and tried as a second key. Still exact, still
    // refusing on two matches, so nothing is guessed: "ddmresidential" either
    // is the domain or it is not.
    const keysOf = (name: string): string[] => {
      const whole = companyKey(name);
      const agency = companyKey(name.split(',')[0] ?? '');
      return agency && agency !== whole ? [whole, agency] : [whole];
    };
    const hits = rows.filter((c) => keysOf(c.name ?? '').includes(label));

    if (hits.length === 1) {
      // Backfill the address so the next reply takes the cheap path above.
      await supa.from('wk_contacts').update({ email }).eq('id', hits[0].id);
      console.log(`[wk-email-webhook] matched ${email} to existing contact ${hits[0].name}`);
      return hits[0].id;
    }
    if (hits.length > 1) {
      console.log(`[wk-email-webhook] ${hits.length} contacts match "${label}" — creating a new one rather than guessing`);
    }
  }

  // 2b. They named one of our houses. Strongest evidence available, and the
  //     only thing that can rescue an agency whose domain is nothing like its
  //     trading name (Zest of Hull is movewithzest.co.uk).
  const byHouse = await matchByNamedHouse(supa, emailText);
  if (byHouse) {
    await supa.from('wk_contacts').update({ email }).eq('id', byHouse);
    return byHouse;
  }

  // 3. Nobody we know. Create, but never ownerless: an unowned contact is one
  //    an agent is not permitted to read.
  const ownerAgentId = await ownerForRecipient(supa, toEmail);
  if (!ownerAgentId) {
    console.warn(`[wk-email-webhook] no agent owns the mailbox ${toEmail} — contact will be admin-only`);
  }

  const { data: inserted, error: insErr } = await supa
    .from('wk_contacts')
    .insert({
      name: contactName || email,
      email,
      phone: `email:${email}`, // wk_contacts.phone is UNIQUE NOT NULL — synthesise a non-conflicting placeholder
      owner_agent_id: ownerAgentId,
      pipeline_column_id: null,
      custom_fields: {
        source: 'inbound_email',
        first_email_id: firstEmailId,
        received_at_mailbox: toEmail || null,
      },
      is_hot: false,
    })
    .select('id')
    .single();

  if (insErr || !(inserted as { id?: string } | null)?.id) {
    console.error('[wk-email-webhook] wk_contacts insert failed', insErr);
    return null;
  }
  return (inserted as { id: string }).id;
}


// ── READING WHAT THE BRANCH SAID ──────────────────────────────────────────
//
// VERBATIM TWIN of api/lib/inbound-classify.ts. Deno cannot import from the
// Vercel api/ tree, so the rules live in two places and
// tests/inbound-classify-twin.test.ts fails the build if they drift. Same
// arrangement as api/lib/spoken-email.ts and its copy in
// wk-voice-transcription.
//
// WHY IT IS HERE AT ALL. Until 2026-08-14 this function filed the email and
// stopped. Lexi at DDM wrote at 08:38 saying the vendor had REJECTED our
// offer; seven hours later the board still said "Chase the agent, follow up
// until you get an answer" while the answer sat unread. Hugo: "the system has
// not synchronized."

const INBOUND_KINDS = [
  'rejection', 'counter_offer', 'acceptance', 'question', 'document_request',
  'viewing_response', 'info_supplied', 'out_of_office', 'not_interested', 'other',
] as const;
type InboundKind = (typeof INBOUND_KINDS)[number];

const DEAL_CHANGING: InboundKind[] = [
  'rejection', 'counter_offer', 'acceptance', 'question',
  'document_request', 'viewing_response', 'not_interested', 'info_supplied',
];

const RULES: Array<{ kind: InboundKind; re: RegExp }> = [
  { kind: 'out_of_office', re: /\b(out of (the )?office|annual leave|on holiday|automatic reply|auto[- ]?reply|away from my desk|maternity leave|no longer works? (at|for))\b/i },
  { kind: 'acceptance', re: /\b(have|has|they'?ve) accepted\b|\boffer (is )?accepted\b|\bagreed (to|at) (the|your) offer\b|\bvendor accepts\b/i },
  { kind: 'rejection', re: /\b(rejected|declined|turned (it |your offer )?down|unable to accept|will not be accepting|(not|non) accept(ing|ed)? (your|the|our|this) offer)\b/i },
  { kind: 'not_interested', re: /\b(not interested|no longer (available|on the market)|under offer|sold stc|withdrawn from the market|remove (us|me) from)\b/i },
  { kind: 'document_request', re: /\b(proof of funds|evidence of funds|bank statement|id check|anti[- ]?money|solicitor'?s? details|memorandum of sale)\b/i },
  { kind: 'viewing_response', re: /\b(viewing|view the property|access|key ?s|meet you there|available to view)\b/i },
  { kind: 'info_supplied', re: /\b(please find attached|attached is|here is the (video|floor ?plan|epc)|as requested|i have attached)\b/i },
];

function stripDisclaimer(text: string): string {
  // Live data, 2026-08-14: four inbound emails including DDM's own carry
  // "does not accept liability" in the virus footer, which a rejection rule
  // reads as the vendor turning us down. The footer is noise on every rule.
  const markers = [
    /this e-?mail (and|&) any attachment/i,
    /this e-?mail (and|&) any files? transmitted/i,
    /does not accept (liability|any responsibility)/i,
    /cannot guarantee that attachments/i,
    /if you are not the intended recipient/i,
    /is confidential and may be privileged/i,
    /the (contents of this|sender) (e-?mail )?(message )?(is|are) confidential/i,
    /registered in england (and wales )?(no|number)/i,
    /please consider the environment before printing/i,
    /reserves the right to monitor all e-?mail/i,
  ];
  let cut = text.length;
  for (const re of markers) {
    const m = re.exec(text);
    if (m && m.index < cut) cut = m.index;
  }
  return text.slice(0, cut);
}

function figuresMentioned(text: string): number[] {
  const out: number[] = [];
  // Money is currency-marked or comma-grouped, never a bare run of digits: a
  // branch signature's phone number would otherwise read as a price.
  const re = /(?:GBP|£)\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,9}(?:\.\d+)?)|(\d{1,3}(?:,\d{3})+(?:\.\d+)?)/gi;
  for (const m of text.matchAll(re)) {
    const raw = (m[1] ?? m[2] ?? '').replace(/,/g, '');
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1000) continue;
    out.push(n);
  }
  return [...new Set(out)];
}

function gbp(n: number) { return `GBP ${Math.round(n).toLocaleString('en-GB')}`; }

function summarise(kind: InboundKind, figures: number[]): string {
  const most = figures.length ? Math.max(...figures) : null;
  switch (kind) {
    case 'rejection': return 'The offer has been rejected.';
    case 'counter_offer': return most
      ? `They have come back with a figure, ${gbp(most)}. Do not treat that as agreed.`
      : 'They have come back on price.';
    case 'acceptance': return 'They say the offer is accepted. Get it in writing with the address and the price.';
    case 'question': return 'They have asked us something and are waiting on an answer.';
    case 'document_request': return 'They are asking for a document before this can go further.';
    case 'viewing_response': return 'They have written about a viewing or access.';
    case 'info_supplied': return 'They have sent something over.';
    case 'out_of_office': return 'Automatic reply. Nobody has read it yet.';
    case 'not_interested': return 'They have closed the door on this one.';
    default: return 'They have written back.';
  }
}

function classifyByRules(subject: string, body: string) {
  const text = stripDisclaimer(`${subject ?? ''}\n${body ?? ''}`);
  const figures = figuresMentioned(text);
  for (const rule of RULES) {
    if (!rule.re.test(text)) continue;
    let kind = rule.kind;
    if (kind === 'rejection' && figures.length) kind = 'counter_offer';
    return { kind, figuresMentioned: figures, changesTheDeal: DEAL_CHANGING.includes(kind), summary: summarise(kind, figures) };
  }
  const asksSomething = /\?/.test(text)
    || /\b(can|could|would|will|do|does|are|is|have|has|did)\s+(you|we|they)\b/i.test(text)
    || /\b(please\s+(confirm|advise|let\s+me\s+know)|any\s+update|let\s+us\s+know)\b/i.test(text);
  if (asksSomething) {
    return { kind: 'question' as InboundKind, figuresMentioned: figures, changesTheDeal: true, summary: summarise('question', figures) };
  }
  return { kind: 'other' as InboundKind, figuresMentioned: figures, changesTheDeal: false, summary: 'They have written back.' };
}

function stepForInbound(kind: InboundKind): string | null {
  switch (kind) {
    case 'rejection':
    case 'counter_offer': return 'Renegotiate';
    case 'acceptance': return 'Get it in writing';
    case 'not_interested': return '';
    default: return null;
  }
}

/** Act on what the branch said. Never sends anything, never moves a card
 *  between board columns: it updates the INSTRUCTION and raises the alarm.
 *  Deciding the money stays with the humans and the fences. */
async function reactToInbound(
  supa: ReturnType<typeof createClient>,
  contactId: string,
  subject: string,
  body: string,
) {
  const reading = classifyByRules(subject ?? '', body ?? '');
  if (!reading.changesTheDeal) return reading;

  try {
    const { data: c } = await supa
      .from('wk_contacts').select('id, name, custom_fields, agent_id').eq('id', contactId).maybeSingle();
    const cf = ((c as { custom_fields?: Record<string, string> } | null)?.custom_fields ?? {});
    // Only property leads: this reading is about houses.
    if (cf.lead_type !== 'estate_agent') return reading;

    const nextStep = stepForInbound(reading.kind);
    const patch: Record<string, string> = {
      ...cf,
      last_reply_kind: reading.kind,
      last_reply_at: new Date().toISOString(),
      last_reply_summary: reading.summary,
    };
    if (reading.figuresMentioned.length) {
      // Recorded as THEIR figure, never as an offer of ours. The name of the
      // key matters: nothing downstream may mistake it for a price we agreed.
      patch.branch_stated_figure = String(Math.max(...reading.figuresMentioned));
    }
    if (nextStep !== null) patch.next_step = nextStep;

    await supa.from('wk_contacts').update({ custom_fields: patch }).eq('id', contactId);

    // Tell Hugo. A rejection sat unread for seven hours while a fresh offer was
    // about to go out blind, and that is the whole reason this exists.
    //
    // IT HAD NEVER ONCE FIRED. `wk_notifications.agent_id` is NOT NULL with no
    // default, and this insert omitted it, so every single one was rejected by
    // Postgres. The whole block sits inside a try/catch whose job is to stop a
    // reading failure from losing the email, so the violation was caught,
    // logged and swallowed, and the feature looked like it worked.
    //
    // Who to tell: the agent the contact belongs to. If the row is unowned
    // there is nobody to notify and we say so in the log rather than inventing
    // a recipient, because a notification sent to the wrong person is worse
    // than one not sent.
    const ownerId = (c as { agent_id?: string | null } | null)?.agent_id ?? null;
    if (ownerId) {
      const { error: notifyErr } = await supa.from('wk_notifications').insert({
        agent_id: ownerId,
        contact_id: contactId,
        kind: 'branch_replied',
        title: `${(c as { name?: string } | null)?.name ?? 'A branch'} replied`,
        body: reading.summary,
        meta: { inbound_kind: reading.kind, figures: reading.figuresMentioned },
      });
      // Logged loudly rather than swallowed: silence is what hid this for days.
      if (notifyErr) console.error('[wk-email-webhook] notification refused', notifyErr);
    } else {
      console.error('[wk-email-webhook] no agent owns contact', contactId,
        '- nobody was told about this reply');
    }
  } catch (e) {
    // Reading the email must never stop it being filed.
    console.error('[wk-email-webhook] reaction failed', String(e));
  }
  return reading;
}


serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  // Read raw body once — we need it for signature verification AND for
  // JSON parse. After this point, req.body is consumed.
  const rawBody = await req.text();
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Signature verification (best-effort — log + drop on mismatch).
  const svixId = req.headers.get('svix-id') ?? '';
  const svixTs = req.headers.get('svix-timestamp') ?? '';
  const svixSig = req.headers.get('svix-signature') ?? '';
  const secret = await loadWebhookSecret(supa);

  if (secret) {
    const valid = await verifySvixSignature(secret, svixId, svixTs, svixSig, rawBody);
    if (!valid) {
      console.error(
        `[wk-email-webhook] INVALID Svix signature — dropping event. svix-id=${svixId} ts=${svixTs}`,
      );
      // PR 100 (Hugo 2026-04-28): was returning 200 here so Resend wouldn't
      // retry. That meant any inbound email that arrived during a secret-
      // mismatch window was silently lost forever (Hugo's reply on
      // 2026-04-28 was lost this way). Now returns 401 so Resend retries
      // with backoff while we fix the secret. Resend caps retries at a few
      // attempts over hours; if the secret stays broken past that, it'll
      // dead-letter — which is still correct behaviour for a sustained
      // misconfiguration.
      return new Response(
        JSON.stringify({ error: 'invalid signature' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
  } else {
    // Fail closed — with no secret we cannot verify the sender, and
    // accepting would let anyone inject wk_contacts / wk_sms_messages rows.
    console.error('[wk-email-webhook] no webhook secret configured — rejecting (fail closed)');
    return new Response(
      JSON.stringify({ error: 'webhook secret not configured' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  let event: ResendInboundEvent;
  try {
    event = JSON.parse(rawBody) as ResendInboundEvent;
  } catch {
    return ok({ note: 'invalid json — accepted to stop retries' });
  }

  if (event.type !== 'email.received') {
    console.log(`[wk-email-webhook] ignoring event type=${event.type}`);
    return ok({ note: 'ignored event type' });
  }

  const d = event.data ?? {};
  // Resend has used both `email_id` and `id` for the inbound email
  // identifier. Either is fine — we just need it for idempotency.
  const emailId = d.email_id || d.id || '';
  if (!emailId) {
    console.warn('[wk-email-webhook] missing email_id in event payload');
    return ok({ note: 'no email_id' });
  }

  // PR 102: extract from/to/subject/body from the payload directly.
  // Earlier code did a GET /emails/{id} which is outbound-only —
  // returned 404 for inbound IDs and dropped every inbound message.
  const fromRaw = d.from;
  const fromAddr =
    typeof fromRaw === 'string'
      ? fromRaw
      : (fromRaw?.address ?? '');
  const fromName =
    typeof fromRaw === 'string' ? '' : (fromRaw?.name ?? '');

  let toAddr = '';
  if (Array.isArray(d.to) && d.to.length > 0) {
    const first = d.to[0];
    toAddr = typeof first === 'string' ? first : (first?.address ?? '');
  }

  const fromEmail = fromAddr.toLowerCase().trim();
  if (!fromEmail) {
    console.warn('[wk-email-webhook] missing from address in payload', JSON.stringify(d).slice(0, 300));
    return ok({ note: 'no from' });
  }

  // Only accept emails delivered to a configured CRM inbound domain.
  // Resend's MX can also catch other domains pointed at it (DMARC reports,
  // postmaster bounces) — drop those at webhook intake so the CRM only ever
  // sees its own domains' traffic. If the env var is unset, fail closed
  // instead of guessing a domain.
  if (!CRM_INBOUND_EMAIL_DOMAINS.length) {
    console.error('[wk-email-webhook] CRM_INBOUND_EMAIL_DOMAIN not set — rejecting event');
    return new Response(
      JSON.stringify({ error: 'CRM_INBOUND_EMAIL_DOMAIN not configured' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  const toEmail = toAddr.toLowerCase().trim();
  if (!CRM_INBOUND_EMAIL_DOMAINS.some((d) => toEmail.endsWith(`@${d}`))) {
    console.log(`[wk-email-webhook] dropping recipient outside ${CRM_INBOUND_EMAIL_DOMAINS.join(',')}: ${toEmail}`);
    return ok({ note: 'recipient outside CRM inbound domain — dropped', to: toEmail });
  }

  const subject = d.subject ?? '';

  // PR 103: fetch html + text from the dedicated inbound endpoint.
  // Resend's email.received webhook payload is metadata-only.
  let html = '';
  let text = '';
  if (RESEND_API_KEY) {
    try {
      const r = await fetch(
        `https://api.resend.com/emails/inbound/${emailId}`,
        { headers: { Authorization: `Bearer ${RESEND_API_KEY}` } },
      );
      if (r.ok) {
        const full = (await r.json()) as { html?: string; text?: string };
        html = full.html ?? '';
        text = full.text ?? '';
      } else {
        const errText = await r.text();
        console.warn(
          `[wk-email-webhook] inbound body fetch ${r.status}: ${errText.slice(0, 200)}`,
        );
      }
    } catch (e) {
      console.error('[wk-email-webhook] inbound body fetch threw', e);
    }
  } else {
    console.warn('[wk-email-webhook] RESEND_API_KEY missing — body will be empty');
  }
  // Prefer the HTML and render it down ourselves.
  //
  // Hugo, 2026-08-11: "emails are not formated, pls fix". The Gascoigne Halman
  // welcome mail arrived as a wall of "https://mailing.street.co.uk/ls/click?
  // upn=u001.6cL4aGcwD419h-2BpLNm8D2AQQ05..." because the old line took
  // `text` whenever it existed, and a marketing tool's text/plain alternative
  // spells every link out in full next to its anchor. The HTML has the same
  // links tucked inside href attributes where they can be dropped, so
  // converting the HTML gives a far cleaner read than the sender's own plain
  // text. Falls back to `text` when there is no HTML at all.
  const rawBodyText = html ? htmlToText(html) : tidyPlainText(text);
  // PR 104: strip quoted history so the inbox shows only the new reply.
  const bodyText = stripReplyQuotes(rawBodyText);

  const contactId = await findOrCreateContact(
    supa, fromEmail, fromName, emailId, toEmail, `${subject ?? ''}\n${bodyText ?? ''}`);
  if (!contactId) return ok({ note: 'contact resolution failed' });

  const { error: msgErr } = await supa
    .from('wk_sms_messages')
    .insert({
      contact_id: contactId,
      direction: 'inbound',
      channel: 'email',
      body: bodyText,
      external_id: emailId,
      subject,
      from_e164: fromEmail,
      to_e164: toAddr || null,
      media_urls: [],
      status: 'received',
    });

  if (msgErr) {
    const code = (msgErr as { code?: string }).code;
    if (code === '23505') {
      console.log(`[wk-email-webhook] duplicate email_id=${emailId} — idempotent skip`);
    } else {
      console.error('[wk-email-webhook] insert failed', msgErr);
    }
  } else {
    await supa
      .from('wk_contacts')
      .update({ last_contact_at: new Date().toISOString() })
      .eq('id', contactId);
    // READ IT, do not just file it. Updates the instruction on the card and
    // raises the alarm; never sends, never moves a board column.
    await reactToInbound(supa, contactId, subject, bodyText);
    // Whoever this was addressed to can now read it, whatever the sender's
    // contact record says about who owns them.
    await grantRecipientAccess(supa, contactId, await ownerForRecipient(supa, toEmail));
  }

  return ok({ saved: !msgErr, email_id: emailId });
});
