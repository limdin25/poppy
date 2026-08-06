-- Migration 017: allow one Instagram (Outstand) account to map to several influencer
-- profiles.
--
-- Migration 007 made outstand_social_account_id unique to keep returning-user login
-- unambiguous. Since then, login matches by the stable ig_user_id / ig_username (016),
-- NOT by the social-account id, so that uniqueness is no longer needed for login.
--
-- It now actively breaks a real case: a person who fills in the /cadastro form is
-- explicitly creating a NEW influencer. They must get their own account even if they
-- connect an Instagram handle that another profile already uses (common while testing,
-- and harmless in production where each influencer has a distinct handle). The unique
-- index blocked the second connection row, so the signup silently failed and the new
-- account never appeared for the admin.
--
-- Drop the unique index. The plain lookup index idx_outstand_connections_social_account
-- (created in 006) stays, so by-account lookups remain fast.

drop index if exists public.uq_outstand_connections_social_account;
