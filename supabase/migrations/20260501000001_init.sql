-- Poppy AI Receptionist — Initial Schema
-- 2026-05-01

-- ============================================================
-- updated_at trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- 1. businesses
-- ============================================================
CREATE TABLE public.businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES auth.users NOT NULL,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  industry TEXT,
  address TEXT,
  website TEXT,
  phone TEXT,
  logo_url TEXT,
  vat_number TEXT,
  google_place_id TEXT,
  timezone TEXT DEFAULT 'Europe/London',
  ai_system_prompt TEXT,
  greeting TEXT,
  tone TEXT DEFAULT 'professional',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER businesses_updated_at
  BEFORE UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 2. channels
-- ============================================================
CREATE TABLE public.channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('voice','whatsapp','sms','email_gmail','email_outlook','email_smtp')),
  status TEXT DEFAULT 'disconnected' CHECK (status IN ('connected','disconnected','reconnecting','error')),
  auto_reply_enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  unipile_account_id TEXT,
  connected_at TIMESTAMPTZ,
  disconnected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(business_id, type)
);

-- ============================================================
-- 3. contacts
-- ============================================================
CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  name TEXT,
  phone TEXT,
  email TEXT,
  whatsapp TEXT,
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(business_id, phone),
  UNIQUE(business_id, email)
);

CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. conversations
-- ============================================================
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  contact_id UUID REFERENCES public.contacts NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('voice','whatsapp','sms','email')),
  status TEXT DEFAULT 'open' CHECK (status IN ('open','closed','archived')),
  assigned_to UUID REFERENCES auth.users,
  ai_handling BOOLEAN DEFAULT true,
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  unread_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_conversations_business_last_msg
  ON public.conversations (business_id, last_message_at DESC);

-- ============================================================
-- 5. messages
-- ============================================================
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.conversations NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender TEXT NOT NULL CHECK (sender IN ('contact','ai','human')),
  content_type TEXT DEFAULT 'text' CHECK (content_type IN ('text','audio','image','file','call_summary')),
  body TEXT,
  media_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_messages_conversation_created
  ON public.messages (conversation_id, created_at);

-- ============================================================
-- 6. calls
-- ============================================================
CREATE TABLE public.calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  conversation_id UUID REFERENCES public.conversations,
  contact_id UUID REFERENCES public.contacts,
  retell_call_id TEXT UNIQUE,
  twilio_call_sid TEXT,
  direction TEXT DEFAULT 'inbound',
  status TEXT CHECK (status IN ('ringing','in_progress','completed','missed','failed')),
  duration_seconds INT,
  recording_url TEXT,
  transcript JSONB,
  call_type TEXT,
  extracted_info JSONB DEFAULT '{}',
  ai_summary TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 7. services
-- ============================================================
CREATE TABLE public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price_from DECIMAL,
  price_to DECIMAL,
  duration_minutes INT,
  bookable BOOLEAN DEFAULT false,
  sort_order INT DEFAULT 0
);

-- ============================================================
-- 8. faqs
-- ============================================================
CREATE TABLE public.faqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 9. call_info_types
-- ============================================================
CREATE TABLE public.call_info_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  name TEXT NOT NULL,
  fields JSONB NOT NULL DEFAULT '[]',
  enabled BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0
);

-- ============================================================
-- 10. appointments
-- ============================================================
CREATE TABLE public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  contact_id UUID REFERENCES public.contacts,
  conversation_id UUID REFERENCES public.conversations,
  service_id UUID REFERENCES public.services,
  cal_booking_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','cancelled','completed','no_show')),
  booked_via TEXT CHECK (booked_via IN ('voice','whatsapp','sms','email','web','manual')),
  customer_notified BOOLEAN DEFAULT false,
  owner_notified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 11. quotes
