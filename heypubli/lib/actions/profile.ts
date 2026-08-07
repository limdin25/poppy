"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { contactSchema } from "@/schemas";
import { redirect } from "next/navigation";

/**
 * Save the real email + WhatsApp captured right after the first Instagram login.
 * Clears needs_contact so the influencer can proceed into onboarding.
 */
export async function saveContactInfo(
  formData: FormData,
): Promise<{ error: string } | null> {
  const parsed = contactSchema.safeParse({
    email: formData.get("email"),
    whatsapp: formData.get("whatsapp"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid data" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (supabase.from("profiles") as any)
    .update({
      email: parsed.data.email,
      whatsapp: parsed.data.whatsapp,
      needs_contact: false,
    })
    .eq("id", user.id);

  if (error) {
    return { error: "Could not save. Please try again." };
  }

  // Use the real email as the auth email too, so they can log in via an email
  // magic link later (not just Instagram). Best-effort.
  await createAdminClient()
    .auth.admin.updateUserById(user.id, {
      email: parsed.data.email,
      email_confirm: true,
    })
    .catch(() => {});

  redirect("/onboarding");
}
