-- Add 'video' to the content_type check constraint on messages
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_content_type_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN ('text','audio','image','video','file','call_summary'));
