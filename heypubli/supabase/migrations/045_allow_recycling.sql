-- Recycling requires an account to post the same master more than once.
--
-- idx_sp_master_profile was UNIQUE on (master_video_id, profile_id): one post
-- per master per account, ever. That was correct when the library was a line
-- played once. It is fatal now: with 11 masters it caps every account at 11
-- posts for life, so a dial set to 10 a day would work for exactly one day and
-- then fail every insert forever, silently, as a duplicate-key error the
-- conductor is written to treat as "already scheduled, move on".
--
-- Hugo, 26 Aug 2026: "we're gonna be reusing the nine master clips in circles."
-- The circle cannot turn while this index exists.
--
-- It is replaced by a NON-unique index, because the lookup it supported is
-- still worth having; only the uniqueness has to go.
drop index if exists idx_sp_master_profile;

create index if not exists idx_sp_master_profile
  on scheduled_posts (master_video_id, profile_id)
  where master_video_id is not null;
