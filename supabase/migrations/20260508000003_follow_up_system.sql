-- Follow-up system: settings + queue tables

-- 1. Per-business follow-up settings
CREATE TABLE public.follow_up_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT true,
  max_attempts INT DEFAULT 2 CHECK (max_attempts BETWEEN 1 AND 3),
  delay_hours INT[] DEFAULT '{2,24}',
  preferred_channel TEXT DEFAULT 'same_channel' CHECK (preferred_channel IN ('same_channel','sms','whatsapp','email')),
  tone TEXT DEFAULT 'friendly' CHECK (tone IN ('friendly','professional','casual')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER follow_up_settings_updated_at
  BEFORE UPDATE ON public.follow_up_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Follow-up queue (individual messages to send)
CREATE TABLE public.follow_up_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  conversation_id UUID REFERENCES public.conversations NOT NULL,
  contact_id UUID REFERENCES public.contacts NOT NULL,
  attempt_number INT NOT NULL DEFAULT 1 CHECK (attempt_number BETWEEN 1 AND 3),
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  reason TEXT CHECK (reason IN (
    'unanswered_question',
    'interested_no_booking',
    'outside_area',
    'outside_hours',
    'price_inquiry',
    'appointment_no_show',
    'general'
  )),
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','sent','cancelled','failed')),
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_follow_up_queue_pending
  ON public.follow_up_queue (scheduled_at)
  WHERE status = 'pending';

CREATE INDEX idx_follow_up_queue_conversation
  ON public.follow_up_queue (conversation_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX idx_follow_up_queue_unique_attempt
  ON public.follow_up_queue (conversation_id, attempt_number)
  WHERE status != 'cancelled';

-- RLS
ALTER TABLE public.follow_up_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_up_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "follow_up_settings_select" ON public.follow_up_settings
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "follow_up_settings_insert" ON public.follow_up_settings
  FOR INSERT WITH CHECK (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "follow_up_settings_update" ON public.follow_up_settings
  FOR UPDATE USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "follow_up_settings_delete" ON public.follow_up_settings
  FOR DELETE USING (business_id IN (SELECT public.user_business_ids()));

CREATE POLICY "follow_up_queue_select" ON public.follow_up_queue
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "follow_up_queue_insert" ON public.follow_up_queue
  FOR INSERT WITH CHECK (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "follow_up_queue_update" ON public.follow_up_queue
  FOR UPDATE USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "follow_up_queue_delete" ON public.follow_up_queue
  FOR DELETE USING (business_id IN (SELECT public.user_business_ids()));
