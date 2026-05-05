# Integrations

All API keys are stored as environment variables. Never hardcoded.

---

| Integration | Purpose | Env Vars | Status |
|---|---|---|---|
| Supabase | DB + Auth + Realtime | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Pending |
| Retell AI | Voice AI agent (handles live calls) | `RETELL_API_KEY` | **Live** |
| Twilio | UK phone numbers + SIP trunking | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | **Live** |
| Stripe | Billing, subscriptions, payment links | `VITE_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Pending |
| Anthropic | Claude Sonnet 4.6 (AI brain for tool use) | `ANTHROPIC_API_KEY` | Pending |
| OpenAI | GPT-4o (transcript extraction/summaries) | `OPENAI_API_KEY` | Pending |
| Unipile | WhatsApp + Email channels | `UNIPILE_TOKEN`, `UNIPILE_DSN`, `UNIPILE_WEBHOOK_SECRET` | **Live** (WhatsApp) |
| Resend | Transactional email (notifications, quotes) | `RESEND_API_KEY` | Pending |
| Cal.com | Booking/calendar integration | `CALCOM_API_KEY` | Pending (Phase 3) |
| Google Cloud | Places API (business search in onboarding) | `GOOGLE_PLACES_API_KEY` | Pending |
| Sentry | Error tracking (frontend + API) | `VITE_SENTRY_DSN` | Pending |

---

## Integration Details

### Supabase
- Database (Postgres), Auth (email + magic link), Realtime (live subscriptions on conversations/messages/calls)
- RLS on all tables via `user_business_ids()` helper

### Retell AI — **Live**

**Credentials:** Stored in `.env` and Vercel env vars.

| Env Var | Purpose |
|---------|---------|
| `RETELL_API_KEY` | API authentication (`key_c094a5f399a55...`) |

**Current setup:**
- Agent ID: `agent_adb8cb0848bc2d3b3a4551933e` (Inbound Call Agent)
- LLM ID: `llm_c2071f7699e2fb91f68f49957bdf` (system prompt lives here)
- Voice: `retell-Willa` (British female, platform provider)
- Language: `en-GB`
- Phone: `+447426495169` (imported custom number via Twilio SIP trunk)
- SIP termination URI: `retellerminationsipuri.pstn.twilio.com`
- Webhook: `https://poppy-henna.vercel.app/api/webhooks/retell`

**Two-step agent setup:**
1. Create/update Retell LLM (with `general_prompt`) → returns `llm_id`
2. Create/update Retell Agent (references `llm_id`, sets `voice_id`, `language`, `webhook_url`) → returns `agent_id`

**Webhook events handled:** `call_ended` (creates call record, contact, conversation) and `call_analyzed` (updates call with summary/sentiment)

**Webhook signature:** `x-retell-signature` header with format `v={timestamp},d={hmac_hex}`. Secret is the RETELL_API_KEY itself. HMAC-SHA256 of `rawBody + timestamp`.

**API routes:**
| Route | Purpose |
|-------|---------|
| `api/webhooks/retell.ts` | Handles call_ended + call_analyzed events |
| `api/numbers/provision.ts` | Creates LLM + Agent + channel row for new businesses |
| `api/agent/sync-prompt.ts` | Rebuilds system prompt from business data → updates Retell LLM |
| `api/agent/update-voice.ts` | Changes voice_id on the Retell Agent |

### Twilio — **Live**

**Credentials:** Stored in `.env` and Vercel env vars.

| Env Var | Purpose |
|---------|---------|
| `TWILIO_ACCOUNT_SID` | Twilio account SID (`ACa694e1c2c51e...`) |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |

**Current setup:**
- Dedicated Poppy Twilio account (separate from NFStay)
- UK number: `+447426495169`
- Elastic SIP Trunk: origination → `sip:sip.retellai.com`, termination secured via credential auth
- Retell IP whitelist: `18.98.16.120/30`
- Number assigned to the SIP trunk

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

### Unipile (Live — WhatsApp)

**Credentials:** Shared with marketplace10/hub.nfstay.com. Stored in Vercel env vars.

| Env Var | Purpose |
|---------|---------|
| `UNIPILE_TOKEN` | API authentication token |
| `UNIPILE_DSN` | Unipile API base URL |
| `UNIPILE_WEBHOOK_SECRET` | Webhook auth header value (`poppy-webhook-secret-2026-05-02`) |
| `ANTHROPIC_API_KEY` | Used by webhook for AI auto-replies (Claude Sonnet 4.6) |
| `APP_URL` | Redirect URL after QR scan (`https://poppy-henna.vercel.app`) |

**Webhook registration:**
- Webhook ID: `V0dsQmpRQiW79wPqc6E6kQ`
- URL: `https://poppy-henna.vercel.app/api/webhooks/unipile`
- Events: `message_received`
- Auth: `Unipile-Auth` header string equality check (not HMAC)

**API routes:**
| Route | Purpose |
|-------|---------|
| `api/webhooks/unipile.ts` | Handles `account_connected` + `message_received` events, downloads attachments |
| `api/channels/whatsapp/connect.ts` | Creates hosted-auth link for QR scan, pre-creates channel row |
| `api/messages/send.ts` | Outbound WhatsApp/email — resolves contact + channel, sends via Unipile |
| `api/messages/poll.ts` | Polling fallback — fetches last 24h, deduplicates, downloads media, syncs reactions |
| `api/messages/compose.ts` | Compose new message to contact (creates conversation if needed) |
| `api/messages/attachment.ts` | Proxy attachment download from Unipile API |
| `api/messages/approve.ts` | Approve draft → send via Unipile (WhatsApp or email), update status to `sent` |
| `api/messages/rewrite.ts` | Regenerate AI reply for a draft using Claude Sonnet 4.6 |

**Integration wrapper:** `src/integrations/unipile/client.ts`
- `sendToChat()` — sends WhatsApp message to a new chat by phone number

**Architecture pattern (from marketplace10):**
- Unipile owns QR-scan UX via hosted auth links (no WhatsApp Business API approval needed)
- Dual ingestion: webhook + polling fallback (belt and braces — Unipile webhooks are unreliable)
- AI auto-reply uses business `ai_system_prompt` via Claude Sonnet 4.6
- All messages stored in unified `messages` table regardless of channel
- Media attachments downloaded from Unipile → uploaded to Supabase Storage (`media` bucket)
- Reactions synced from Unipile and stored in message metadata
- Reaction notification texts filtered out (Unipile sends them with unreliable `is_event` flag)

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
