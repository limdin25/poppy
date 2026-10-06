# Reviewed report follow-ups

Authorised by Hugo on 6 October 2026. Migration:
`20261006000004_reviewed_report_followups.sql`.

The old `sa_report_followups` sequence tracked manual SMS reminders. It did not
have a sender cron, an email sequence or individual saved drafts. Its standard
waits were 24 hours, then 48 hours, then 120 hours: days 1, 3 and 8.

Both report composers now open the same review before sending. The default
sequence uses the report's selected channel and fills in the lead, property and
report link. Pedro can edit each message, email subject and London time, switch
individual steps off, or skip all. Send report saves the reviewed plan before
contacting the provider and arms it only after a confirmed report submission.
The contact card and the report follow-ups page use the same editor afterwards.
Sending another property or channel does not create a second sequence for the
person. Already sent steps stay sent. Existing legacy sequences are not armed
by this migration.

Each item has a unique `(contact_id, step_key)`, saved recipient, exact content,
London timezone, due instant and edit version. Normal states are scheduled,
edited, skipped, sent and cancelled. Sending and check_inbox record interrupted
or uncertain requests without retrying them. A minute cron calls the existing
SMS/email senders through a narrow internal doorway that accepts only an item
ID and loads the saved message. The final database claim is immediately before
the provider call. Concurrent senders, stale edits and the legacy manual sender
cannot claim that item again. Resend also receives a per-item idempotency key.

Database triggers stop remaining messages on an inbound SMS/email/call,
recorded conversation, callback booking, opt-out or closed stage. Interested
offers a small stop prompt if there is no booking; bookings, Onboarded,
Preparing to onboard, Not interested and Do not contact stop automatically.
Cancellation is retained on the sequence, so completing a callback or moving
the stage back cannot silently restart it. Sent/provider-accepted messages
cannot be recalled. No automated follow-up is submitted outside 09:00 to
19:59 London time. New or edited enabled dates must be in the future. UTC
instants are stored alongside the fixed Europe/London timezone.

Verification:

- Pure schedule tests cover defaults, edits, skips, night/past dates and BST/GMT.
- Local PostgreSQL tests exercise real save/cancel triggers and concurrent claims.
- Both real edge handlers run against fake providers for exact content, stops,
  simultaneous dispatch and ambiguous timeout tests.
- Browser tests run with the laptop timezone set to Manila and check the London
  pickers, Enter/Escape, switches, skip-all, focus trap and laptop/mobile layout.

Run browser checks with
`PW_BROWSER_CHANNEL=chrome node_modules/.bin/playwright test -c tests/e2e/report-followups.config.ts`.
Database tests use `PHONE_TEST_DATABASE_URL` and reject non-local hosts.

The deployed sender functions are `wk-sms-send` and `wk-email-send`; the cron is
`/api/cron/hostunico-followups`. General SA scheduled SMS and AI reply automation
remain disabled. No real lead is used for release tests.
