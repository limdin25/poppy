"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { queueSkoolInvite } from "@/lib/data/lanes";

async function requireAdmin(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single<{ is_admin: boolean }>();
  if (!profile?.is_admin) throw new Error("Not an admin");
  return user.id;
}

/**
 * Hugo's manual gate for self-serve signups. Approving PROMOTES the lead to partner
 * (that is what makes the invite legal past the skool_invites lane CHECK) and queues the
 * free invite in the same breath. The lane change is audited via lane_locked_by.
 */
export async function approveOrganicLead(leadId: string): Promise<void> {
  const adminId = await requireAdmin();
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from("signup_leads") as any)
    .update({
      lane: "partner",
      lane_locked_at: new Date().toISOString(),
      lane_locked_by: `admin:${adminId}`,
      approval_state: "approved",
      approved_at: new Date().toISOString(),
      approved_by: adminId,
    })
    .eq("id", leadId)
    .eq("lane", "organic");
  if (error) throw new Error(error.message);
  await queueSkoolInvite(leadId);
  revalidatePath("/admin/leads");
}

export async function rejectOrganicLead(leadId: string): Promise<void> {
  const adminId = await requireAdmin();
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from("signup_leads") as any)
    .update({
      approval_state: "rejected",
      approved_at: new Date().toISOString(),
      approved_by: adminId,
    })
    .eq("id", leadId)
    .eq("lane", "organic");
  if (error) throw new Error(error.message);
  revalidatePath("/admin/leads");
}
