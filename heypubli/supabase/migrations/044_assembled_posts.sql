-- Every post gets its own file, assembled just before it goes out.
--
-- The shape of a post is now three pieces:
--   [ 5s blurred opening, three beats of text ]  unique per post
--   [ the account's body render                ]  built once per master x account
--   [ one of 640 end cards                     ]  picked per post
--
-- Only the middle piece is expensive, and it is built once and reused forever.
-- The two ends are cheap and are what make every post a different file.
--
-- WHY media_url IS LEFT ALONE UNTIL THE ASSEMBLY SUCCEEDS. The conductor still
-- writes the plain body render into media_url exactly as it does today, and the
-- assembler OVERWRITES it once it has something better. So if the worker is
-- down, out of disk, or halfway through a deploy, the machine keeps posting the
-- plain version instead of posting nothing. A pipeline that degrades is worth
-- far more than one that stops.

alter table scheduled_posts
  -- the finished file, and when it was made. null means "not assembled yet",
  -- which is a normal state for a post scheduled minutes from now.
  add column if not exists assembled_url  text,
  add column if not exists assembled_at   timestamptz,
  -- what went into it, so any post can be traced back to its ingredients and
  -- a bad opening can be found rather than guessed at
  add column if not exists hook_id        uuid references hook_lines (id),
  add column if not exists card_file      text,
  add column if not exists blur_clip      text,
  add column if not exists blur_at        numeric(6, 2),
  -- set once the file has been posted AND deleted from storage, so the janitor
  -- never has to ask storage what it already knows
  add column if not exists assembled_purged_at timestamptz;

-- The assembler's work queue: posts going out soon that have no file yet. This
-- is the query it runs on every tick, so it gets its own index.
create index if not exists scheduled_posts_needing_assembly
  on scheduled_posts (scheduled_at)
  where assembled_url is null and status = 'scheduled' and master_video_id is not null;

-- The janitor's queue: published posts whose file is still taking up disk.
-- At 3,700 posts a day and 15MB a file that is 55GB a day, so this is not
-- housekeeping, it is the difference between the server working and not.
create index if not exists scheduled_posts_purgeable
  on scheduled_posts (published_at)
  where assembled_url is not null and assembled_purged_at is null and status = 'published';
