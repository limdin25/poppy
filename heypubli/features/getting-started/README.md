# getting-started

The three steps a new creator works through, on the right of the dashboard. It
replaced "Your products", a tier ladder of Nike / Adidas / Samsung logos
inherited from the Brazilian original that promised deals nobody had.

## The three steps

| # | Step | Ticked by |
|---|------|-----------|
| 1 | Connect your Instagram | a live Instagram connection |
| 2 | Join the community | a `skool_members` row for their email |
| 3 | Get your profile ready | the creator pressing the button |

Steps 1 and 2 read real state, so they cannot be faked and cannot go stale.
Step 3 is work inside the Instagram app (real name, photo, bio, affiliate link
in the website field) which we have no way to see, so it is self-declared and
stamped on `profiles.profile_ready_at`.

## Two things not to undo

**Step 2 never says the invite is automatic.** It is not. Only Facebook
lead-form leads get an invite queued at capture (`app/api/webhooks/fb-leads`);
a self-serve signup waits for an admin to approve them in `/admin/leads`. A
test asserts the word stays out of the copy.

**The same email in both places is the point, not a nicety.** Skool's paid
member webhook gives us an email and nothing else, so the email is the only
thing that can ever join a community sale back to the creator who sent the
buyer. The copy says so out loud.

## Videos

Each step takes an optional video via the `videos` prop
(`{ instagram: "/videos/step-1.mp4" }`). A step with no video renders no
player rather than an empty black box. Files go in `public/videos`.
