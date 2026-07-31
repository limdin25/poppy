-- Curated voice seeding. The first voice is the reference the calling bridge
-- has PROVEN on live phone calls (bridge/config.py FISH_VOICE default).
-- More curated voices are added by inserting rows here as they are vetted;
-- preview_path files land in ugc-renders/curated/ rendered once by hand.

insert into public.ugc_voices (provider_voice_id, name, kind, preview_path)
values ('a4c68282850b4568bc92749fa2c16815', 'Maria', 'curated', null)
on conflict do nothing;
