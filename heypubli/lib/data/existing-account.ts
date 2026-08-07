import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Do we already know this person?
 *
 * Asked whenever an Instagram connect fails during signup, so we can stop
 * telling somebody to "try again" at a signup they finished half an hour ago.
 *
 * 07 Aug 2026: Edelyn signed up at 08:33, her Instagram linked, and at 09:03 she
 * was back on the connect step reading "Could not sign in with Instagram.
 * Please try again." She had an account, a linked Instagram, and nothing left to
 * do but open the Skool invite in her email. The error screen said none of that,
 * so she kept retrying.
 *
 * Fails to FALSE on any doubt. Wrongly telling a brand new creator they already
 * have an account is a dead end they cannot argue with; wrongly showing the
 * retry screen is just the behaviour we already had.
 */
export async function accountExistsForEmail(
  email: string | undefined | null,
): Promise<boolean> {
  const addr = (email ?? "").trim().toLowerCase();
  if (!addr || !addr.includes("@")) return false;
  // A synthetic auth address is our own invention, never proof of a person.
  if (addr.endsWith("@instagram.heypubli.com")) return false;

  try {
    const { data, error } = await createAdminClient()
      .from("profiles")
      .select("id")
      .eq("email", addr)
      .maybeSingle();
    if (error) {
      console.error("[existing-account] lookup failed", error);
      return false;
    }
    return Boolean(data);
  } catch (err) {
    console.error("[existing-account] threw", err);
    return false;
  }
}
