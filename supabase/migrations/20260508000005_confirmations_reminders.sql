-- ============================================================
-- MIGRATION: Booking confirmations & reminders (Calendly-style)
-- ============================================================

-- Confirmation settings on agents
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS confirmation_enabled BOOLEAN DEFAULT true;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS confirmation_delay_seconds INTEGER DEFAULT 1;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS confirmation_channels TEXT[] DEFAULT '{whatsapp,sms,email}';

-- Reminder settings on agents (times in seconds before appointment)
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN DEFAULT true;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS reminder_times_seconds INTEGER[] DEFAULT '{86400,3600}';
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS reminder_channels TEXT[] DEFAULT '{whatsapp,sms,email}';

-- Owner notification settings on agents
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS owner_confirmation_enabled BOOLEAN DEFAULT true;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS owner_reminder_enabled BOOLEAN DEFAULT true;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS owner_reminder_times_seconds INTEGER[] DEFAULT '{86400}';

-- Queue table for all appointment notifications
CREATE TABLE IF NOT EXISTS public.appointment_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('confirmation', 'reminder', 'owner_confirmation', 'owner_reminder')),
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'email')),
  recipient_phone TEXT,
  recipient_email TEXT,
  message TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appt_notifications_status ON public.appointment_notifications(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appt_notifications_appointment ON public.appointment_notifications(appointment_id);

-- RLS
ALTER TABLE public.appointment_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own business notifications" ON public.appointment_notifications
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM public.team_members WHERE user_id = auth.uid())
  );
