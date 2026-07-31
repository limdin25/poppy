"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Gender } from "@/types/database";

export async function saveOnboarding(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Não autenticado" };

  const step = parseInt(formData.get("step") as string, 10);

  if (step === 3 || step === 4) {
    const sectorIds = (formData.get("sector_ids") as string).split(",").filter(Boolean);
    const type = step === 3 ? "preferred" : "content";

    await supabase
      .from("influencer_sectors")
      .delete()
      .eq("profile_id", user.id)
      .eq("type", type);

    if (sectorIds.length > 0) {
      const rows = sectorIds.map((sectorId) => ({
        profile_id: user.id,
        sector_id: sectorId,
        type,
      }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("influencer_sectors") as any).insert(rows);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("profiles") as any)
      .update({ onboarding_step: step + 1 })
      .eq("id", user.id);

    return { success: true };
  }

  if (step === 5) {
    const dateOfBirth = (formData.get("date_of_birth") as string) || null;
    const gender = (formData.get("gender") as Gender) || null;
    const addressStreet = (formData.get("address_street") as string) || null;
    const addressCity = (formData.get("address_city") as string) || null;
    const addressPostalCode = (formData.get("address_postal_code") as string) || null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("profiles") as any)
      .update({
        date_of_birth: dateOfBirth,
        gender,
        address_street: addressStreet,
        address_city: addressCity,
        address_postal_code: addressPostalCode,
        onboarding_step: 6,
        onboarding_complete: true,
      })
      .eq("id", user.id);

    if (error) return { error: error.message };

    revalidatePath("/dashboard");
    return { success: true };
  }

  if (step === 2) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("profiles") as any)
      .update({ onboarding_step: 3 })
      .eq("id", user.id);
    return { success: true };
  }

  return { error: "Etapa inválida" };
}
