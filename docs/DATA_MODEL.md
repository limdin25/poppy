# Data Model

All tables live in Supabase (Postgres). UUIDs throughout, `created_at` defaults to `now()`.

---

## Tables

### 1. businesses

Primary table. One row per registered business.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| owner_id | uuid FK auth.users | |
| name | text | |
| phone | text | |
| email | text | |
| website | text | |
| address | text | |
| industry | text | |
| description | text | |
| greeting_message | text | |
| voice_id | text | Default `'alloy'` |
| behaviour_prompt | text | |
| training_data | jsonb | |
| plan | text | Default `'trial'` |
| billing_state | text | Default `'trial_active'` |
| stripe_customer_id | text | |
| stripe_subscription_id | text | |
| trial_ends_at | timestamptz | |
| onboarding_completed | bool | |
| created_at | timestamptz | |

### 2. channels

Communication channels connected to a business.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK businesses | |
| type | text | `'voice'` \| `'whatsapp'` \| `'sms'` \| `'email'` |
| provider | text | `'twilio'` \| `'unipile'` |
| provider_channel_id | text | |
| phone_number | text | |
| email_address | text | |
| status | text | |
| config | jsonb | |
| created_at | timestamptz | |

### 3. contacts

CRM-lite contact records per business.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK businesses | |
| name | text | |
| phone | text | |
| email | text | |
| notes | text | |
| tags | text[] | |
| last_contact_at | timestamptz | |
| created_at | timestamptz | |

**Constraint:** `UNIQUE(business_id, phone)`

### 4. conversations

Groups messages/calls into threads.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK businesses | |
| contact_id | uuid FK contacts | |
| channel_id | uuid FK channels | |
| channel_type | text | |
| status | text | `'open'` \| `'closed'` \| `'archived'` |
| subject | text | |
| last_message_at | timestamptz | |
| unread_count | int | |
| assigned_to | uuid | |
| created_at | timestamptz | |

### 5. messages

Individual messages within a conversation.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| conversation_id | uuid FK conversations | |
| direction | text | `'inbound'` \| `'outbound'` |
| content | text | |
| content_type | text | `'text'` \| `'audio'` \| `'image'` \| `'document'` |
| sent_by | text | `'ai'` \| `'human'` \| `'system'` \| `'contact'` |
| provider_message_id | text | |
| metadata | jsonb | |
| created_at | timestamptz | |

### 6. calls

Voice call records with Retell AI data.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK businesses | |
| conversation_id | uuid FK conversations | |
| contact_id | uuid FK contacts | |
| channel_id | uuid FK channels | |
| retell_call_id | text | UNIQUE |
| direction | text | |
| status | text | |
| duration_seconds | int | |
| recording_url | text | |
| transcript | jsonb | |
| summary | text | |
| sentiment | text | |
| outcome | text | |
| started_at | timestamptz | |
| ended_at | timestamptz | |
| created_at | timestamptz | |

### 7. services

Services a business offers (for booking/quoting).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK businesses | |
| name | text | |
| description | text | |
| price_cents | int | |
| duration_minutes | int | |
| is_active | bool | |
| order_index | int | |
| created_at | timestamptz | |

### 8. faqs

Business-specific FAQ pairs the AI uses to answer questions.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK businesses | |
| question | text | |
| answer | text | |
| order_index | int | |
| created_at | timestamptz | |

### 9. call_info_types

Custom fields the AI should extract during calls.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK businesses | |
| label | text | |
| type | text | `'text'` \| `'number'` \| `'date'` \| `'boolean'` |
| required | bool | |
| order_index | int | |
| created_at | timestamptz | |

### 10. appointments

Bookings created by the AI or manually.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK businesses | |
| contact_id | uuid FK contacts | |
| service_id | uuid FK services | |
| call_id | uuid FK calls | |
| status | text | |
| scheduled_at | timestamptz | |
| duration_minutes | int | |
| notes | text | |
| cal_event_id | text | |
| created_at | timestamptz | |

### 11. quotes

Quotes generated after calls.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK businesses | |
| contact_id | uuid FK contacts | |
| call_id | uuid FK calls | |
| quote_number | text | UNIQUE |
| items | jsonb | |
| subtotal_cents | int | |
| tax_cents | int | |
| total_cents | int | |
| status | text | |
| valid_until | timestamptz | |
| pdf_url | text | |
| sent_at | timestamptz | |
| created_at | timestamptz | |

### 12. invoices

Invoices derived from quotes or created standalone.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK businesses | |
| contact_id | uuid FK contacts | |
| quote_id | uuid FK quotes | |
| invoice_number | text | UNIQUE |
| items | jsonb | |
| subtotal_cents | int | |
| tax_cents | int | |
| total_cents | int | |
| status | text | |
| due_date | date | |
| paid_at | timestamptz | |
| stripe_payment_link | text | |
| pdf_url | text | |
| created_at | timestamptz | |

### 13. notification_settings

Per-user notification preferences.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK businesses | |
| user_id | uuid FK auth.users | |
| missed_calls | bool | |
| new_messages | bool | |
| appointments | bool | |
| daily_summary | bool | |
| channel | text | `'email'` \| `'sms'` \| `'push'` |
| created_at | timestamptz | |

### 14. team_members

Multi-user access per business.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK businesses | |
| user_id | uuid FK auth.users | |
| role | text | `'owner'` \| `'admin'` \| `'member'` |
| name | text | |
| email | text | |
| phone | text | |
| created_at | timestamptz | |

---

## WhatsApp Data Flow Through Tables

When a WhatsApp message arrives, the tables interact as follows:

1. **channels** — The business must have a row with `type='whatsapp'`, `provider='unipile'`, `status='connected'`. The `provider_channel_id` field is not used; instead the channel is matched by `unipile_account_id` stored in `config` or a dedicated column (added during connect flow). The webhook uses `business_id` from the channel to scope all downstream writes.

2. **contacts** — Upserted by phone number (E.164 format) scoped to `business_id`. The `whatsapp` field is set to `true`. If the contact doesn't exist, one is created with `name` set to the phone number initially.

3. **conversations** — Looked up by `contact_id` + `channel_type='whatsapp'` + `status='open'`. If none exists, a new one is created linked to both the contact and the channel. The `ai_handling` field controls whether auto-reply is enabled. `last_message_at` and `unread_count` are updated on each inbound message.

4. **messages** — Each message is stored with:
   - `direction`: `'inbound'` or `'outbound'`
   - `sent_by`: `'contact'` (inbound), `'ai'` (auto-reply), or `'human'` (manual reply)
   - `content`: message body text
   - `metadata`: `{ "external_id": "<unipile_message_id>" }` — used for deduplication by the polling fallback

### Deduplication

The polling endpoint (`/api/messages/poll`) checks `metadata->>'external_id'` before inserting. If a message with that external_id already exists in the conversation, it's skipped. This prevents duplicates when both webhook and polling capture the same message.

---

## Row Level Security (RLS)

Every table has RLS enabled. Access is controlled via a helper function:

```sql
CREATE OR REPLACE FUNCTION user_business_ids()
RETURNS SETOF uuid AS $$
  SELECT business_id FROM team_members WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

Every table policy follows the same pattern:

```sql
CREATE POLICY "Users can access own business data"
  ON <table>
  FOR ALL
  USING (business_id IN (SELECT user_business_ids()));
```

This ensures users only see data belonging to businesses they are a member of.

---

## Realtime

Supabase Realtime is enabled on:

- **conversations** — live updates when new conversations arrive or status changes
- **messages** — instant message delivery in the inbox
- **calls** — live call status updates on the dashboard
