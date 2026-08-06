# creator-brochure

## What it does

The setup guide at `/brochure`. One page, one creator, four steps, read top to
bottom like a printed leaflet. It replaces nothing: the three-step
`getting-started` card still sits on the dashboard, and this is the long form a
creator is sent to when they need the whole picture rather than a nudge.

## Files

- `Brochure.tsx` — the page. Server component.
- `Brochure.test.tsx` — Vitest
- `copy.ts` — every word, final
- `shots.ts` — the seven pictures, and the words that stand in for them
- `shots.test.ts` — fails if the manifest and `public/brochure` drift apart
- `Plate.tsx` — one picture, or the text that replaces it. Server component.
- `StatusStrip.tsx` — where a step stands. Server component.
- `CopyBlock.tsx` — client. Copy button with a visible, selectable fallback.
- `SkoolLinkForm.tsx` — client. Step 3.
- `RecheckButton.tsx` — client. Re-runs the real check via `router.refresh()`.
- `DeclareBioButton.tsx` — client. The step 4 escape hatch.
- `mock.ts` — two creators, one at the start and one finished
- `index.ts` — public exports

## Route

`/brochure` → `app/(influencer)/brochure/page.tsx`

`(influencer)` is the only group a signed-in creator lives in, and the parens
mean it does not appear in the URL. `(admin)` is gated on `is_admin`, `(auth)`
is the logged-out shell, and a bare `app/brochure/` would get no sidebar at all.

**`/brochure/:path*` is in the `middleware.ts` matcher and must stay there.**
That matcher is an allow-list: a path missing from it is not "unprotected", it
is a path middleware never runs on, so the page becomes public to anyone with
the URL. This page prints a creator's email address. `heypubli.com/v0` to `/v6`
were deleted on 2026-08-05 for exactly this mistake. The page also checks
`auth.getUser()` itself, because middleware should be the second lock, not the
only one.

## How each step knows it is done

| # | Step | Ticked by | Can it be faked |
|---|------|-----------|-----------------|
| 1 | Connect your Instagram | a live row in `outstand_connections` or `instagram_connections` | no |
| 2 | Join the community | a `skool_members` row for their email | no |
| 3 | Get your affiliate link | `profiles.skool_affiliate_url`, pasted by them | it is their own link, there is nothing to fake |
| 4 | Put it in your Instagram bio | their referral code found in the bio or website field | only via the escape hatch below, and that is stamped separately |

Step 4 reads the bio back through Outstand's `/social-accounts/{id}/metrics`,
which returns `biography` AND `website`. It does not compare URLs, it looks for
the `ref` value out of their Skool link, because Instagram strips the scheme
from the website field and creators paste with and without `www`.

**Five states, not two.** `done`, `todo`, `waiting`, `unknown`, `blocked`. The
order of the branches in `getBrochureData` is deliberate: every "we cannot
check" case is taken before the one that says "not there", so the only way a
creator is told their link is missing is if we genuinely read a bio without it.

**`bio_link_declared_at` is offered only in the `unknown` state.** Outstand
returns 402 when the subscription lapses and the metrics tier is optional, so
"we cannot read your bio" is a live possibility, not a hypothetical. Without the
escape hatch a creator who did everything right is stuck on the last step
forever with nothing on screen to press. It writes its own column so nobody
later mistakes a self-declared step for a verified one.

## The bio sentence

`lib/bio-variants.ts`. 32 hand-written lines, then 10 x 10 x 8 slot
combinations: 832 sentences before anything repeats. Every one is asserted at
build time to be under 100 characters, free of banned punctuation and free of
money words.

**Allocated from a sequence, never hashed from the user id.** A hash promises
repeatability, not uniqueness: with 384 possible lines and 100 creators you
expect about 13 duplicate pairs. `allocate_bio_variant(uuid)` takes the row
lock, so two tabs open at once get one number, and the number is frozen from
then on because the creator has copied that sentence onto a public profile.

**Not because Meta bans duplicate bios.** It does not, and there is no rule
anywhere in the Community Standards, the Terms or the Help Centre that says
otherwise. The documented risk is on the destination, not the profile: the
Recommendations Guidelines avoid recommending sites that get a disproportionate
share of their clicks from Instagram. Varied wording does not change that ratio.
We do it because a creator's page should not read like a form letter.

## The pictures

Seven, none of them taken yet, and the page is finished without them. Each shot
carries a `fallback` written as instruction, so the words teach the step on
their own and the picture is an upgrade rather than a dependency.

To add one: export to `public/brochure/<id>.webp` and change that shot's `src`
from `null`. `shots.test.ts` fails the build if a `src` points at a file that is
not there.

Export at exactly 828 x 1104 (`tall`) or 828 x 466 (`wide`), webp, under 120 KB.
Mark up in #E1306C, one arrow or circle each. Screenshot the real screen: no
mock-ups, no invented email subject lines.

## Three things not to undo

**Step 2 never says the invite is automatic.** It is not. Only Facebook
lead-form leads get one queued at capture; a self-serve signup waits for an
admin. A test asserts the words "automatic", "instantly" and "straight away"
stay out of that step.

**The creator's email address is printed on the page, in a callout.** Using a
different address in Skool is the one mistake here that costs them money and
cannot be spotted afterwards, because a Skool webhook gives us an email and
nothing else.

**Inter is loaded in `page.tsx`, not in `app/layout.tsx`.** Hugo's rule is Inter
900 for headings; the rest of the product is Geist. Scoping the font to this
page's wrapper gets the rule without repainting every other screen.

## Dependencies

`lib/data/brochure.ts`, `lib/actions/brochure.ts`, `lib/bio-variants.ts`,
`lib/bio-check.ts`, `lib/skool-link.ts`, `lib/data/outstand.ts`,
`lib/data/community.ts`, `lib/flags.ts`. Migration `023_creator_brochure.sql`.
