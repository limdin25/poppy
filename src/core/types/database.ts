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
  created_at: string
  updated_at: string
}

export interface Conversation {
  id: string
  business_id: string
  contact_id: string
  channel: 'voice' | 'whatsapp' | 'sms' | 'email'
  status: 'open' | 'closed' | 'archived'
  assigned_to: string | null
  ai_handling: boolean
  last_message_at: string | null
  last_message_preview: string | null
  unread_count: number
  subject: string | null
  is_spam: boolean
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

export interface Service {
  id: string
  business_id: string
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
