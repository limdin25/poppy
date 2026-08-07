import { normaliseWhatsapp } from "./whatsapp-number";

/**
 * The WhatsApp number carried in the signup link, ready for the form.
 *
 * Hugo, 07 Aug 2026: "how can numbers be wrong if they whatsapp us first, it
 * makes no sense". Quite right. The link we send was a bare
 * heypubli.com/signup, carrying no identity at all, so the page had to ask a
 * creator to retype the very number they were reading the message on. Two of
 * the first three signups got it wrong, one by a single digit and one by
 * keeping the local trunk zero after the country code, and both had to be
 * repaired by hand before their onboarding nudges went to a stranger.
 *
 * So the link now carries ?w=<digits> and the box arrives filled in. Strictly
 * digits, with an optional leading plus: anything else is discarded rather than
 * shown, because a prefill is content we put in front of a creator and must
 * never be able to carry markup or a second parameter.
 */
export function prefillWhatsappFromLink(w: string | undefined | null): string {
  const raw = (w ?? "").trim();
  if (!raw) return "";
  if (!/^\+?\d+$/.test(raw)) return "";

  const n = normaliseWhatsapp(raw);
  return n.ok ? n.e164 : "";
}
