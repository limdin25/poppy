export type Gender = "male" | "female" | "non_binary" | "undisclosed";
export type SectorType = "preferred" | "content";
export type PostMediaType = "feed" | "story_image" | "story_video" | "reel" | "carousel";
export type PostStatus = "pending" | "published" | "failed";
export type MessageChannel = "whatsapp" | "email";
export type MessageDirection = "outbound" | "inbound";
export type MessageStatus = "sent" | "delivered" | "read" | "failed";
export type ChannelType = "whatsapp" | "email";
export type ChannelStatus = "connected" | "disconnected";
export type ConversationStatus = "open" | "closed";
export type InboxContentType = "text" | "image" | "audio" | "video" | "file";
export type InboxSender = "contact" | "admin" | "ai";
export type InboxMessageStatus = "sent" | "draft" | "failed" | "pending";
export type AiQueueStatus =
  | "pending"
  | "processing"
  | "done"
  | "cancelled"
  | "owner_replied"
  | "ai_replied"
  | "expired";
export type SaleStatus = "confirmed" | "refunded" | "cancelled";
export type PostingProvider = "heypubli" | "outstand";
export type PixKeyType = "cpf" | "cnpj" | "email" | "phone" | "random";
export type RegistrationMethod = "instagram" | "email" | "admin_manual";
export type CampaignStartMode = "schedule" | "immediate";
export type NotificationType = "account_connected" | "generic";

export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  whatsapp: string | null;
  date_of_birth: string | null;
  gender: Gender | null;
  address_street: string | null;
  address_city: string | null;
  address_postal_code: string | null;
  address_country: string;
  phone: string | null;
  timezone: string;
  pix_key_type: PixKeyType | null;
  pix_key: string | null;
  commission_rate: number | null;
  hotmart_url: string | null;
  hotmart_affiliate_code: string | null;
  referral_tag: string | null;
  registration_method: RegistrationMethod;
  ig_username: string | null;
  auth_provider: "email" | "instagram";
  needs_contact: boolean;
  onboarding_step: number;
  onboarding_complete: boolean;
  is_admin: boolean;
  suspended_at: string | null;
  last_accessed_at: string | null;
  created_at: string;
}

export interface Sector {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
}

export interface InfluencerSector {
  id: string;
  profile_id: string;
  sector_id: string;
  type: SectorType;
  created_at: string;
}

export interface InstagramConnection {
  id: string;
  profile_id: string;
  ig_user_id: string;
  ig_username: string;
  access_token: string;
  token_expires_at: string;
  token_refreshed_at: string | null;
  is_connected: boolean;
  followers_count: number | null;
  created_at: string;
}

export interface Brand {
  id: string;
  name: string;
  logo_url: string | null;
  description: string | null;
  hotmart_product_id: string | null;
  hotmart_product_url: string | null;
  share_base_url: string | null;
  commission_rate: number;
  target_sectors: string[];
  is_active: boolean;
  created_at: string;
}

export interface BrandAssignment {
  id: string;
  profile_id: string;
  brand_id: string;
  assigned_at: string;
}

// Optional Instagram publish options — only what the official API actually
// supports (via Outstand). Stories support none of these; music/links/stickers
// are not available to any API client.
export interface InstagramPostOptions {
  collaborators?: string[]; // up to 3 public IG usernames (feed/reel)
  first_comment?: string; // auto-posted as the first comment after publish
  reel_cover_seconds?: number; // cover frame offset for Reels
}

