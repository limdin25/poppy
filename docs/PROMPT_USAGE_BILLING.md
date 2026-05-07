# Implementation Prompt: Hey Elsie Billing & AI Takeover System

## Context

Hey Elsie is an AI receptionist SaaS for small businesses (salons, trades, clinics). It answers missed calls via AI voice (Retell AI + Twilio), auto-replies to WhatsApp/Instagram/email (via Unipile), and books appointments into Google Calendar. The AI only steps in when the business owner doesn't respond within 20 minutes.

**Stack**: React 19 + Vite + Tailwind + Supabase + Vercel serverless functions.
**Stripe account**: `acct_1M9GXPLdAEhwWg6w` (shared with Lemlin — already integrated).
**Supabase project**: `loggyxryrhqsbtqpteog` (EU West 2).
**Unipile**: €49/mo for 10 connected accounts, then €5/account above 10. Each WhatsApp/Instagram/Email connection = 1 account.

## What to Build

Three interconnected systems:

1. **Billing system** — per-booking pricing with monthly cap, multi-currency, Stripe metered billing
2. **AI takeover system** — 20-minute delay before AI responds to messages, with collision prevention
3. **Daily summary notifications** — one daily digest to business owners

---

## Part 1: Billing System

### Pricing Model

**The business owner pays nothing except when Elsie books an appointment.**

| Event | UK (GBP) | USA (USD) | Europe (EUR) |
|---|---|---|---|
| Activation credit | **£5** (covers first booking) | **$5** | **€5** |
| AI-answered calls | Free | Free | Free |
| AI-sent messages | Free | Free | Free |
| **First AI-booked appointment** | **£5** (paid upfront as activation credit) | **$5** | **€5** |
| **Subsequent AI-booked appointments** | **£20/booking** | **$20/booking** | **€20/booking** |
| **Monthly cap** | **£189** | **$189** | **€189** |

### Billing Rules

1. Only AI-created bookings are billable. If the business owner books manually through their calendar or in-app, it's free.
2. A "booking" = Elsie creates a Google Calendar event for a customer. The billing event fires when the calendar API confirms success.
3. The £189/$189/€189 monthly cap covers all bookings. Once hit, all further bookings are free for the rest of the billing cycle.
4. Billing cycle is 30 days from the date they activated (not calendar month).
5. Post-paid: charge at the end of each billing cycle via Stripe invoice.
6. If the total for a cycle is £0 (no bookings), don't create an invoice.
7. **Activation credit**: The business owner pays £5/$5/€5 after signing the contract. This £5 is stored as a Stripe Customer Balance credit and is applied to their first AI-booked appointment. So the first booking effectively costs £5 instead of £20. The remaining £15 of that first booking is waived — it's a discount, not a partial charge.
8. **No free trial**. Instead, the sales process is: sales call → contract signed → £5 activation credit paid → channels connected → Elsie goes live. The £5 commitment + signed contract replaces the free trial.

### Why This Model

The sales pitch: "We don't charge you anything upfront. We answer all the calls you miss, 24/7. Any WhatsApp, Instagram, or email you don't reply to within 20 minutes — our AI handles it. It knows your business, your prices, your availability. If a customer wants to book, it books them straight into your diary. You only pay when we book you a customer. £20 per booking. Never more than £189/month. Your first booking is just £5 to get started. That's it."

### Customer Journey

This is NOT a self-serve SaaS signup. It's a sales-led process:

1. **Sales call** — Hugo (or sales team) pitches the business owner. Explains the product, asks which channels their customers use (phone, WhatsApp, Instagram, email).
2. **Contract** — Business owner signs a simple one-page service agreement covering: what Elsie does, pricing (£20/booking, £189 cap, first booking £5), data handling (GDPR), cancellation (anytime, no lock-in), 30-day rolling terms.
3. **Activation payment (£5)** — After signing, the business owner pays £5. This captures their card and acts as a credit toward their first booking. Framing: "Your first booking is just £5 to activate."
4. **Onboarding** — Hugo (or the onboarding flow) connects their channels, sets up call forwarding, teaches Elsie their services/FAQs/availability.
5. **Elsie goes live** — AI starts handling missed calls and unanswered messages.
6. **First booking happens** — Elsie books a customer. The £5 credit is applied. Business owner sees: "First booking — £5 (activation credit applied)" instead of £20.
7. **Ongoing** — £20 per booking, capped at £189/mo. Monthly invoice via Stripe.

---

### Currency Detection

Detect the user's country at signup and set their currency permanently.

