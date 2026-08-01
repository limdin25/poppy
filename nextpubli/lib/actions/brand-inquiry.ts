"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export async function submitBrandInquiry(formData: FormData) {
  const name = formData.get("name") as string;
  const email = formData.get("email") as string;
  const brandName = formData.get("brand_name") as string;
  const instagram = (formData.get("instagram") as string) || null;
  const message = (formData.get("message") as string) || null;

  if (!name || !email || !brandName) {
    return { error: "Fill in all required fields" };
  }

  const admin = createAdminClient();

  const { data: adminProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("is_admin", true)
    .limit(1)
    .single<{ id: string }>();

  if (!adminProfile) {
    return { error: "Internal error. Please try again." };
  }

  const content = [
    `[BRAND LEAD]`,
    `Name: ${name}`,
    `Email: ${email}`,
    `Brand: ${brandName}`,
    instagram ? `Instagram: ${instagram}` : null,
    message ? `Message: ${message}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from("messages_log") as any).insert({
    profile_id: adminProfile.id,
    channel: "email",
    direction: "inbound",
    content,
    status: "delivered",
    sent_at: new Date().toISOString(),
    sent_by: email,
  });

  if (error) return { error: "Failed to send. Please try again." };

  return { success: true };
}
