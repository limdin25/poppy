"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A creator disconnecting their own Instagram.
 *
 * The onboarding has always told them "You can disconnect whenever you want
 * from Settings, and nothing goes out before you connect." That was not true.
 * Settings rendered a Disconnect button with no handler on it, so it was
 * decoration, and the only real disconnect lived in the admin actions where no
 * creator could reach it. On 07 Aug 2026 a lead asked how to delink and got
 * told the same untrue thing, which is what prompted this.
 *
 * BOTH tables are cleared. outstand_connections is the live integration and the
 * one posting actually reads; instagram_connections is the older Meta path and
 * is currently empty, but clearing only the table you happen to remember is
 * exactly how somebody keeps receiving posts after asking us to stop. Rows are
 * marked disconnected rather than deleted, so the history survives and a
 * reconnect is a new row rather than a resurrection.
 */

export type DisconnectResult = { ok: true } | { ok: false; reason: "not_signed_in" | "failed" };

export async function disconnectMyInstagram(): Promise<DisconnectResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "not_signed_in" };

  const admin = createAdminClient();

  // Scoped to the caller's own profile id, always. A disconnect must never be
  // able to reach across accounts.
  for (const table of ["outstand_connections", "instagram_connections"]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin.from(table) as any)
      .update({ is_connected: false })
      .eq("profile_id", user.id);
    if (error) {
      console.error(`[disconnect] ${table} failed`, error);
      return { ok: false, reason: "failed" };
    }
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { ok: true };
}
