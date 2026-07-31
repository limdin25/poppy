"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPostingSettingsAdmin } from "@/lib/data/outstand";
import {
  buildPostsForItem,
  buildPostsForMember,
  filterActiveProfileIds,
  getCampaignById,
  getCampaignItemById,
  getCampaignItems,
  getCampaignMembers,
} from "@/lib/data/campaigns";
import { readInstagramOptions } from "@/lib/instagram-options";
import { DEFAULT_TIMEZONE, isSchedulingTimezone, localToUtcIso } from "@/lib/timezone";
import type { CampaignItem, InstagramPostOptions, PostMediaType } from "@/types/database";

type ActionResult = { error: string } | { success: true; postsCreated?: number };

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

function revalidateCampaignPages() {
  revalidatePath("/admin/campanha");
  revalidatePath("/admin/influenciadores");
  revalidatePath("/admin/agendador");
  revalidatePath("/admin");
}

interface ItemFields {
  mediaType: PostMediaType;
  mediaUrl: string;
  caption: string;
  scheduledAtUtc: string;
  brandId: string | null;
  instagramOptions: InstagramPostOptions | null;
}

function readItemFields(formData: FormData): ItemFields | { error: string } {
  const mediaType = formData.get("media_type") as PostMediaType;
  const mediaUrl = ((formData.get("media_url") as string) || "").trim();
  const caption = ((formData.get("caption") as string) || "").trim();
  const scheduledLocal = ((formData.get("scheduled_at") as string) || "").trim();
  const brandId = ((formData.get("brand_id") as string) || "").trim() || null;

  const validTypes = ["feed", "story_image", "story_video", "reel", "carousel"];
  if (!validTypes.includes(mediaType)) return { error: "Tipo de post inválido." };
  if (!mediaUrl) return { error: "Envie a mídia ou informe a URL." };
  if (!scheduledLocal) return { error: "Informe data e hora." };

  // Wall time in the timezone picked in the modal (defaults to the app default).
  const tzRaw = ((formData.get("timezone") as string) || "").trim();
  const timezone = isSchedulingTimezone(tzRaw) ? tzRaw : DEFAULT_TIMEZONE;

  return {
    mediaType,
    mediaUrl,
    caption,
    scheduledAtUtc: localToUtcIso(scheduledLocal, timezone),
    brandId,
    instagramOptions: readInstagramOptions(formData),
  };
}

/** Adds an item to the campaign timeline and schedules it for every current member. */
export async function createCampaignItem(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const campaignId = (formData.get("campaign_id") as string) || "";
  if (!campaignId) return { error: "Campanha inválida." };

  const fields = readItemFields(formData);
  if ("error" in fields) return fields;

  const campaign = await getCampaignById(campaignId);
  if (!campaign) return { error: "Campanha não encontrada." };

  const brandId = fields.brandId ?? campaign.brand_id;
  if (!brandId) return { error: "Selecione uma marca para o post." };

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: item, error } = await (admin.from("campaign_items") as any)
    .insert({
      campaign_id: campaignId,
      brand_id: brandId,
      media_type: fields.mediaType,
      media_url: fields.mediaUrl,
      caption: fields.caption,
      scheduled_at: fields.scheduledAtUtc,
      instagram_options: fields.instagramOptions,
    })
    .select("*")
    .single();
  if (error) return { error: error.message };

  // Schedule the new item for everyone already in the campaign (future items
  // only, suspended accounts excluded).
  const members = await getCampaignMembers(campaignId);
  const activeIds = await filterActiveProfileIds(members.map((m) => m.profile_id));
  let postsCreated = 0;
  if (activeIds.length > 0) {
    const settings = await getPostingSettingsAdmin();
    const rows = buildPostsForItem({
      campaign,
      item: item as CampaignItem,
      profileIds: activeIds,
      provider: settings?.active_provider ?? "heypubli",
      now: new Date(),
    });
    if (rows.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: postsErr } = await (admin.from("scheduled_posts") as any).upsert(
        rows,
        { onConflict: "campaign_item_id,profile_id", ignoreDuplicates: true },
      );
      if (postsErr) {
        return { error: `Item criado, mas falhou ao agendar: ${postsErr.message}` };
      }
      postsCreated = rows.length;
    }
  }

  revalidateCampaignPages();
  return { success: true, postsCreated };
}

