"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { InstagramPostOptions, PostMediaType } from "@/types/database";
import { getPostingSettingsAdmin } from "@/lib/data/outstand";
import { readInstagramOptions } from "@/lib/instagram-options";
import { DEFAULT_TIMEZONE, isSchedulingTimezone, localToUtcIso } from "@/lib/timezone";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single<{ is_admin: boolean }>();

  if (!profile?.is_admin) throw new Error("Acesso negado");
  return user.id;
}

export async function deleteInfluencer(profileId: string) {
  await requireAdmin();
  const admin = createAdminClient();

  const { error: postsErr } = await admin
    .from("scheduled_posts")
    .delete()
    .eq("profile_id", profileId);
  if (postsErr) throw postsErr;

  const { error: salesErr } = await admin
    .from("hotmart_sales")
    .delete()
    .eq("profile_id", profileId);
  if (salesErr) throw salesErr;

  const { error: msgsErr } = await admin
    .from("messages_log")
    .delete()
    .eq("profile_id", profileId);
  if (msgsErr) throw msgsErr;

  const { error: assignErr } = await admin
    .from("brand_assignments")
    .delete()
    .eq("profile_id", profileId);
  if (assignErr) throw assignErr;

  const { error: sectorsErr } = await admin
    .from("influencer_sectors")
    .delete()
    .eq("profile_id", profileId);
  if (sectorsErr) throw sectorsErr;

  const { error: igErr } = await admin
    .from("instagram_connections")
    .delete()
    .eq("profile_id", profileId);
  if (igErr) throw igErr;

  const { error: profileErr } = await admin.from("profiles").delete().eq("id", profileId);
  if (profileErr) throw profileErr;

  const { error: authErr } = await admin.auth.admin.deleteUser(profileId);
  if (authErr) throw authErr;

  revalidatePath("/admin/influenciadores");
  revalidatePath("/admin");
}

/**
 * Suspends (or reactivates) an influencer without deleting anything: history,
 * connections and payouts stay. Suspended accounts are locked out by the
 * middleware and excluded from scheduling.
 */
export async function setInfluencerSuspended(profileId: string, suspended: boolean) {
  await requireAdmin();
  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from("profiles") as any)
    .update({ suspended_at: suspended ? new Date().toISOString() : null })
    .eq("id", profileId);

  if (error) return { error: error.message };

  revalidatePath(`/admin/influenciadores/${profileId}`);
  revalidatePath("/admin/influenciadores");
  revalidatePath("/admin/agendador");
  return { success: true };
}

export async function disconnectInfluencerInstagram(connectionId: string) {
  await requireAdmin();
  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from("instagram_connections") as any)
    .update({ is_connected: false })
    .eq("id", connectionId);

  if (error) throw error;
  revalidatePath("/admin/influenciadores");
}

export async function createBrand(formData: FormData) {
  await requireAdmin();
  const admin = createAdminClient();

  const name = formData.get("name") as string;
  const description = (formData.get("description") as string) || null;
  const hotmartProductId = (formData.get("hotmart_product_id") as string) || null;
  const hotmartProductUrl = (formData.get("hotmart_product_url") as string) || null;
  const sectorsRaw = (formData.get("target_sectors") as string) || "";
  const targetSectors = sectorsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const isActive = formData.get("is_active") === "true";
  const logoUrl = (formData.get("logo_url") as string) || null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from("brands") as any).insert({
    name,
    description,
    logo_url: logoUrl,
    hotmart_product_id: hotmartProductId,
    hotmart_product_url: hotmartProductUrl,
    target_sectors: targetSectors,
    is_active: isActive,
  });

  if (error) throw error;
  revalidatePath("/admin/marcas");
}

export async function updateBrand(brandId: string, formData: FormData) {
  await requireAdmin();
  const admin = createAdminClient();

  const name = formData.get("name") as string;
  const description = (formData.get("description") as string) || null;
  const hotmartProductId = (formData.get("hotmart_product_id") as string) || null;
  const hotmartProductUrl = (formData.get("hotmart_product_url") as string) || null;
  const sectorsRaw = (formData.get("target_sectors") as string) || "";
  const targetSectors = sectorsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const isActive = formData.get("is_active") === "true";
  const logoUrl = (formData.get("logo_url") as string) || null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from("brands") as any)
    .update({
      name,
      description,
      logo_url: logoUrl,
      hotmart_product_id: hotmartProductId,
      hotmart_product_url: hotmartProductUrl,
      target_sectors: targetSectors,
      is_active: isActive,
    })
    .eq("id", brandId);

  if (error) throw error;
  revalidatePath("/admin/marcas");
}

