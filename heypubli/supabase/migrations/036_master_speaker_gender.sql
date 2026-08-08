-- The speaker's gender for each master video, set by hand at upload.
--
-- The render pipeline swaps the voice per account so that 100 copies of one
-- clip do not all carry the identical performance. Choosing that replacement
-- voice needs to know whether the person on screen is a man or a woman, and
-- putting a woman's voice on a man is a ruined asset that may go out publicly.
--
-- It is DATA, never inferred. Pitch detection was built and tested against real
-- samples and got it wrong in both directions: a male clip read as female at
-- 178 Hz, and two known-female clips read as male at 123 and 111 Hz. So the
-- column is nullable and null means SKIP the swap and ship the original audio,
-- which is a non-event, rather than guess.
alter table master_videos
  add column if not exists speaker_gender text
  check (speaker_gender in ('female', 'male'));

comment on column master_videos.speaker_gender is
  'female | male, set by hand at upload. NULL means skip the voice swap and use the original audio. Never inferred from the audio.';

-- The five masters that predate the column. Hugo, 08 Aug 2026, asked directly:
-- "they are all female... those videos are all females."
update master_videos
   set speaker_gender = 'female'
 where speaker_gender is null;
