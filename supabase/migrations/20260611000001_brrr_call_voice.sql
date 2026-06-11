-- Voice A/B test: which agent voice made each qualifier call
ALTER TABLE brrr_property_calls ADD COLUMN IF NOT EXISTS voice text;
