# admin-videos

Hugo's authorization page for the creator video pipeline (`/admin/videos`).
Built 07 Aug 2026 from his spec: "show me a place where it shows the video and
which accounts gonna go for and for me to authorize... give me a place where I
can upload them... it should show us when I approve what time is gonna be
released."

- The **sequence**: every master video in order, with its preview player, its
  caption, and the APPROVE button. Approval is the only gate; the cron
  (`/api/cron/video-pipeline`) and the Mac render worker do everything else.
- The **captions**, one per account, printed under the account inside "Approving
  sends this to N accounts". Hugo, 08 Aug 2026: "missing the caption so I can
  approve." Each is the machine caption for that account plus its own 1 to 4
  hashtags drawn from Hugo's list, composed by `composeCaption()`, the same
  function the cron writes into `scheduled_posts.caption`. Once a post exists,
  the page shows the frozen text off the post row instead, so what he reads is
  always what goes out. Typing in the master's caption box overrides the words
  for everybody; writing a `#` in it also takes the hashtags off the machine.
- The **accounts**: every connected Instagram account, its permanent color
  (one of the variants factory's 14 palette families), and its next two
  release times (11:00/19:00 local + a per-account stagger so no two accounts
  post at the same moment).
- The **worker pulse**: the Mac render worker heartbeats
  `video_pipeline_state`; the page says plainly when it has gone quiet.

Data: `lib/data/video-pipeline-admin.ts`. Actions:
`lib/actions/video-pipeline.ts`. Pure rules + tests:
`lib/data/video-pipeline.ts`.
