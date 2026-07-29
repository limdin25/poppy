-- Fish Audio voice settings for the AI caller, editable from
-- /admin/crm/agent/fish.
--
-- A separate column rather than a key inside voice_config on purpose:
-- voice_config is read wholesale by the Retell sync on the Call behaviour page,
-- and burying unrelated settings in there is how you end up sending Fish
-- parameters to Retell.
--
-- Shape (all optional, the bridge falls back to its own defaults):
--   {
--     "voice_id":    "32e344f53f114cfcbb7ed086f10f2403",
--     "model":       "s2.1-pro-free",
--     "speed":       1.15,     -- 0.5 to 2.0
--     "volume":      6,        -- library voices land ~-23 dBFS, a line wants ~-17
--     "temperature": 0.7,      -- 0 to 1, higher is more expressive
--     "top_p":       0.7,
--     "chunk_length": 120,     -- 100 to 300, smaller starts sooner
--     "emotions_enabled": true,
--     "allowed_emotions": ["warm","curious","calm"],
--     "system_prompt": "...",  -- overrides the built-in caller prompt
--     "opener": "..."          -- overrides the built-in opener
--   }

alter table public.wk_agent_channel_settings
  add column if not exists fish_config jsonb not null default '{}'::jsonb;

comment on column public.wk_agent_channel_settings.fish_config is
  'Fish Audio voice + prompt settings for the outbound AI caller (bridge/). Edited at /admin/crm/agent/fish.';
