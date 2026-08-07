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
export type PostingProvider = "heypubli" | "outstand";
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
  /** Their own Skool affiliate link, pasted at step 3 of Getting started. */
  skool_affiliate_url: string | null;
  /** When they said their Instagram profile is presentable. Self-declared. */
  profile_ready_at: string | null;
  /** Which bio sentence they were given at /brochure step 4. Allocated once, then frozen. */
  bio_variant_index: number | null;
  /** They said the link is in their bio, offered only when we could not read it ourselves. */
  bio_link_declared_at: string | null;
  /** They said they joined the community. Self-declared because Skool cannot tell us. */
  community_joined_declared_at: string | null;
  /** They said their profile photo is in place. Self-declared, no API can judge a photo. */
  photo_declared_at: string | null;
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

/** How far someone got through the funnel. Forward-only, see lib/data/signup-leads.ts. */
export type SignupLeadStage =
  | "captured"
  | "contacted"
  | "engaged"
  | "started"
  | "sent_to_instagram"
  | "connected"
  | "invited";

/**
 * The lane decides everything downstream. partner = Facebook lead-form recruit, free
 * Skool invite. customer = buyer via an affiliate link, pays for the community. organic =
 * self-serve signup, community only with Hugo's manual approval.
 */
export type SignupLane = "partner" | "customer" | "organic";

export type SignupLeadSource =
  | "fb_lead_form"
  | "web_signup"
  | "admin_manual"
  | "affiliate_link"
  | "import";

export type NurtureState =
  | "idle"
  | "active"
  | "paused"
  | "stopped"
  | "exhausted"
  | "blocked";

export type ApprovalState = "none" | "pending" | "approved" | "rejected";

/**
 * Someone in the funnel, whichever door they came through. `whatsapp` keeps the
 * schema-wide column name; every label a person reads says Mobile.
 */
export interface SignupLead {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  whatsapp: string;
  /** Generated by Postgres from email. Read only. */
  email_normalized: string;
  status: SignupLeadStage;
  profile_id: string | null;
  attempts: number;
  first_seen_at: string;
  last_seen_at: string;
  sent_to_instagram_at: string | null;
  connected_at: string | null;
  created_at: string;
  lane: SignupLane;
  source: SignupLeadSource;
  lane_locked_at: string;
  lane_locked_by: string | null;
  fb_leadgen_id: string | null;
  fb_form_id: string | null;
  fb_ad_id: string | null;
  fb_campaign_id: string | null;
  whatsapp_e164: string | null;
  wk_contact_id: string | null;
  consent_source: string | null;
  consent_at: string | null;
  captured_at: string | null;
  contacted_at: string | null;
  engaged_at: string | null;
  invited_at: string | null;
  nurture_state: NurtureState;
  nurture_step: number;
  nurture_next_at: string | null;
  nurture_last_sent_at: string | null;
  nurture_stop_reason: string | null;
  whatsapp_opted_out_at: string | null;
  whatsapp_undeliverable_code: string | null;
  approval_state: ApprovalState;
  approved_at: string | null;
  approved_by: string | null;
}

export interface SkoolInvite {
  id: string;
  lead_id: string;
  profile_id: string | null;
  email: string;
  first_name: string;
  /** Constrained to 'partner' by the database. The whole point of the table. */
  lane: string;
  status: "queued" | "sending" | "sent" | "confirmed" | "failed" | "blocked";
  idempotency_key: string;
  attempts: number;
  last_error: string | null;
  requested_at: string;
  last_attempt_at: string | null;
  sent_at: string | null;
  confirmed_at: string | null;
}

export interface SkoolMember {
  id: string;
  email_normalized: string;
  lead_id: string | null;
  membership: "free_invited" | "trial" | "paid";
  source: string;
  first_seen_at: string;
  paid_at: string | null;
  updated_at: string;
}

export interface LaneConflict {
  id: string;
  lead_id: string;
  existing_lane: string;
  incoming_lane: string;
  incoming_source: string;
  detail: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: string | null;
  created_at: string;
}

