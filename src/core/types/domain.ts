export type Role = 'owner' | 'admin' | 'member'

export type BillingState =
  | 'trial_active'
  | 'trial_expired'
  | 'active'
  | 'past_due'
  | 'cancelled'

export type Plan = 'trial' | 'starter' | 'professional' | 'business'

export type ChannelType = 'voice' | 'whatsapp' | 'sms' | 'email'

export type CallStatus =
  | 'ringing'
  | 'in_progress'
  | 'completed'
  | 'missed'
  | 'failed'

export type ConversationStatus = 'open' | 'closed' | 'archived'

export type MessageDirection = 'inbound' | 'outbound'

export type MessageSender = 'ai' | 'human' | 'system' | 'contact'

export type AppointmentStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show'

export type QuoteStatus =
  | 'draft'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'expired'

export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'paid'
  | 'overdue'
  | 'cancelled'