**Implementation**: Use Vercel's built-in `request.geo` (available on all Vercel deployments for free). It returns `{ country: 'GB', city: '...', region: '...' }` from the `x-vercel-ip-country` header.

Create a utility function:

```typescript
// src/core/utils/currency.ts

type Currency = 'GBP' | 'USD' | 'EUR';

const EU_COUNTRIES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'
];

export function getCurrencyFromCountry(countryCode: string | null): Currency {
  if (!countryCode) return 'USD';
  if (countryCode === 'GB') return 'GBP';
  if (countryCode === 'US' || countryCode === 'CA') return 'USD';
  if (EU_COUNTRIES.includes(countryCode)) return 'EUR';
  return 'USD';
}

export function getCurrencySymbol(currency: Currency): string {
  switch (currency) {
    case 'GBP': return '£';
    case 'USD': return '$';
    case 'EUR': return '€';
  }
}

export function formatAmount(amount: number, currency: Currency): string {
  return `${getCurrencySymbol(currency)}${amount.toFixed(2)}`;
}
```

**In API routes** (Vercel serverless functions), read the country from request headers:
```typescript
const country = req.headers['x-vercel-ip-country'] as string || null;
const currency = getCurrencyFromCountry(country);
```

**At signup**: store the detected currency on the business record. Never change it after.

**In the frontend**: read the business's currency from Supabase and use it for all price displays. Show £20, $20, or €20 depending on their currency. Show £189, $189, or €189 for the cap.

---

### Supabase Schema

```sql
-- ============================================================
-- MIGRATION: Usage-based billing
-- ============================================================

-- Add billing columns to businesses table
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS currency text DEFAULT 'GBP'
  CHECK (currency IN ('GBP', 'USD', 'EUR'));
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS billing_active boolean DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS billing_started_at timestamptz;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS contract_signed_at timestamptz;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS activation_credit_paid boolean DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS active_channels text[] DEFAULT '{phone}';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS country_code text;

-- Billing periods: one row per business per 30-day cycle
CREATE TABLE billing_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,

  -- Booking totals
  booking_count integer DEFAULT 0,
  total_amount numeric(10,2) DEFAULT 0,        -- actual charged (capped at 189)
  total_before_cap numeric(10,2) DEFAULT 0,    -- what they would have paid without cap

  -- Cap tracking
  cap_amount numeric(10,2) NOT NULL DEFAULT 189,  -- 189 in their currency
  cap_reached boolean DEFAULT false,
  cap_reached_at timestamptz,

  currency text NOT NULL CHECK (currency IN ('GBP', 'USD', 'EUR')),

  -- Stripe
  stripe_invoice_id text,
  stripe_invoice_status text,  -- 'pending', 'paid', 'failed', 'void'
  paid_at timestamptz,

  status text DEFAULT 'active' CHECK (status IN ('active', 'invoiced', 'paid', 'failed', 'void')),

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(business_id, period_start)
);

CREATE INDEX idx_billing_periods_business ON billing_periods(business_id, period_start);
CREATE INDEX idx_billing_periods_status ON billing_periods(status, period_end);

-- Booking events: every AI-booked appointment logged here
CREATE TABLE booking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) NOT NULL,
  billing_period_id uuid REFERENCES billing_periods(id) NOT NULL,

  -- What was booked
  appointment_id uuid REFERENCES appointments(id),
  contact_id uuid REFERENCES contacts(id),
  contact_name text,
  service_description text,       -- e.g. "Cut & Blowdry", "Boiler Repair"
  appointment_datetime timestamptz,
  channel text,                   -- which channel the booking came from: 'phone', 'whatsapp', 'instagram', 'email'

  -- Billing
  amount_raw numeric(10,2) NOT NULL DEFAULT 20.00,  -- always 20 in their currency
  amount_billed numeric(10,2) NOT NULL,              -- 20 or 0 if monthly cap hit
  currency text NOT NULL CHECK (currency IN ('GBP', 'USD', 'EUR')),
  capped boolean DEFAULT false,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_booking_events_business ON booking_events(business_id, created_at);
CREATE INDEX idx_booking_events_period ON booking_events(billing_period_id);

-- RLS Policies
ALTER TABLE billing_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own billing periods" ON billing_periods
  FOR SELECT USING (business_id IN (
    SELECT id FROM businesses WHERE owner_id = auth.uid()
  ));

ALTER TABLE booking_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own booking events" ON booking_events
  FOR SELECT USING (business_id IN (
    SELECT id FROM businesses WHERE owner_id = auth.uid()
  ));

-- Enable realtime for billing_periods so the dashboard updates live
ALTER PUBLICATION supabase_realtime ADD TABLE billing_periods;
```