export interface NurtureSend {
  id: string;
  lead_id: string;
  step: number;
  template_key: string;
  channel: "whatsapp" | "email";
  wk_message_id: string | null;
  twilio_sid: string | null;
  status: "queued" | "sent" | "delivered" | "read" | "failed" | "skipped";
  error_code: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface FunnelSettings {
  id: string;
  nurture_enabled: boolean;
  whatsapp_enabled: boolean;
  skool_invites_enabled: boolean;
  daily_template_cap: number;
  /** The onboarding nudge brain's kill switch. ON by default (migration 025). */
  onboarding_nudges_enabled: boolean;
  /** The reply brain's kill switch. OFF by default (migration 030). */
  auto_reply_enabled: boolean;
  updated_at: string;
}

/** One automated conversation action: a reply, a check-in, or a handover (migration 030). */
export interface FunnelReply {
  id: string;
  phone: string;
  lead_id: string | null;
  profile_id: string | null;
  in_reply_to: string | null;
  kind: "reply" | "check_in" | "handover" | "refusal" | "silence";
  key: string | null;
  step: string | null;
  body: string | null;
  images: string[];
  reason: string | null;
  status: string;
  created_at: string;
}

/** Single-row watermark for the 5 minute funnel email (migrations 028, 029). */
export interface FunnelMonitorState {
  id: string;
  last_run_at: string | null;
  last_email_at: string | null;
  paused_reason: string | null;
  /** Written by sheet-sync on every run; the monitor alerts when it goes stale. */
  sheet_sync_last_ok_at: string | null;
  sheet_sync_last_error: string | null;
  /** The tick's run lock (migration 031): one tick at a time, 4 minute self-expiry. */
  tick_lock_at: string | null;
  /** Heartbeats (migration 032): stamped by /api/funnel/reply and /api/funnel/tick on
   *  every completed run. Read by the monitor and by Elsie's independent dead man's
   *  switch, because a dead cron system kills the watchdog that shares it. */
  reply_last_ok_at: string | null;
  tick_last_ok_at: string | null;
  /** How many blocked-country rows the last sheet-sync run refused at the door. */
  sheet_sync_last_refused_blocked: number;
  updated_at: string;
}

/** One row per (creator, onboarding step): when they first saw it, when it turned done. */
export interface OnboardingProgress {
  profile_id: string;
  step: OnboardingStepId;
  first_seen_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export type OnboardingStepId = "instagram" | "community" | "affiliate" | "photo" | "bio";

/** Per-creator nudge bookkeeping: count, last send, and why we stopped for good. */
export interface OnboardingNudgeState {
  profile_id: string;
  nudge_count: number;
  last_nudged_at: string | null;
  last_step: string | null;
  stopped_at: string | null;
  stop_reason: string | null;
  updated_at: string;
}

/** One anonymous event on /watch: view, play, watch_50, watch_90, ended, cta_click, demo_play. */
export interface WatchEvent {
  id: string;
  session_id: string;
  event: string;
  meta: Record<string, unknown>;
  created_at: string;
}

/** One nudge that actually left the building. */
export interface OnboardingNudge {
  id: string;
  profile_id: string;
  step: string;
  kind: "freeform" | "template";
  variant: string;
  external_id: string;
  sent_at: string;
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

// ---- the creator video pipeline (migration 033) ----------------------------

export type MasterVideoStatus = "preview_rendering" | "pending_approval" | "approved";

export interface MasterVideo {
  id: string;
  seq: number;
  source_id: string;
  title: string;
  caption: string;
  source_url: string | null;
  preview_url: string | null;
  status: MasterVideoStatus;
  approved_at: string | null;
  recipe_version: number;
  created_at: string;
}

export interface CreatorVideoState {
  profile_id: string;
  color_family: string;
  stagger_min: number;
  next_seq: number;
  variant_idx: number;
  enrolled_at: string;
}

export type CreatorRenderStatus = "queued" | "rendering" | "ready" | "failed";

export interface CreatorVideoRender {
  id: string;
  master_id: string;
  profile_id: string;
  color_family: string;
  seed: string;
  status: CreatorRenderStatus;
  attempts: number;
  video_url: string | null;
  error: string | null;
  claimed_at: string | null;
  rendered_at: string | null;
  created_at: string;
}

export interface VideoPipelineState {
  id: string;
  worker_last_seen: string | null;
  updated_at: string;
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
      master_videos: {
        Row: MasterVideo;
        Insert: Omit<MasterVideo, "id" | "created_at">;
        Update: Partial<Omit<MasterVideo, "id" | "created_at">>;
        Relationships: [];
      };
      creator_video_state: {
        Row: CreatorVideoState;
        Insert: CreatorVideoState;
        Update: Partial<Omit<CreatorVideoState, "profile_id">>;
        Relationships: [];
      };
      creator_video_renders: {
        Row: CreatorVideoRender;
        Insert: Omit<CreatorVideoRender, "id" | "created_at">;
        Update: Partial<Omit<CreatorVideoRender, "id" | "created_at">>;
        Relationships: [];
      };
      video_pipeline_state: {
        Row: VideoPipelineState;
        Insert: VideoPipelineState;
        Update: Partial<Omit<VideoPipelineState, "id">>;
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
      signup_leads: {
        Row: SignupLead;
        // email_normalized is generated by Postgres, so it is never written. Almost every
        // other column has a database default, so inserts stay small.
        Insert: Partial<Omit<SignupLead, "id" | "email_normalized" | "created_at">> &
          Pick<SignupLead, "first_name" | "last_name" | "email" | "whatsapp">;
        Update: Partial<
          Omit<SignupLead, "id" | "email_normalized" | "first_seen_at" | "created_at">
        >;
        Relationships: [];
      };
      skool_invites: {
        Row: SkoolInvite;
        Insert: Partial<Omit<SkoolInvite, "id" | "requested_at">> &
          Pick<SkoolInvite, "lead_id" | "email" | "lane" | "idempotency_key">;
        Update: Partial<Omit<SkoolInvite, "id" | "lead_id" | "requested_at">>;
        Relationships: [];
      };
      skool_members: {
        Row: SkoolMember;
        Insert: Partial<Omit<SkoolMember, "id">> &
          Pick<SkoolMember, "email_normalized" | "membership">;
        Update: Partial<Omit<SkoolMember, "id">>;
        Relationships: [];
      };
      lane_conflicts: {
        Row: LaneConflict;
        Insert: Partial<Omit<LaneConflict, "id" | "created_at">> &
          Pick<LaneConflict, "lead_id" | "existing_lane" | "incoming_lane" | "incoming_source">;
        Update: Partial<Omit<LaneConflict, "id" | "lead_id" | "created_at">>;
        Relationships: [];
      };
      nurture_sends: {
        Row: NurtureSend;
        Insert: Partial<Omit<NurtureSend, "id" | "created_at">> &
          Pick<NurtureSend, "lead_id" | "step" | "template_key">;
        Update: Partial<Omit<NurtureSend, "id" | "lead_id" | "step" | "created_at">>;
        Relationships: [];
      };
      funnel_settings: {
        Row: FunnelSettings;
        Insert: Partial<FunnelSettings> & Pick<FunnelSettings, "id">;
        Update: Partial<Omit<FunnelSettings, "id">>;
        Relationships: [];
      };
      funnel_monitor_state: {
        Row: FunnelMonitorState;
        Insert: Partial<FunnelMonitorState> & Pick<FunnelMonitorState, "id">;
        Update: Partial<Omit<FunnelMonitorState, "id">>;
        Relationships: [];
      };
      funnel_replies: {
        Row: FunnelReply;
        Insert: Partial<Omit<FunnelReply, "id" | "created_at">> &
          Pick<FunnelReply, "phone" | "kind">;
        Update: Partial<Omit<FunnelReply, "id" | "created_at">>;
        Relationships: [];
      };
      onboarding_progress: {
        Row: OnboardingProgress;
        Insert: Partial<Omit<OnboardingProgress, "updated_at">> &
          Pick<OnboardingProgress, "profile_id" | "step">;
        Update: Partial<Omit<OnboardingProgress, "profile_id" | "step">>;
        Relationships: [];
      };
      onboarding_nudge_state: {
        Row: OnboardingNudgeState;
        Insert: Partial<Omit<OnboardingNudgeState, "updated_at">> &
          Pick<OnboardingNudgeState, "profile_id">;
        Update: Partial<Omit<OnboardingNudgeState, "profile_id">>;
        Relationships: [];
      };
      onboarding_nudges: {
        Row: OnboardingNudge;
        Insert: Partial<Omit<OnboardingNudge, "id" | "sent_at">> &
          Pick<OnboardingNudge, "profile_id" | "step" | "kind" | "variant" | "external_id">;
        Update: Partial<Omit<OnboardingNudge, "id" | "profile_id">>;
        Relationships: [];
      };
      watch_events: {
        Row: WatchEvent;
        Insert: Partial<Omit<WatchEvent, "id" | "created_at">> &
          Pick<WatchEvent, "session_id" | "event">;
        Update: never;
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
