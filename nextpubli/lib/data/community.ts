import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Is this person in the Skool community yet?
 *
 * `skool_members` is written by the Skool webhook (invite confirmed, or a new
 * paid member) and keyed on the normalised email, because an email address is
 * the only thing Skool's events give us. That is also why the Getting started
 * copy tells creators to use the same email in both places.
 *
 * Read with the service role: the table is admin-only by RLS and this is the
 * creator asking about their own address, not browsing anybody else's.
 * Synthetic Instagram addresses can never match a real Skool account, so they
 * are refused before the query rather than returning a confident false.
 */
export async function isCommunityMember(email: string | null): Promise<boolean> {
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized || normalized.endsWith("@instagram.heypubli.com")) return false;

  const { data, error } = await createAdminClient()
    .from("skool_members")
    .select("id")
    .eq("email_normalized", normalized)
    .maybeSingle();

  if (error) {
    // Never claim they joined on the strength of a failed read: the step stays
    // open, which is the harmless direction to be wrong in.
    console.error("[community] isCommunityMember failed", error);
    return false;
  }
  return Boolean(data);
}