---

### API Routes

#### 1. `POST /api/billing/record-booking`

**Called internally when Elsie books an appointment via Google Calendar.**

This is NOT called by the frontend. It's called from the booking creation logic after the Google Calendar API confirms success.

```
Input: {
  business_id: uuid,
  appointment_id: uuid,
  contact_id: uuid,
  contact_name: string,
  service_description: string,
  appointment_datetime: string (ISO),
  channel: 'phone' | 'whatsapp' | 'instagram' | 'email'
}
```

Logic:
1. Look up the business's currency and billing_active status
2. If `billing_active = false`, reject (business hasn't paid activation credit yet)
3. Find the current billing_period for this business (where period_start <= today <= period_end)
4. If no billing period exists (shouldn't happen if setup is correct), create one
5. Check if monthly cap is reached:
   - If `billing_periods.total_amount >= cap_amount` → set `amount_billed = 0`, `capped = true`
   - Otherwise → set `amount_billed = min(20, cap_amount - total_amount)`
6. Insert into `booking_events`
7. Update `billing_periods`: increment `booking_count`, add to `total_amount` and `total_before_cap`
8. If `total_amount >= cap_amount` and not already flagged → set `cap_reached = true`, `cap_reached_at = now()`
9. Return the booking event

**Important**: Use a Supabase transaction (or at minimum, use the service role client) to ensure the cap check and insert are atomic. Two simultaneous bookings shouldn't both charge full price if only one fits under the cap.

**Important**: Wrap in try/catch. If billing fails, the appointment should still be booked. Never let billing bugs break the core product.

---

#### 2. `POST /api/billing/activate`

**Called after the business owner signs the contract and pays the £5 activation credit.**

This is the moment the card is captured and Elsie is activated for billing.

```
Input: {
  payment_method_id: string (from Stripe Elements on frontend)
}
```

Logic:
1. Get the authenticated user's business
2. Create a Stripe Customer in the business's currency:
   ```javascript
   const customer = await stripe.customers.create({
     email: user.email,
     name: business.name,
     metadata: { business_id: business.id, currency: business.currency },
     payment_method: payment_method_id,
     invoice_settings: { default_payment_method: payment_method_id }
   });
   ```
3. Charge the £5/$5/€5 activation credit:
   ```javascript
   // Charge £5 immediately
   await stripe.paymentIntents.create({
     amount: 500,  // 500 pence = £5 (or 500 cents for USD/EUR)
     currency: business.currency.toLowerCase(),
     customer: customer.id,
     payment_method: payment_method_id,
     confirm: true,
     description: 'Hey Elsie activation credit — covers first booking',
     metadata: { business_id: business.id, type: 'activation_credit' }
   });

   // Add £5 credit to their Stripe Customer Balance
   // This will be automatically applied to their first invoice
   await stripe.customers.createBalanceTransaction(customer.id, {
     amount: -500,  // negative = credit (in smallest currency unit)
     currency: business.currency.toLowerCase(),
     description: 'Activation credit — applied to first booking'
   });
   ```
4. Create a Stripe Subscription with a metered price for bookings:
   ```javascript
   const subscription = await stripe.subscriptions.create({
     customer: customer.id,
     items: [{ price: bookingPriceId }],  // the metered price for their currency
     billing_cycle_anchor: Math.floor(Date.now() / 1000),
   });
   ```
5. Update the business in Supabase:
   - `stripe_customer_id = customer.id`
   - `stripe_subscription_id = subscription.id`
   - `billing_active = true`
   - `billing_started_at = now()`
   - `activation_credit_paid = true`
6. Create the first `billing_period` (today → today + 30 days)
7. Return success

**How the £5 credit works with the first invoice:**
- Elsie books appointments throughout the month
- At end of billing cycle, Stripe generates an invoice (e.g. 5 bookings = £100)
- Stripe automatically applies the £5 customer balance credit
- Customer is charged £95 instead of £100
- The first booking effectively cost £5 instead of £20 — the £15 difference is absorbed as a customer acquisition cost

---

#### 3. `GET /api/billing/usage`

**Called by the frontend to show the customer their current billing period.**

Returns:
```json
{
  "current_period": {
    "id": "uuid",
    "start": "2026-05-07",
    "end": "2026-06-06",
    "booking_count": 7,
    "total_amount": 140.00,
    "total_before_cap": 140.00,
    "cap_amount": 189,
    "cap_reached": false,
    "currency": "GBP",
    "days_remaining": 18,
    "amount_saved": 0
  },
  "activation_credit": {
    "paid": true,
    "amount": 5.00,
    "applied": false
  }
}
```

---

#### 4. `GET /api/billing/history`

**Called by the frontend to show past billing periods.**

Returns paginated array:
```json
{
  "periods": [
    {
      "id": "uuid",
      "start": "2026-04-07",
      "end": "2026-05-06",
      "booking_count": 12,
      "total_amount": 189.00,
      "total_before_cap": 240.00,
      "cap_reached": true,
      "currency": "GBP",
      "status": "paid",
      "paid_at": "2026-05-07T00:15:00Z",
      "stripe_invoice_url": "https://invoice.stripe.com/..."
    }
  ]
}
```

---

#### 5. `GET /api/billing/bookings`

**Called by the frontend to show itemised booking events.**

Accepts: `?period_id=xxx&page=1&per_page=20`

Returns paginated list:
```json
{
  "bookings": [
    {
      "id": "uuid",
      "created_at": "2026-05-07T14:32:00Z",
      "contact_name": "Sarah Williams",
      "service_description": "Cut & Blowdry",
      "appointment_datetime": "2026-05-09T10:00:00Z",
      "channel": "whatsapp",
      "amount_billed": 20.00,
      "capped": false,
      "currency": "GBP"
    },
    {
      "id": "uuid",
      "created_at": "2026-05-07T16:10:00Z",
      "contact_name": "Mike Thompson",
      "service_description": "Beard Trim",
      "appointment_datetime": "2026-05-08T15:30:00Z",
      "channel": "phone",
      "amount_billed": 0,
      "capped": true,
      "currency": "GBP"
    }
  ],
  "total": 12,
  "page": 1,
  "per_page": 20
}
```

---

#### 6. `POST /api/billing/create-invoice`

**Called by Vercel cron job daily to invoice completed billing periods.**

Logic:
1. Find all `billing_periods` where `period_end <= today` and `status = 'active'`
2. For each:
   - If `total_amount = 0` → set `status = 'void'`, skip (no invoice for zero usage)
   - Report total booking usage to Stripe via Usage Records API
   - Create and finalise a Stripe Invoice
   - Update `billing_periods` with `stripe_invoice_id`, set `status = 'invoiced'`
3. Create the next billing period for the business (next 30 days)
4. Log results

---

#### 7. `POST /api/webhooks/stripe-billing`

**Handles Stripe invoice webhook events.**

Register webhook endpoint in Stripe for events:
- `invoice.paid` → update billing_period `status = 'paid'`, `paid_at = now()`
- `invoice.payment_failed` → update `status = 'failed'`, send email to business owner
- `invoice.voided` → update `status = 'void'`

---

### Stripe Setup

**Products and Prices to create (3 prices per currency):**

1. **AI Booking Fee (GBP)** — Metered price, £20 per unit, `usage_type: 'metered'`, `currency: 'gbp'`
2. **AI Booking Fee (USD)** — Metered price, $20 per unit, `usage_type: 'metered'`, `currency: 'usd'`
3. **AI Booking Fee (EUR)** — Metered price, €20 per unit, `usage_type: 'metered'`, `currency: 'eur'`

All three prices belong to a single Stripe Product: "Hey Elsie AI Receptionist".

**Monthly cap logic**: The cap is enforced on YOUR side, not Stripe's. When `total_amount >= 189`, you stop reporting usage records to Stripe. Stripe only bills what you report.

**Stripe Customer Portal**: Enable so customers can view invoices, update payment method, and download receipts. Configure at https://dashboard.stripe.com/settings/billing/portal.

**Store these in env vars:**
```
STRIPE_BOOKING_PRICE_GBP=price_xxx
STRIPE_BOOKING_PRICE_USD=price_xxx
STRIPE_BOOKING_PRICE_EUR=price_xxx
STRIPE_BILLING_WEBHOOK_SECRET=whsec_xxx
```

---

### Cron Jobs

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/billing/create-invoice",
      "schedule": "0 2 * * *"
    }
  ]
}
```

Runs daily at 2am UTC. The route must verify `CRON_SECRET` (same pattern as existing poll cron).

---

## Part 2: AI Takeover System (20-Minute Delay)

### How It Works

When a customer sends a message via WhatsApp, Instagram, or email:

1. Message arrives via Unipile webhook / polling → saved to `messages` table
2. A **takeover timer** starts: 20 minutes countdown
3. During those 20 minutes, the business owner can reply from their phone (WhatsApp, Instagram app, email). If they do, Elsie does nothing.
4. At the 20-minute mark, Elsie checks: "Has the business owner replied to this conversation since the customer's last message?"
5. If **yes** → cancel. Owner handled it.
6. If **no** → wait 30 more seconds (grace period for mid-typing), check again, then Elsie replies.

**Phone calls are different**: There is no delay. Call forwarding routes unanswered calls to Elsie's Twilio number after 15-30 seconds of ringing. Elsie answers the call live.

**After hours**: If a message arrives outside the business's set working hours, Elsie replies immediately (0 delay). No one is going to respond at 9pm.

### Database Changes

```sql
-- Track pending AI takeovers
CREATE TABLE ai_takeover_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) NOT NULL,
  conversation_id uuid REFERENCES conversations(id) NOT NULL,
  trigger_message_id uuid REFERENCES messages(id) NOT NULL,  -- the customer message that started the timer
  channel text NOT NULL,  -- 'whatsapp', 'instagram', 'email'

  -- Timing
  message_received_at timestamptz NOT NULL,
  takeover_at timestamptz NOT NULL,  -- message_received_at + 20 minutes (or 0 for after-hours)
  grace_checked_at timestamptz,      -- when the 30s grace period check happened

  -- Status
  status text DEFAULT 'pending' CHECK (status IN (
    'pending',           -- waiting for 20 min to pass
    'owner_replied',     -- owner replied before 20 min, cancelled
    'ai_replied',        -- Elsie took over and replied
    'cancelled',         -- cancelled for other reason (e.g. spam)
    'expired'            -- took too long to process, skipped
  )),

  owner_reply_message_id uuid REFERENCES messages(id),  -- if owner replied, which message
  ai_reply_message_id uuid REFERENCES messages(id),     -- if Elsie replied, which message

  created_at timestamptz DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX idx_takeover_pending ON ai_takeover_queue(status, takeover_at)
  WHERE status = 'pending';
