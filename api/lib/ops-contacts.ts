// Who the machine is allowed to interrupt, and how to word a template variable
// so Meta will actually deliver it.
//
// Hugo, 2026-08-22: "you have my WhatsApp, which is triple five, and you have
// Pedro's WhatsApp. I want you to contact us every time via WhatsApp every time
// you need something."
//
// IN SETTINGS, NOT IN CODE. A phone number compiled into a deployment is a
// redeploy every time somebody joins or leaves, and worse, it is a number no
// one can see without reading the source. platform_settings.ops_contacts is one
// row an admin can edit.
//
// AN EMPTY NUMBER IS SKIPPED, NEVER GUESSED. Pedro's WhatsApp was named but not
// given, so his entry ships blank. A blank entry is reported (the caller counts
// it as missing and says so) and never dialled: the alternative, deriving a
// mobile from his CRM caller ID, would text a Twilio line nobody reads, or
// worse, a stranger.

import type { SupabaseClient } from '@supabase/supabase-js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = SupabaseClient<any, any, any>;

export interface OpsContact {
  name: string;
  phone: string;
  role: string;
}

export interface OpsContacts {
  enabled: boolean;
  contacts: OpsContact[];
}

export const OPS_DEFAULTS: OpsContacts = { enabled: true, contacts: [] };

/** A number Twilio can put a WhatsApp message on. */
export function sendablePhone(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').replace(/[^\d+]/g, '');
  if (/^\+\d{10,15}$/.test(s)) return s;
  if (/^0\d{9,10}$/.test(s)) return `+44${s.slice(1)}`;
  return null;
}

export function parseOpsContacts(raw: unknown): OpsContacts {
  let parsed: Partial<OpsContacts> = {};
  try {
    parsed = typeof raw === 'string'
      ? JSON.parse(raw || '{}') as Partial<OpsContacts>
      : ((raw ?? {}) as Partial<OpsContacts>);
  } catch { /* defaults */ }
  const contacts = Array.isArray(parsed.contacts) ? parsed.contacts : [];
  return {
    enabled: parsed.enabled !== false,
    contacts: contacts
      .map((c) => ({
        name: String((c as OpsContact)?.name ?? '').trim(),
        phone: String((c as OpsContact)?.phone ?? '').trim(),
        role: String((c as OpsContact)?.role ?? '').trim(),
      }))
      .filter((c) => c.name),
  };
}

export async function loadOpsContacts(sb: Sb): Promise<OpsContacts> {
  const { data } = await sb
    .from('platform_settings').select('value').eq('key', 'ops_contacts').maybeSingle();
  return parseOpsContacts((data as { value?: unknown } | null)?.value);
}

/** The ones we can actually message, in list order. */
export function reachable(ops: OpsContacts): Array<OpsContact & { e164: string }> {
  return ops.contacts
    .map((c) => ({ ...c, e164: sendablePhone(c.phone) ?? '' }))
    .filter((c) => c.e164);
}

/** The ones named but not contactable, so a caller can SAY what is missing
 *  rather than quietly asking fewer people than Hugo thinks it asked. */
export function unreachable(ops: OpsContacts): OpsContact[] {
  return ops.contacts.filter((c) => !sendablePhone(c.phone));
}

/**
 * Is this inbound number one of ours?
 *
 * THE POINT IS NEGATIVE, not positive: a staff number must never be treated as
 * a lead. Hugo messaging the builders line to answer a question must not be
 * stamped with a product, must not be auto-replied to by the sales brain, and
 * must not land in a campaign. Matched on the last nine digits so a number
 * stored as 07863..., +447863... or 447863... all resolve to the same person.
 */
export function matchOpsContact(ops: OpsContacts, phone: string): OpsContact | null {
  const tail = String(phone ?? '').replace(/\D/g, '').slice(-9);
  if (tail.length < 9) return null;
  return ops.contacts.find(
    (c) => String(c.phone ?? '').replace(/\D/g, '').slice(-9) === tail,
  ) ?? null;
}

/**
 * Make a string safe to put in a Meta template variable.
 *
 * Meta's real rules, each learned the expensive way somewhere in this repo:
 * a variable may not contain a newline or a tab, may not contain four or more
 * consecutive spaces, and may not be empty (the send is rejected outright, not
 * degraded). Length is ours: a template variable carrying a paragraph reads as
 * spam to the reviewer and gets the template pulled.
 */
export function templateVar(raw: string, max = 120): string {
  const flat = String(raw ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!flat) return 'a deal';
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}.` : flat;
}