export async function deleteBrand(brandId: string) {
  await requireAdmin();
  const admin = createAdminClient();

  const { error: assignErr } = await admin
    .from("brand_assignments")
    .delete()
    .eq("brand_id", brandId);
  if (assignErr) throw assignErr;

  const { error: postsErr } = await admin
    .from("scheduled_posts")
    .delete()
    .eq("brand_id", brandId);
  if (postsErr) throw postsErr;

  const { error } = await admin.from("brands").delete().eq("id", brandId);
  if (error) throw error;

  revalidatePath("/admin/marcas");
}

export async function schedulePost(formData: FormData) {
  await requireAdmin();
  const admin = createAdminClient();

  const influencerIds = (formData.get("influencer_ids") as string).split(",");
  const brandId = formData.get("brand_id") as string;
  const mediaType = formData.get("media_type") as PostMediaType;
  const mediaUrl = (formData.get("media_url") as string) || "";
  const caption = formData.get("caption") as string;
  const scheduledAt = formData.get("scheduled_at") as string;
  const instagramOptions: InstagramPostOptions | null = readInstagramOptions(formData);

  const settings = await getPostingSettingsAdmin();
  const provider = settings?.active_provider ?? "heypubli";

  // Wall time in the timezone the scheduler picked (falls back to the app default).
  const tzRaw = (formData.get("timezone") as string) || "";
  const timezone = isSchedulingTimezone(tzRaw)
    ? tzRaw
    : (settings?.default_timezone ?? DEFAULT_TIMEZONE);

  const rows = influencerIds.map((profileId) => ({
    profile_id: profileId.trim(),
    brand_id: brandId,
    media_type: mediaType,
    media_url: mediaUrl,
    caption,
    scheduled_at: localToUtcIso(scheduledAt, timezone),
    status: "pending" as const,
    provider,
    instagram_options: instagramOptions,
    ig_media_id: null,
    outstand_post_id: null,
    published_at: null,
    error_message: null,
    reach: null,
    likes: null,
    comments: null,
    shares: null,
    campaign_id: null,
    campaign_item_id: null,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from("scheduled_posts") as any).insert(rows);
  if (error) throw error;

  revalidatePath("/admin/agendador");
  revalidatePath("/admin");
}

export async function deletePost(postId: string) {
  await requireAdmin();
  const admin = createAdminClient();

  const { error } = await admin.from("scheduled_posts").delete().eq("id", postId);
  if (error) throw error;

  revalidatePath("/admin/agendador");
}

/** Admin manually creates an influencer account (the trigger mints their referral tag). */
export async function createInfluencer(
  formData: FormData,
): Promise<{ error: string } | { success: true }> {
  await requireAdmin();
  const firstName = ((formData.get("first_name") as string) || "").trim();
  const lastName = ((formData.get("last_name") as string) || "").trim();
  const email = ((formData.get("email") as string) || "").trim().toLowerCase();
  const whatsapp = ((formData.get("whatsapp") as string) || "").trim() || null;

  if (!firstName || !email.includes("@")) {
    return { error: "Nome e um email válido são obrigatórios." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      first_name: firstName,
      last_name: lastName,
      auth_provider: "email",
      registration_method: "admin_manual",
    },
  });
  if (error) return { error: error.message };

  // Trigger created the profile + referral tag; attach the WhatsApp if given.
  if (whatsapp && data.user) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("profiles") as any).update({ whatsapp }).eq("id", data.user.id);
  }

  revalidatePath("/admin/influenciadores");
  return { success: true };
}

