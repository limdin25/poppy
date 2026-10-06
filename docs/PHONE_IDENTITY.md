# CRM phone identity, 6 October 2026

The phone is one identity across campaigns, owners and desks. Migration
`20261006000003_phone_identity_and_cooldown.sql` is the authority.

- `wk_normalize_phone` maps UK local, country-code, spaces, dashes, 00 and
  optional (0) formats to E.164. Email-only identities remain non-dialable.
- `wk_contacts.normalized_phone` is generated and globally unique. New imports
  reuse the original contact ID, including after 30 days.
- `wk_phone_registry` serializes simultaneous imports and reservations. Its
  admission timestamp cannot be reset by a caller's `created_at`. A new lead
  can be admitted again after 30 days only while the contact is open. Repeated
  inputs during the cooldown do not extend it. Do not contact is permanent,
  including alternate report mobiles and deleted contacts.
- `wk_ingest_contacts` accepts one object or an array. It returns the canonical
  contact and attaches additional property details as timeline notes. Existing
  owner, stage and desk are preserved. Exact repeated details do not spam notes.
- Table triggers also guard direct inserts, upserts and phone/status updates.
  The queue has a unique active-phone index for pending, dialing, connected
  review rows and report qualification holds. New reservations use the cooldown; retry transitions on
  the existing row and due, explicitly scheduled call follow-ups remain valid.
- Report qualification holds and the worked-stage picker fix remain in place.
  A held row cannot create a second reservation.

All 27 JavaScript/TypeScript contact creation sites use the RPC: manual add,
queue manager, CSV upload, phone-validation import, booking/Retell handlers,
builder/operations helpers, agent/trade/property/auction/SA scripts and the
five checked-in inbound/partner edge functions. The Python city/report import
also uses it. The report API updates contacts rather than creating them; its
alternate mobile is guarded too. The live SQL writer `wk_apply_outcome` inserts
queue rows and is covered by the table trigger. Historical migrations retain
their original text. No contact or queue writers were found in openrent-worker.
The disabled VPS `sa-overnight` copy is updated without enabling its timer.

The cleanup records every original contact and linked row in the private
`wk_contact_merge_archive`, moves all foreign-key history to the oldest ID,
and carries forward the strongest closed/DNC stage. Its desk follows that
stage so the card stays on the correct board. Conflicting singleton workflow
states are preserved as timeline notes and archive rows. Call records and call
follow-ups move intact. Call fingerprints are checked before committing, and
an active call on a duplicate prevents the merge until that call ends.

Read-only audit: `scripts/audit-phone-duplicates.mjs` accepts a management token
from `SUPABASE_ACCESS_TOKEN` and a private `--out` file. It prints counts only.
Full before/after phone reports are local, excluded from deployment and Git.
The committed audit lists masked numbers and contact IDs.

Tests: `tests/phone-identity.test.ts`, `tests/sql/phone-dedupe.sql` and the local
fixture. Set `PHONE_TEST_DATABASE_URL` to a local PostgreSQL admin database to
run the real migration, preservation checks and two-connection race tests.
The test rejects remote hosts and creates its own disposable database. Normal
Vitest runs still check the table guards and CSV preservation contract.