CREATE INDEX idx_takeover_business ON ai_takeover_queue(business_id, conversation_id);
```

### API Routes

#### `POST /api/messages/queue-takeover`

**Called by the webhook/polling handler when a new INBOUND customer message arrives.**

Logic:
1. Receive: `{ business_id, conversation_id, message_id, channel, received_at }`
2. Check if there's already a pending takeover for this conversation → if yes, don't create a duplicate (the existing timer is enough — we respond to the latest message in the conversation)
3. Determine takeover delay:
   - Check business's working hours (stored in business settings)
   - If current time is outside working hours → `takeover_at = now()` (immediate)
   - If inside working hours → `takeover_at = received_at + 20 minutes`
4. Insert into `ai_takeover_queue` with `status = 'pending'`

#### `POST /api/messages/process-takeovers`

**Called by Vercel cron every 1 minute.**

Logic:
1. Find all rows in `ai_takeover_queue` where `status = 'pending'` AND `takeover_at <= now()`
2. For each:
   a. **Check if owner replied**: Query the `messages` table for this conversation — is there any outbound message sent by the owner (not AI) with `created_at > message_received_at`?
   b. If **owner replied**:
      - Set `status = 'owner_replied'`, `owner_reply_message_id`, `processed_at = now()`
      - Do nothing else
   c. If **owner did NOT reply**:
      - **Grace period**: If `grace_checked_at` is null, set `grace_checked_at = now()`, set `takeover_at = now() + 30 seconds`, and skip for now (will be picked up next cron run in ~1 min)
      - If `grace_checked_at` is set (we already waited the grace period):
        - Check AGAIN if owner replied in the last 30 seconds
        - If yes → mark `owner_replied`
        - If no → **trigger AI reply**:
          - Call the existing AI auto-reply logic (Claude Sonnet) to generate a response
          - Send via Unipile
          - Set `status = 'ai_replied'`, `ai_reply_message_id`, `processed_at = now()`
3. Also: expire any `pending` entries older than 2 hours (safety net for stuck items)

#### Collision Detection: Owner Replies Mid-AI-Response

The check for owner replies uses the `messages` table, which is populated by both:
- Unipile webhook/polling (captures messages the owner sends from their phone)
- The Hey Elsie app (if the owner replies from the dashboard)

Since Unipile connects via WhatsApp Web / Instagram API, it syncs messages sent from the owner's phone. So if the owner replies from their personal WhatsApp at minute 19, we'll see it in the messages table before the 20-minute mark.

**The 30-second grace period handles the edge case** where the owner is typing at minute 20. The cron checks at ~20:00, sees no reply, sets the grace period, then checks again at ~20:30-21:00. If the owner sent something in that window, Elsie backs off.

### Cron Setup

Add to `vercel.json`:
```json
{
  "path": "/api/messages/process-takeovers",
  "schedule": "* * * * *"
}
```

Runs every minute. The route must verify `CRON_SECRET`.

---

## Part 3: Daily Summary Notification

### One notification per day, sent at 8pm in the business's timezone.

**Do NOT send notifications every time Elsie replies.** That would be 10-20 notifications a day for a busy salon. Annoying.

### Template (sent via email — use Resend):

```
Subject: Elsie's daily report for [Business Name]

