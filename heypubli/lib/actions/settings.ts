"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function saveSettings(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const firstName = formData.get("first_name") as string;
  const lastName = formData.get("last_name") as string;
  const whatsapp = (formData.get("whatsapp") as string) || null;
  const dialCode = (formData.get("dial_code") as string) || "+55";
  const addressCountry = formData.get("address_country") as string;
  const addressStreet = (formData.get("address_street") as string) || null;
  const addressCity = (formData.get("address_city") as string) || null;
  const addressPostalCode = (formData.get("address_postal_code") as string) || null;

  const fullWhatsapp = whatsapp ? `${dialCode}${whatsapp}` : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("profiles") as any)
    .update({
      first_name: firstName,
      last_name: lastName,
      whatsapp: fullWhatsapp,
      address_country: addressCountry,
      address_street: addressStreet,
      address_city: addressCity,
      address_postal_code: addressPostalCode,
    })
    .eq("id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { success: true };
}
