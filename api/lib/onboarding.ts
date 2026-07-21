// Shared helpers for the agent onboarding flow (public /join page).
// The email verification code is never stored in the clear — we keep a
// SHA-256 hash of `code:email` and re-hash the submitted code to compare.

/** SHA-256 hex of the code bound to the email (edge Web Crypto). */
export async function hashOnboardingCode(code: string, email: string): Promise<string> {
  const data = new TextEncoder().encode(`${code.trim()}:${email.trim().toLowerCase()}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** A fresh 6-digit numeric code, zero-padded. */
export function genOnboardingCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return (arr[0] % 1_000_000).toString().padStart(6, '0');
}