-- ============================================================
CREATE TABLE public.quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  contact_id UUID REFERENCES public.contacts,
  quote_number TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected','expired')),
  line_items JSONB NOT NULL DEFAULT '[]',
  subtotal DECIMAL NOT NULL DEFAULT 0,
  vat_rate DECIMAL DEFAULT 20,
  vat_amount DECIMAL DEFAULT 0,
  total DECIMAL NOT NULL DEFAULT 0,
  notes TEXT,
  valid_until DATE,
  pdf_url TEXT,
  created_from TEXT CHECK (created_from IN ('voice_note','text','manual')),
  original_transcript TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 12. invoices
-- ============================================================
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  contact_id UUID REFERENCES public.contacts,
  quote_id UUID REFERENCES public.quotes,
  invoice_number TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','overdue','cancelled')),
  line_items JSONB NOT NULL DEFAULT '[]',
  subtotal DECIMAL NOT NULL DEFAULT 0,
  vat_rate DECIMAL DEFAULT 20,
  vat_amount DECIMAL DEFAULT 0,
  total DECIMAL NOT NULL DEFAULT 0,
  notes TEXT,
  due_date DATE,
  pdf_url TEXT,
  payment_link TEXT,
  paid_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 13. notification_settings
-- ============================================================
CREATE TABLE public.notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL UNIQUE,
  email_enabled BOOLEAN DEFAULT true,
  email_address TEXT,
  sms_enabled BOOLEAN DEFAULT false,
  sms_number TEXT,
  whatsapp_enabled BOOLEAN DEFAULT true,
  whatsapp_number TEXT,
  push_enabled BOOLEAN DEFAULT true,
  notify_on_call BOOLEAN DEFAULT true,
  notify_on_message BOOLEAN DEFAULT true,
  notify_on_booking BOOLEAN DEFAULT true,
  notify_on_quote_accepted BOOLEAN DEFAULT true,
  quiet_hours_start TIME,
  quiet_hours_end TIME
);

-- ============================================================
-- 14. team_members
-- ============================================================
CREATE TABLE public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  user_id UUID REFERENCES auth.users,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  invited_at TIMESTAMPTZ DEFAULT now(),
  joined_at TIMESTAMPTZ,
  UNIQUE(business_id, email)
);

-- ============================================================
-- Helper function: returns business IDs the current user belongs to
-- (placed after team_members table exists)
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_business_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT business_id
  FROM public.team_members
  WHERE user_id = auth.uid();
$$;

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_info_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS Policies
-- ============================================================

-- businesses
CREATE POLICY "businesses_select" ON public.businesses
  FOR SELECT USING (id IN (SELECT public.user_business_ids()));
CREATE POLICY "businesses_insert" ON public.businesses
  FOR INSERT WITH CHECK (id IN (SELECT public.user_business_ids()));
CREATE POLICY "businesses_update" ON public.businesses
  FOR UPDATE USING (id IN (SELECT public.user_business_ids()));
CREATE POLICY "businesses_delete" ON public.businesses
  FOR DELETE USING (id IN (SELECT public.user_business_ids()));

