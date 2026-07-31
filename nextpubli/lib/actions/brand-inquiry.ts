"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export async function submitBrandInquiry(formData: FormData) {
  const name = formData.get("name") as string;
  const email = formData.get("email") as string;
  const brandName = formData.get("brand_name") as string;
  const instagram = (formData.get("instagram") as string) || null;
  const message = (formData.get("message") as string) || null;

  if (!name || !email || !brandName) {
    return { error: "Preencha todos os campos obrigatórios" };
  }

  const admin = createAdminClient();

  const { data: adminProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("is_admin", true)
    .limit(1)
    .single<{ id: string }>();

  if (!adminProfile) {
    return { error: "Erro interno. Tente novamente." };
  }

  const content = [
    `[LEAD MARCA]`,
    `Nome: ${name}`,
    `Email: ${email}`,
    `Marca: ${brandName}`,
    instagram ? `Instagram: ${instagram}` : null,
    message ? `Mensagem: ${message}` : null,
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

  if (error) return { error: "Erro ao enviar. Tente novamente." };

  return { success: true };
}