export interface ScheduledPost {
  id: string;
  profile_id: string;
  brand_id: string;
  media_type: PostMediaType;
  media_url: string;
  caption: string;
  scheduled_at: string;
  status: PostStatus;
  provider: PostingProvider;
  instagram_options: InstagramPostOptions | null;
  ig_media_id: string | null;
  outstand_post_id: string | null;
  published_at: string | null;
  error_message: string | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  campaign_id: string | null;
  campaign_item_id: string | null;
  created_at: string;
}

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  brand_id: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CampaignItem {
  id: string;
  campaign_id: string;
  brand_id: string | null;
  media_type: PostMediaType;
  media_url: string;
  caption: string;
  scheduled_at: string;
  instagram_options: InstagramPostOptions | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignMember {
  id: string;
  campaign_id: string;
  profile_id: string;
  start_mode: CampaignStartMode;
  added_by: string | null;
  added_at: string;
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  profile_id: string | null;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

export interface MessageLog {
  id: string;
  profile_id: string;
  channel: MessageChannel;
  direction: MessageDirection;
  content: string;
  status: MessageStatus;
  sent_at: string;
  sent_by: string;
}

export interface HotmartSale {
  id: string;
  profile_id: string;
  transaction_id: string;
  product_name: string;
  sale_amount: number;
  commission_amount: number;
  status: SaleStatus;
  sold_at: string;
  purchase_complete_at: string | null;
  payout_id: string | null;
}

export type PayoutStatus = "requested" | "paid" | "cancelled";

export interface Payout {
  id: string;
  profile_id: string;
  commission_amount: number;
  sales_count: number;
  status: PayoutStatus;
  pix_key: string | null;
  pix_key_type: string | null;
  requested_at: string;
  paid_at: string | null;
  paid_by: string | null;
}

export interface LinkClick {
  id: string;
  profile_id: string | null;
  referral_tag: string;
  brand_id: string | null;
  referer: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  is_bot: boolean;
  clicked_at: string;
}

export interface Channel {
  id: string;
  type: ChannelType;
  label: string | null;
  status: ChannelStatus;
  unipile_account_id: string | null;
  config: Record<string, unknown>;
  auto_reply_enabled: boolean;
  draft_mode: boolean;
  auto_reply_delay_seconds: number;
  connected_at: string | null;
  disconnected_at: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  profile_id: string | null;
  channel: ChannelType;
  status: ConversationStatus;
  unipile_chat_id: string | null;
  subject: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  ai_handling: boolean;
  is_group: boolean;
  group_name: string | null;
  created_at: string;
  profile?: Profile | null;
}

export interface InboxMessage {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  sender: InboxSender;
  sender_name: string | null;
  body: string | null;
  media_url: string | null;
  content_type: InboxContentType;
  status: InboxMessageStatus;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AiSettings {
  id: string;
  openai_api_key: string | null;
  system_prompt: string;
  model: string;
  max_tokens: number;
  created_at: string;
  updated_at: string;
}

export interface AiTakeoverQueue {
  id: string;
  conversation_id: string;
  message_id: string | null;
  status: AiQueueStatus;
  scheduled_at: string;
  grace_checked_at: string | null;
  processed_at: string | null;
  ai_reply_message_id: string | null;
  created_at: string;
}

export interface AdminSession {
  id: string;
  admin_id: string;
  impersonated_id: string;
  started_at: string;
  ended_at: string | null;
  actions_taken: Record<string, unknown>;
}

export interface PostingSettings {
  id: string;
  active_provider: PostingProvider;
  outstand_api_key: string | null;
  outstand_social_network_id: string | null;
  default_timezone: string;
  created_at: string;
  updated_at: string;
}

export interface OutstandConnection {
  id: string;
  ig_user_id?: string | null;
  profile_id: string;
  outstand_social_account_id: string;
  ig_username: string | null;
  is_connected: boolean;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, "created_at">;
        Update: Partial<Omit<Profile, "id" | "created_at">>;
        Relationships: [];
      };
      sectors: {
        Row: Sector;
        Insert: Omit<Sector, "id">;
        Update: Partial<Omit<Sector, "id">>;
        Relationships: [];
      };
      influencer_sectors: {
        Row: InfluencerSector;
        Insert: Omit<InfluencerSector, "id" | "created_at">;
        Update: Partial<Omit<InfluencerSector, "id" | "created_at">>;
        Relationships: [];
      };
      instagram_connections: {
        Row: InstagramConnection;
        Insert: Omit<InstagramConnection, "id" | "created_at">;
        Update: Partial<Omit<InstagramConnection, "id" | "created_at">>;
        Relationships: [];
      };
      brands: {
        Row: Brand;
        Insert: Omit<Brand, "id" | "created_at">;
        Update: Partial<Omit<Brand, "id" | "created_at">>;
        Relationships: [];
      };
      brand_assignments: {
        Row: BrandAssignment;
        Insert: Omit<BrandAssignment, "id" | "assigned_at">;
        Update: Partial<Omit<BrandAssignment, "id" | "assigned_at">>;
        Relationships: [];
      };
      scheduled_posts: {
        Row: ScheduledPost;
        Insert: Omit<ScheduledPost, "id" | "created_at">;
        Update: Partial<Omit<ScheduledPost, "id" | "created_at">>;
        Relationships: [];
      };
      messages_log: {
        Row: MessageLog;
        Insert: Omit<MessageLog, "id">;
        Update: Partial<Omit<MessageLog, "id">>;
        Relationships: [];
      };
      hotmart_sales: {
        Row: HotmartSale;
        Insert: Omit<HotmartSale, "id">;
        Update: Partial<Omit<HotmartSale, "id">>;
        Relationships: [];
      };
      link_clicks: {
        Row: LinkClick;
        Insert: Omit<LinkClick, "id" | "clicked_at">;
        Update: Partial<Omit<LinkClick, "id" | "clicked_at">>;
        Relationships: [];
      };
      payouts: {
        Row: Payout;
        Insert: Omit<Payout, "id" | "requested_at">;
        Update: Partial<Omit<Payout, "id" | "requested_at">>;
        Relationships: [];
      };
      admin_sessions: {
        Row: AdminSession;
        Insert: Omit<AdminSession, "id">;
        Update: Partial<Omit<AdminSession, "id">>;
        Relationships: [];
      };
      channels: {
        Row: Channel;
        Insert: Omit<Channel, "id" | "created_at">;
        Update: Partial<Omit<Channel, "id" | "created_at">>;
        Relationships: [];
      };
      conversations: {
        Row: Conversation;
        Insert: Omit<Conversation, "id" | "created_at">;
        Update: Partial<Omit<Conversation, "id" | "created_at">>;
        Relationships: [];
      };
      inbox_messages: {
        Row: InboxMessage;
        Insert: Omit<InboxMessage, "id" | "created_at">;
        Update: Partial<Omit<InboxMessage, "id" | "created_at">>;
        Relationships: [];
      };
      ai_settings: {
        Row: AiSettings;
        Insert: Omit<AiSettings, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<AiSettings, "id" | "created_at">>;
        Relationships: [];
      };
      ai_takeover_queue: {
        Row: AiTakeoverQueue;
        Insert: Omit<AiTakeoverQueue, "id" | "created_at">;
        Update: Partial<Omit<AiTakeoverQueue, "id" | "created_at">>;
        Relationships: [];
      };
      posting_settings: {
        Row: PostingSettings;
        Insert: Omit<PostingSettings, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<PostingSettings, "id" | "created_at">>;
        Relationships: [];
      };
      outstand_connections: {
        Row: OutstandConnection;
        Insert: Omit<OutstandConnection, "id" | "created_at">;
        Update: Partial<Omit<OutstandConnection, "id" | "created_at">>;
        Relationships: [];
      };
      campaigns: {
        Row: Campaign;
        Insert: Omit<Campaign, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Campaign, "id" | "created_at">>;
        Relationships: [];
      };
      campaign_items: {
        Row: CampaignItem;
        Insert: Omit<CampaignItem, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<CampaignItem, "id" | "created_at">>;
        Relationships: [];
      };
      campaign_members: {
        Row: CampaignMember;
        Insert: Omit<CampaignMember, "id" | "added_at">;
        Update: Partial<Omit<CampaignMember, "id" | "added_at">>;
        Relationships: [];
      };
      notifications: {
        Row: AppNotification;
        Insert: Omit<AppNotification, "id" | "created_at">;
        Update: Partial<Omit<AppNotification, "id" | "created_at">>;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