Hi [Owner First Name],

Here's what Elsie handled today:

📞 Calls answered: 4
💬 Messages replied to: 7
📅 Appointments booked: 2

[If bookings > 0:]
Bookings:
• Sarah W. — Cut & Blowdry — Thu 9 May, 10:00am (via WhatsApp)
• Mike T. — Beard Trim — Fri 10 May, 3:30pm (via phone)

Billing this month: £[amount] / £189 cap ([X] bookings)
[If cap reached:] You've hit your cap — everything is free until [date]!

View full details: https://app.heyelsie.com/billing

— Elsie
```

### Implementation

#### `POST /api/notifications/daily-summary`

**Called by Vercel cron at 8pm UTC (adjustable).**

Logic:
1. For each active business:
   - Count today's AI-answered calls (from `calls` table where answered_by = 'ai' and date = today)
   - Count today's AI-sent messages (from `messages` table where sender = 'ai' and date = today)
   - Count today's AI-booked appointments (from `booking_events` where date = today)
   - Get booking details (contact name, service, datetime, channel)
   - Get current billing period totals
2. Skip if all counts are 0 (don't send "Elsie did nothing today" emails)
3. Send via Resend to the business owner's email
4. Log the notification

Add to `vercel.json`:
```json
{
  "path": "/api/notifications/daily-summary",
  "schedule": "0 20 * * *"
}
```

---

## Part 4: Frontend — Customer Billing Dashboard

### New page: `/billing`

Add to the main app navigation. This is where business owners see what they owe and what Elsie has done.

#### Section 1: Current Period (hero card at top)

**Active billing:**
```
This month                              £140 / £189 cap
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━░░░░░░░  74%

