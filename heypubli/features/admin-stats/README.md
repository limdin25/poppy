# admin-stats

Hugo's numbers page at `/admin/stats`. Every creator, their followers, growth,
views, likes and reach, filterable by creator and sortable by any of them, plus
every video that has actually gone out with a link to the live post.

**Views are per ACCOUNT, not per video.** Outstand has no per-post metrics
endpoint and the post payload carries no counts, so a per-video view count does
not exist to be shown. The page says this in as many words rather than letting
the number be misread.

**Growth is derived, not reported.** No API returns "followers gained". It is the
difference between two readings of `creator_metrics_snapshots`, captured at
07:00 and 20:00 by `/api/cron/accounts-digest`. A creator with one reading shows
"not measured yet", never "0", because zero would read as flat.
