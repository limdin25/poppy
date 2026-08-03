import { createHmac, timingSafeEqual } from "crypto";

/**
 * Shared HMAC check for every funnel webhook, modelled on app/api/webhooks/outstand:
 * raw body, SHA-256, constant-time compare, and FAIL CLOSED when the secret env var is
 * missing. A webhook that skips verification because someone forgot an env var is an
 * open door, not a soft launch.
 */
export function verifyFunnelSignature(
  rawBody: string,
  header: string | null,
  secret: string | undefined,
): boolean {
  if (!secret) return false;
  if (!header) return false;
  const given = header.replace(/^sha256=/, "").trim();
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (given.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function signFunnelBody(rawBody: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
}
