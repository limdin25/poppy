-- Allow multiple channels of the same type per business
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_business_id_type_key;

-- Add channel limits to businesses (default 1 each)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS channel_limits JSONB DEFAULT '{"whatsapp": 1, "email": 1, "sms": 1, "voice": 1, "instagram": 1}';
