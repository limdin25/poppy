-- Per-call AI cost (Retell combined cost, USD). Twilio carrier charges billed separately.
alter table public.brrr_property_calls add column if not exists cost_usd numeric(8,4);
