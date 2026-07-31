import type { Campaign, CampaignItem } from "@/types/database";
import type { CampaignMemberRow, ConnectedAccountRow } from "@/lib/data/campaigns";

export const mockCampaign: Campaign = {
  id: "camp-1",
  name: "Campanha Principal",
  description: "Campanha padrão — adicione as novas contas conectadas aqui.",
  brand_id: "brand-1",
  is_default: true,
  is_active: true,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

export const mockItems: CampaignItem[] = [
  {
    id: "item-1",
    campaign_id: "camp-1",
    brand_id: "brand-1",
    media_type: "story_image",
    media_url: "https://cdn.example.com/story.jpg",
    caption: "Story de quinta-feira",
    scheduled_at: "2099-06-11T20:00:00Z", // 17:00 em São Paulo
    instagram_options: null,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  },
  {
    id: "item-2",
    campaign_id: "camp-1",
    brand_id: "brand-1",
    media_type: "reel",
    media_url: "https://cdn.example.com/reel.mp4",
    caption: "Reel de lançamento",
    scheduled_at: "2099-06-15T21:00:00Z",
    instagram_options: null,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  },
];

export const mockMembers: CampaignMemberRow[] = [
  {
    id: "m1",
    campaign_id: "camp-1",
    profile_id: "user-1",
    start_mode: "schedule",
    added_by: "admin-1",
    added_at: "2026-06-05T13:00:00Z",
    name: "Ana Silva",
    ig_username: "ana.silva",
  },
];

export const mockCandidates: ConnectedAccountRow[] = [
  {
    profile_id: "user-2",
    name: "Bruno Costa",
    ig_username: "bruno.costa",
    connected_at: "2026-06-09T18:30:00Z",
  },
];

export const mockBrands = [
  { id: "brand-1", name: "ScanPlates" },
  { id: "brand-2", name: "Outra Marca" },
];
