-- Step 2 of /brochure could never be completed, and the copy promised it would.
--
-- It said "this ticks itself the moment Skool tells us you are in, so there is
-- nobody to email". Skool never tells us. Its Zapier app has exactly two
-- triggers, "Answered Membership Questions" and "New Paid Member", and there is
-- no trigger at all for a free member joining. Our creators join FREE, on an
-- invite, so the one event that would tick this step does not exist.
--
-- Worse, until 2026-08-06 the step ticked green for the wrong reason: the old
-- Zapier callback wrote a skool_members row the moment an invite was SENT, so
-- somebody who never opened the email was told they had finished. That was
-- fixed by making isCommunityMember() count only a real paid membership, which
-- left this step permanently stuck instead of permanently wrong.
--
-- So it becomes self-declared, exactly like bio_link_declared_at. Hugo, 2026-08-06:
-- "we force them to check their email for the school, and then let me know when
-- you have joined". Kept in its own column so nobody later mistakes a creator's
-- word for a verified fact: a paid membership still ticks it on its own, and
-- this column is the free-invite path.

alter table public.profiles
  add column if not exists community_joined_declared_at timestamptz;

comment on column public.profiles.community_joined_declared_at is
  'Creator said they joined the Skool community. Self-declared on purpose: Skool has no trigger for a free member joining, so this is the only signal that exists.';
