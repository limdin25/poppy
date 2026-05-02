# Integrations

All API keys are stored as environment variables. Never hardcoded.

---

| Integration | Purpose | Env Vars | Status |
|---|---|---|---|
| Supabase | DB + Auth + Realtime | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Pending |
| Retell AI | Voice AI agent (handles live calls) | `RETELL_API_KEY`, `RETELL_WEBHOOK_SECRET` | Pending |
| Twilio | UK phone numbers + SMS delivery | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_TRUNKING_SID` | Pending |
| Stripe | Billing, subscriptions, payment links | `VITE_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Pending |
| Anthropic | Claude Sonnet 4.6 (AI brain for tool use) | `ANTHROPIC_API_KEY` | Pending |
| OpenAI | GPT-4o (transcript extraction/summaries) | `OPENAI_API_KEY` | Pending |
| Unipile | WhatsApp + Email channels | `UNIPILE_API_KEY`, `UNIPILE_DSN` | Pending (Phase 2) |
| Resend | Transactional email (notifications, quotes) | `RESEND_API_KEY` | Pending |
| Cal.com | Booking/calendar integration | `CALCOM_API_KEY` | Pending (Phase 3) |
| Google Cloud | Places API (business search in onboarding) | `GOOGLE_PLACES_API_KEY` | Pending |
| Sentry | Error tracking (frontend + API) | `VITE_SENTRY_DSN` | Pending |

---

## Integration Details

### Supabase
- Database (Postgres), Auth (email + magic link), Realtime (live subscriptions on conversations/messages/calls)
- RLS on all tables via `user_business_ids()` helper

### Retell AI
- Manages the voice agent: receives calls via Twilio SIP trunk, runs the AI conversation, posts webhook events (call started, ended, transcript ready)
- Webhook endpoint: `POST /api/webhooks/retell`

### Twilio
- Provisions UK phone numbers per business
- SIP trunking connects numbers to Retell AI
- SMS sending for notifications and AI replies

### Stripe
- Subscription billing (trial -> paid conversion)
- Webhook handles `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`
- Payment links on invoices

### Anthropic (Claude Sonnet 4.6)
- Core AI brain for the receptionist
- Strict tool use mode ensures valid structured outputs (appointment booking, quote generation, info extraction)

### OpenAI (GPT-4o)
- Transcript post-processing: extracting structured data from call transcripts
- Summarisation of long conversations

### Unipile (Phase 2)
- WhatsApp Business and Email channel connectivity
- Unified messaging API

### Resend
- Transactional emails: quote PDFs, invoice notifications, missed call alerts, daily summaries

### Cal.com (Phase 3)
- Calendar availability checking
- Appointment booking during calls
- Sync with Google/Outlook calendars

### Google Cloud (Places API)
- Business search during onboarding (auto-fill name, address, phone, website)

### Sentry
- Frontend error tracking via `@sentry/react`
- API route error capture
