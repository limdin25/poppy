# Phase 1 — Decisions

One shell, for every UK trade. Rendered server-side as standalone HTML by `src/core/site-demo/render.ts`.

## Start questionnaire

| Item | Answer | Source |
|---|---|---|
| How to start | Step-by-step, director chosen by analysis | Hugo unavailable, inferred |
| Image placeholders | **No photography at all.** Geometry, type and inline SVG only | Forced by the content truth rules |
| Niche | UK trade services: plumber, electrician, roofer, locksmith, pest control and 14 more in `api/lib/trades.ts` | Hugo |
| Page list | One page. A demo site is a single scroll. | Inferred |
| Palette | Blue and white, light mode | Hugo |
| Constraint | Must adapt across trades with no redesign | Hugo |

## The visual problem, stated concretely

This page is a website for a plumber who has never seen it, opened on a phone, by someone who was cold-texted an hour ago. It has to solve four problems that a normal brief does not have:

1. **No photography exists.** We have never met this business. We have no van, no team, no finished bathrooms. Most trade sites are 80 percent stock photography. This one gets zero. Presence has to come from type, geometry and light alone.
2. **The content is genuinely thin and must stay thin.** Six or seven true facts: name, trade, town, phone, a service list, sometimes a Google rating. The truth rules forbid padding it with invented certifications, years in business, or guarantees. So the design must make a *small amount of true information feel substantial*, rather than hiding that it is small.
3. **It must feel local and grounded.** A plumber in Wigan should not be handed something that looks like a Series A startup.
4. **It must survive a trade swap.** Plumber to locksmith to pest control with no redesign.

## Director and film

**Yasujirō Ozu — late colour period, *An Autumn Afternoon* / *Good Morning*.**

Not chosen by association. Chosen because Ozu's method is the exact solution to problems 1 and 2. Two concrete devices:

- **The pillow shot.** Ozu cuts away to a held, static frame of an ordinary thing: an empty corridor, a kettle, a washing line, a rooftop. It carries no plot. Its function is to confer weight and pacing on everyday material *without adding content*. That is precisely what a page with seven true facts needs.
- **Frontal tatami framing.** Camera fixed low, subject square to the lens, composition rigorously symmetrical. Dignity through stillness and geometry rather than through spectacle or volume.

Late Ozu is also natively blue and white: flat blue-grey planes, white walls, one saturated accent per frame. The palette Hugo asked for is the palette the film already has.

### Anti-convergence check

1. **What specific visual problem does this film solve?** Pillow shots and frontal geometry make non-photogenic, ordinary subject matter feel considered and deliberate. This page has no photography and little content, and must not look impoverished.
2. **Would it work for three unrelated niches?** No. The low, domestic, patient register would be wrong for a fintech, a nightclub, or an agency. It fits the everyday working trade specifically.
3. **Reputation or analysis?** Analysis. The selection rests on two named techniques and their direct mapping to two named constraints, not on Ozu's standing.

## Previous-work audit

Prior surfaces by this user: the VSL video page (`api/vsl/page.ts`), the reviews client app, the landing page.

**Shell-ban list** — forbidden here because they would repeat prior work or collapse into template defaults:

- left copy with a right-hand object or device mock
- top navigation bar with stacked rounded cards below
- the rounded premium card matrix
- pill metadata rows
- gradient hero with centred copy
- testimonial carousel
- stat counters that animate on scroll
- glassmorphism and translucent panels

**Primary composition family: stacked frontal tableaux.** Distinct from the VSL page's vertical scroll-with-video and from the reviews app's dashboard grid.

## Uniqueness guardrail

Stripped of colour and typography, the wireframe must not resemble the VSL page. The distinguishing structural move is the low eye-line and the pillow bands, neither of which exists in any prior surface.

## Restraint statement

No photography. No gradients as decoration. No glassmorphism. No card matrix. No carousel. No invented statistics, certifications or guarantees. No hamburger menu. No cookie banner theatre. If a section works as a generic three-column grid, it gets rebuilt.