7 appointments booked by Elsie
Billing period: 7 May – 6 Jun 2026
Next invoice: 6 Jun 2026
```

Progress bar: green < 50%, amber 50-80%, blue 80-100%.

**When cap reached:**
```
🎉 You've hit your monthly cap!

Elsie booked 10+ appointments this month.
Everything is free until 6 Jun 2026.

£189 / £189 cap — MAXED
```

#### Section 2: Booking List

Table showing every AI-booked appointment:

```
Date           Customer        Service          Channel     Amount
7 May, 14:32   Sarah Williams  Cut & Blowdry    WhatsApp    £20.00
7 May, 16:10   Mike Thompson   Beard Trim       Phone       £20.00
8 May, 09:45   Jane Davis      Colour & Cut     Instagram   £20.00
8 May, 11:20   Tom Harris      Full Colour       Email      £0.00 (cap reached)
```

- Filter by date range
- Filter by channel
- Show "(cap reached)" in grey when amount was £0 due to cap
- Clicking a row expands to show: conversation snippet, booking confirmation details

#### Section 3: Past Invoices

```
Period              Bookings   Total     Status
7 Apr – 6 May       12        £189.00   Paid ✓     [View Invoice]
7 Mar – 6 Apr        5        £100.00   Paid ✓     [View Invoice]
7 Feb – 6 Mar        0         £0.00    No charge  
```

- "View Invoice" links to Stripe hosted invoice
- Status badges: Paid (green), Pending (amber), Failed (red), No charge (grey)

#### Section 4: Payment Method

- Show current card (last 4 digits, brand, expiry)
- "Update payment method" button → opens Stripe Customer Portal
- Show next billing date

---

## Part 5: Frontend — Admin Billing Dashboard

### New page in Admin: `/admin/billing`

#### Overview Cards (top row)

| Card | Value |
|---|---|
| Total Revenue (this month) | Sum of all billing_periods.total_amount for current month |
| Active Customers | Count of businesses where billing_active = true |
| Avg Revenue per Customer | Total revenue / active customers |
| Customers at Cap | Count where cap_reached = true this period |
| Failed Payments | Count where status = 'failed' |
| Activation Rate | Count who paid £5 activation / total contracts sent |

#### Customer Table

```
Business           Currency  Bookings  This Month  Cap?   Status    Last Payment
Glow Salon         GBP       12        £189.00     Yes    Paid      6 May 2026
Dave's Plumbing    GBP        3        £60.00      No     Paid      6 May 2026
Bella Beauty       EUR        8        €160.00     No     Paid      3 May 2026
Smith Dental       USD       11        $189.00     Yes    Failed    —
New User           GBP        0        £0.00       No     New       —
```

- Click any row → drill into that business's full booking history
- Filter by: currency, cap status, payment status
- Sort by any column
- Red highlight on failed payments
- "View in Stripe" link per customer
- "View in Supabase" link per customer (admin only)

#### Revenue Chart

- Bar chart: monthly revenue over time
- Line overlay: number of bookings
- Split by currency (GBP/USD/EUR tabs or stacked)

---

## Part 6: Onboarding (Sales-Led, Not Self-Serve)

### Important: This is NOT a self-serve product

Business owners do NOT sign up themselves through a website form. The process is sales-led:

1. **Hugo (or sales team) has a sales call** with the business owner
2. During the call, Hugo asks: "Where do your customers contact you? Phone? WhatsApp? Instagram? Email?"
3. Hugo sends a **contract/service agreement** for the business owner to sign
4. After signing, the business owner pays the **£5 activation credit** (card captured via Stripe)
5. Hugo (or an automated onboarding flow) connects their channels and sets up Elsie

### The Onboarding Flow (After Contract + £5 Payment)

**Step 1: Create Account**
- Hugo creates the business account in the admin dashboard (or the business owner is sent a signup link)
- Business name, owner name, email, phone, business type
- Currency is auto-detected from IP at account creation time

**Step 2: Channel Selection**
- Based on what the business owner said during the sales call, connect ONLY the channels they need
- This saves Unipile seats (each connection = 1 Unipile account)

During sales call, Hugo identifies their channels. In the admin dashboard or onboarding flow:

Checkboxes:
- [ ] Phone calls (most common)
- [ ] WhatsApp
- [ ] Instagram DM
- [ ] Email
- [ ] Facebook Messenger

Pre-select based on business type:
- Hair Salon → Phone + WhatsApp + Instagram pre-checked
- Plumber → Phone + WhatsApp pre-checked
- Dental → Phone + Email pre-checked

Store selected channels in the business record:
```sql
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS active_channels text[] DEFAULT '{phone}';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS contract_signed_at timestamptz;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS activation_credit_paid boolean DEFAULT false;
```

**Step 3: Connect Channels**
- **Phone**: Set up call forwarding on their mobile (dial `**61*[ElsieNumber]*11*30#`)
- **WhatsApp**: Scan QR code via Unipile hosted auth
- **Instagram**: Connect via Unipile hosted auth (must be Business/Creator account)
- **Email**: OAuth connect Gmail/Outlook via Unipile

