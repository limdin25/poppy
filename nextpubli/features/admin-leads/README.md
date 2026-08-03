# admin-leads

The admin **Signups** table at `/admin/leads`.

Everyone who finished the three questions on `/signup` lands here, whether or not they
went on to connect Instagram. That second group is the point: before `signup_leads`
existed their name, email and mobile only ever lived in a one-hour httpOnly cookie, so an
abandoned signup left nothing behind at all.

## Public API

- `AdminLeads`: `<AdminLeads leads={...} />`
- `adminLeadsCopy`

## How a row gets here

| Stage               | Written by                                    | Means                                        |
| ------------------- | --------------------------------------------- | -------------------------------------------- |
| `started`           | `POST /api/signup/lead`, from the wizard       | Answered all three questions                  |
| `sent_to_instagram` | `POST /api/auth/instagram/start`               | Pressed Connect, we handed them to Instagram  |
| `connected`         | `/auth/outstand/callback`                      | Instagram came back, the account exists       |

## Things that will break if you change them

- **Stages only move forward** (`advanceStage` in `lib/data/signup-leads.ts`). A connected
  influencer who re-opens `/signup` must not drop back to `started`.
- **Counts come off the `*_at` stamps, never off `status`.** A connected lead also started;
  counting it only under `connected` makes the funnel understate every earlier step.
- **The connect stamp matches on the email the PERSON typed**, not the auth email. Instagram
  signups get a synthetic `ig_xxx@instagram.heypubli.com` auth address that matches nothing.
- **Nothing writes through RLS.** The table has a select policy for admins and no write
  policy at all; every write goes through the service-role client in a server route. The
  form feeding it is public, so an insert policy would let anyone forge leads.
- The CSV escapes cells starting with `=`, `+`, `-` or `@`. Every mobile number starts with
  `+`, and Excel would otherwise read it as a formula.
