// Cookies that carry the Instagram OAuth state + signup data across the
// Instagram/Outstand round-trip. Shared by the start route (set) and the
// callback (read/clear) so both always use IDENTICAL attributes — a delete
// with different Domain/Path silently no-ops and the cookie survives.

export const STATE_COOKIE = "ig_login_state";
export const SIGNUP_COOKIE = "ig_signup_data";

// Instagram routinely forces detours mid-OAuth (convert to professional
// account, 2FA, app switching) that take well over 5 minutes. The nonce is
// random, httpOnly and single-purpose, so a 1-hour window is an acceptable
// CSRF trade-off — a 5-minute one was killing real signups.
export const STATE_TTL_SECONDS = 3600;

// Share the auth cookies across apex + www so they survive the nextpubli.com →
// www redirect that happens mid-flow.
export function cookieDomain(origin: string): string | undefined {
  try {
    const host = new URL(origin).hostname;
    if (host === "nextpubli.com" || host.endsWith(".nextpubli.com")) {
      return ".nextpubli.com";
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function authCookieOptions(origin: string) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: STATE_TTL_SECONDS,
    path: "/",
    domain: cookieDomain(origin),
  };
}

/** Attributes a deletion must repeat to actually match the stored cookie. */
export function authCookieClearAttrs(origin: string) {
  return { path: "/", domain: cookieDomain(origin) };
}