**Step 4: Teach Elsie**
- Business name, services offered, pricing, FAQs
- Opening hours (for after-hours instant AI mode)
- Google Calendar connected for booking
- Greeting message and tone preferences

**Step 5: Test**
- Make a test call to verify Elsie answers correctly
- Send a test WhatsApp message (if connected)
- Verify booking flow works end-to-end

**Step 6: Go Live**
- Elsie starts handling real calls and messages
- Business owner can see everything in their dashboard
- First booking → £5 activation credit applied

### No Free Trial

There is no free trial. The sales-led process replaces it:
- The sales call builds trust and qualifies the lead
- The contract creates commitment
- The £5 activation credit captures the card and gives skin in the game
- The "first booking is £5" framing makes the activation feel like a deal, not a cost
- If the business owner doesn't get any bookings in the first month, they've only spent £5 — that IS the trial

---

## Part 7: Edge Cases

1. **Business connects channels but gets no enquiries** — No bookings = no charge. But Unipile costs you ~£4-13/mo per customer. After 90 days of zero bookings, auto-disconnect Unipile and email: "Elsie hasn't received any enquiries. We've paused your channels to save resources. Reconnect anytime from your dashboard."

2. **AI answers a call but doesn't book** — Free. The business benefits (customer got an answer, info given, message taken) but Hey Elsie doesn't charge because no booking was made.

3. **AI sends messages but doesn't book** — Free. Same logic. Only bookings are billable.

