# API Integrations

## Meta Graph API — Instagram Login + Content Publishing

- **Docs:** https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
- **Method:** Instagram API with Instagram Login (launched July 2024 — no Facebook needed)
- **Permissions:** `instagram_business_basic` + `instagram_business_content_publish`

### Auth Flow

1. Influencer clicks "Conectar meu Instagram" → redirects to `/api/instagram/connect` → Meta OAuth
2. Meta returns authorization code to `/auth/instagram/callback`
3. Backend exchanges for short-lived token (1 hour)
4. Backend exchanges for long-lived token (60 days)
5. Vercel Cron runs daily at 6am UTC → `/api/instagram/refresh-tokens` refreshes tokens expiring within 7 days

### Publishing (2 steps)

```
POST /{ig_user_id}/media → container_id
GET /{container_id}?fields=status_code → wait for FINISHED
POST /{ig_user_id}/media_publish?creation_id={container_id} → published!
```

### Media Types

| Type          | media_type | Parameters                        |
| ------------- | ---------- | --------------------------------- |
| Feed (image)  | —          | image_url, caption                |
| Story (image) | STORIES    | image_url                         |
| Story (video) | STORIES    | video_url                         |
| Reel          | REELS      | video_url, caption, cover_url     |
| Carousel      | CAROUSEL   | children (container IDs), caption |

- **Limit:** 100 posts per account per 24h
- **Requirement:** Professional account (Business or Creator). Media must be public URL.

### Vercel Cron Jobs (replaces n8n)

Configured in `vercel.json`. No external automation tool needed.

| Job            | Route                           | Schedule         | What it does                              |
| -------------- | ------------------------------- | ---------------- | ----------------------------------------- |
| Token refresh  | `/api/instagram/refresh-tokens` | Daily at 6am UTC | Refreshes tokens expiring within 7 days   |
| Post publisher | `/api/instagram/publish`        | Every 15 minutes | Publishes pending scheduled posts via API |

- **Auth:** Both routes require `Authorization: Bearer {CRON_SECRET}` header (Vercel sends this automatically)
- **Meta App:** NextPubli (App ID: 494214389576737), Live, Business type

---

## Hotmart API — Sales & Commissions

- **Docs:** https://developers.hotmart.com/docs
- **Auth:** OAuth 2.0 Client Credentials (server-to-server)

```
POST https://api-sec-vlc.hotmart.com/security/oauth/token
grant_type=client_credentials & client_id=XXX & client_secret=XXX
```

### Endpoints

| Endpoint                                      | Method | Description                              |
| --------------------------------------------- | ------ | ---------------------------------------- |
| /payments/rest/v2/sales                       | GET    | Sales history (filter by affiliate_code) |
| /affiliation/rest/v2/products/{id}/affiliates | GET    | Affiliates per product                   |
| Webhook 2.0                                   | POST   | Real-time sale notifications             |

- **Webhook events:** order_confirmed, order_completed, refund, subscription_cancel
- **Rate limit:** 500 requests/minute

---

## Unipile — WhatsApp Admin

- **Docs:** https://developer.unipile.com/docs/whatsapp
- **Setup:** Admin scans WhatsApp QR code → Unipile connects → API available
- **Features:** Send text, image, video, document. Receive messages. Full history.
- **Webhooks:** New message notifications
- **Cost:** EUR49/month (up to 10 connected accounts)

---

## Resend — Email

- **Docs:** https://resend.com/docs
- **Usage:** Welcome emails, notifications, alerts, influencer communication
- **Free tier:** 3,000 emails/month, 100/day
