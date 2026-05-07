export interface Business {
  id: string
  owner_id: string
  name: string
  slug: string
  industry: string | null
  address: string | null
  website: string | null
  phone: string | null
  logo_url: string | null
  vat_number: string | null
  google_place_id: string | null
  timezone: string
  ai_system_prompt: string | null
  greeting: string | null
  tone: string
  status: string
  admin_notes: string | null
  plan: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  billing_status: string
  bank_details: { account_name: string; sort_code: string; account_number: string; bank_name?: string } | null
  google_calendar_tokens: { access_token: string; refresh_token: string; expiry_date: number } | null
  google_calendar_id: string | null
  currency: 'GBP' | 'USD' | 'EUR'
  billing_active: boolean
  billing_started_at: string | null
  contract_signed_at: string | null
  activation_credit_paid: boolean
  active_channels: string[]
  country_code: string | null
  takeover_delay_seconds: number
  after_hours_delay_seconds: number
  working_hours_start: number
  working_hours_end: number
  working_days: string[]
  last_inbound_at: string | null
  channels_paused: boolean
  channels_paused_at: string | null
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  business_id: string
  name: string | null
  phone: string | null
  email: string | null
  whatsapp: string | null
  notes: string | null
  tags: string[]
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export type AgentType = 'voice' | 'whatsapp' | 'sms' | 'instagram' | 'email'

export interface Agent {
  id: string
  business_id: string
  name: string
  description: string | null
  agent_type: AgentType
  is_default: boolean
  status: 'active' | 'draft' | 'paused' | 'archived'
  greeting: string | null
  tone: string | null
  ai_system_prompt: string | null
  ai_model: string | null
  takeover_delay_seconds: number | null
  after_hours_delay_seconds: number | null
  working_hours_start: number | null
  working_hours_end: number | null
  working_days: string[] | null
  voice_id: string | null
  voice_speed: number | null
  retell_agent_id: string | null
  retell_llm_id: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface TrainingJob {
  id: string
  business_id: string
  agent_id: string | null
  source_type: 'website' | 'google_places' | 'document' | 'pasted_text'
  source_url: string | null
  source_file_url: string | null
  source_text: string | null
  status: 'pending' | 'processing' | 'completed' | 'failed'
  error_message: string | null
  generated_config: {
    greeting?: string
    faqs?: { question: string; answer: string }[]
    services?: { name: string; description?: string; price_from?: number; price_to?: number; duration_minutes?: number; bookable?: boolean }[]
    tone?: string
    system_prompt_additions?: string
  }
  applied: boolean
  applied_at: string | null
  created_at: string
}

export interface Conversation {
  id: string
  business_id: string
  contact_id: string | null
  agent_id: string | null
  channel: 'voice' | 'whatsapp' | 'sms' | 'email' | 'instagram'
  status: 'open' | 'closed' | 'archived'
  assigned_to: string | null
  ai_handling: boolean
  last_message_at: string | null
  last_message_preview: string | null
  unread_count: number
  subject: string | null
  is_spam: boolean
  is_group: boolean
  group_name: string | null
  unipile_chat_id: string | null
  created_at: string
  contact?: Contact
}

export interface Message {
  id: string
  conversation_id: string
  direction: 'inbound' | 'outbound'
  sender: 'contact' | 'ai' | 'human'
  content_type: 'text' | 'audio' | 'image' | 'video' | 'file' | 'call_summary'
  body: string | null
  media_url: string | null
  metadata: Record<string, unknown>
  status: 'sent' | 'draft' | 'failed'
  sender_name: string | null
  sender_contact_id: string | null
  created_at: string
}

export interface Call {
  id: string
  business_id: string
  conversation_id: string | null
  contact_id: string | null
  retell_call_id: string | null
  twilio_call_sid: string | null
  direction: string
  status: 'ringing' | 'in_progress' | 'completed' | 'missed' | 'failed'
  duration_seconds: number | null
  recording_url: string | null
  transcript: { speaker: string; text: string }[] | null
  call_type: string | null
  extracted_info: Record<string, unknown>
  ai_summary: string | null
  started_at: string | null
  ended_at: string | null
  created_at: string
  contact?: Contact
}

export interface Channel {
  id: string
  business_id: string
  agent_id: string | null
  type: 'voice' | 'whatsapp' | 'sms' | 'instagram' | 'email_gmail' | 'email_outlook' | 'email_smtp'
  label: string | null
  status: 'connected' | 'disconnected' | 'reconnecting' | 'error'
  auto_reply_enabled: boolean
  draft_mode: boolean
  auto_unsubscribe: boolean
  config: Record<string, unknown>
  unipile_account_id: string | null
  connected_at: string | null
  disconnected_at: string | null
  created_at: string
}

export interface Service {
  id: string
  business_id: string
  agent_id: string | null
  name: string
  description: string | null
  price_from: number | null
  price_to: number | null
  duration_minutes: number | null
  bookable: boolean
  sort_order: number
}

export interface Faq {
  id: string
  business_id: string
  agent_id: string | null
  question: string
  answer: string
  sort_order: number
  created_at: string
}

export interface Appointment {
  id: string
  business_id: string
  contact_id: string | null
  conversation_id: string | null
  service_id: string | null
  cal_booking_id: string | null
  title: string
  description: string | null
  starts_at: string
  ends_at: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'
  booked_via: 'voice' | 'whatsapp' | 'sms' | 'email' | 'web' | 'manual' | null
  customer_notified: boolean
  owner_notified: boolean
  created_at: string
  contact?: Contact
  service?: Service
}

export interface Quote {
  id: string
  business_id: string
  contact_id: string | null
  quote_number: string
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired'
  line_items: { description: string; qty: number; unit_price: number }[]
  subtotal: number
  vat_rate: number
  vat_amount: number
  total: number
  notes: string | null
  valid_until: string | null
  pdf_url: string | null
  created_from: 'voice_note' | 'text' | 'manual' | null
  original_transcript: string | null
  sent_at: string | null
  created_at: string
  contact?: Contact
}

export interface Invoice {
  id: string
  business_id: string
  contact_id: string | null
  quote_id: string | null
  invoice_number: string
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'
  line_items: { description: string; amount: number }[]
  subtotal: number
  vat_rate: number
  vat_amount: number
  total: number
  notes: string | null
  due_date: string | null
  pdf_url: string | null
  payment_method: 'bank_transfer' | 'cash' | 'none'
  payment_link: string | null
  paid_at: string | null
  sent_at: string | null
  created_at: string
  contact?: Contact
}

export interface TeamMember {
  id: string
  business_id: string
  user_id: string | null
  email: string
  name: string | null
  role: 'owner' | 'admin' | 'member'
  invited_at: string
  joined_at: string | null
  last_active_at: string | null
}

export interface BillingPeriod {
  id: string
  business_id: string
  period_start: string
  period_end: string
  booking_count: number
  total_amount: number
  total_before_cap: number
  cap_amount: number
  cap_reached: boolean
  cap_reached_at: string | null
  currency: 'GBP' | 'USD' | 'EUR'
  stripe_invoice_id: string | null
  stripe_invoice_status: string | null
  paid_at: string | null
  status: 'active' | 'invoiced' | 'paid' | 'failed' | 'void'
  created_at: string
  updated_at: string
}

export interface BookingEvent {
  id: string
  business_id: string
  billing_period_id: string
  appointment_id: string | null
  contact_id: string | null
  contact_name: string | null
  service_description: string | null
  appointment_datetime: string | null
  channel: string | null
  amount_raw: number
  amount_billed: number
  currency: 'GBP' | 'USD' | 'EUR'
  capped: boolean
  created_at: string
}

export interface BookingDispute {
  id: string
  business_id: string
  booking_event_id: string
  reason: 'ai_error' | 'wrong_time' | 'wrong_service' | 'duplicate' | 'other'
  description: string | null
  status: 'pending' | 'approved' | 'rejected'
  credit_amount: number | null
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
}

export interface AiTakeoverEntry {
  id: string
  business_id: string
  conversation_id: string
  trigger_message_id: string
  channel: string
  message_received_at: string
  takeover_at: string
  grace_checked_at: string | null
  status: 'pending' | 'owner_replied' | 'ai_replied' | 'cancelled' | 'expired'
  owner_reply_message_id: string | null
  ai_reply_message_id: string | null
  created_at: string
  processed_at: string | null
}
