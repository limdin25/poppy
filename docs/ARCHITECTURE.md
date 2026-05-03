# Poppy Architecture

## Overview

Poppy is an AI phone receptionist for UK service businesses. It answers inbound calls, captures caller details (name, reason, urgency), and sends a structured summary to the business owner via their preferred channel. The goal: no missed leads, no voicemail, no hiring a human receptionist.

---

## Folder Structure

```
src/
  app/            App shell — router, layout, providers
  core/           Shared UI primitives (14 Radix/shadcn components), hooks, lib utilities, types
  features/       Isolated feature modules (see list below)
  integrations/   Third-party service wrappers
  prompts/        AI system prompt templates for the receptionist agent

api/              Vercel serverless functions (webhooks, cron, protected routes)
```

### Features (`src/features/`)

Each folder is a self-contained module with its own pages, components, hooks, and types:

| Feature | Purpose |
|---------|---------|
| registration | Sign-up flow |
| onboarding | Business profile setup wizard |
| dashboard | Owner home screen — stats, recent calls |
| calls | Call history + detail view |
| inbox | Unified message feed |
| agent-setup | Configure the AI receptionist persona and rules |
| account | Billing, plan, profile settings |
| contacts | CRM-lite — caller records |
| channels | Notification delivery config (SMS, email, WhatsApp) |
| appointments | Booking integration |
| quotes | Quote request capture |
| invoices | Payment/invoice tracking |
| workspace | Multi-user / team settings |
| auth | Login, magic link, session management |

### Integrations (`src/integrations/`)

| Wrapper | Service |
|---------|---------|
| supabase | DB, Auth, Realtime, Storage |
| retell | AI voice agent (call handling) |
| twilio | Phone numbers, SIP trunking |
| stripe | Subscriptions, billing |
| unipile | Messaging aggregation |
| anthropic | Claude (fallback reasoning) |
| openai | GPT models (prompt completion) |
| resend | Transactional email |
| calcom | Calendar / booking |

---

## Modularity Rules

These are enforced and non-negotiable:

1. **Features NEVER import from other features.** No exceptions.
2. **Cross-feature shared code lives in `src/core/`.** If two features need the same thing, extract it there.
3. **Core never imports from features.** Dependency flows one way: features depend on core, never the reverse.
4. **Each third-party gets its own wrapper** in `src/integrations/{name}/`. Features import the wrapper, never the raw SDK.
5. **Features communicate through Supabase** (tables + Realtime subscriptions), not direct imports or event buses.
6. **CSS custom properties for theming.** Change one variable, the whole app updates. No scattered colour hex values.
7. **Tests live per feature.** Breaking feature A cannot break feature B's tests.

---

## Data Flow — Inbound Call

```
Inbound call
  → Twilio SIP trunk
    → Retell AI (handles conversation, follows system prompt)
      → Webhook POST to Vercel function on call end
        → Vercel function writes to Supabase:
            • calls table (duration, transcript, summary)
            • contacts table (upsert caller)
            • conversations table (full exchange)
        → Supabase Realtime pushes update
          → Dashboard refreshes live
```

The owner also receives a notification (email/SMS/WhatsApp) via their configured channel.

---

## Data Flow — Inbound WhatsApp Message

```
Inbound WhatsApp message
  → Unipile webhook POST /api/webhooks/unipile (event: message_received)
    → Vercel function:
        • Upserts contact (by phone, scoped to business)
        • Creates or finds conversation (channel='whatsapp')
        • Downloads attachments (image/audio/video/file) → Supabase Storage
        • Stores message in messages table (direction=inbound, sender=contact)
        • If ai_handling enabled on conversation:
            → Calls Claude Sonnet 4.6 with business ai_system_prompt
            → Sends AI reply via Unipile /chats endpoint
            → Stores outbound message (sender=ai)
  → Supabase Realtime pushes update
    → Inbox refreshes live
```

### Attachment Handling

Media messages (images, audio, video, files) are downloaded from Unipile's attachment API and uploaded to Supabase Storage (`media` bucket, `attachments/` prefix). The public URL is stored in `messages.media_url`. The frontend renders the appropriate element (`<img>`, `<audio>`, `<video>`) based on `content_type`.

### WhatsApp Channel Connection

```
Business clicks "Connect WhatsApp" in settings
  → GET /api/channels/whatsapp/connect
    → Pre-creates channel row (status='pending')
    → Creates Unipile hosted-auth link
    → Redirects to Unipile QR scan page
  → User scans QR code
  → Unipile webhook POST /api/webhooks/unipile (event: account_connected)
    → Updates channel status to 'connected', stores unipile_account_id
```

### Polling Fallback

`GET /api/messages/poll` runs on a schedule (or manually). Fetches the last 24 hours of WhatsApp messages from all Unipile accounts, deduplicates by `external_id` in message metadata, and creates any missing contacts/conversations/messages. Safety net for unreliable webhooks.

---

## API Routes (Vercel Serverless)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/webhooks/unipile` | POST | Handles `account_connected` and `message_received` events |
| `/api/channels/whatsapp/connect` | GET | Creates Unipile hosted-auth link, pre-creates channel row |
| `/api/messages/send` | POST | Outbound WhatsApp/email sending (resolves contact + channel, sends via Unipile) |
| `/api/messages/poll` | GET/POST | Polling fallback — fetches last 24h of messages, deduplicates, downloads attachments |
| `/api/messages/compose` | POST | Compose new message to a contact (creates conversation if needed) |
| `/api/messages/attachment` | GET | Proxy attachment download from Unipile |
| `/api/messages/approve` | POST | Approve a draft message — sends via Unipile, updates status to `sent` |
| `/api/messages/rewrite` | POST | Regenerate AI reply for a draft message (keeps status `draft`) |

---

## Mobile-First

- Bottom tab bar on mobile, sidebar on desktop.
- Single-column layouts that scale up to wider screens.
- Touch targets sized for thumbs; no hover-dependent interactions.
- All critical actions reachable within one tap from the tab bar.

---

## Tech Stack

| Technology | Role |
|------------|------|
| React 19 | UI framework |
| Vite | Build tool + dev server |
| TypeScript | Type safety across the app |
| Tailwind CSS v3 | Utility-first styling |
| Radix UI | Accessible headless primitives |
| Supabase | Postgres DB, Auth, Realtime, Row-Level Security |
| Retell AI | Voice agent — handles the live call |
| Twilio | Phone numbers + SIP connectivity |
| Stripe | Subscription billing |
| Anthropic | Claude Sonnet 4.6 — AI brain for auto-replies and tool use |
| Resend | Transactional email delivery |
| Cal.com | Appointment scheduling |
| Vercel | Hosting (frontend + serverless API routes) |
