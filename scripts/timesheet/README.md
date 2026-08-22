# Pedro's weekly timesheet, how to regenerate

The page lives at https://heyelsie.com/timesheet (public, noindex). The HTML is
generated here and baked into `api/lib/timesheet-html.ts`.

Three steps, in order.

1. Pull the week's calls out of Supabase into `pedro-calls.json`:

```bash
PGPASSWORD='<db password>' psql "postgresql://postgres.loggyxryrhqsbtqpteog@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" -At -c "
select json_agg(row_to_json(t)) from (
  select k.id, k.started_at, k.answered_at, k.duration_sec, k.status, k.direction, k.script_key,
         c.name as disposition, k.contact_id
  from wk_calls k left join wk_pipeline_columns c on c.id=k.disposition_column_id
  where k.agent_id='6b26172e-d98d-4cc4-9e22-b3b4e24624ee'
    and k.started_at >= '<monday of last week>' and k.started_at < '<saturday>'
  order by k.started_at) t;" > pedro-calls.json
```

2. `node compute.mjs` writes `days.json` and prints the daily hours.
3. Edit the week dates, the per-day notes and the hand-counted figures at the top
   of `gen-timesheet.mjs`, then run it. It writes `api/lib/timesheet-html.ts` and
   a local `preview.html`, and **exits non-zero if a long dash, curly quote or
   ellipsis appears anywhere in the page**.

## The counting rules (Hugo's, not defaults)

- The working day = first call to last call. No office clock.
- Call end is `started_at + duration_sec`, **never `ended_at`**. Some rows carry a
  bogus rounded-hour `ended_at` that hides real idle gaps.
- Gaps under 10 minutes count as work. Gaps over 10 minutes are idle.
- 1 hour of break free per day, added back. Only idle beyond that comes off.
- A day with zero calls is not paid.
- Rate $2.50/hr (40 hours for $100). Total rounded up in Pedro's favour.
- Any extra paid break Hugo grants that week is added on top and stated on the
  page in plain words, so Pedro can see exactly what was given and why.

Pedro dials as `pedro@hostunico.com`, profile `6b26172e-d98d-4cc4-9e22-b3b4e24624ee`.
`wk_sms_messages` has no `agent_id`, the agent is `created_by`.
