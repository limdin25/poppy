-- Training goes round twice, and Hugo can see every answer and how long it took.
--
-- Hugo, 2026-08-10: "let make another one for him to watch all again plus your
-- recomendations and do a new test... make sure all recoreded for admin, time
-- spent on each answer etc.. add all questions needed, also anythng else
-- needed, and things he done wrong today, like make question to see if he
-- improves based on report".
--
-- WHY A ROUND COLUMN IS NOT OPTIONAL. Without one, Pedro sits the round-two
-- test having re-watched nothing, because five separate mechanisms all read the
-- same row and all say "already done":
--   * training_video_progress is UNIQUE (trainee_key, video_key), one row per
--     person per video, for ever;
--   * quizUnlocked() reads those rows, and his say 100%, so the gate is already
--     open before he has loaded the page;
--   * watched_sec is Math.max(previous, claim), monotone by design, so progress
--     cannot be written backwards;
--   * completed_at is sticky and never clears, so the tick stays lit;
--   * the YouTube player seeds itself from the server's pct and posts nothing
--     on a re-watch.
-- Every one of those is a read of a row this column now scopes.
--
-- Deliberately NOT solved by deleting his round-one rows. That would erase the
-- record of what he actually watched, and tests/training-answer-key.test.ts
-- pins that api/pedro-training/progress.ts contains no .delete() at all.

alter table public.training_video_progress
  add column if not exists round int not null default 1;

alter table public.training_quiz_attempts
  add column if not exists round int not null default 1;

-- The unique key moves so a round-two re-watch INSERTS a new row instead of
-- colliding with (and overwriting) the round-one record of the same video.
alter table public.training_video_progress
  drop constraint if exists training_video_progress_trainee_key_video_key_key;

do $$ begin
  alter table public.training_video_progress
    add constraint training_video_progress_trainee_round_video_key
    unique (trainee_key, round, video_key);
exception when duplicate_table or duplicate_object then null;
end $$;

create index if not exists training_quiz_attempts_round_idx
  on public.training_quiz_attempts (trainee_key, round, started_at desc);

-- Per-question analytics. The whole test is exactly two POSTs (start, submit),
-- so the seconds ride in the submit payload as a parallel array rather than
-- adding twenty round trips to a timed exam. That is client-supplied, and it
-- follows the precedent already set by the attempt's own duration_sec; the
-- server still grades against the questions IT served and never trusts the
-- client for correctness.
comment on column public.training_quiz_attempts.results is
  'Per question: id, prompt, kind, given, answered, correct, correctAnswer, explanation, plus seconds (how long that question took) and position (the order it was shown). Rendered on /admin/training.';

comment on column public.training_video_progress.round is
  'Which training round this row belongs to. 1 is the original. A new round starts every video unwatched and the quiz locked again.';
