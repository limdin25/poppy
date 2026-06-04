-- Lets the owner hand-write the COMPLETE voice/chat prompt. When set, sync-prompt
-- pushes this verbatim to Retell instead of the auto-generated prompt. Null =
-- auto-generate from greeting/services/FAQs/etc (the default).
ALTER TABLE agents ADD COLUMN IF NOT EXISTS full_prompt_override text;