/** Edits an item; pending derived posts mirror the change, missing ones are created. */
export async function updateCampaignItem(
  itemId: string,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const existing = await getCampaignItemById(itemId);
  if (!existing) return { error: "Item não encontrado." };

  const fields = readItemFields(formData);
  if ("error" in fields) return fields;

  const campaign = await getCampaignById(existing.campaign_id);
  if (!campaign) return { error: "Campanha não encontrada." };

  const brandId = fields.brandId ?? existing.brand_id ?? campaign.brand_id;
  if (!brandId) return { error: "Selecione uma marca para o post." };

  const admin = createAdminClient();
  const patch = {
    brand_id: brandId,
    media_type: fields.mediaType,
    media_url: fields.mediaUrl,
    caption: fields.caption,
    scheduled_at: fields.scheduledAtUtc,
    instagram_options: fields.instagramOptions,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from("campaign_items") as any)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (error) return { error: error.message };

  // Mirror onto pending derived posts (published/failed history is never rewritten).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: postsErr } = await (admin.from("scheduled_posts") as any)
    .update(patch)
    .eq("campaign_item_id", itemId)
    .eq("status", "pending");
  if (postsErr)
    return { error: `Item salvo, mas falhou ao reagendar: ${postsErr.message}` };

  // If the item moved into the future, members that never got it (it was in the
  // past when they joined) get their post now. Suspended accounts are skipped.
  const members = await getCampaignMembers(existing.campaign_id);
  const activeIds = await filterActiveProfileIds(members.map((m) => m.profile_id));
  if (activeIds.length > 0) {
    const settings = await getPostingSettingsAdmin();
    const rows = buildPostsForItem({
      campaign,
      item: { ...existing, ...patch },
      profileIds: activeIds,
      provider: settings?.active_provider ?? "heypubli",
      now: new Date(),
    });
    if (rows.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("scheduled_posts") as any).upsert(rows, {
        onConflict: "campaign_item_id,profile_id",
        ignoreDuplicates: true,
      });
    }
  }

  revalidateCampaignPages();
  return { success: true };
}

/** Removes an item; pending derived posts go with it, published history stays. */
export async function deleteCampaignItem(itemId: string): Promise<ActionResult> {
  await requireAdmin();
  const admin = createAdminClient();

  const { error: postsErr } = await admin
    .from("scheduled_posts")
    .delete()
    .eq("campaign_item_id", itemId)
    .eq("status", "pending");
  if (postsErr) return { error: postsErr.message };

  const { error } = await admin.from("campaign_items").delete().eq("id", itemId);
  if (error) return { error: error.message };

  revalidateCampaignPages();
  return { success: true };
}

/**
 * Adds accounts to the campaign. Every future item is scheduled for them; with
 * startNow the campaign's first item publishes immediately. Their "new account"
 * notifications are marked read.
 */
export async function addMembersToCampaign(
  campaignId: string,
  profileIds: string[],
  startNow: boolean,
): Promise<ActionResult> {
  const adminId = await requireAdmin();
  const requestedIds = profileIds.map((p) => p.trim()).filter(Boolean);
  if (requestedIds.length === 0) return { error: "Selecione pelo menos uma conta." };
  const ids = await filterActiveProfileIds(requestedIds);
  if (ids.length === 0) return { error: "Essas contas estão suspensas." };

  const campaign = await getCampaignById(campaignId);
  if (!campaign) return { error: "Campanha não encontrada." };

  const admin = createAdminClient();
  const memberRows = ids.map((profileId) => ({
    campaign_id: campaignId,
    profile_id: profileId,
    start_mode: startNow ? ("immediate" as const) : ("schedule" as const),
    added_by: adminId,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: memberErr } = await (admin.from("campaign_members") as any).upsert(
    memberRows,
    { onConflict: "campaign_id,profile_id", ignoreDuplicates: true },
  );
  if (memberErr) return { error: memberErr.message };

  const [items, settings] = await Promise.all([
    getCampaignItems(campaignId),
    getPostingSettingsAdmin(),
  ]);
  const now = new Date();
  const rows = ids.flatMap((profileId) =>
    buildPostsForMember({
      campaign,
      items,
      profileId,
      startNow,
      provider: settings?.active_provider ?? "heypubli",
      now,
    }),
  );
  if (rows.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: postsErr } = await (admin.from("scheduled_posts") as any).upsert(
      rows,
      { onConflict: "campaign_item_id,profile_id", ignoreDuplicates: true },
    );
    if (postsErr) {
      return { error: `Contas adicionadas, mas falhou ao agendar: ${postsErr.message}` };
    }
  }

  // Their "new account, not in campaign yet" alerts are now resolved.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("notifications") as any)
    .update({ read_at: new Date().toISOString() })
    .in("profile_id", ids)
    .eq("type", "account_connected")
    .is("read_at", null);

  revalidateCampaignPages();
  revalidatePath("/admin/notificacoes");
  return { success: true, postsCreated: rows.length };
}

/** Removes an account from the campaign; their pending campaign posts are cancelled. */
export async function removeMemberFromCampaign(
  campaignId: string,
  profileId: string,
): Promise<ActionResult> {
  await requireAdmin();
  const admin = createAdminClient();

  const { error: postsErr } = await admin
    .from("scheduled_posts")
    .delete()
    .eq("campaign_id", campaignId)
    .eq("profile_id", profileId)
    .eq("status", "pending");
  if (postsErr) return { error: postsErr.message };

  const { error } = await admin
    .from("campaign_members")
    .delete()
    .eq("campaign_id", campaignId)
    .eq("profile_id", profileId);
  if (error) return { error: error.message };

  revalidateCampaignPages();
  return { success: true };
}

/** Edits the campaign itself (name, default brand, description). */
export async function updateCampaign(
  campaignId: string,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const name = ((formData.get("name") as string) || "").trim();
  const description = ((formData.get("description") as string) || "").trim() || null;
  const brandId = ((formData.get("brand_id") as string) || "").trim() || null;
  if (!name) return { error: "Informe o nome da campanha." };

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from("campaigns") as any)
    .update({
      name,
      description,
      brand_id: brandId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);
  if (error) return { error: error.message };

  revalidateCampaignPages();
  return { success: true };
}