4. **Spam calls/messages** — If AI identifies spam, it doesn't engage meaningfully. No booking = no charge.

5. **Business owner books manually** — Not charged. Only AI-created calendar events trigger billing.

6. **AI books an appointment but customer cancels** — Still charged. The booking was made; the cancellation is between the business and their customer. (Note: if this becomes a complaint, we can add a dispute process later.)

7. **Two bookings happen simultaneously** — The cap check must be atomic. Use a Supabase transaction or database-level locking to prevent double-charging over the cap.

8. **Activation credit and first invoice** — The £5 credit is applied automatically by Stripe's customer balance system. If the first month has 0 bookings, the £5 credit rolls forward to the next month. It never expires.

9. **Payment fails** — Retry via Stripe (automatic retries). After 3 failures: email the owner, show in-app banner, but DON'T stop Elsie from working. A business losing leads because of a failed credit card is worse for retention than absorbing a few unbilled bookings. Pause Elsie only after 14 days of failed payments.

10. **Mid-cycle cancellation** — Charge for bookings made up to cancellation date. Create final invoice immediately.

11. **Currency detection fails (no IP data)** — Default to USD.

12. **Owner replies at minute 19:30, AI fires at minute 20** — The 30-second grace period catches this. The cron at minute 20 sets the grace flag, then at minute ~21 checks again and sees the owner's reply. Elsie backs off.

13. **Multiple customer messages in quick succession** — Only one takeover timer per conversation. If a customer sends 5 messages in 2 minutes, one timer covers all of them. Elsie responds to the full conversation thread, not individual messages.

---

## Environment Variables Needed

Add to `.env` and Vercel:
```
STRIPE_BOOKING_PRICE_GBP=price_xxx      # Created in Stripe setup
STRIPE_BOOKING_PRICE_USD=price_xxx      # Created in Stripe setup
STRIPE_BOOKING_PRICE_EUR=price_xxx      # Created in Stripe setup
STRIPE_BILLING_WEBHOOK_SECRET=whsec_xxx  # From Stripe webhook setup
```

Existing vars already in place: `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `CRON_SECRET`.

---

## Vercel Cron Summary

Add these to the existing `crons` array in `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/messages/poll", "schedule": "* * * * *" },
    { "path": "/api/messages/process-takeovers", "schedule": "* * * * *" },
    { "path": "/api/billing/create-invoice", "schedule": "0 2 * * *" },
    { "path": "/api/notifications/daily-summary", "schedule": "0 20 * * *" }
  ]
}
```

| Cron | Frequency | What it does |
|---|---|---|
| poll | Every minute | Existing: poll Unipile for new messages |
| process-takeovers | Every minute | Check pending AI takeovers, fire if 20 min passed |
| create-invoice | Daily 2am UTC | Invoice completed billing periods via Stripe |
| daily-summary | Daily 8pm UTC | Send daily report email to business owners |

---

## Implementation Order

Build in this sequence to keep things testable at each step:

1. **Database migration** — Run the SQL above. Add columns to businesses table.
2. **Currency detection** — Utility function + set currency at signup.
3. **AI takeover queue** — New table, queue-takeover route, process-takeovers cron. Test: send a WhatsApp message, wait 20 min, verify AI replies. Send another, reply as owner within 20 min, verify AI stays silent.
4. **Billing recording** — record-booking route, called from booking creation logic. Test: AI books appointment, verify booking_event and billing_period update.
5. **Stripe setup** — Create product/prices, activate route, webhook handler. Test: add card, verify Stripe customer created, verify invoice generation.
6. **Customer billing page** — React page showing current period, bookings, history, payment method.
7. **Admin billing page** — Admin page showing all customers, revenue, failed payments.
8. **Daily summary** — Cron + Resend email. Test: verify email arrives with correct counts.
9. **Contract + activation flow** — £5 payment page, Stripe customer balance credit, activation confirmation email.
10. **Onboarding channel selection** — Checkboxes, pre-selection by business type, store in DB.

---

## DO NOT

- Do NOT revert, reformat, or overwrite existing styles unless this task explicitly requires it
- Do NOT touch `vite.config.ts` without asking Hugo first
- Do NOT hardcode any API keys — use environment variables
- Do NOT add features beyond what is described in this prompt
- Do NOT use `sed` to edit .tsx/.ts files — use proper edit tools
- Do NOT charge for anything other than AI-booked appointments
- Do NOT send per-event notifications — only the daily summary
- Do NOT block calls/messages/bookings if billing recording fails
- Run `npx tsc --noEmit && npx vitest run` before committing