-- channels
CREATE POLICY "channels_select" ON public.channels
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "channels_insert" ON public.channels
  FOR INSERT WITH CHECK (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "channels_update" ON public.channels
  FOR UPDATE USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "channels_delete" ON public.channels
  FOR DELETE USING (business_id IN (SELECT public.user_business_ids()));

-- contacts
CREATE POLICY "contacts_select" ON public.contacts
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "contacts_insert" ON public.contacts
  FOR INSERT WITH CHECK (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "contacts_update" ON public.contacts
  FOR UPDATE USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "contacts_delete" ON public.contacts
  FOR DELETE USING (business_id IN (SELECT public.user_business_ids()));

-- conversations
CREATE POLICY "conversations_select" ON public.conversations
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "conversations_insert" ON public.conversations
  FOR INSERT WITH CHECK (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "conversations_update" ON public.conversations
  FOR UPDATE USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "conversations_delete" ON public.conversations
  FOR DELETE USING (business_id IN (SELECT public.user_business_ids()));

-- messages (join through conversations)
CREATE POLICY "messages_select" ON public.messages
  FOR SELECT USING (conversation_id IN (
    SELECT id FROM public.conversations WHERE business_id IN (SELECT public.user_business_ids())
  ));
CREATE POLICY "messages_insert" ON public.messages
  FOR INSERT WITH CHECK (conversation_id IN (
    SELECT id FROM public.conversations WHERE business_id IN (SELECT public.user_business_ids())
  ));
CREATE POLICY "messages_update" ON public.messages
  FOR UPDATE USING (conversation_id IN (
    SELECT id FROM public.conversations WHERE business_id IN (SELECT public.user_business_ids())
  ));
CREATE POLICY "messages_delete" ON public.messages
  FOR DELETE USING (conversation_id IN (
    SELECT id FROM public.conversations WHERE business_id IN (SELECT public.user_business_ids())
  ));

-- calls
CREATE POLICY "calls_select" ON public.calls
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "calls_insert" ON public.calls
  FOR INSERT WITH CHECK (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "calls_update" ON public.calls
  FOR UPDATE USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "calls_delete" ON public.calls
  FOR DELETE USING (business_id IN (SELECT public.user_business_ids()));

-- services
CREATE POLICY "services_select" ON public.services
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "services_insert" ON public.services
  FOR INSERT WITH CHECK (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "services_update" ON public.services
  FOR UPDATE USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "services_delete" ON public.services
  FOR DELETE USING (business_id IN (SELECT public.user_business_ids()));

-- faqs
CREATE POLICY "faqs_select" ON public.faqs
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "faqs_insert" ON public.faqs
  FOR INSERT WITH CHECK (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "faqs_update" ON public.faqs
  FOR UPDATE USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "faqs_delete" ON public.faqs
  FOR DELETE USING (business_id IN (SELECT public.user_business_ids()));

-- call_info_types
CREATE POLICY "call_info_types_select" ON public.call_info_types
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "call_info_types_insert" ON public.call_info_types
  FOR INSERT WITH CHECK (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "call_info_types_update" ON public.call_info_types
  FOR UPDATE USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "call_info_types_delete" ON public.call_info_types
  FOR DELETE USING (business_id IN (SELECT public.user_business_ids()));

-- appointments
CREATE POLICY "appointments_select" ON public.appointments
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "appointments_insert" ON public.appointments
  FOR INSERT WITH CHECK (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "appointments_update" ON public.appointments
  FOR UPDATE USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "appointments_delete" ON public.appointments
  FOR DELETE USING (business_id IN (SELECT public.user_business_ids()));

-- quotes
CREATE POLICY "quotes_select" ON public.quotes
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "quotes_insert" ON public.quotes
  FOR INSERT WITH CHECK (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "quotes_update" ON public.quotes
  FOR UPDATE USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "quotes_delete" ON public.quotes
  FOR DELETE USING (business_id IN (SELECT public.user_business_ids()));

-- invoices
CREATE POLICY "invoices_select" ON public.invoices
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "invoices_insert" ON public.invoices
  FOR INSERT WITH CHECK (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "invoices_update" ON public.invoices
  FOR UPDATE USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "invoices_delete" ON public.invoices
  FOR DELETE USING (business_id IN (SELECT public.user_business_ids()));

-- notification_settings
CREATE POLICY "notification_settings_select" ON public.notification_settings
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "notification_settings_insert" ON public.notification_settings
  FOR INSERT WITH CHECK (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "notification_settings_update" ON public.notification_settings
  FOR UPDATE USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "notification_settings_delete" ON public.notification_settings
  FOR DELETE USING (business_id IN (SELECT public.user_business_ids()));

-- team_members
CREATE POLICY "team_members_select" ON public.team_members
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "team_members_insert" ON public.team_members
  FOR INSERT WITH CHECK (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "team_members_update" ON public.team_members
  FOR UPDATE USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "team_members_delete" ON public.team_members
  FOR DELETE USING (business_id IN (SELECT public.user_business_ids()));

-- ============================================================
-- Realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;