export async function updateInfluencerProfile(profileId: string, formData: FormData) {
  await requireAdmin();
  const admin = createAdminClient();

  const firstName = formData.get("first_name") as string;
  const lastName = formData.get("last_name") as string;
  const whatsapp = (formData.get("whatsapp") as string) || null;
  const phone = (formData.get("phone") as string) || null;
  const dateOfBirth = (formData.get("date_of_birth") as string) || null;
  const addressStreet = (formData.get("address_street") as string) || null;
  const addressCity = (formData.get("address_city") as string) || null;
  const addressPostalCode = (formData.get("address_postal_code") as string) || null;
  const pixKeyType = (formData.get("pix_key_type") as string) || null;
  const pixKey = (formData.get("pix_key") as string) || null;
  const hotmartUrl = (formData.get("hotmart_url") as string) || null;
  const hotmartAffiliateCode = (formData.get("hotmart_affiliate_code") as string) || null;

  // Commission is entered as a percentage (e.g. "20"); store as a 0–1 rate, or null to
  // inherit the brand rate. Empty/invalid → null.
  const commissionPct = ((formData.get("commission_rate_pct") as string) || "").trim();
  let commissionRate: number | null = null;
  if (commissionPct !== "") {
    const pct = Number(commissionPct);
    if (!Number.isNaN(pct)) commissionRate = Math.max(0, Math.min(1, pct / 100));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from("profiles") as any)
    .update({
      first_name: firstName,
      last_name: lastName,
      whatsapp,
      phone,
      date_of_birth: dateOfBirth,
      address_street: addressStreet,
      address_city: addressCity,
      address_postal_code: addressPostalCode,
      pix_key_type: pixKeyType,
      pix_key: pixKey,
      commission_rate: commissionRate,
      hotmart_url: hotmartUrl,
      hotmart_affiliate_code: hotmartAffiliateCode,
    })
    .eq("id", profileId);

  if (error) return { error: error.message };

  revalidatePath(`/admin/influenciadores/${profileId}`);
  revalidatePath("/admin/influenciadores");
  return { success: true };
}

/** Admin confirms a PIX payout was sent. No-op (already paid/cancelled) is reported. */
export async function markPayoutPaid(payoutId: string) {
  const adminId = await requireAdmin();
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from("payouts") as any)
    .update({ status: "paid", paid_at: new Date().toISOString(), paid_by: adminId })
    .eq("id", payoutId)
    .eq("status", "requested")
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Pagamento já processado." };
  revalidatePath("/admin/pagamentos");
  return { success: true };
}

/** Admin cancels an open request, releasing its sales back to the available pool. */
export async function cancelPayout(payoutId: string) {
  await requireAdmin();
  const admin = createAdminClient();
  // Cancel FIRST, guarded on status='requested', so a concurrent mark-paid can't
  // leave a paid payout with its sales released (double-pay).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from("payouts") as any)
    .update({ status: "cancelled" })
    .eq("id", payoutId)
    .eq("status", "requested")
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Pagamento já processado." };
  // Only now release its sales back to the available pool.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("hotmart_sales") as any)
    .update({ payout_id: null })
    .eq("payout_id", payoutId);
  revalidatePath("/admin/pagamentos");
  return { success: true };
}

export async function updateInfluencerAuth(profileId: string, formData: FormData) {
  await requireAdmin();
  const admin = createAdminClient();

  const email = (formData.get("email") as string) || null;
  const password = (formData.get("password") as string) || null;

  const updates: { email?: string; password?: string } = {};
  if (email) updates.email = email;
  if (password) updates.password = password;

  if (Object.keys(updates).length === 0) return { error: "Nenhuma alteração" };

  const { error } = await admin.auth.admin.updateUserById(profileId, updates);
  if (error) return { error: error.message };

  if (email) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("profiles") as any).update({ email }).eq("id", profileId);
  }

  revalidatePath(`/admin/influenciadores/${profileId}`);
  revalidatePath("/admin/influenciadores");
  return { success: true };
}

export async function uploadBrandLogo(formData: FormData) {
  await requireAdmin();
  const admin = createAdminClient();

  const file = formData.get("file") as File;
  if (!file || file.size === 0) return { error: "Nenhum arquivo enviado" };

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const fileName = `brand-logos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await admin.storage.from("assets").upload(fileName, file, {
    cacheControl: "3600",
    upsert: false,
  });

  if (error) return { error: error.message };

  const { data } = admin.storage.from("assets").getPublicUrl(fileName);
  return { url: data.publicUrl };
}
